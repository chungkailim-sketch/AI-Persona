import { notFound } from 'next/navigation';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { listProjectDatasets, getDatasetVersion } from '@/server/datasets';
import { DETECTION_CAVEAT } from '@/ingest/sensitivity';
import { QUALITY_CAVEAT } from '@/ingest/quality';
import { MODEL_PROCESSING_NOTICE } from '@/server/governance';
import Link from 'next/link';
import type { Route } from 'next';
import { WorkflowNav } from '../WorkflowNav';
import { IngestionMonitor } from './IngestionMonitor';
import { EmptyState } from '@/ui/components/States';
import { countEvents, readRecentEvents, readSnapshot } from '@/telemetry/read';
import { pipelineFromVersionStatus } from '@/telemetry/reduce';
import { downstreamImpact } from '@/server/workflow';
import { latestForecastAnalysis } from '@/forecast/analysis';
import { trendAnalysisView } from '@/forecast/view';
import { TrendRequestForm, TrendResults } from './TrendPanel';
import { StructuredPanel } from './StructuredPanel';
import { structuredTablesView } from '@/ingest/structured';
import {
  FieldReviewForm,
  FindingItem,
  GovernanceForm,
  UploadForm,
  type FieldRow,
} from './DataStep';

export const metadata = { title: 'Source data · Persona Intelligence' };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  AWAITING_UPLOAD: 'Waiting for files',
  UPLOADING: 'Uploading',
  SCANNING: 'Scanning',
  PARSING: 'Reading the files',
  PROFILING: 'Profiling fields',
  MAPPING: 'Mapping',
  VALIDATING: 'Validating',
  DETECTING_SENSITIVE: 'Checking for sensitive fields',
  READY_FOR_REVIEW: 'Ready for your review',
  IMPORTED: 'Imported',
  PARTIALLY_IMPORTED: 'Partly imported',
  FAILED: 'Failed',
};

function toDateInput(d: Date | null | undefined): string {
  return d ? d.toISOString().slice(0, 10) : '';
}

export default async function DataStepPage(props: PageProps<'/projects/[projectId]/data'>) {
  const { projectId } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser(`/projects/${projectId}/data`);

  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const canEdit = can(ctx, 'dataset.upload', projectId);
  const datasets = await listProjectDatasets(user, projectId);

  const requested = typeof search.version === 'string' ? search.version : undefined;
  const selectedId =
    requested ?? datasets.find((d) => d.latest)?.latest?.id ?? null;

  const detail = selectedId ? await getDatasetVersion(user, projectId, selectedId) : null;

  const fieldRows: FieldRow[] = (detail?.fields ?? []).map((f) => {
    const profile = f.profile as { withheld?: true; topValues?: { value: string; count: number }[] } | null;
    return {
      id: f.id,
      name: f.name,
      type: f.type,
      typeConfidence: f.typeConfidence,
      scalePoints: f.scalePoints,
      missingPct: f.missingPct,
      distinctCount: f.distinctCount,
      outlierCount: f.outlierCount,
      sensitivity: f.sensitivity,
      sensitivityReason: f.sensitivityReason,
      excluded: f.excluded,
      inclusionJustification: f.inclusionJustification,
      constructMappingGrade: f.constructMappingGrade,
      topValues: profile?.withheld ? null : (profile?.topValues ?? null),
      withheld: Boolean(profile?.withheld),
    };
  });

  // ── Live monitor inputs: recorded events, the authoritative snapshot, and — for versions
  //    ingested before per-stage events existed — a labelled reconstruction from the status.
  const monitor = detail
    ? await (async () => {
        const scope = { projectId, datasetVersionId: detail.version.id };
        const [events, snapshot, total] = await Promise.all([
          readRecentEvents(scope, 400),
          readSnapshot(scope),
          countEvents(scope),
        ]);
        const fallback = pipelineFromVersionStatus(detail.version.status, {
          approved: detail.usability.usable,
          scanned: false,
        });
        return { events, snapshot, total, fallback };
      })()
    : null;
  const impact = await downstreamImpact(projectId);
  const analysis = detail ? await latestForecastAnalysis(user, projectId, detail.version.id) : null;
  const trendView = analysis ? trendAnalysisView(analysis) : null;
  const structured = detail ? await structuredTablesView(detail.version.id) : [];
  const hasLongTable = ['wave_year', 'wave_month', 'statement', 'response', 'segment', 'share'].every((c) => (detail?.fields ?? []).some((f) => f.name.trim().toLowerCase() === c));
  const segmentGroups = (() => {
    const f = (detail?.fields ?? []).find((x) => x.name.trim().toLowerCase() === 'segment_group');
    const p = f?.profile as { withheld?: true; topValues?: { value: string }[] } | null | undefined;
    return p?.withheld ? [] : (p?.topValues ?? []).map((v) => v.value).filter(Boolean);
  })();
  const selectedName = datasets.find((d) => d.latest?.id === selectedId)?.name ?? 'Dataset';

  return (
    <div className="flex flex-col gap-6">
      <WorkflowNav projectId={projectId} projectName={project.name} current="DATA" />

      <header>
        <h1 className="text-2xl">Source data</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          Attach the evidence this project rests on, review what is in it, and record where it came
          from. Nothing can be simulated until a person has done all three — the automation below
          prepares the material, it does not clear it for use.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        {/* ── Sources column ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <section aria-labelledby="attached" className="panel">
            <div className="panel-head">
              <h2 id="attached" className="font-sans text-sm font-medium text-ink">Attached datasets</h2>
              <span className="font-mono text-[11px] text-ink-subtle">{datasets.length}</span>
            </div>
            {datasets.length === 0 ? (
              <p className="px-3.5 py-5 text-sm text-ink-muted">No data attached yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {datasets.map((d) => {
                  const selected = d.latest?.id === selectedId;
                  return (
                    <li key={d.datasetId}>
                      <Link
                        href={`/projects/${projectId}/data?version=${d.latest?.id ?? ''}` as Route}
                        aria-current={selected ? 'true' : undefined}
                        className={`motion-color block px-3.5 py-2.5 hover:bg-bg ${selected ? 'border-l-2 border-brand bg-brand-soft/40' : 'border-l-2 border-transparent'}`}
                      >
                        <span className="block truncate text-sm font-medium text-ink">{d.name}</span>
                        <span className="mt-0.5 block font-mono text-[10.5px] text-ink-subtle">
                          v{d.latest?.versionNo ?? 1} · {STATUS_LABEL[d.latest?.status ?? ''] ?? d.latest?.status}
                          {d.latest?.rowCount != null && ` · ${d.latest.rowCount.toLocaleString()} rows · ${d.latest.fieldCount} fields`}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1 text-[10px]">
                          {d.latest?.qualityScore != null && (
                            <span className="rounded-sm border border-line px-1.5 font-mono text-ink-muted">quality {d.latest.qualityScore}</span>
                          )}
                          {(d.latest?.blocking ?? 0) > 0 && (
                            <span className="rounded-sm border border-danger/40 bg-danger-soft px-1.5 font-mono text-danger">{d.latest?.blocking} blocking</span>
                          )}
                          {(d.latest?.warnings ?? 0) > 0 && (
                            <span className="rounded-sm border border-warn/40 bg-warn-soft px-1.5 font-mono text-warn">{d.latest?.warnings} to acknowledge</span>
                          )}
                          <span className={`rounded-sm border px-1.5 font-mono ${d.latest?.modelProcessingAllowed ? 'border-ok/40 bg-ok-soft text-ok' : 'border-warn/40 bg-warn-soft text-warn'}`}>
                            {d.latest?.modelProcessingAllowed ? 'model processing permitted' : 'model processing not permitted'}
                          </span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {canEdit && (
            <section aria-labelledby="upload" className="panel">
              <div className="panel-head">
                <h2 id="upload" className="font-sans text-sm font-medium text-ink">Attach data</h2>
              </div>
              <div className="px-3.5 pb-3.5">
                {(impact.cohorts > 0 || impact.runs > 0) && (
                  <p className="mt-3 rounded border border-info/40 bg-info-soft px-3 py-2 text-xs text-ink">
                    <strong className="font-medium">Impact before you upload:</strong> {impact.cohorts} cohort(s)
                    ({impact.approvedCohorts} approved) and {impact.runs} run(s) ({impact.completedRuns} completed)
                    already exist. They keep the dataset versions they were built from and are not changed; to use new
                    data, generate a new cohort in step 3.
                  </p>
                )}
                <UploadForm projectId={projectId} />
              </div>
            </section>
          )}
          {!canEdit && (
            <p className="panel px-3.5 py-3 text-sm text-ink-muted">
              You can view this project&rsquo;s data but not change it. Uploading, reviewing fields and
              recording provenance need the <span className="font-mono">dataset.upload</span> permission,
              which belongs to owners and collaborators.
            </p>
          )}
        </div>

        {/* ── Monitor column ─────────────────────────────────────────────── */}
        <div className="min-w-0">
          {detail && monitor ? (
            <IngestionMonitor
              key={detail.version.id}
              projectId={projectId}
              datasetVersionId={detail.version.id}
              datasetName={selectedName}
              initialEvents={monitor.events}
              initialSnapshot={monitor.snapshot}
              fallbackPipeline={monitor.fallback}
              serverTotal={monitor.total}
              fieldCount={detail.fields.length}
              blockers={detail.usability.blockers}
              canRetry={canEdit}
            />
          ) : (
            <EmptyState title="Nothing is being processed" icon="database">
              Attach a CSV or XLSX file. Each stage of ingestion appears here as the server records it —
              upload, scan status, parsing, profiling, sensitive-data detection and evidence preparation.
            </EmptyState>
          )}
        </div>
      </div>

      {/* ── Readiness ────────────────────────────────────────────────────── */}
      {detail && (
        <section aria-labelledby="readiness" className="">
          <h2 id="readiness" className="text-lg">Can this be used?</h2>
          {detail.usability.usable ? (
            <p className="mt-3 rounded border border-ok bg-ok-soft px-4 py-3 text-sm text-ok">
              Yes. Every condition is met: ingestion finished, findings are acknowledged, provenance
              is recorded, the field review is confirmed and model processing is permitted.
            </p>
          ) : (
            <div className="mt-3 rounded border border-warn bg-warn-soft/40 px-4 py-3">
              <p className="text-sm font-medium text-ink">Not yet. Outstanding:</p>
              <ul className="mt-2 flex flex-col gap-1.5">
                {detail.usability.blockers.map((b) => (
                  <li key={b} className="flex gap-2 text-sm text-ink-muted">
                    <span aria-hidden className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-warn" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* ── Structured data ──────────────────────────────────────────────── */}
      {detail && structured.length > 0 && (
        <section aria-labelledby="structured" className="">
          <h2 id="structured" className="text-lg">Structured data</h2>
          <p className="mt-1 max-w-prose text-xs text-ink-subtle">
            What the upload contains, as tables ready to use: report layouts such as Mintel databooks flattened into one
            long table (market × wave × question × response × segment, each with its base), column names turned into
            identifiers, &ldquo;no data&rdquo; markers blanked and numbers written plainly. Nothing is imputed. Each table has a data
            dictionary, and downloads leave out any column excluded in the field review.
          </p>
          <div className="mt-3">
            <StructuredPanel projectId={projectId} datasetVersionId={detail.version.id} tables={structured} canDownload={canEdit} />
          </div>
        </section>
      )}

      {/* ── Quality ──────────────────────────────────────────────────────── */}
      {detail && detail.version.quality.length > 0 && (
        <section aria-labelledby="quality" className="">
          <h2 id="quality" className="text-lg">
            Quality {detail.version.qualityScore != null && (
              <span className="font-mono text-base text-ink-muted">
                {detail.version.qualityScore}/100
              </span>
            )}
          </h2>
          <p className="mt-1 max-w-prose text-xs text-ink-subtle">{QUALITY_CAVEAT}</p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {detail.version.quality.map((c) => (
              <li key={c.id} className="rounded border border-line bg-surface p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-ink">{c.label}</span>
                  <span className="font-mono text-sm text-ink-muted">
                    {c.score} <span className="text-[10px] text-ink-subtle">×{c.weight}</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-subtle">{c.explanation}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Integrity findings ───────────────────────────────────────────── */}
      {detail && detail.version.integrity.length > 0 && (
        <section aria-labelledby="integrity" className="">
          <h2 id="integrity" className="text-lg">What the checks found</h2>
          <p className="mt-1 max-w-prose text-xs text-ink-subtle">
            Each of these corresponds to a defect that has actually appeared in supplier data and
            would have changed a conclusion without being noticed.
          </p>
          <ul className="mt-3 flex flex-col gap-2">
            {detail.version.integrity.map((f) => (
              <FindingItem
                key={f.id}
                projectId={projectId}
                finding={{
                  id: f.id,
                  check: f.check,
                  severity: f.severity,
                  message: f.message,
                  acknowledged: Boolean(f.acknowledgedAt),
                }}
              />
            ))}
          </ul>
        </section>
      )}

      {/* ── Trends and forecast gate ──────────────────────────────────────── */}
      {detail && hasLongTable && (
        <section aria-labelledby="trends" className="border-t border-line pt-6">
          <h2 id="trends" className="text-lg">Trends across waves</h2>
          <p className="mt-1 max-w-prose text-xs text-ink-subtle">
            Which tracked measures have moved, and by more than sampling noise. A forecast is shown only if
            the ten-question forecast gate passes; when it refuses, trend classification is the answer.
            Computed in code from the stored table — no language model is involved.
          </p>
          <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <div className="panel px-3.5 py-3">
              {canEdit ? (
                <TrendRequestForm projectId={projectId} datasetVersionId={detail.version.id} groups={segmentGroups} />
              ) : (
                <p className="text-sm text-ink-muted">Running an analysis needs the <span className="font-mono">dataset.upload</span> permission.</p>
              )}
              {trendView && (
                <p className="mt-3 font-mono text-[10.5px] text-ink-subtle">
                  Last analysis {trendView.completedAt ? new Date(trendView.completedAt).toISOString().slice(0, 16).replace('T', ' ') : 'pending'} UTC · groups {trendView.groups.join(', ')}
                </p>
              )}
            </div>
            <div className="min-w-0">
              {trendView ? (
                <TrendResults analysis={trendView} />
              ) : (
                <EmptyState title="No trend analysis yet" icon="chart">
                  Run the analysis to classify every complete series as rising, falling or no detectable change,
                  and to see whether this history could support a forecast.
                </EmptyState>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Governance ───────────────────────────────────────────────────── */}
      {detail && canEdit && (
        <section aria-labelledby="governance" className="border-t border-line pt-6">
          <h2 id="governance" className="text-lg">Provenance and permission</h2>
          <GovernanceForm
            projectId={projectId}
            datasetVersionId={detail.version.id}
            notice={MODEL_PROCESSING_NOTICE}
            defaults={{
              dataOwner: detail.version.governance?.dataOwner ?? '',
              sourceName: detail.version.governance?.sourceName ?? '',
              methodology: detail.version.governance?.methodology ?? '',
              collectionStart: toDateInput(detail.version.governance?.collectionStart),
              collectionEnd: toDateInput(detail.version.governance?.collectionEnd),
              geography: (detail.version.governance?.geography ?? []).join(', '),
              language: (detail.version.governance?.language ?? []).join(', '),
              sampleSize: detail.version.governance?.sampleSize?.toString() ?? '',
              lawfulBasis: detail.version.governance?.lawfulBasis ?? 'NOT_APPLICABLE_AGGREGATE',
              classification: detail.version.governance?.classification ?? 'CLIENT_CONFIDENTIAL',
              permittedUses: (detail.version.governance?.permittedUses ?? []).join(', '),
              restrictions: detail.version.governance?.restrictions ?? '',
              retentionDays: detail.version.governance?.retentionDays ?? 90,
              allowModelProcessing: detail.version.governance?.allowModelProcessing ?? false,
            }}
          />
        </section>
      )}

      {/* ── Field review ─────────────────────────────────────────────────── */}
      {detail && fieldRows.length > 0 && canEdit && (
        <section aria-labelledby="fields" className="border-t border-line pt-6">
          <h2 id="fields" className="text-lg">Field review</h2>
          <FieldReviewForm
            projectId={projectId}
            datasetVersionId={detail.version.id}
            fields={fieldRows}
            detectionCaveat={DETECTION_CAVEAT}
          />
        </section>
      )}

    </div>
  );
}

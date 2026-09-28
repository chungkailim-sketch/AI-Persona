import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { assembleReport } from '@/report/assemble';
import { checkReport, listExports, OVERRIDE_MINIMUM } from '@/report/export';
import { CLAIM_CHECK_NOTICE } from '@/report/claimCheck';
import type { Route } from 'next';
import { WorkflowNav } from '../WorkflowNav';
import { ResultsOverview } from './ResultsOverview';
import { resultsSummary } from '@/report/summary';
import { SimulationNotice } from '@/ui/components/SimulationNotice';
import {
  ClaimCheckPanel,
  EvidenceDrawer,
  ExportPanel,
  LimitationsBlock,
  type FindingRow,
} from './ResultsStep';

export const metadata = { title: 'Results · Persona Intelligence' };
export const dynamic = 'force-dynamic';

export default async function ResultsStepPage(props: PageProps<'/projects/[projectId]/results'>) {
  const { projectId } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser(`/projects/${projectId}/results`);

  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'report.view', projectId)) notFound();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true },
  });
  if (!project) notFound();

  const completed = await prisma.run.findMany({
    where: { projectId, status: { in: ['COMPLETED', 'COMPLETED_WITH_WARNINGS'] } },
    orderBy: { completedAt: 'desc' },
    select: { id: true, completedAt: true, status: true, isMock: true },
  });

  if (completed.length === 0) {
    return (
      <div>
        <WorkflowNav projectId={projectId} projectName={project.name} current="RESULTS" />
        <h1 className="mt-6 text-2xl">Results</h1>
        <p className="mt-3 max-w-prose rounded border border-line bg-surface px-4 py-6 text-sm text-ink-muted">
          No run has completed in this project yet. Results appear here once one has.
        </p>
        <p className="mt-4 text-sm">
          <Link
            href={`/projects/${projectId}/simulate`}
            className="text-brand underline-offset-2 hover:underline"
          >
            Go to the simulation step
          </Link>
        </p>
      </div>
    );
  }

  const requested = typeof search.run === 'string' ? search.run : undefined;
  const runId = completed.find((r) => r.id === requested)?.id ?? completed[0]!.id;

  const report = await assembleReport(user, projectId, runId);
  const checked = checkReport(report);
  const blockedCount = checked.flatMap((c) => c.issues.filter((i) => i.severity === 'blocking')).length;
  const exports = await listExports(user, projectId, runId);
  const canExport = can(ctx, 'report.export', projectId);

  const summary = await resultsSummary(runId, report.findings[0]?.id ?? null);

  const findings: FindingRow[] = report.findings.map((f) => ({
    id: f.id,
    title: f.title,
    claim: f.claim,
    evidenceGrade: f.evidenceGrade,
    classification: f.classification,
    confidence: f.confidence,
    consensusRatio: f.consensusRatio,
    limitations: f.limitations,
    votes: f.votes,
  }));

  return (
    <div>
      <WorkflowNav projectId={projectId} projectName={project.name} current="RESULTS" />

      <h1 className="mt-6 text-2xl">Results</h1>

      {completed.length > 1 && (
        <nav aria-label="Runs" className="mt-3 flex flex-wrap gap-1">
          {completed.map((r) => (
            <Link
              key={r.id}
              href={`/projects/${projectId}/results?run=${r.id}`}
              aria-current={r.id === runId ? 'page' : undefined}
              className={
                r.id === runId
                  ? 'rounded bg-brand px-3 py-1 text-xs text-brand-ink'
                  : 'rounded bg-surface px-3 py-1 text-xs text-ink-muted hover:text-ink'
              }
            >
              {r.completedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? 'run'}
              {r.isMock && ' · mock'}
            </Link>
          ))}
        </nav>
      )}

      {/* ── What the run found ───────────────────────────────────────────── */}
      <section aria-labelledby="answer" className="mt-8">
        <SimulationNotice isMock={report.isMock} className="mb-4" />
        <h2 id="answer" className="text-lg">What the run found</h2>
        <p className="mt-2 max-w-prose text-base text-ink">{report.directAnswer}</p>
        {report.groupthinkWarning && (
          <p className="mt-3 max-w-prose rounded border border-danger bg-danger-soft px-4 py-3 text-sm text-danger">
            Herding was detected in this panel. The agreement above was produced by exposure to
            other views, not by independent reasoning — read it as one view held by many.
          </p>
        )}
      </section>

      <p className="no-print mt-4 flex flex-wrap gap-2">
        <Link href={`/projects/${projectId}/results/report?run=${runId}` as Route} className="inline-flex items-center gap-1.5 rounded border border-line-strong bg-surface px-3 py-1.5 text-sm text-ink hover:border-brand">
          Open report mode
        </Link>
        <Link href={`/projects/${projectId}/simulate?run=${runId}` as Route} className="inline-flex items-center gap-1.5 rounded border border-line px-3 py-1.5 text-sm text-ink-muted hover:text-ink">
          Run telemetry
        </Link>
      </p>

      <div className="mt-6">
        <ResultsOverview report={report} summary={summary} />
      </div>

      {/* ── Limitations, before the detail ───────────────────────────────── */}
      <LimitationsBlock
        limitations={report.limitations}
        isMock={report.isMock}
        groupthink={report.groupthinkWarning}
      />

      {/* ── Confidence ───────────────────────────────────────────────────── */}
      <section aria-labelledby="confidence" className="mt-10">
        <h2 id="confidence" className="text-lg">How much to trust it</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">{report.confidenceBasis}</p>
        {report.antiHerd && (
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-line bg-surface p-3">
              <dt className="text-xs text-ink-subtle">Flip rate</dt>
              <dd className="mt-1 font-mono text-xl text-ink">
                {report.antiHerd.flipRate.toFixed(2)}
              </dd>
              <dd className="mt-1 text-xs text-ink-subtle">
                Share who changed position after the challenge round.
              </dd>
            </div>
            <div className="rounded border border-line bg-surface p-3">
              <dt className="text-xs text-ink-subtle">Stance entropy</dt>
              <dd className="mt-1 font-mono text-xl text-ink">
                {report.antiHerd.entropy.toFixed(2)}
              </dd>
              <dd className="mt-1 text-xs text-ink-subtle">
                0 means the panel converged on one answer; 1 means it split evenly.
              </dd>
            </div>
            <div className="rounded border border-line bg-surface p-3">
              <dt className="text-xs text-ink-subtle">Dissent survival</dt>
              <dd className="mt-1 font-mono text-xl text-ink">
                {report.antiHerd.dissentSurvival.toFixed(2)}
              </dd>
              <dd className="mt-1 text-xs text-ink-subtle">
                Share of independent dissenters still dissenting at the end.
              </dd>
            </div>
          </dl>
        )}
      </section>

      {/* ── Hypotheses and the bar set in advance ────────────────────────── */}
      {report.hypotheses.length > 0 && (
        <section aria-labelledby="hypotheses" className="mt-12 border-t border-line pt-8">
          <h2 id="hypotheses" className="text-lg">The bar, set before the run</h2>
          <p className="mt-1 max-w-prose text-xs text-ink-subtle">
            Shown beside what the run found so you can judge for yourself whether it was met, rather
            than being told.
          </p>
          <ul className="mt-4 flex flex-col gap-3">
            {report.hypotheses.map((h) => (
              <li key={h.label} className="rounded border border-line bg-surface p-4">
                <p className="text-sm text-ink">
                  <span className="mr-2 rounded bg-bg px-2 py-0.5 font-mono text-[10px] uppercase text-ink-muted">
                    {h.label}
                  </span>
                  {h.statement}
                </p>
                <p className="mt-2 text-xs text-ink-muted">
                  <span className="font-medium">Set in advance as the bar:</span>{' '}
                  {h.minimumEvidenceThreshold}
                </p>
                {h.alternativeExplanations.length > 0 && (
                  <p className="mt-1 text-xs text-ink-subtle">
                    Other explanations to rule out: {h.alternativeExplanations.join('; ')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Findings with evidence drawers ───────────────────────────────── */}
      <section aria-labelledby="findings" className="mt-12 border-t border-line pt-8">
        <h2 id="findings" className="text-lg">Findings</h2>
        <ul className="mt-4 flex flex-col gap-3">
          {findings.map((f) => (
            <EvidenceDrawer key={f.id} finding={f} panelSize={report.panelSize} />
          ))}
        </ul>
      </section>

      {/* ── Dissent ──────────────────────────────────────────────────────── */}
      {report.dissents.length > 0 && (
        <section aria-labelledby="dissent" className="mt-12 border-t border-line pt-8">
          <h2 id="dissent" className="text-lg">Dissent</h2>
          <p className="mt-1 max-w-prose text-xs text-ink-subtle">
            Recorded rather than averaged away. A minority view that survived the challenge round is
            often the most informative thing in a run.
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {report.dissents.map((d, i) => (
              <li key={`${d.personaKey}-${i}`} className="rounded border border-line bg-surface p-3">
                <p className="text-xs">
                  <span className="font-mono text-ink">{d.personaKey}</span>{' '}
                  <span className="rounded bg-bg px-2 py-0.5 font-mono text-[10px] text-ink-muted">
                    {d.position}
                  </span>
                </p>
                {d.note && <p className="mt-1 text-xs text-ink-muted">{d.note}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Evidence ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="evidence" className="mt-12 border-t border-line pt-8">
        <h2 id="evidence" className="text-lg">Evidence this rests on</h2>
        <ul className="mt-4 flex flex-col gap-3">
          {report.evidence.map((e) => (
            <li key={e.datasetName} className="rounded border border-line bg-surface p-4">
              <p className="font-medium text-ink">{e.datasetName}</p>
              <p className="mt-1 text-xs text-ink-subtle">
                {e.rowCount.toLocaleString()} responses · {e.fieldCount} measures used
                {e.collectionPeriod && ` · collected ${e.collectionPeriod}`}
              </p>
              <p className="mt-2 text-xs text-ink-muted">{e.methodology}</p>
              {e.caveats.map((c) => (
                <p key={c} className="mt-2 text-xs text-warn">
                  {c}
                </p>
              ))}
            </li>
          ))}
        </ul>
      </section>

      {/* ── Claim check ──────────────────────────────────────────────────── */}
      <ClaimCheckPanel checked={checked} notice={CLAIM_CHECK_NOTICE} />

      {/* ── Provenance of the run itself ─────────────────────────────────── */}
      <section aria-labelledby="provenance" className="mt-12 border-t border-line pt-8">
        <h2 id="provenance" className="text-lg">How this run was produced</h2>
        <dl className="mt-3 grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-subtle">Provider</dt>
          <dd className="font-mono text-xs text-ink">
            {report.modelProvider} ({report.modelId})
          </dd>
          <dt className="text-ink-subtle">Model calls</dt>
          <dd className="font-mono text-xs text-ink">
            {report.callCount} · ${report.spendUsd.toFixed(4)} recorded
          </dd>
          <dt className="text-ink-subtle">Seeds</dt>
          <dd className="font-mono text-xs text-ink">{report.seeds.join(', ')}</dd>
          <dt className="text-ink-subtle">Plan hash</dt>
          <dd className="break-all font-mono text-xs text-ink">{report.planHash}</dd>
        </dl>
        <p className="mt-2 max-w-prose text-xs text-ink-subtle">
          The plan hash identifies the cohort, evidence, brief, model, seeds and prompt version. A
          run with the same hash asked the same question of the same material in the same way.
        </p>
      </section>

      {/* ── Export ───────────────────────────────────────────────────────── */}
      {canExport ? (
        <ExportPanel
          projectId={projectId}
          runId={runId}
          blockedCount={blockedCount}
          overrideMinimum={OVERRIDE_MINIMUM}
        />
      ) : (
        <p className="mt-10 max-w-prose rounded border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          You can read this report but not export it.
        </p>
      )}

      {exports.length > 0 && (
        <section aria-labelledby="exports" className="mt-10">
          <h3 id="exports" className="text-sm font-medium text-ink">Export history</h3>
          <ul className="mt-2 flex flex-col gap-1.5">
            {exports.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span className="font-mono text-[10px] text-ink-subtle">
                  {e.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                </span>
                <span className="font-mono text-ink-muted">{e.format}</span>
                {e.blocked ? (
                  <span className="rounded bg-danger-soft px-2 py-0.5 font-mono text-[10px] text-danger">
                    blocked
                  </span>
                ) : e.reviewerAckAt ? (
                  <span className="rounded bg-warn-soft px-2 py-0.5 font-mono text-[10px] text-warn">
                    overridden
                  </span>
                ) : (
                  <span className="rounded bg-ok-soft px-2 py-0.5 font-mono text-[10px] text-ok">
                    exported
                  </span>
                )}
                {e.blockReason && <span className="text-ink-subtle">{e.blockReason}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

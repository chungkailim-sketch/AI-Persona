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
import { findingsDetail, resultsSummary } from '@/report/summary';
import { SimulationNotice } from '@/ui/components/SimulationNotice';
import {
  ClaimCheckPanel,
  EvidenceDrawer,
  ExportPanel,
  type FindingRow,
} from './ResultsStep';
import { fmtDateTime } from '@/lib/time';
import { FindingsDetailPanel } from './FindingsDetail';

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
    select: { id: true, completedAt: true, status: true, isMock: true, config: { select: { hypothesisId: true } } },
  });
  const briefRow = await prisma.brief.findFirst({
    where: { projectId },
    orderBy: { versionNo: 'desc' },
    include: { hypotheses: { orderBy: { createdAt: 'asc' } } },
  });
  const hypotheses = briefRow?.hypotheses ?? [];
  // Runs made before the choice existed tested the brief's first hypothesis.
  const testedBy = (r: (typeof completed)[number]) => r.config?.hypothesisId ?? hypotheses[0]?.id ?? null;

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
  const requestedRun = completed.find((r) => r.id === requested);
  const hypothesisParam = typeof search.hypothesis === 'string' ? search.hypothesis : undefined;
  const hypothesisId =
    (hypothesisParam && hypotheses.some((h) => h.id === hypothesisParam) ? hypothesisParam : undefined) ??
    (requestedRun ? testedBy(requestedRun) : undefined) ??
    testedBy(completed[0]!);
  const forHypothesis = completed.filter((r) => testedBy(r) === hypothesisId);
  const runId = (requestedRun && testedBy(requestedRun) === hypothesisId ? requestedRun.id : forHypothesis[0]?.id) ?? null;
  const selectedHypothesis = hypotheses.find((h) => h.id === hypothesisId) ?? null;
  const hypothesisNav = hypotheses.length > 1 && (
    <nav aria-label="Hypothesis" className="mt-3 flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-xs text-ink-subtle">Hypothesis</span>
      {hypotheses.map((h) => {
        const runs = completed.filter((r) => testedBy(r) === h.id).length;
        return (
          <Link
            key={h.id}
            href={`/projects/${projectId}/results?hypothesis=${h.id}` as Route}
            aria-current={h.id === hypothesisId ? 'page' : undefined}
            title={h.statement}
            className={
              h.id === hypothesisId
                ? 'rounded border border-brand bg-brand px-3 py-1 text-xs text-brand-ink'
                : 'rounded border border-line bg-surface px-3 py-1 text-xs text-ink-muted hover:text-ink'
            }
          >
            {h.label} · {runs} run{runs === 1 ? '' : 's'}
          </Link>
        );
      })}
    </nav>
  );

  if (!runId) {
    return (
      <div>
        <WorkflowNav projectId={projectId} projectName={project.name} current="RESULTS" />
        <h1 className="mt-6 text-2xl">Results</h1>
        {hypothesisNav}
        <p className="mt-4 max-w-prose rounded border border-line bg-surface px-4 py-6 text-sm text-ink-muted">
          No completed run has tested {selectedHypothesis ? `${selectedHypothesis.label} ("${selectedHypothesis.statement}")` : 'this hypothesis'} yet.{' '}
          <Link href={`/projects/${projectId}/simulate` as Route} className="text-brand underline-offset-2 hover:underline">Plan a run for it</Link>.
        </p>
      </div>
    );
  }

  const report = await assembleReport(user, projectId, runId);
  const checked = checkReport(report);
  const blockedCount = checked.flatMap((c) => c.issues.filter((i) => i.severity === 'blocking')).length;
  const exports = await listExports(user, projectId, runId);
  const canExport = can(ctx, 'report.export', projectId);

  const summary = await resultsSummary(runId, report.findings[0]?.id ?? null);
  const detail = await findingsDetail(runId, report.findings[0]?.id ?? null, summary.rows);

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
      {hypothesisNav}

      {forHypothesis.length > 1 && (
        <nav aria-label="Runs" className="mt-3 flex flex-wrap gap-1">
          {forHypothesis.map((r) => (
            <Link
              key={r.id}
              href={`/projects/${projectId}/results?hypothesis=${hypothesisId}&run=${r.id}` as Route}
              aria-current={r.id === runId ? 'page' : undefined}
              className={
                r.id === runId
                  ? 'rounded bg-brand px-3 py-1 text-xs text-brand-ink'
                  : 'rounded bg-surface px-3 py-1 text-xs text-ink-muted hover:text-ink'
              }
            >
              {r.completedAt ? fmtDateTime(r.completedAt) : 'run'}
              {r.isMock && ' · mock'}
            </Link>
          ))}
        </nav>
      )}

      {/* ── What the run found ───────────────────────────────────────────── */}
      <section aria-labelledby="answer" className="mt-8">
        <SimulationNotice isMock={report.isMock} className="mb-4" />
        <h2 id="answer" className="text-lg">What the run found</h2>
        {selectedHypothesis && (
          <p className="mt-1 max-w-prose text-sm text-ink-muted">
            <span className="mr-1.5 rounded bg-bg px-1.5 py-0.5 font-mono text-[10px] uppercase">{selectedHypothesis.label}</span>
            {selectedHypothesis.statement}
          </p>
        )}
        <p className="mt-2 max-w-prose text-base text-ink">{report.directAnswer}</p>
        <FindingsDetailPanel detail={detail} />
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

      {/* ── Findings with evidence drawers ───────────────────────────────── */}
      <section aria-labelledby="findings" className="mt-12 border-t border-line pt-8">
        <h2 id="findings" className="text-lg">Findings</h2>
        <ul className="mt-4 flex flex-col gap-3">
          {findings.map((f) => (
            <EvidenceDrawer key={f.id} finding={f} panelSize={report.panelSize} />
          ))}
        </ul>
      </section>

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
                  {fmtDateTime(e.createdAt)}
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

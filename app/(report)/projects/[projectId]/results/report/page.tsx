import Link from 'next/link';
import type { Route } from 'next';
import { notFound } from 'next/navigation';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { assembleReport } from '@/report/assemble';
import { nextExperiments, resultsSummary } from '@/report/summary';
import { ReportModeLayout } from '@/ui/components/ReportModeLayout';
import { PrintButton } from '@/ui/components/PrintButton';
import { FindingSeverityBadge } from '@/ui/components/FindingSeverityBadge';
import { findingSeverity } from '@/telemetry/status';

export const metadata = { title: 'Report · Persona Intelligence' };
export const dynamic = 'force-dynamic';

const CLASS_WORD: Record<string, string> = {
  CONFIRMED: 'Confirmed', PROBABLE: 'Probable', CONTESTED: 'Contested', MINORITY_RETAINED: 'Minority retained', DISCARDED: 'Discarded',
};

export default async function ReportModePage(props: PageProps<'/projects/[projectId]/results/report'>) {
  const { projectId } = await props.params;
  const search = await props.searchParams;
  const user = await requireUser(`/projects/${projectId}/results`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'report.view', projectId)) notFound();

  const requested = typeof search.run === 'string' ? search.run : undefined;
  const run = await prisma.run.findFirst({
    where: { projectId, status: { in: ['COMPLETED', 'COMPLETED_WITH_WARNINGS'] }, ...(requested ? { id: requested } : {}) },
    orderBy: { completedAt: 'desc' },
    select: { id: true, mode: true },
  });
  if (!run) notFound();

  const report = await assembleReport(user, projectId, run.id);
  const summary = await resultsSummary(run.id, report.findings[0]?.id ?? null);
  const f = report.findings[0];

  return (
    <ReportModeLayout
      title={report.headline || 'Simulation report'}
      projectName={report.projectName}
      generatedAt={new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'}
      isMock={report.isMock}
      config={[
        { label: 'Run', value: report.runId },
        { label: 'Completed', value: report.completedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '—' },
        { label: 'Mode', value: run.mode.toLowerCase().replace(/_/g, ' ') },
        { label: 'Provider', value: `${report.modelProvider} · ${report.modelId}` },
        { label: 'Seeds', value: report.seeds.join(', ') },
        { label: 'Plan hash', value: report.planHash.slice(0, 16) + '…' },
      ]}
      actions={
        <>
          <Link href={`/projects/${projectId}/results?run=${run.id}` as Route} className="text-sm text-link underline-offset-2 hover:underline">
            ← Back to results
          </Link>
          <PrintButton />
        </>
      }
    >
      <section aria-labelledby="r-answer">
        <h2 id="r-answer" className="text-xl">What the run found</h2>
        <p className="mt-2 text-base text-ink">{report.directAnswer}</p>
        <p className="mt-2 text-sm text-ink-muted">{report.qualifiedRecommendation}</p>
        {f && (
          <p className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            <FindingSeverityBadge {...(() => { const s = findingSeverity({ severity: null, classification: f.classification, groupthink: report.groupthinkWarning }); return { level: s.level, derived: s.derived }; })()} />
            Classification: <strong className="font-medium text-ink">{f.classification ? CLASS_WORD[f.classification] : '—'}</strong>
            · support {f.consensusRatio === null ? '—' : `${Math.round(f.consensusRatio * 100)}%`} of {report.panelSize}
            · evidence grade L3 (simulation)
          </p>
        )}
      </section>

      <section aria-labelledby="r-limits" className="rounded border border-warn/50 p-4">
        <h2 id="r-limits" className="text-xl">What this cannot support</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
          {report.limitations.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </section>

      <section aria-labelledby="r-method">
        <h2 id="r-method" className="text-xl">Methodology</h2>
        <p className="mt-2 text-sm text-ink-muted">
          Each approved persona assessed the hypothesis alone; at least half the panel then argued against the majority view;
          every persona reconsidered; the distribution was computed arithmetically, with anti-herding metrics. Every answer was
          validated against a schema before use. {report.confidenceBasis}
        </p>
      </section>

      {report.hypotheses.length > 0 && (
        <section aria-labelledby="r-bar">
          <h2 id="r-bar" className="text-xl">The bar, set before the run</h2>
          <ul className="mt-2 flex flex-col gap-2 text-sm">
            {report.hypotheses.map((h) => (
              <li key={h.label}><span className="font-mono text-ink-subtle">{h.label}</span> {h.statement}<br /><span className="text-ink-muted">Bar: {h.minimumEvidenceThreshold}</span></li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="r-seg">
        <h2 id="r-seg" className="text-xl">Segment comparison</h2>
        <p className="mt-1 text-xs text-ink-subtle">Simulated positions. No statistical significance is claimed.</p>
        <table className="mt-2 w-full text-left text-[12.5px]">
          <thead className="border-b border-line text-ink-subtle">
            <tr><th scope="col" className="py-1.5 font-normal">Segment</th><th scope="col" className="py-1.5 font-normal">Independent</th><th scope="col" className="py-1.5 font-normal">After challenge</th><th scope="col" className="py-1.5 font-normal">Base</th><th scope="col" className="py-1.5 font-normal">Confidence</th></tr>
          </thead>
          <tbody>
            {summary.rows.map((r) => (
              <tr key={r.persona} className="border-b border-line/70"><th scope="row" className="py-1.5 font-normal">{r.segment}</th><td className="font-mono">{r.independent}</td><td className="font-mono">{r.final}{r.moved ? ' (moved)' : ''}</td><td className="font-mono">{r.baseSize ?? '—'}</td><td>{r.confidence.toLowerCase()}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      {report.dissents.length > 0 && (
        <section aria-labelledby="r-dissent">
          <h2 id="r-dissent" className="text-xl">Dissent</h2>
          <ul className="mt-2 flex flex-col gap-1.5 text-sm">
            {report.dissents.slice(0, 20).map((d, i) => (
              <li key={`${d.personaKey}-${i}`}><span className="font-mono">{d.personaKey}</span> — {d.position}{d.note ? `: ${d.note}` : ''}</li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="r-evidence">
        <h2 id="r-evidence" className="text-xl">Evidence this rests on</h2>
        <ul className="mt-2 flex flex-col gap-2 text-sm">
          {report.evidence.map((e) => (
            <li key={e.datasetName}>
              <strong className="font-medium">{e.datasetName}</strong> — {e.rowCount.toLocaleString()} rows, {e.fieldCount} measures{e.collectionPeriod ? `, collected ${e.collectionPeriod}` : ''}.
              <span className="block text-ink-muted">{e.methodology}</span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="r-next">
        <h2 id="r-next" className="text-xl">Suggested next experiments</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm text-ink-muted">
          {nextExperiments(report, summary).map((s) => <li key={s}>{s}</li>)}
        </ul>
      </section>
    </ReportModeLayout>
  );
}

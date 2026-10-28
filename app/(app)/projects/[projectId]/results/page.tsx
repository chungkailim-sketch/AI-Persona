import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { loadReport } from '@/roundtable/report';
import { PILLARS } from '@/roundtable/marketIndex';
import { SlideDeck } from '@/ui/report/Slides';
import { WorkflowNav } from '../WorkflowNav';
import { MarketInputsForm } from './MarketInputsForm';

export const metadata = { title: 'Report · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

/** Step 5 — the slide report, the market inputs behind its indices, and the PDF. */
export default async function ReportStepPage(props: PageProps<'/projects/[projectId]/results'>) {
  const { projectId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/results`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) notFound();

  const report = await loadReport(projectId);
  const rows = report
    ? report.potential.map((p) => {
        const input = report.inputs.find((i) => i.market.toLowerCase() === p.market.toLowerCase());
        return { market: p.market, values: Object.fromEntries(PILLARS.map((k) => [k, input?.[k] ?? null])), source: input?.source ?? '' };
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <WorkflowNav projectId={projectId} projectName={project.name} current="RESULTS" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Report</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">The roundtable as slides. Open the full report to download it as a PDF.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/projects/${projectId}/advanced/results` as Route} className="text-sm text-link underline-offset-2 hover:underline">Advanced results tools →</Link>
          {report && (
            <Link href={`/projects/${projectId}/report` as Route} className="rounded bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
              Open full report / PDF
            </Link>
          )}
        </div>
      </header>

      {!report ? (
        <section className="panel max-w-2xl px-5 py-5 text-sm text-ink-muted">
          No roundtable has completed yet. <Link href={`/projects/${projectId}/simulate` as Route} className="text-link underline">Go to the roundtable</Link>
        </section>
      ) : (
        <>
          <details className="panel">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
              Market inputs <span className="font-normal text-ink-subtle">— the pillars behind the market potential and entry slides (0–100, higher = easier entry)</span>
            </summary>
            <div className="border-t border-line px-4 py-3">
              <p className="mb-3 max-w-prose text-xs text-ink-subtle">
                Enter what the survey data cannot supply — for example China favourability (Pew), geopolitics and trade, spending power and digital readiness — with the source. Blank brand friendliness and category demand are taken from the roundtable; other blanks are left out and the weights rescaled.
              </p>
              <MarketInputsForm projectId={projectId} rows={rows} canEdit={can(ctx, 'project.edit', projectId)} />
            </div>
          </details>
          <SlideDeck r={report} />
        </>
      )}
    </div>
  );
}

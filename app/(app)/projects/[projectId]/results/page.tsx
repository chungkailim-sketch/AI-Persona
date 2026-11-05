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
import { DecisionGuidance } from '../DecisionGuidance';
import { MarketInputsForm } from './MarketInputsForm';
import { PlannerForm } from './PlannerForm';
import { PlanView } from './PlanView';
import { KnowledgeLibrary } from './KnowledgeLibrary';
import { RefreshWhileImporting } from '../data/RefreshWhileImporting';
import { projectModules } from '@/modules/project';
import { listPlans } from '@/advice/planner';
import { INDUSTRIES, KNOWLEDGE } from '@/knowledge/library';
import { fmtDateTime, TZ_LABEL } from '@/lib/time';
import type { CommsPlan } from '@/roundtable/schemas';

export const metadata = { title: 'Results · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

/**
 * Step 5 — results: the slide report (with the market inputs behind its indices and the PDF), plans
 * that answer the team's PR, communications and marketing questions, and the knowledge library.
 * What appears follows the project's modules.
 */
export default async function ReportStepPage(props: PageProps<'/projects/[projectId]/results'>) {
  const { projectId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/results`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) notFound();

  const [report, modules, plans] = await Promise.all([loadReport(projectId), projectModules(projectId), listPlans(projectId)]);
  const planning = plans.some((p) => p.status === 'QUEUED' || p.status === 'RUNNING');
  const sections = [report && { id: 'report', label: 'Report' }, modules.has('comms_planner') && { id: 'plans', label: 'Comms & marketing plans' }, modules.has('knowledge') && { id: 'knowledge', label: 'Knowledge library' }].filter(Boolean) as { id: string; label: string }[];
  const rows = report
    ? report.potential.map((p) => {
        const input = report.inputs.find((i) => i.market.toLowerCase() === p.market.toLowerCase());
        return { market: p.market, values: Object.fromEntries(PILLARS.map((k) => [k, input?.[k] ?? null])), source: input?.source ?? '' };
      })
    : [];

  return (
    <div className="flex flex-col gap-6">
      <WorkflowNav projectId={projectId} projectName={project.name} current="RESULTS" />
      <RefreshWhileImporting active={planning} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Results</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">The report as slides and PDF, plans that answer your comms and marketing questions, and the knowledge behind them.</p>
          {sections.length > 1 && (
            <nav aria-label="On this page" className="mt-3 flex flex-wrap gap-2">
              {sections.map((x) => <a key={x.id} href={`#${x.id}`} className="rounded-full border border-line px-3 py-1 text-xs font-semibold text-ink-muted hover:border-brand hover:text-ink">{x.label}</a>)}
            </nav>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/projects/${projectId}/advanced/results` as Route} className="text-sm text-link underline-offset-2 hover:underline">Advanced results tools →</Link>
          {report && (
            <Link href={`/projects/${projectId}/report` as Route} className="rounded-full bg-action px-6 py-2.5 text-[13px] font-medium tracking-wide text-action-ink hover:opacity-90">
              Open full report / PDF
            </Link>
          )}
        </div>
      </header>

      {!report ? (
        modules.has('roundtable') && (
          <section className="panel max-w-2xl px-5 py-5 text-sm text-ink-muted">
            No roundtable has completed yet, so there is no slide report. <Link href={`/projects/${projectId}/simulate` as Route} className="text-link underline">Go to the roundtable</Link>
          </section>
        )
      ) : (
        <section id="report" className="flex scroll-mt-48 flex-col gap-6">
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
          <DecisionGuidance projectId={projectId} checkpoint="REPORT" canAsk={can(ctx, 'project.edit', projectId)} />
          <SlideDeck r={report} modules={modules} />
        </section>
      )}

      {modules.has('comms_planner') && (
        <section id="plans" aria-labelledby="plans-heading" className="flex scroll-mt-48 flex-col gap-4 border-t border-line pt-6">
          <div>
            <h2 id="plans-heading" className="text-xl">PR, communications and marketing plans</h2>
            <p className="mt-1 max-w-prose text-sm text-ink-muted">Ask a question; the plan answers it purely from the survey data, the personas and the roundtable, applying recognised frameworks from the knowledge library. Every insight shows the data it rests on.</p>
          </div>
          {can(ctx, 'simulation.run', projectId) && (
            <div className="panel max-w-3xl px-5 py-4"><PlannerForm projectId={projectId} industries={INDUSTRIES} /></div>
          )}
          {plans.map((p) => {
            const content = p.content as unknown as (CommsPlan & { frameworks: (CommsPlan['frameworks'][number] & { id?: string })[] }) | null;
            const sources = (p.sources ?? {}) as { data?: string[] };
            return (
              <article key={p.id} className="panel">
                <div className="panel-head">
                  <div className="min-w-0">
                    <h3 className="font-sans text-[15px] font-bold text-ink">{content?.title || p.question}</h3>
                    <p className="text-xs text-ink-subtle">{`“${p.question}” · ${fmtDateTime(p.createdAt)} ${TZ_LABEL}${p.isMock && p.status === 'COMPLETED' ? ' · mock' : ''}`}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-ink-muted">{p.status === 'COMPLETED' ? '' : p.status === 'FAILED' ? 'Failed' : 'Writing…'}</span>
                </div>
                <div className="px-4 py-4">
                  {p.status === 'FAILED' && <p className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{p.failureReason}</p>}
                  {p.status === 'COMPLETED' && content && <PlanView content={content} dataLines={sources.data ?? []} />}
                  {(p.status === 'QUEUED' || p.status === 'RUNNING') && <p className="text-sm text-ink-muted">Writing the plan from the data…</p>}
                </div>
              </article>
            );
          })}
        </section>
      )}

      {modules.has('knowledge') && (
        <section id="knowledge" aria-labelledby="knowledge-heading" className="flex scroll-mt-48 flex-col gap-4 border-t border-line pt-6">
          <div>
            <h2 id="knowledge-heading" className="text-xl">Knowledge library</h2>
            <p className="mt-1 max-w-prose text-sm text-ink-muted">Recognised PR, communications and marketing frameworks, and market-entry knowledge for foreign brands across industries — summarised for this platform, each linked to its original source (professional bodies, governments, multilateral institutions and peer-reviewed research). The planner draws on these.</p>
          </div>
          <KnowledgeLibrary entries={KNOWLEDGE} industries={INDUSTRIES} />
        </section>
      )}
    </div>
  );
}

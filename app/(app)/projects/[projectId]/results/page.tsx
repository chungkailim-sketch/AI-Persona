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
import { listCreativeBriefs } from '@/creative/brief';
import type { CreativeBriefContent } from '@/creative/fields';
import { CreativeBriefButton } from './CreativeBriefButton';
import { CreativeBriefActions } from './CreativeBriefActions';
import { WorkflowNav } from '../WorkflowNav';
import { MarketInputsForm } from './MarketInputsForm';
import { PlannerForm } from './PlannerForm';
import { PlanView } from './PlanView';
import { ReportExportBar } from './ReportExportBar';
import { FloatingCollapse } from '@/ui/FloatingCollapse';
import { projectBrand } from '@/report/brandService';
import { cookies } from 'next/headers';
import { LANG_COOKIE, parseLang } from '@/ui/i18n/translate';
import { PlanRecordActions } from './PlanRecordActions';
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
  const search = await props.searchParams;
  const user = await requireUser(`/projects/${projectId}/results`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) notFound();

  const [report, modules, plans, creative] = await Promise.all([loadReport(projectId), projectModules(projectId), listPlans(projectId), listCreativeBriefs(projectId)]);
  const canPlan = can(ctx, 'simulation.run', projectId);
  const brand = await projectBrand(projectId);
  const uiLang = parseLang((await cookies()).get(LANG_COOKIE)?.value) === 'zh' ? 'zh' : 'en';
  const plan = plans.find((p) => p.id === search.plan) ?? plans[0] ?? null;
  const editRow = typeof search.editPlan === 'string' ? plans.find((p) => p.id === search.editPlan) : undefined;
  const editPlan = editRow ? { question: editRow.question, industry: String((editRow.options as { industry?: string } | null)?.industry ?? '') } : null;
  const planning = [...plans, ...creative].some((p) => p.status === 'QUEUED' || p.status === 'RUNNING');
  const sections = [report && { id: 'report', label: 'Report' }, { id: 'creative', label: 'Creative brief (AIGC)' }, modules.has('comms_planner') && { id: 'plans', label: 'Comms & marketing plans' }, modules.has('knowledge') && { id: 'knowledge', label: 'Knowledge library' }].filter(Boolean) as { id: string; label: string }[];
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
          {/* The slides are long; collapsed by default so every section of the page is in reach. */}
          <details id="report-preview" className="panel scroll-mt-48">
            <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
              Report preview <span className="font-normal text-ink-subtle">— the slides as they print to PDF; open to read them here</span>
            </summary>
            <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
              <ReportExportBar
                projectId={projectId}
                lang={uiLang}
                canEdit={can(ctx, 'project.edit', projectId)}
                brand={brand ? { name: brand.name, fileName: brand.fileName, colors: [brand.colors.dark2, ...brand.colors.accents].slice(0, 7), fonts: [brand.fonts.heading, brand.fonts.body].filter((f): f is string => Boolean(f)), hasLogo: Boolean(brand.logo) } : null}
              />
              <SlideDeck r={report} modules={modules} brand={brand} />
            </div>
          </details>
          <FloatingCollapse targetId="report-preview" label="Collapse the report preview" />
        </section>
      )}

      {/* Collapsible like the report preview: each opens from the navigation above. */}
      <details id="creative" className="panel scroll-mt-48">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
          <span id="creative-heading">Creative brief for AI content generation</span>{' '}
          <span className="font-normal text-ink-subtle">— Written for you from the whole study — every persona, the roundtable results and key messaging, the report&rsquo;s market indices, the latest plan and debate, into the AIGC Creative Brief.</span>
        </summary>
        <div className="flex flex-col gap-4 border-t border-line px-4 py-4">
        {can(ctx, 'simulation.run', projectId) && <div className="panel max-w-3xl px-5 py-4"><CreativeBriefButton projectId={projectId} again={creative.length > 0} /></div>}
        {creative.length > 0 && (
          <ul className="flex max-w-3xl flex-col divide-y divide-line rounded-lg border border-line bg-surface">
            {creative.map((c) => {
              const content = c.content as unknown as CreativeBriefContent | null;
              return (
                <li key={c.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink">{content?.fields.concept || c.question}</p>
                      <p className="text-xs text-ink-subtle">
                        {c.question}{' · '}{fmtDateTime(c.createdAt)} {TZ_LABEL}{content ? <>{' · '}{`${content.shots.length} shot prompts`}</> : null}
                        {(content as { edited?: boolean } | null)?.edited ? <>{' · '}<span>edited</span></> : null}
                        {c.isMock && c.status === 'COMPLETED' ? ' · mock' : ''}
                      </p>
                      {c.status === 'FAILED' && <p className="text-xs text-danger">{c.failureReason}</p>}
                    </div>
                    {c.status === 'COMPLETED' ? (
                      <a href={`/api/projects/${projectId}/creative-brief/${c.id}`} className="shrink-0 rounded-full border border-line-strong px-4 py-1.5 text-[13px] font-medium text-ink hover:border-brand">Download .docx</a>
                    ) : c.status === 'FAILED' ? null : (
                      <span className="text-xs font-semibold text-ink-muted">Writing…</span>
                    )}
                  </div>
                  <CreativeBriefActions projectId={projectId} briefId={c.id} status={c.status} canManage={can(ctx, 'simulation.run', projectId)} />
                </li>
              );
            })}
          </ul>
        )}
        </div>
      </details>

      {modules.has('comms_planner') && (
        <details id="plans" className="panel scroll-mt-48">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
            <span id="plans-heading">PR, communications and marketing plans</span>{' '}
            <span className="font-normal text-ink-subtle">— ask a question; the plan answers it purely from the survey data, the personas and the roundtable, applying recognised frameworks. Every insight shows the data it rests on.</span>
          </summary>
          <div className="grid gap-4 border-t border-line px-4 py-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
            <div className="flex flex-col gap-4">
              {canPlan && (
                <div className="panel px-3.5 py-3">
                  <PlannerForm projectId={projectId} industries={INDUSTRIES} initial={editPlan} key={editPlan ? `edit-${String(search.editPlan)}` : 'new'} />
                </div>
              )}
              {plans.length > 0 && (
                <nav aria-label="Previous plans" className="panel">
                  <div className="panel-head"><h3 className="font-sans text-sm font-medium text-ink">Previous plans</h3></div>
                  <ul className="flex flex-col divide-y divide-line">
                    {plans.map((p) => {
                      const title = (p.content as { title?: string } | null)?.title || p.question;
                      return (
                        <li key={p.id}>
                          <Link
                            href={`/projects/${projectId}/results?plan=${p.id}#plans` as Route}
                            aria-current={p.id === plan?.id ? 'true' : undefined}
                            className={`block px-3.5 py-2 hover:bg-bg ${p.id === plan?.id ? 'border-l-2 border-brand bg-brand-soft/40' : 'border-l-2 border-transparent'}`}
                          >
                            <span className="line-clamp-2 text-xs text-ink">{title}</span>
                            <span className="mt-0.5 block text-[10.5px] text-ink-subtle">{`${p.status.toLowerCase()} · ${fmtDateTime(p.createdAt)}${p.isMock && p.status === 'COMPLETED' ? ' · mock' : ''}`}</span>
                          </Link>
                          <div className="px-3.5 pb-2">
                            <PlanRecordActions projectId={projectId} planId={p.id} status={p.status} canManage={canPlan} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </nav>
              )}
            </div>
            <div className="min-w-0">
              {!plan ? (
                <p className="border-t border-line px-4 py-3 text-sm text-ink-muted">No plan yet. Ask a question and write one.</p>
              ) : (() => {
                const content = plan.content as unknown as (CommsPlan & { frameworks: (CommsPlan['frameworks'][number] & { id?: string })[] }) | null;
                const sources = (plan.sources ?? {}) as { data?: string[] };
                return (
                  <article className="panel">
                    <div className="panel-head">
                      <div className="min-w-0">
                        <h3 className="font-sans text-[15px] font-bold text-ink">{content?.title || plan.question}</h3>
                        <p className="text-xs text-ink-subtle">{`“${plan.question}” · ${fmtDateTime(plan.createdAt)} ${TZ_LABEL}${plan.isMock && plan.status === 'COMPLETED' ? ' · mock' : ''}`}</p>
                      </div>
                      <span className="shrink-0 text-xs font-semibold text-ink-muted">{plan.status === 'COMPLETED' ? '' : plan.status === 'FAILED' ? 'Failed' : 'Writing…'}</span>
                    </div>
                    <div className="px-4 py-4">
                      {plan.status === 'FAILED' && <p className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">{plan.failureReason}</p>}
                      {plan.status === 'COMPLETED' && content && <PlanView content={content} dataLines={sources.data ?? []} />}
                      {(plan.status === 'QUEUED' || plan.status === 'RUNNING') && <p className="text-sm text-ink-muted">Writing the plan from the data…</p>}
                    </div>
                  </article>
                );
              })()}
            </div>
          </div>
        </details>
      )}

      {modules.has('knowledge') && (
        <details id="knowledge" className="panel scroll-mt-48">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
            <span id="knowledge-heading">Knowledge library</span>{' '}
            <span className="font-normal text-ink-subtle">— recognised PR, communications and marketing frameworks and market-entry knowledge, each linked to its original source. The planner draws on these.</span>
          </summary>
          <div className="border-t border-line px-4 py-4">
            <KnowledgeLibrary entries={KNOWLEDGE} industries={INDUSTRIES} />
          </div>
        </details>
      )}
    </div>
  );
}

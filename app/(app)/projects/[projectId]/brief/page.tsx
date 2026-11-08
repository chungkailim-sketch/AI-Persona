import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { LANG_COOKIE, parseLang } from '@/ui/i18n/translate';
import { availableMarkets, DEFAULT_CATEGORIES, DEFAULT_QUESTION, latestBrief, studyBriefMissing } from '@/roundtable/service';
import { WorkflowNav } from '../WorkflowNav';
import { DecisionGuidance } from '../DecisionGuidance';
import { StudyBriefForm } from './StudyBriefForm';
import { ModulesForm } from './ModulesForm';
import { activeModules, USE_CASES } from '@/modules/registry';
import { latestBriefImport, type ImportContent } from '@/advice/briefImport';
import { Markdown } from '@/ui/Markdown';
import { RefreshWhileImporting } from '../data/RefreshWhileImporting';
import { BriefUpload } from './BriefUpload';

export const metadata = { title: 'Brief · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

/** Step 2 — markets, the roundtable question and the categories. Hypotheses and stimuli are in Advanced. */
export default async function BriefStepPage(props: PageProps<'/projects/[projectId]/brief'>) {
  const { projectId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/brief`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'project.view', projectId)) notFound();
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
  if (!project) notFound();

  const lang = parseLang((await cookies()).get(LANG_COOKIE)?.value);
  const [brief, available, setup, imported] = await Promise.all([latestBrief(projectId), availableMarkets(projectId), prisma.project.findUnique({ where: { id: projectId }, select: { useCase: true, modules: true } }), latestBriefImport(projectId)]);
  const reading = imported?.status === 'QUEUED' || imported?.status === 'RUNNING';
  const read = imported?.status === 'COMPLETED' ? (imported.content as unknown as ImportContent) : null;
  const hypothesisCount = brief ? await prisma.hypothesis.count({ where: { briefId: brief.id } }) : 0;
  const canEdit = can(ctx, 'project.edit', projectId);
  const missing = studyBriefMissing(brief);
  const view = {
    context: brief?.businessContext ?? '',
    markets: brief?.markets ?? [],
    question: brief?.researchQuestion || DEFAULT_QUESTION[lang],
    categories: brief?.categories.length ? brief.categories : DEFAULT_CATEGORIES[lang],
    audience: brief?.targetAudience ?? '',
  };

  return (
    <div className="flex flex-col gap-6">
      <WorkflowNav projectId={projectId} projectName={project.name} current="BRIEF" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl">Brief</h1>
          <p className="mt-1 max-w-prose text-sm text-ink-muted">Choose the markets, the question the roundtable answers and the categories each persona scores.</p>
        </div>
        <Link href={`/projects/${projectId}/advanced/brief` as Route} className="text-sm text-link underline-offset-2 hover:underline">
          Advanced brief tools →
        </Link>
      </header>
      <details className="panel max-w-3xl">
        <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-ink">
          {`Use case and modules · ${USE_CASES.find((u) => u.key === setup?.useCase)?.label ?? 'Market entry'}`}
        </summary>
        <div className="border-t border-line px-5 py-4">
          <ModulesForm projectId={projectId} useCase={setup?.useCase ?? 'market_entry'} active={[...activeModules(setup ?? { useCase: 'market_entry', modules: [] })]} canEdit={can(ctx, 'project.edit', projectId)} />
        </div>
      </details>
      <RefreshWhileImporting active={reading} />
      {canEdit && (
        <section className="panel max-w-3xl px-5 py-5">
          <BriefUpload projectId={projectId} />
          {reading && <p role="status" className="mt-3 rounded border border-info/40 bg-info-soft px-3 py-2 text-sm text-ink"><span>Reading the brief:</span> <span data-no-translate>{imported!.question}</span> <span>This page updates on its own.</span></p>}
          {imported?.status === 'FAILED' && <p role="alert" className="mt-3 rounded border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{imported.failureReason ?? 'The brief could not be read.'}</p>}
        </section>
      )}
      {read && (
        <details className="panel max-w-3xl">
          <summary className="cursor-pointer px-5 py-3">
            <span className="text-sm font-semibold text-ink"><span>Brief read from file:</span> <span data-no-translate>{imported!.question}</span></span>
            <span className="block text-xs text-ink-muted">
              {imported!.isMock && <><span>Placeholder reading (mock model).</span>{' '}</>}
              <span>{`${read.hypotheses.length} hypotheses added`}</span>{' · '}<span>Agent swarm set-up suggested on the Personas step</span>{' · '}<span>Open to see the brief as a document</span>
            </span>
          </summary>
          <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
            {read.unmatchedMarkets.length > 0 && <p className="text-sm text-warn"><span>Markets in the brief with no data uploaded yet:</span> <span>{read.unmatchedMarkets.join(', ')}</span> <span>Upload their data on the Data step to include them.</span></p>}
            {read.notes.map((n) => <p key={n} className="text-sm text-ink-muted">{n}</p>)}
            {read.hypotheses.length > 0 && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Hypotheses to test</h2>
                <ul className="mt-1 list-disc pl-5 text-sm text-ink">{read.hypotheses.map((h) => <li key={h.statement}>{h.statement}</li>)}</ul>
                <p className="mt-1 text-xs text-ink-subtle">
                  <span>{`${hypothesisCount} on this brief version.`}</span>{' '}
                  <Link href={`/projects/${projectId}/advanced/brief` as Route} className="text-link underline">Edit them in the advanced brief tools</Link>
                </p>
              </div>
            )}
            {read.swarm.topic && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Suggested agent swarm debate</h2>
                <p className="mt-1 text-sm text-ink">{read.swarm.topic}</p>
                {read.swarm.hypothesis && <p className="text-sm text-ink-muted"><span>Hypothesis:</span> {read.swarm.hypothesis}</p>}
              </div>
            )}
            <div className="rounded border border-line bg-bg px-4 py-3">
              <Markdown text={read.markdown} />
            </div>
          </div>
        </details>
      )}
      {brief && missing.length > 0 && (
        <p role="status" className="max-w-3xl rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          Not complete yet: {missing.join(' ')} The suggested values below are not saved until you press Save.
        </p>
      )}
      <section className="panel max-w-3xl px-5 py-5">
        <StudyBriefForm key={`${brief?.id ?? 'new'}-${brief?.updatedAt.getTime() ?? 0}`} projectId={projectId} brief={view} available={available} canEdit={canEdit} locked={brief?.status === 'LOCKED'} />
      </section>
      {brief && <div className="max-w-3xl"><DecisionGuidance projectId={projectId} checkpoint="BRIEF" canAsk={can(ctx, 'project.edit', projectId)} /></div>}
      {brief && missing.length === 0 && (
        <div className="flex max-w-3xl justify-end">
          <Link href={`/projects/${projectId}/personas` as Route} className="rounded-full bg-action px-6 py-2.5 text-[13px] font-medium tracking-wide text-action-ink hover:opacity-90">
            Next: Personas →
          </Link>
        </div>
      )}
    </div>
  );
}

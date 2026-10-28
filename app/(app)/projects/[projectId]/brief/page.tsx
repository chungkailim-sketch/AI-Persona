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
import { StudyBriefForm } from './StudyBriefForm';

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
  const [brief, available] = await Promise.all([latestBrief(projectId), availableMarkets(projectId)]);
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
      <section className="panel max-w-3xl px-5 py-5">
        <StudyBriefForm projectId={projectId} brief={view} available={available} canEdit={can(ctx, 'project.edit', projectId)} locked={brief?.status === 'LOCKED'} />
      </section>
      {brief && missing.length === 0 && (
        <div className="flex max-w-3xl justify-end">
          <Link href={`/projects/${projectId}/personas` as Route} className="rounded bg-brand px-4 py-2 text-sm font-semibold text-brand-ink hover:opacity-90">
            Next: Cast →
          </Link>
        </div>
      )}
    </div>
  );
}

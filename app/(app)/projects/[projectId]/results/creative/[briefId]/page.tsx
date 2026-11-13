import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { BRIEF_FIELDS, type CreativeBriefContent } from '@/creative/fields';
import { SECTION_TITLES } from '@/creative/markdown';
import { EditBriefForm } from './EditBriefForm';

export const metadata = { title: 'Edit creative brief · RF AI Persona Intelligence' };
export const dynamic = 'force-dynamic';

/** Edit a written AIGC creative brief: every row of the template and every shot prompt. */
export default async function EditCreativeBriefPage(props: PageProps<'/projects/[projectId]/results/creative/[briefId]'>) {
  const { projectId, briefId } = await props.params;
  const user = await requireUser(`/projects/${projectId}/results/creative/${briefId}`);
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, 'simulation.run', projectId)) notFound();
  const advice = await prisma.advice.findFirst({ where: { id: briefId, projectId, kind: 'CREATIVE_BRIEF', status: 'COMPLETED' }, include: { project: { select: { name: true } } } });
  if (!advice?.content) notFound();
  const content = advice.content as unknown as CreativeBriefContent;
  const sections = Object.entries(SECTION_TITLES).map(([key, title]) => ({ title, fields: BRIEF_FIELDS.filter((f) => f.section === key).map((f) => ({ key: f.key, label: f.label, hint: f.hint, value: content.fields[f.key] ?? '' })) }));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">{advice.project.name}</p>
          <h1 className="text-2xl">Edit creative brief</h1>
          <p className="mt-1 text-sm text-ink-muted">{advice.question}. Change any row or shot prompt; the Word and Markdown downloads use what you save.</p>
        </div>
        <Link href={`/projects/${projectId}/results#creative` as Route} className="text-sm text-link underline-offset-2 hover:underline">← Back to Results</Link>
      </header>
      <EditBriefForm projectId={projectId} briefId={briefId} sections={sections} shots={content.shots} />
    </div>
  );
}

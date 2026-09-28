import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { prisma } from '@/lib/prisma';
import { EmptyState } from '@/ui/components/States';

export const metadata = { title: 'Briefs · Persona Intelligence' };
export const dynamic = 'force-dynamic';

/** The latest brief of every project you belong to. Editing happens in the project's step 2. */
export default async function BriefsPage() {
  const user = await requireUser('/briefs');
  const briefs = await prisma.brief.findMany({
    where: { project: { members: { some: { userId: user.userId } }, archivedAt: null } },
    orderBy: [{ projectId: 'asc' }, { versionNo: 'desc' }],
    distinct: ['projectId'],
    select: { id: true, projectId: true, versionNo: true, status: true, researchQuestion: true, updatedAt: true, project: { select: { name: true } }, _count: { select: { hypotheses: true } } },
  });
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl">Briefs</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">The research question and hypotheses behind each project. A brief used by a run is locked; changes create a new version.</p>
      </header>
      {briefs.length === 0 ? (
        <EmptyState title="No briefs yet" icon="doc">A brief is written in step 2 of a project.</EmptyState>
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">
          {briefs.map((b) => (
            <li key={b.id} className="panel p-4">
              <p className="eyebrow">{b.project.name} · v{b.versionNo} · {b.status.toLowerCase()}</p>
              <p className="mt-1 text-sm text-ink">{b.researchQuestion || <span className="text-ink-subtle">No research question stated yet.</span>}</p>
              <p className="mt-2 flex items-center justify-between font-mono text-[11px] text-ink-subtle">
                <span>{b._count.hypotheses} hypothesis(es) · saved {b.updatedAt.toISOString().slice(0, 16).replace('T', ' ')}Z</span>
                <Link href={`/projects/${b.projectId}/brief` as Route} className="font-sans text-xs text-link underline-offset-2 hover:underline">Open</Link>
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

import Link from 'next/link';
import type { Route } from 'next';
import { requireUser } from '@/auth/guard';
import { prisma } from '@/lib/prisma';
import { EmptyState } from '@/ui/components/States';
import { StatusBadge } from '@/ui/components/StatusBadge';
import { NODE_STATUS_META } from '@/telemetry/status';
import { isTerminalRunStatus } from '@/telemetry/contract';

export const metadata = { title: 'Simulations · Persona Intelligence' };
export const dynamic = 'force-dynamic';

function meta(status: string) {
  if (status === 'COMPLETED') return NODE_STATUS_META.completed;
  if (status === 'COMPLETED_WITH_WARNINGS') return NODE_STATUS_META.warning;
  if (status === 'FAILED') return NODE_STATUS_META.failed;
  if (status === 'CANCELLED') return NODE_STATUS_META.cancelled;
  if (status === 'DRAFT') return { ...NODE_STATUS_META.awaiting, label: 'Awaiting confirmation' };
  return { ...NODE_STATUS_META.active, label: status.toLowerCase().replace(/_/g, ' ') };
}

/** Every run in the projects you are a member of, newest first. Membership is the filter. */
export default async function RunsPage() {
  const user = await requireUser('/runs');
  const runs = await prisma.run.findMany({
    where: { project: { members: { some: { userId: user.userId } }, archivedAt: null } },
    orderBy: { createdAt: 'desc' },
    take: 100,
    select: { id: true, status: true, isMock: true, createdAt: true, completedAt: true, projectId: true, project: { select: { name: true } }, _count: { select: { modelCalls: true } } },
  });
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl">Simulations</h1>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">Runs across the projects you belong to. Open one to watch it live or read its record.</p>
      </header>
      {runs.length === 0 ? (
        <EmptyState title="No runs yet" icon="play">Plan and confirm a run from a project&apos;s simulation step.</EmptyState>
      ) : (
        <div className="panel overflow-x-auto" tabIndex={0} role="region" aria-label="Runs table">
          <table className="w-full min-w-[40rem] text-left text-[13px]">
            <thead className="border-b border-line text-ink-subtle">
              <tr>{['Run', 'Project', 'Status', 'Provider', 'Calls', 'Finished'].map((h) => <th key={h} scope="col" className="px-3 py-2 font-normal">{h}</th>)}</tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-line/70">
                  <th scope="row" className="px-3 py-2 font-normal">
                    <Link href={`/projects/${r.projectId}/simulate?run=${r.id}` as Route} className="font-mono text-link underline-offset-2 hover:underline">
                      {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </Link>
                  </th>
                  <td className="px-3 py-2 text-ink">{r.project.name}</td>
                  <td className="px-3 py-2"><StatusBadge size="xs" meta={meta(r.status)} /></td>
                  <td className="px-3 py-2 font-mono text-xs">{r.isMock ? 'mock' : 'live'}</td>
                  <td className="px-3 py-2 font-mono text-xs">{r._count.modelCalls}</td>
                  <td className="px-3 py-2 font-mono text-xs">{isTerminalRunStatus(r.status) ? r.completedAt?.toISOString().slice(0, 16).replace('T', ' ') ?? '—' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

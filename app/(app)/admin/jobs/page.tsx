import { notFound } from 'next/navigation';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';
import { queueDepth, QUEUE_CONFIG } from '@/queue/queue';

export const metadata = { title: 'Jobs · Administration' };
export const dynamic = 'force-dynamic';

/**
 * The queue, as an operator needs to see it.
 *
 * A failed job shows its error *category* and message here, because this page is for the people who
 * have to fix things. The same message never reaches a project member's browser: it can name
 * uploaded fields, and platform administration is deliberately separated from project content.
 */
export default async function AdminJobsPage() {
  const user = await requireUser('/admin/jobs');
  const ctx = await authContextFor(user);
  if (!can(ctx, 'admin.jobs.view')) notFound();

  const [depth, recent, stalled] = await Promise.all([
    queueDepth(),
    prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: {
        id: true,
        kind: true,
        status: true,
        attempt: true,
        maxAttempts: true,
        createdAt: true,
        completedAt: true,
        claimedBy: true,
        heartbeatAt: true,
        errorCategory: true,
        errorMessage: true,
      },
    }),
    prisma.job.count({
      where: {
        status: 'RUNNING',
        heartbeatAt: { lt: new Date(Date.now() - QUEUE_CONFIG.stallAfterMs) },
      },
    }),
  ]);

  const stats = [
    { label: 'Pending', value: depth.pending },
    { label: 'Running', value: depth.running },
    { label: 'Failed', value: depth.failed },
    { label: 'Stalled', value: stalled },
  ];

  return (
    <>
      <h1 className="text-2xl">Job queue</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Ingestion and simulation run here rather than in a request. A job whose worker stops beating
        for {QUEUE_CONFIG.stallAfterMs / 1000} seconds is returned to the queue automatically — a
        worker that stopped beating has stopped working, whatever it believes.
      </p>

      <dl className="mt-6 grid gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded border border-line bg-surface p-4">
            <dt className="text-xs text-ink-subtle">{s.label}</dt>
            <dd
              className={
                (s.label === 'Failed' || s.label === 'Stalled') && s.value > 0
                  ? 'mt-1 font-mono text-2xl text-danger'
                  : 'mt-1 font-mono text-2xl text-ink'
              }
            >
              {s.value}
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="recent" className="mt-10">
        <h2 id="recent" className="text-lg">Recent jobs</h2>
        {recent.length === 0 ? (
          <p className="mt-3 rounded border border-line bg-surface px-4 py-6 text-sm text-ink-muted">
            No jobs have been enqueued.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Jobs table">
            <table className="w-full min-w-[48rem] border-collapse text-sm">
              <caption className="sr-only">The 60 most recent jobs, newest first</caption>
              <thead>
                <tr className="border-b border-line text-left">
                  <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Created</th>
                  <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Kind</th>
                  <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Status</th>
                  <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Attempt</th>
                  <th scope="col" className="py-2 font-medium text-ink-subtle">Failure</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((j) => (
                  <tr key={j.id} className="border-b border-line/60 align-top">
                    <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-ink-subtle">
                      {j.createdAt.toISOString().replace('T', ' ').slice(0, 19)}
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-ink">{j.kind}</td>
                    <td className="py-2 pr-4">
                      <span
                        className={
                          j.status === 'FAILED'
                            ? 'rounded bg-danger-soft px-2 py-0.5 font-mono text-[10px] text-danger'
                            : j.status === 'COMPLETED'
                              ? 'rounded bg-ok-soft px-2 py-0.5 font-mono text-[10px] text-ok'
                              : j.status === 'RUNNING'
                                ? 'rounded bg-info-soft px-2 py-0.5 font-mono text-[10px] text-info'
                                : 'rounded bg-bg px-2 py-0.5 font-mono text-[10px] text-ink-muted'
                        }
                      >
                        {j.status.toLowerCase()}
                      </span>
                    </td>
                    <td className="py-2 pr-4 font-mono text-xs text-ink-muted">
                      {j.attempt}/{j.maxAttempts}
                    </td>
                    <td className="py-2 text-xs text-ink-subtle">
                      {j.errorCategory && (
                        <span className="mr-2 font-mono text-[10px] text-warn">
                          {j.errorCategory}
                        </span>
                      )}
                      {j.errorMessage ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-6 max-w-prose text-xs text-ink-subtle">
        Only <span className="font-mono">transient</span> and <span className="font-mono">provider</span>{' '}
        failures are retried. A malformed file or a refused run will be just as malformed or refused
        on a third attempt, and retrying it wastes time while telling nobody anything.
      </p>
    </>
  );
}

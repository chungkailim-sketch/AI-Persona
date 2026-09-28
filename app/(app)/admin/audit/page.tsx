import { requireUser } from '@/auth/guard';
import { listAuditEvents } from '@/server/admin';
import { fmtDateTime } from '@/lib/time';

export const metadata = { title: 'Audit log · Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  const actor = await requireUser('/admin/audit');
  const events = await listAuditEvents(actor, 200);

  return (
    <>
      <h1 className="text-2xl">Audit log</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Append-only. Entries are never edited or deleted; a correction is a new entry. IP addresses
        are stored as salted hashes, never in the clear, so they can be correlated but not read.
      </p>

      {events.length === 0 ? (
        <p className="mt-6 rounded border border-line bg-surface px-4 py-6 text-sm text-ink-muted">
          No events recorded yet.
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-label="Audit events table">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <caption className="sr-only">
              The {events.length} most recent audit events, newest first
            </caption>
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">When (GMT+8)</th>
                <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Action</th>
                <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Actor</th>
                <th scope="col" className="py-2 pr-4 font-medium text-ink-subtle">Target</th>
                <th scope="col" className="py-2 font-medium text-ink-subtle">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id} className="border-b border-line/60 align-top">
                  <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-ink-subtle">
                    {fmtDateTime(e.createdAt, { seconds: true })}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink">{e.action}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink-muted">
                    {e.actorEmail ?? '—'}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs text-ink-muted">
                    {e.targetType}
                    {e.targetId ? `:${e.targetId.slice(0, 10)}` : ''}
                  </td>
                  <td className="py-2 text-xs text-ink-subtle">{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

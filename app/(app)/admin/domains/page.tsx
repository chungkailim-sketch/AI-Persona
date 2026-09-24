import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { listDomains } from '@/server/admin';
import { AddDomainForm } from './AddDomainForm';
import { toggleDomainAction } from './actions';

export const metadata = { title: 'Approved domains · Administration' };
export const dynamic = 'force-dynamic';

export default async function AdminDomainsPage() {
  const actor = await requireUser('/admin/domains');
  const ctx = await authContextFor(actor);
  const domains = await listDomains(actor);
  const canManage = can(ctx, 'admin.domains.manage');

  return (
    <>
      <h1 className="text-2xl">Approved domains</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Only addresses on an active domain can receive a sign-in code. A first sign-in from an
        approved domain creates a standard account; it does not grant any project access.
      </p>

      <ul className="mt-6 flex max-w-2xl flex-col gap-2">
        {domains.map((d) => (
          <li
            key={d.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-surface px-4 py-3"
          >
            <div>
              <p className="font-mono text-sm text-ink">{d.domain}</p>
              {d.note && <p className="mt-0.5 text-xs text-ink-subtle">{d.note}</p>}
            </div>
            <div className="flex items-center gap-3">
              <span
                className={
                  d.active
                    ? 'rounded bg-ok-soft px-2 py-0.5 font-mono text-[10px] text-ok'
                    : 'rounded bg-bg px-2 py-0.5 font-mono text-[10px] text-ink-subtle'
                }
              >
                {d.active ? 'active' : 'inactive'}
              </span>
              {canManage && (
                <form action={toggleDomainAction}>
                  <input type="hidden" name="domain" value={d.domain} />
                  <input type="hidden" name="active" value={String(!d.active)} />
                  <button
                    type="submit"
                    className="rounded border border-line px-2 py-1 text-xs text-ink-muted hover:border-brand"
                  >
                    {d.active ? 'Deactivate' : 'Activate'}
                  </button>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>

      {canManage && (
        <section aria-labelledby="add" className="mt-10 border-t border-line pt-6">
          <h2 id="add" className="text-lg">Add a domain</h2>
          <AddDomainForm />
        </section>
      )}
    </>
  );
}

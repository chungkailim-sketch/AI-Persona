import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { permissionsFor } from '@/auth/permissions';
import { prisma } from '@/lib/prisma';

export const metadata = { title: 'Administration · Persona Intelligence' };
export const dynamic = 'force-dynamic';

export default async function AdminOverviewPage() {
  const user = await requireUser('/admin');
  const ctx = await authContextFor(user);
  const held = permissionsFor(ctx);

  const [users, domains, sessions, flags] = await Promise.all([
    prisma.user.count(),
    prisma.approvedDomain.count({ where: { active: true } }),
    prisma.session.count({ where: { revokedAt: null, absoluteExpiresAt: { gt: new Date() } } }),
    prisma.featureFlag.findMany({ orderBy: { key: 'asc' } }),
  ]);

  const stats = [
    { label: 'User accounts', value: users },
    { label: 'Active approved domains', value: domains },
    { label: 'Live sessions', value: sessions },
  ];

  return (
    <>
      <h1 className="text-2xl">Overview</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Platform administration is separate from project content. Holding a role here grants no
        access to any client project; that requires membership, or a time-boxed break-glass grant
        recorded in the audit log.
      </p>

      <dl className="mt-8 grid gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded border border-line bg-surface p-4">
            <dt className="text-xs text-ink-subtle">{s.label}</dt>
            <dd className="mt-1 font-mono text-2xl text-ink">{s.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="controls" className="mt-12">
        <h2 id="controls" className="text-lg">Safety controls</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          These cannot be turned off by any role, including yours. They are listed so that their
          presence is verifiable, not so that they can be changed.
        </p>
        <ul className="mt-4 flex max-w-2xl flex-col gap-2">
          {flags.map((f) => (
            <li
              key={f.key}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-surface px-4 py-3"
            >
              <div>
                <p className="font-mono text-xs text-ink">{f.key}</p>
                <p className="mt-0.5 text-xs text-ink-subtle">{f.description}</p>
              </div>
              <span
                className={
                  f.locked
                    ? 'rounded bg-ok-soft px-2 py-0.5 font-mono text-[10px] text-ok'
                    : 'rounded bg-bg px-2 py-0.5 font-mono text-[10px] text-ink-subtle'
                }
              >
                {f.locked ? 'on · locked' : f.enabled ? 'on' : 'off'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="your-permissions" className="mt-12">
        <h2 id="your-permissions" className="text-lg">Permissions you hold</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          Shown in full rather than implied by which buttons appear, so that what you can do is
          inspectable. Every one of these is checked again on the server for each request.
        </p>
        <ul className="mt-4 flex flex-wrap gap-1.5">
          {held.map((p) => (
            <li key={p} className="rounded bg-surface px-2 py-1 font-mono text-[11px] text-ink-muted">
              {p}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

import Link from 'next/link';
import { requireUser } from '@/auth/guard';
import { listProjectsForUser } from '@/server/projects';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';

export const metadata = { title: 'Home · Persona Intelligence' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await requireUser('/dashboard');
  const [projects, ctx] = await Promise.all([
    listProjectsForUser(user),
    authContextFor(user),
  ]);

  return (
    <div className="">
      <h1 className="text-2xl">
        {user.displayName ? `Welcome, ${user.displayName}` : 'Welcome'}
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        Signed in as <span className="font-mono text-xs">{user.email}</span> ·{' '}
        <span className="font-mono text-xs">{user.systemRole.toLowerCase().replace('_', ' ')}</span>
      </p>

      <section aria-labelledby="recent" className="mt-10">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="recent" className="text-lg">Your projects</h2>
          <Link href="/projects" className="text-sm text-ink-muted underline-offset-2 hover:underline">
            All projects
          </Link>
        </div>
        {projects.length === 0 ? (
          <div className="mt-3 rounded border border-line bg-surface p-6">
            <p className="text-sm text-ink-muted">
              Nothing here yet. A project is where evidence, a brief, personas and runs live
              together.
            </p>
            <Link
              href="/projects"
              className="mt-4 inline-block rounded bg-brand px-4 py-2 text-sm font-medium text-brand-ink hover:opacity-90"
            >
              Create your first project
            </Link>
          </div>
        ) : (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {projects.slice(0, 6).map((p) => (
              <li key={p.id}>
                <Link
                  href={`/projects/${p.id}/data`}
                  className="block rounded border border-line bg-surface p-4 hover:border-brand"
                >
                  <span className="font-medium text-ink">{p.name}</span>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {p.role.toLowerCase()} · updated {p.updatedAt.toISOString().slice(0, 10)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="waiting" className="mt-12">
        <h2 id="waiting" className="text-lg">Waiting on you</h2>
        <p className="mt-3 rounded border border-line bg-surface px-4 py-4 text-sm text-ink-muted">
          Persona approvals, governance confirmations and failed jobs will appear here once those
          capabilities are built. This panel is empty because nothing produces those items yet — not
          because you have nothing outstanding.
        </p>
      </section>

      {can(ctx, 'admin.access') && (
        <section aria-labelledby="admin" className="mt-12 border-t border-line pt-8">
          <h2 id="admin" className="text-lg">Administration</h2>
          <p className="mt-2 max-w-prose text-sm text-ink-muted">
            You hold a platform administration role. That grants no access to project content: a
            project is reachable only through membership, or through a time-boxed break-glass grant
            that is recorded in the audit log.
          </p>
          <Link href="/admin" className="mt-3 inline-block text-sm text-brand underline-offset-2 hover:underline">
            Open the admin console
          </Link>
        </section>
      )}
    </div>
  );
}

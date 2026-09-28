import Link from 'next/link';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can, permissionsFor } from '@/auth/permissions';
import { notFound } from 'next/navigation';

/**
 * Administration is gated here as well as in each page.
 *
 * A user without `admin.access` gets 404 rather than 403. There is nothing to tell them: confirming
 * that an admin console exists at this address is information they have no need for.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser('/admin');
  const ctx = await authContextFor(user);
  if (!can(ctx, 'admin.access')) notFound();

  const held = permissionsFor(ctx);
  const tabs = [
    { href: '/admin', label: 'Overview', need: 'admin.access' },
    { href: '/admin/users', label: 'Users and roles', need: 'admin.users.manage' },
    { href: '/admin/domains', label: 'Approved domains', need: 'admin.domains.manage' },
    { href: '/admin/jobs', label: 'Job queue', need: 'admin.jobs.view' },
    { href: '/admin/usage', label: 'Usage and spend', need: 'admin.usage.view' },
    { href: '/admin/audit', label: 'Audit log', need: 'audit.view' },
  ] as const;

  return (
    <div className="">
      <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-brand">Administration</p>
      <nav aria-label="Administration" className="mt-3 border-b border-line">
        <ul className="flex flex-wrap gap-1">
          {tabs
            .filter((t) => held.includes(t.need))
            .map((t) => (
              <li key={t.href}>
                <Link
                  href={t.href}
                  className="block rounded-t px-3 py-2 text-sm text-ink-muted hover:bg-surface hover:text-ink"
                >
                  {t.label}
                </Link>
              </li>
            ))}
        </ul>
      </nav>
      <div className="pt-6">{children}</div>
    </div>
  );
}

import { prisma } from '@/lib/prisma';
import { requireUser } from '@/auth/guard';
import { cookies } from 'next/headers';
import { revokeSessionAction } from './actions';
import { ThemePreferenceControl } from '@/ui/shell/ThemeSwitcher';
import { THEME_COOKIE, parseThemePreference } from '@/ui/theme/theme';

export const metadata = { title: 'Settings · Persona Intelligence' };
export const dynamic = 'force-dynamic';

function when(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

export default async function SettingsPage() {
  const user = await requireUser('/settings');

  const sessions = await prisma.session.findMany({
    where: { userId: user.userId, revokedAt: null, absoluteExpiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: 'desc' },
    select: { id: true, issuedAt: true, lastSeenAt: true, absoluteExpiresAt: true },
  });

  const jar = await cookies();
  const profile = await prisma.user.findUnique({ where: { id: user.userId }, select: { themePreference: true } });
  const themePreference = parseThemePreference(jar.get(THEME_COOKIE)?.value ?? profile?.themePreference);

  return (
    <div>
      <h1 className="text-2xl">Settings</h1>

      <section aria-labelledby="account" className="mt-8">
        <h2 id="account" className="text-lg">Account</h2>
        <dl className="mt-3 grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-ink-subtle">Email</dt>
          <dd className="font-mono text-xs text-ink">{user.email}</dd>
          <dt className="text-ink-subtle">Role</dt>
          <dd className="text-ink">{user.systemRole.toLowerCase().replace(/_/g, ' ')}</dd>
        </dl>
        <p className="mt-3 max-w-prose text-xs text-ink-subtle">
          There is no password to change. Sign-in is by one-time code to this address; your role is
          set by an administrator.
        </p>
      </section>

      <section aria-labelledby="appearance" className="mt-12">
        <h2 id="appearance" className="text-lg">Appearance</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          Saved to your profile, so it follows you to another device, and to this browser, so the first page you open is already
          in your theme. The quick switch in the top bar toggles between light and dark.
        </p>
        <div className="mt-3">
          <ThemePreferenceControl initialPreference={themePreference} />
        </div>
      </section>

      <section aria-labelledby="sessions" className="mt-12">
        <h2 id="sessions" className="text-lg">Active sessions</h2>
        <p className="mt-2 max-w-prose text-sm text-ink-muted">
          Revoking a session ends it immediately on the server — a copied cookie stops working at
          once, rather than when it would have expired.
        </p>
        <ul className="mt-4 flex max-w-2xl flex-col gap-2">
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-line bg-surface px-4 py-3"
            >
              <div className="text-sm">
                <p className="text-ink">
                  {s.id === user.sessionId ? 'This session' : 'Other session'}
                </p>
                <p className="mt-0.5 text-xs text-ink-subtle">
                  Started {when(s.issuedAt)} · last seen {when(s.lastSeenAt)} · expires{' '}
                  {when(s.absoluteExpiresAt)}
                </p>
              </div>
              {s.id !== user.sessionId && (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={s.id} />
                  <button
                    type="submit"
                    className="rounded border border-line px-3 py-1.5 text-xs text-ink-muted hover:border-danger hover:text-danger"
                  >
                    Revoke
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="notifications" className="mt-12">
        <h2 id="notifications" className="text-lg">Notifications</h2>
        <p className="mt-2 max-w-prose rounded border border-line bg-surface px-4 py-4 text-sm text-ink-muted">
          <span className="mr-2 rounded bg-warn-soft px-2 py-0.5 font-mono text-[10px] uppercase text-warn">
            Not available in this build
          </span>
          Run-completion and failure notifications are delivered by Phase 4, once there are runs to
          notify about.
        </p>
      </section>
    </div>
  );
}

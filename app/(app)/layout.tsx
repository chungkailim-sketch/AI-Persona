import { cookies } from 'next/headers';
import { requireUser } from '@/auth/guard';
import { authContextFor } from '@/auth/session';
import { can } from '@/auth/permissions';
import { loadEnv } from '@/lib/env';
import { prisma } from '@/lib/prisma';
import { listProjectsForUser } from '@/server/projects';
import { activeRunsFor } from '@/server/activity';
import { ApplicationShell } from '@/ui/shell/ApplicationShell';
import { NAV_COOKIE, THEME_COOKIE, parseThemePreference } from '@/ui/theme/theme';

/**
 * Application shell.
 *
 * Authentication is required here, not only in the network guard, because the guard only checks
 * that a cookie exists. This is the point at which the session is actually resolved against the
 * database — so a revoked session, an expired one, or a deactivated user is turned away before any
 * child component renders.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const ctx = await authContextFor(user);
  const isAdmin = can(ctx, 'admin.access');

  let mockProvider = true;
  let environment = process.env.NODE_ENV ?? 'development';
  try {
    const e = loadEnv();
    mockProvider = e.MODEL_PROVIDER === 'mock';
    environment = e.NODE_ENV;
  } catch {
    mockProvider = true;
  }

  const jar = await cookies();
  const cookiePref = jar.get(THEME_COOKIE)?.value;
  const [projects, activity, profile] = await Promise.all([
    listProjectsForUser(user),
    activeRunsFor(user),
    prisma.user.findUnique({ where: { id: user.userId }, select: { themePreference: true } }),
  ]);
  // The cookie is what the first paint used; the profile is the fallback on a device without one.
  const themePreference = parseThemePreference(cookiePref ?? profile?.themePreference);

  return (
    <ApplicationShell
      initialCollapsed={jar.get(NAV_COOKIE)?.value === 'collapsed'}
      top={{
        userEmail: user.email,
        userRole: user.systemRole,
        isAdmin,
        projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status, currentStep: p.currentStep, isDemo: p.isDemo })),
        environment,
        mockProvider,
        activity,
        themePreference,
      }}
    >
      {children}
    </ApplicationShell>
  );
}

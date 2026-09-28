/**
 * Route guards (SEC-04).
 *
 * Every server component and route handler that touches protected data calls one of these. The
 * rule the prompt states — authorization is enforced server-side, not by hiding UI — is realised
 * by making the *only* convenient way to obtain a user also the way that checks permission.
 *
 * Denials are audited. An unauthorised attempt that leaves no trace is indistinguishable from one
 * that never happened, which is precisely what an investigation needs to tell apart.
 */
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { can, type AuthContext, type Permission } from '@/auth/permissions';
import { authContextFor, currentSession, type SessionUser } from '@/auth/session';
import { recordAudit } from '@/lib/audit';
import { clientIp } from '@/lib/request';

export class AuthorizationError extends Error {
  constructor(
    readonly permission: Permission,
    readonly projectId?: string,
  ) {
    super('Not authorised');
    this.name = 'AuthorizationError';
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super('Not signed in');
    this.name = 'AuthenticationError';
  }
}

/**
 * For server components: redirects to sign-in, preserving the intended destination.
 *
 * `returnTo` becomes a query parameter on the statically known `/sign-in` route, never part of the
 * path, so typed routes still verify the destination. The sign-in page validates the value again
 * before using it, because a query parameter is attacker-controlled and an unvalidated one is an
 * open redirect.
 */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await currentSession();
  if (!user) {
    if (returnTo) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
    redirect('/sign-in');
  }
  return user;
}

/** For route handlers: throws rather than redirecting, so the caller can answer 401 in JSON. */
export async function requireUserApi(): Promise<SessionUser> {
  const user = await currentSession();
  if (!user) throw new AuthenticationError();
  return user;
}

export async function requirePermission(
  permission: Permission,
  projectId?: string,
): Promise<{ user: SessionUser; ctx: AuthContext }> {
  const user = await requireUserApi();
  const ctx = await authContextFor(user, projectId);
  if (!can(ctx, permission, projectId)) {
    const h = await headers();
    await recordAudit({
      action: 'authz.denied',
      targetType: 'permission',
      targetId: permission,
      actorUserId: user.userId,
      actorEmail: user.email,
      projectId: projectId ?? null,
      reason: `Denied ${permission}${projectId ? ` on project ${projectId}` : ''}`,
      ip: clientIp(h),
    });
    throw new AuthorizationError(permission, projectId);
  }
  return { user, ctx };
}

/** Non-throwing variant, for deciding whether to render a control at all. */
export async function hasPermission(permission: Permission, projectId?: string): Promise<boolean> {
  const user = await currentSession();
  if (!user) return false;
  const ctx = await authContextFor(user, projectId);
  return can(ctx, permission, projectId);
}

/**
 * Server-side session handling (SEC-02, SEC-03).
 *
 * Design points that matter:
 *  - The cookie holds a random 256-bit token. The database stores only its SHA-256 hash, so a
 *    database disclosure does not yield usable sessions. Lookup is by hash, which is why the hash
 *    column is unique and indexed.
 *  - Two independent expiries. Idle expiry slides on use; absolute expiry never does. A session
 *    cannot be kept alive indefinitely by activity alone.
 *  - Deactivating a user takes effect on their next request, because the user record is read on
 *    every resolution rather than trusted from the cookie.
 */
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { env } from '@/lib/env';
import {
  SESSION_CONFIG,
  hashSessionToken,
  isSessionValid,
  newSessionToken,
  sessionExpiries,
} from '@/auth/otp';
import type { AuthContext, ProjectRole, SystemRole } from '@/auth/permissions';

export interface SessionUser {
  userId: string;
  email: string;
  displayName: string | null;
  systemRole: SystemRole;
  sessionId: string;
}

export async function createSession(
  userId: string,
  meta: { userAgentHash?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const { token, tokenHash } = newSessionToken();
  const { idleExpiresAt, absoluteExpiresAt } = sessionExpiries();
  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      idleExpiresAt,
      absoluteExpiresAt,
      userAgentHash: meta.userAgentHash ?? null,
    },
  });
  return { token, expiresAt: absoluteExpiresAt };
}

/**
 * Resolve the current session, or null.
 *
 * Side effect by design: a valid session's idle expiry slides forward. That write is throttled to
 * once a minute so that a page with several server components does not produce a write per
 * component.
 */
export async function currentSession(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_CONFIG.cookieName)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session) return null;
  if (!isSessionValid(session)) return null;
  if (session.user.status !== 'ACTIVE') return null;

  const now = Date.now();
  if (now - session.lastSeenAt.getTime() > 60_000) {
    const { idleExpiresAt } = sessionExpiries(new Date(now));
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now), idleExpiresAt },
    });
  }

  return {
    userId: session.userId,
    email: session.user.email,
    displayName: session.user.displayName,
    systemRole: session.user.systemRole as SystemRole,
    sessionId: session.id,
  };
}

export async function revokeSession(sessionId: string, reason: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeAllSessionsForUser(userId: string, reason: string): Promise<number> {
  const r = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return r.count;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_CONFIG.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_CONFIG.cookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: env().NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Build the authorization context for a request, resolving project membership when a project is
 * in scope. Membership is read fresh on every request — never cached in the cookie — so a removed
 * collaborator loses access immediately rather than at their next sign-in.
 */
export async function authContextFor(
  user: SessionUser,
  projectId?: string,
): Promise<AuthContext> {
  if (!projectId) {
    return { userId: user.userId, email: user.email, systemRole: user.systemRole };
  }
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: user.userId } },
    select: { role: true },
  });
  return {
    userId: user.userId,
    email: user.email,
    systemRole: user.systemRole,
    projectRole: (membership?.role as ProjectRole | undefined) ?? undefined,
  };
}

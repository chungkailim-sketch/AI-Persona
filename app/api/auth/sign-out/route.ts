/**
 * POST /api/auth/sign-out — revoke the current session.
 *
 * The session row is revoked server-side, not merely forgotten by the browser, so a copied cookie
 * is useless afterwards.
 */
import { NextResponse } from 'next/server';
import { recordAudit } from '@/lib/audit';
import { clientIp } from '@/lib/request';
import { clearSessionCookie, currentSession, revokeSession } from '@/auth/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<NextResponse> {
  const user = await currentSession();
  if (user) {
    await revokeSession(user.sessionId, 'user signed out');
    await recordAudit({
      action: 'auth.signout',
      targetType: 'session',
      targetId: user.sessionId,
      actorUserId: user.userId,
      actorEmail: user.email,
      ip: clientIp(request.headers),
    });
  }
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}

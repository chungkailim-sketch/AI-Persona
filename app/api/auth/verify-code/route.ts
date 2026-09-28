/**
 * POST /api/auth/verify-code — exchange a one-time code for a session.
 *
 * The attempt counter increments before the comparison, so a crash mid-verification cannot be used
 * to get a free guess. A successful verification consumes the challenge and invalidates every other
 * outstanding challenge for that address, so a second code sitting in an inbox cannot be replayed.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { env, demoSignIn } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { clientIp, userAgentHash } from '@/lib/request';
import { createSession, setSessionCookie } from '@/auth/session';
import { normaliseEmail, verifyCode } from '@/auth/otp';
import { enqueue } from '@/queue/queue';
import { cookies } from 'next/headers';
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, parseThemePreference } from '@/ui/theme/theme';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  email: z.string().email().max(320),
  code: z.string().regex(/^\d{6}$/, 'The code is six digits.'),
});

/** One message for every failure mode, so the endpoint cannot be used to probe state. */
const FAILURE = 'That code is not valid. Request a new one if it has expired.';

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: FAILURE }, { status: 400 });
  }

  const email = normaliseEmail(parsed.data.email);
  const ip = clientIp(request.headers);

  const challenge = await prisma.otpChallenge.findFirst({
    where: { email, consumedAt: null },
    orderBy: { createdAt: 'desc' },
  });

  if (!challenge) {
    await recordAudit({
      action: 'auth.code.failed',
      targetType: 'email',
      actorEmail: email,
      reason: 'no outstanding challenge',
      ip,
    });
    return NextResponse.json({ error: FAILURE }, { status: 400 });
  }

  // Count the attempt before comparing, so that a verification which throws or times out after
  // this point still costs an attempt rather than granting a free retry.
  //
  // The comparison then runs against the *pre-increment* count, because `verifyCode` treats
  // `attempts` as "attempts already made before this one". Passing the incremented value would
  // spend the last allowance on the cap check itself and give the user one fewer guess than
  // `maxAttempts` promises.
  await prisma.otpChallenge.update({
    where: { id: challenge.id },
    data: { attempts: { increment: 1 } },
  });

  const result = await verifyCode(challenge, parsed.data.code);

  if (!result.ok) {
    await recordAudit({
      action: 'auth.code.failed',
      targetType: 'otpChallenge',
      targetId: challenge.id,
      actorEmail: email,
      reason: result.reason,
      ip,
    });
    return NextResponse.json({ error: FAILURE }, { status: 400 });
  }

  const user = challenge.userId
    ? await prisma.user.findUnique({ where: { id: challenge.userId } })
    : await prisma.user.findUnique({ where: { email } });

  if (!user || user.status === 'DEACTIVATED') {
    await recordAudit({
      action: 'auth.code.failed',
      targetType: 'otpChallenge',
      targetId: challenge.id,
      actorEmail: email,
      reason: 'user missing or deactivated',
      ip,
    });
    return NextResponse.json({ error: FAILURE }, { status: 400 });
  }

  await prisma.$transaction([
    // Consume this challenge and every sibling: a second code in the inbox is now dead.
    prisma.otpChallenge.updateMany({
      where: { email, consumedAt: null },
      data: { consumedAt: new Date() },
    }),
    prisma.user.update({
      where: { id: user.id },
      data: { status: 'ACTIVE', lastLoginAt: new Date() },
    }),
  ]);

  const { token, expiresAt } = await createSession(user.id, {
    userAgentHash: userAgentHash(request.headers, env().IP_HASH_PEPPER),
  });
  await setSessionCookie(token, expiresAt);

  // Carry the stored theme preference to this device, so the first page after sign-in is already
  // in the user's theme rather than flashing the default.
  (await cookies()).set(THEME_COOKIE, parseThemePreference(user.themePreference), {
    path: '/',
    maxAge: THEME_COOKIE_MAX_AGE,
    sameSite: 'lax',
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  });

  // The demonstration account arrives at a prepared workspace rather than an empty upload screen.
  // Enqueued rather than awaited: reading twenty-nine databooks takes minutes, and a sign-in that
  // hangs for minutes is not a demonstration of anything good. The job is idempotent by key, so a
  // second sign-in does not start a second provisioning, and `provisionDemoWorkspace` itself
  // returns immediately in production and when no demonstration credential is configured.
  //
  // A standard user reaches none of this: the address has to match the configured one exactly.
  const demo = demoSignIn(env());
  if (demo && demo.email === user.email) {
    try {
      // The idempotency key stops a second sign-in starting a second provisioning — but a key that
      // never changes also means one failure is permanent, and the only symptom of that is a
      // project that never appears however many times you sign in. So the attempt number is part
      // of the key: a failed run is retried on the next sign-in, a succeeded one is not, and there
      // is still never more than one running at a time.
      const previous = await prisma.job.count({
        where: { kind: 'demo_provision', status: 'FAILED' },
      });
      const settled = await prisma.project.count({ where: { name: { startsWith: 'CBGA Outlook 2027' } } });

      if (settled === 0) {
        await enqueue({
          kind: 'demo_provision',
          input: {},
          idempotencyKey: `demo-provision:${user.id}:${previous}`,
          maxAttempts: 1,
        });
      }
    } catch (e) {
      // A failed enqueue must never cost someone their sign-in.
      console.warn(
        '[demo] Could not enqueue workspace provisioning:',
        e instanceof Error ? e.message : String(e),
      );
    }
  }

  await recordAudit({
    action: 'auth.session.created',
    targetType: 'user',
    targetId: user.id,
    actorUserId: user.id,
    actorEmail: user.email,
    ip,
  });

  return NextResponse.json({ ok: true, redirectTo: '/dashboard' });
}

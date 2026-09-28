/**
 * POST /api/auth/request-code — issue a one-time sign-in code.
 *
 * The response is deliberately uninformative. Whether the address is unknown, deactivated, on a
 * domain nobody approved, or perfectly valid, the caller gets the same body and the same status.
 * Anything else turns this endpoint into an account-enumeration oracle. The real outcome is in the
 * audit log, where it belongs.
 *
 * The code itself is generated, hashed, stored as a hash, and handed to the email adapter. It is
 * never placed in the response, never logged outside the development adapter, and never stored in
 * plain text.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { env, demoSignIn } from '@/lib/env';
import { recordAudit } from '@/lib/audit';
import { clientIp } from '@/lib/request';
import { checkRequestRate } from '@/auth/rateLimit';
import { ensureDevelopmentSignIn } from '@/auth/devBootstrap';
import { emailAdapter, signInEmail } from '@/email/adapter';
import {
  GENERIC_OTP_RESPONSE,
  OTP_CONFIG,
  createChallengeMaterial,
  createFixedChallengeMaterial,
  domainOf,
  hashIp,
  normaliseEmail,
} from '@/auth/otp';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({ email: z.string().email().max(320) });

/** One shape for every outcome. Callers cannot distinguish them. */
function generic(): NextResponse {
  return NextResponse.json({ message: GENERIC_OTP_RESPONSE }, { status: 202 });
}

/**
 * Say out loud, in development only, why a code was not sent.
 *
 * The HTTP response has to stay uninformative — that is what stops this endpoint being an
 * account-enumeration oracle — but a developer staring at "If that address is eligible…" and an
 * empty inbox has been told nothing at all. The audit log has the answer, and nobody thinks to
 * read the audit log while trying to sign in. This puts it in the terminal they are already
 * watching, and never runs outside development.
 */
function explainRefusal(email: string, reason: string, remedy: string): void {
  if (process.env.NODE_ENV === 'production') return;
  console.warn(
    `\n[auth] No sign-in code was sent to ${email}.\n` +
      `       Reason: ${reason}\n` +
      `       Fix:    ${remedy}\n` +
      `       (The browser deliberately shows the same message either way. This note is development-only.)\n`,
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // A malformed body is a client error, not an enumeration signal — it reveals nothing about
    // whether any particular address exists.
    return NextResponse.json({ error: 'A valid email address is required.' }, { status: 400 });
  }

  // Development only, once per process, and a no-op in production: make sure the addresses the
  // environment names actually exist before we check whether they do. Without this, a correct
  // .env still fails until somebody remembers to run the seed.
  await ensureDevelopmentSignIn();

  const email = normaliseEmail(parsed.data.email);
  const ip = clientIp(request.headers);
  const ipHash = ip ? hashIp(ip, env().IP_HASH_PEPPER) : null;

  const rate = await checkRequestRate(email, ipHash);
  if (!rate.allowed) {
    await recordAudit({
      action: 'auth.code.request_refused',
      targetType: 'email',
      actorEmail: email,
      reason: rate.reason ?? 'rate limited',
      ip,
    });
    // Rate limiting is the one case where the response differs, because the user needs to know to
    // wait. It reveals nothing about the address: the limit applies to any address equally.
    return NextResponse.json(
      { message: 'Too many requests. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rate.retryAfterSeconds ?? 60) } },
    );
  }

  const domain = domainOf(email);
  const approved = domain
    ? await prisma.approvedDomain.findFirst({ where: { domain, active: true } })
    : null;

  if (!approved) {
    await recordAudit({
      action: 'auth.code.request_refused',
      targetType: 'email',
      actorEmail: email,
      reason: 'domain not approved',
      ip,
    });
    explainRefusal(
      email,
      `the domain "${domain ?? '(unparseable)'}" is not an active approved domain.`,
      'in development the domains named in BOOTSTRAP_APPROVED_DOMAINS and DEMO_SIGN_IN_EMAIL are created automatically, ' +
        'so either this domain is in neither, or it exists and was deactivated. Add it to .env and restart, ' +
        'or reactivate it under Admin → Approved domains. Run "npm run doctor" to see which.',
    );
    return generic();
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (user && user.status === 'DEACTIVATED') {
    await recordAudit({
      action: 'auth.code.request_refused',
      targetType: 'user',
      targetId: user.id,
      actorEmail: email,
      reason: 'user deactivated',
      ip,
    });
    explainRefusal(
      email,
      'that account is deactivated.',
      'reactivate it under Admin → Users, or sign in with another address.',
    );
    return generic();
  }

  // First sign-in from an approved domain creates the account. The account is INVITED until a code
  // is actually verified, so an unverified address never becomes an active user.
  const account =
    user ??
    (await prisma.user.create({ data: { email, systemRole: 'STANDARD_USER', status: 'INVITED' } }));

  // A demonstration address, when one is configured, gets a predictable code instead of a random
  // one. Everything downstream is unchanged: the code is hashed with a fresh salt, expires on the
  // same clock, and is subject to the same attempt cap. `demoSignIn` returns null in production,
  // and `loadEnv` refuses to start a production environment that sets it at all.
  const demo = demoSignIn(env());
  const isDemoAddress = demo !== null && demo.email === email;

  // Half a configuration is the trap worth naming: the address is approved, a code is issued and
  // emailed, everything looks like it worked — and the fixed code the person is typing was never
  // the code that was generated.
  if (demo === null && process.env.NODE_ENV !== 'production') {
    const half =
      Boolean(env().DEMO_SIGN_IN_EMAIL) !== Boolean(env().DEMO_SIGN_IN_CODE);
    if (half) {
      console.warn(
        '\n[auth] DEMO_SIGN_IN_EMAIL and DEMO_SIGN_IN_CODE must BOTH be set. Only one is.\n' +
          '       The fixed demonstration code is therefore OFF and a random code was issued instead.\n',
      );
    }
  }

  const { code, codeHash, salt, expiresAt } = isDemoAddress
    ? await createFixedChallengeMaterial(demo.code)
    : await createChallengeMaterial();

  await prisma.otpChallenge.create({
    data: {
      email,
      userId: account.id,
      codeHash,
      salt,
      expiresAt,
      maxAttempts: OTP_CONFIG.maxAttempts,
      requestIpHash: ipHash,
    },
  });

  try {
    await emailAdapter().send({ to: email, ...signInEmail(code, OTP_CONFIG.ttlMs / 60000) });
  } catch (e) {
    // Delivery failure must be loud in the log — a user waiting for a code that was never sent has
    // no way to tell the difference from a code that was.
    console.error('[auth] sign-in code delivery failed', {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  await recordAudit({
    action: 'auth.code.requested',
    targetType: 'user',
    targetId: account.id,
    actorEmail: email,
    ip,
    // Recorded so that a log read later cannot mistake a demonstration sign-in for a real one.
    reason: isDemoAddress ? 'fixed demonstration code (development environment)' : undefined,
  });

  return generic();
}

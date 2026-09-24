// @vitest-environment node
process.env.DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? 'postgresql://postgres@localhost:55432/rfpi_test?host=/tmp';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters-long';
process.env.IP_HASH_PEPPER = 'test-pepper';

import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDatabase, seedUser } from './helpers';
import { checkRequestRate, IP_LIMIT_PER_HOUR } from '../../src/auth/rateLimit';
import { OTP_CONFIG } from '../../src/auth/otp';

async function challengeAt(email: string, at: Date, ipHash: string | null = null) {
  await db.otpChallenge.create({
    data: {
      email,
      codeHash: 'x'.repeat(128),
      salt: 'y'.repeat(32),
      expiresAt: new Date(at.getTime() + OTP_CONFIG.ttlMs),
      createdAt: at,
      requestIpHash: ipHash,
    },
  });
}

describe('sign-in rate limiting', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('allows a first request', async () => {
    await seedUser('rl1@example.com');
    expect(await checkRequestRate('rl1@example.com', null)).toEqual({ allowed: true });
  });

  it('enforces the resend cooldown and reports how long to wait', async () => {
    const now = new Date();
    await challengeAt('rl2@example.com', new Date(now.getTime() - 10_000));

    const decision = await checkRequestRate('rl2@example.com', null, now);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('COOLDOWN_ACTIVE');
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(OTP_CONFIG.resendCooldownMs / 1000);
  });

  it('allows a resend once the cooldown has passed', async () => {
    const now = new Date();
    await challengeAt('rl3@example.com', new Date(now.getTime() - OTP_CONFIG.resendCooldownMs - 1000));
    expect(await checkRequestRate('rl3@example.com', null, now)).toEqual({ allowed: true });
  });

  it('enforces the hourly cap per address', async () => {
    const now = new Date();
    for (let i = 0; i < OTP_CONFIG.maxPerAddressPerHour; i += 1) {
      await challengeAt('rl4@example.com', new Date(now.getTime() - (i + 2) * 120_000));
    }
    const decision = await checkRequestRate('rl4@example.com', null, now);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('HOURLY_LIMIT');
  });

  it('forgets requests older than an hour', async () => {
    const now = new Date();
    for (let i = 0; i < OTP_CONFIG.maxPerAddressPerHour + 3; i += 1) {
      await challengeAt('rl5@example.com', new Date(now.getTime() - 3_700_000 - i * 1000));
    }
    expect(await checkRequestRate('rl5@example.com', null, now)).toEqual({ allowed: true });
  });

  it('caps requests from one IP across many different addresses', async () => {
    const now = new Date();
    const ipHash = 'deadbeef'.repeat(8);
    // Each address is under its own limit; the IP limit is what stops enumeration.
    for (let i = 0; i < IP_LIMIT_PER_HOUR; i += 1) {
      await challengeAt(`enum${i}@example.com`, new Date(now.getTime() - (i + 2) * 60_000), ipHash);
    }
    const decision = await checkRequestRate('fresh@example.com', ipHash, now);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('IP_LIMIT');

    // A different client is unaffected.
    expect(await checkRequestRate('fresh@example.com', 'cafe'.repeat(16), now)).toEqual({
      allowed: true,
    });
  });
});

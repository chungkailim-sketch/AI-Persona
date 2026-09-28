// @vitest-environment node
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { db, resetDatabase, seedDomain, seedUser } from './helpers';
import {
  OTP_CONFIG,
  createChallengeMaterial,
  hashCode,
  verifyCode,
  isDomainAllowed,
  newSessionToken,
  hashSessionToken,
  sessionExpiries,
  isSessionValid,
} from '../../src/auth/otp';

describe('one-time code lifecycle against the database', () => {
  beforeAll(async () => { await resetDatabase(); });
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('stores only a hash, never the code', async () => {
    const user = await seedUser('a@example.com');
    const { code, codeHash, salt, expiresAt } = await createChallengeMaterial();

    await db.otpChallenge.create({
      data: { email: user.email, userId: user.id, codeHash, salt, expiresAt },
    });

    const row = await db.otpChallenge.findFirstOrThrow({ where: { email: user.email } });
    expect(row.codeHash).not.toBe(code);
    expect(row.codeHash).not.toContain(code);
    expect(row.codeHash).toHaveLength(OTP_CONFIG.scryptKeyLength * 2);
    // The stored hash is reproducible from the code and salt, and from nothing else.
    expect(await hashCode(code, row.salt)).toBe(row.codeHash);
    expect(await hashCode(code, 'different-salt')).not.toBe(row.codeHash);
  });

  it('accepts the right code once and refuses the same challenge afterwards', async () => {
    const user = await seedUser('b@example.com');
    const { code, codeHash, salt, expiresAt } = await createChallengeMaterial();
    const row = await db.otpChallenge.create({
      data: { email: user.email, userId: user.id, codeHash, salt, expiresAt },
    });

    expect(await verifyCode(row, code)).toEqual({ ok: true });

    await db.otpChallenge.update({ where: { id: row.id }, data: { consumedAt: new Date() } });
    const consumed = await db.otpChallenge.findUniqueOrThrow({ where: { id: row.id } });
    expect(await verifyCode(consumed, code)).toEqual({ ok: false, reason: 'ALREADY_USED' });
  });

  it('refuses a wrong code and stops entirely at the attempt cap', async () => {
    const user = await seedUser('c@example.com');
    const { code, codeHash, salt, expiresAt } = await createChallengeMaterial();
    const row = await db.otpChallenge.create({
      data: { email: user.email, userId: user.id, codeHash, salt, expiresAt },
    });

    const wrong = code === '000000' ? '111111' : '000000';

    // The caller increments durably first, then verifies against the pre-increment count. This
    // mirrors the route exactly, and pins the promise that `maxAttempts` guesses are evaluated —
    // not one fewer.
    let current = row;
    for (let i = 1; i <= OTP_CONFIG.maxAttempts; i += 1) {
      const before = current;
      current = await db.otpChallenge.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 } },
      });
      expect(await verifyCode(before, wrong)).toEqual({ ok: false, reason: 'INVALID_CODE' });
    }

    // The allowance is now spent, and even the correct code is refused.
    expect(await verifyCode(current, code)).toEqual({ ok: false, reason: 'TOO_MANY_ATTEMPTS' });
  });

  it('refuses an expired challenge', async () => {
    const user = await seedUser('d@example.com');
    const { code, codeHash, salt } = await createChallengeMaterial();
    const row = await db.otpChallenge.create({
      data: {
        email: user.email,
        userId: user.id,
        codeHash,
        salt,
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    expect(await verifyCode(row, code)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('matches domains exactly, never by suffix', async () => {
    await seedDomain('example.com');
    const active = (await db.approvedDomain.findMany({ where: { active: true } })).map((d) => d.domain);

    expect(isDomainAllowed('someone@example.com', active)).toBe(true);
    expect(isDomainAllowed('SOMEONE@Example.COM', active)).toBe(true);
    // A suffix match would admit an attacker-registered domain; it must not.
    expect(isDomainAllowed('someone@mail.example.com', active)).toBe(false);
    expect(isDomainAllowed('someone@notexample.com', active)).toBe(false);
    expect(isDomainAllowed('someone@example.com.evil.test', active)).toBe(false);
  });
});

describe('session tokens against the database', () => {
  beforeEach(async () => { await resetDatabase(); });
  afterAll(async () => { await db.$disconnect(); });

  it('stores the hash, and the raw token is not recoverable from the row', async () => {
    const user = await seedUser('e@example.com');
    const { token, tokenHash } = newSessionToken();
    const { idleExpiresAt, absoluteExpiresAt } = sessionExpiries();

    await db.session.create({ data: { userId: user.id, tokenHash, idleExpiresAt, absoluteExpiresAt } });

    const row = await db.session.findUniqueOrThrow({ where: { tokenHash } });
    expect(row.tokenHash).not.toBe(token);
    expect(row.tokenHash).toBe(hashSessionToken(token));
    expect(isSessionValid(row)).toBe(true);
  });

  it('treats a revoked session as invalid even before it expires', async () => {
    const user = await seedUser('f@example.com');
    const { tokenHash } = newSessionToken();
    const { idleExpiresAt, absoluteExpiresAt } = sessionExpiries();
    const row = await db.session.create({
      data: { userId: user.id, tokenHash, idleExpiresAt, absoluteExpiresAt },
    });

    const revoked = await db.session.update({
      where: { id: row.id },
      data: { revokedAt: new Date(), revokedReason: 'test' },
    });
    expect(isSessionValid(revoked)).toBe(false);
  });

  it('honours absolute expiry even when the session is still active', async () => {
    const user = await seedUser('g@example.com');
    const { tokenHash } = newSessionToken();
    const row = await db.session.create({
      data: {
        userId: user.id,
        tokenHash,
        idleExpiresAt: new Date(Date.now() + 60_000),
        absoluteExpiresAt: new Date(Date.now() - 1),
      },
    });
    expect(isSessionValid(row)).toBe(false);
  });
});

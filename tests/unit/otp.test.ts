import { describe, it, expect } from 'vitest';
import {
  generateCode, createChallengeMaterial, createFixedChallengeMaterial, verifyCode, hashCode, isDomainAllowed,
  canResend, withinHourlyLimit, OTP_CONFIG, newSessionToken, hashSessionToken,
  sessionExpiries, isSessionValid, domainOf, normaliseEmail,
} from '@/auth/otp';

const challenge = async (over: Partial<Awaited<ReturnType<typeof createChallengeMaterial>>> = {}) => {
  const m = await createChallengeMaterial();
  return {
    base: {
      id: 'c1', email: 'a@example.com',
      codeHash: over.codeHash ?? m.codeHash, salt: over.salt ?? m.salt,
      expiresAt: over.expiresAt ?? m.expiresAt,
      consumedAt: null as Date | null, attempts: 0, maxAttempts: OTP_CONFIG.maxAttempts,
    },
    code: m.code,
  };
};

describe('code generation', () => {
  it('produces a code of the configured length, digits only', () => {
    const c = generateCode();
    expect(c).toHaveLength(OTP_CONFIG.codeLength);
    expect(c).toMatch(/^\d+$/);
  });

  it('does not repeat across many generations', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateCode()));
    expect(seen.size).toBeGreaterThan(150);
  });
});

describe('hashing', () => {
  it('never stores the plaintext code', async () => {
    const { code, codeHash, salt } = await createChallengeMaterial();
    expect(codeHash).not.toContain(code);
    expect(codeHash).toHaveLength(OTP_CONFIG.scryptKeyLength * 2);
    expect(await hashCode(code, salt)).toBe(codeHash);
  });

  it('produces different hashes for the same code under different salts', async () => {
    const a = await hashCode('123456', 'salt-a');
    const b = await hashCode('123456', 'salt-b');
    expect(a).not.toBe(b);
  });
});

describe('verification', () => {
  it('accepts the correct code', async () => {
    const { base, code } = await challenge();
    expect(await verifyCode(base, code)).toEqual({ ok: true });
  });

  it('rejects a wrong code', async () => {
    const { base, code } = await challenge();
    const wrong = code === '000000' ? '111111' : '000000';
    expect(await verifyCode(base, wrong)).toEqual({ ok: false, reason: 'INVALID_CODE' });
  });

  it('rejects an expired code', async () => {
    const { base, code } = await challenge({ expiresAt: new Date(Date.now() - 1000) });
    expect(await verifyCode(base, code)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('rejects a reused code', async () => {
    const { base, code } = await challenge();
    const consumed = { ...base, consumedAt: new Date() };
    expect(await verifyCode(consumed, code)).toEqual({ ok: false, reason: 'ALREADY_USED' });
  });

  it('rejects once the attempt limit is reached', async () => {
    const { base, code } = await challenge();
    const maxed = { ...base, attempts: OTP_CONFIG.maxAttempts };
    expect(await verifyCode(maxed, code)).toEqual({ ok: false, reason: 'TOO_MANY_ATTEMPTS' });
  });
});

describe('domain allowlist', () => {
  const allowed = ['example.com', 'RuderFinn.com'];
  it('matches case-insensitively', () => {
    expect(isDomainAllowed('Person@Example.com', allowed)).toBe(true);
    expect(isDomainAllowed('person@ruderfinn.com', allowed)).toBe(true);
  });
  it('does not admit subdomains implicitly', () => {
    expect(isDomainAllowed('person@mail.example.com', allowed)).toBe(false);
  });
  it('rejects malformed addresses', () => {
    expect(isDomainAllowed('not-an-email', allowed)).toBe(false);
    expect(isDomainAllowed('@example.com', allowed)).toBe(false);
    expect(isDomainAllowed('person@', allowed)).toBe(false);
  });
  it('normalises and extracts the domain', () => {
    expect(normaliseEmail('  A@B.COM ')).toBe('a@b.com');
    expect(domainOf('a@b.com')).toBe('b.com');
  });
});

describe('rate limiting', () => {
  it('enforces the resend cooldown', () => {
    expect(canResend(null)).toBe(true);
    expect(canResend(new Date(Date.now() - 1000))).toBe(false);
    expect(canResend(new Date(Date.now() - OTP_CONFIG.resendCooldownMs - 1))).toBe(true);
  });
  it('enforces the hourly ceiling and ignores older requests', () => {
    const now = new Date();
    const recent = Array.from({ length: OTP_CONFIG.maxPerAddressPerHour }, () => new Date(now.getTime() - 60_000));
    expect(withinHourlyLimit(recent, now)).toBe(false);
    const old = Array.from({ length: 10 }, () => new Date(now.getTime() - 2 * 60 * 60 * 1000));
    expect(withinHourlyLimit(old, now)).toBe(true);
  });
});

describe('sessions', () => {
  it('stores only a hash of the token', () => {
    const { token, tokenHash } = newSessionToken();
    expect(tokenHash).not.toBe(token);
    expect(hashSessionToken(token)).toBe(tokenHash);
  });
  it('invalidates on revocation, idle expiry and absolute expiry', () => {
    const now = new Date();
    const { idleExpiresAt, absoluteExpiresAt } = sessionExpiries(now);
    expect(isSessionValid({ revokedAt: null, idleExpiresAt, absoluteExpiresAt }, now)).toBe(true);
    expect(isSessionValid({ revokedAt: new Date(), idleExpiresAt, absoluteExpiresAt }, now)).toBe(false);
    expect(isSessionValid({ revokedAt: null, idleExpiresAt: new Date(now.getTime() - 1), absoluteExpiresAt }, now)).toBe(false);
    expect(isSessionValid({ revokedAt: null, idleExpiresAt, absoluteExpiresAt: new Date(now.getTime() - 1) }, now)).toBe(false);
  });
});

describe('a fixed demonstration code', () => {
  it('is never stored in plain text, exactly like a random one', async () => {
    const material = await createFixedChallengeMaterial('010101');
    expect(material.code).toBe('010101');
    expect(material.codeHash).not.toContain('010101');
    expect(material.salt).toHaveLength(32);
    // The hash is a scrypt derivation, so it is the full key length in hex.
    expect(material.codeHash).toHaveLength(OTP_CONFIG.scryptKeyLength * 2);
  });

  it('produces a different hash each time, because the salt is fresh', async () => {
    const a = await createFixedChallengeMaterial('010101');
    const b = await createFixedChallengeMaterial('010101');
    expect(a.codeHash).not.toBe(b.codeHash);
  });

  it('verifies, and still refuses a wrong code', async () => {
    const m = await createFixedChallengeMaterial('010101');
    const challenge = {
      id: 'c1', email: 'admin@rfcomms.com', codeHash: m.codeHash, salt: m.salt,
      expiresAt: m.expiresAt, consumedAt: null, attempts: 0, maxAttempts: 5,
    };
    expect(await verifyCode(challenge, '010101')).toEqual({ ok: true });
    expect(await verifyCode(challenge, '010102')).toEqual({ ok: false, reason: 'INVALID_CODE' });
  });

  it('expires on the same clock as every other code', async () => {
    const m = await createFixedChallengeMaterial('010101');
    const challenge = {
      id: 'c1', email: 'admin@rfcomms.com', codeHash: m.codeHash, salt: m.salt,
      expiresAt: m.expiresAt, consumedAt: null, attempts: 0, maxAttempts: 5,
    };
    const afterExpiry = new Date(m.expiresAt.getTime() + 1);
    expect(await verifyCode(challenge, '010101', afterExpiry)).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('is still subject to the attempt cap', async () => {
    const m = await createFixedChallengeMaterial('010101');
    const challenge = {
      id: 'c1', email: 'admin@rfcomms.com', codeHash: m.codeHash, salt: m.salt,
      expiresAt: m.expiresAt, consumedAt: null, attempts: 5, maxAttempts: 5,
    };
    expect(await verifyCode(challenge, '010101')).toEqual({ ok: false, reason: 'TOO_MANY_ATTEMPTS' });
  });
});

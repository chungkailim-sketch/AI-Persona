// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { db, resetDatabase } from './helpers';
import { resetEnvCache } from '../../src/lib/env';
import { ensureDevelopmentSignIn, resetDevBootstrap } from '../../src/auth/devBootstrap';

/**
 * The convenience that removes the seed step, and the three ways it must refuse to be convenient.
 *
 * The failure this exists to prevent is specific and was hit in practice: a correct .env, a correct
 * fixed code, and a sign-in that fails anyway because the approved domain lives in a table nobody
 * had populated — reported through an endpoint that is deliberately incapable of saying so.
 */
const BASE = {
  SESSION_SECRET: 'x'.repeat(48),
  DATABASE_URL: process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL!,
};

function configure(over: Record<string, string>): void {
  for (const [k, v] of Object.entries({ ...BASE, ...over })) process.env[k] = v;
  resetEnvCache();
  resetDevBootstrap();
}

function clear(...keys: string[]): void {
  for (const k of keys) delete process.env[k];
}

describe('development sign-in reconciliation', () => {
  beforeEach(async () => {
    await resetDatabase();
    clear('DEMO_SIGN_IN_EMAIL', 'DEMO_SIGN_IN_CODE', 'BOOTSTRAP_APPROVED_DOMAINS', 'BOOTSTRAP_SUPER_ADMIN_EMAIL');
    Object.assign(process.env, { NODE_ENV: 'test' });
  });
  afterAll(async () => {
    clear('DEMO_SIGN_IN_EMAIL', 'DEMO_SIGN_IN_CODE', 'BOOTSTRAP_APPROVED_DOMAINS', 'BOOTSTRAP_SUPER_ADMIN_EMAIL');
    resetEnvCache();
    await db.$disconnect();
  });

  it('creates the demonstration domain and account from an empty database', async () => {
    configure({ DEMO_SIGN_IN_EMAIL: 'admin@rfcomms.com', DEMO_SIGN_IN_CODE: '010101' });
    await ensureDevelopmentSignIn();

    const domain = await db.approvedDomain.findUnique({ where: { domain: 'rfcomms.com' } });
    expect(domain?.active).toBe(true);
    const user = await db.user.findUnique({ where: { email: 'admin@rfcomms.com' } });
    expect(user?.systemRole).toBe('SUPER_ADMIN');
    expect(user?.status).toBe('ACTIVE');
  });

  it('creates the domains named in BOOTSTRAP_APPROVED_DOMAINS too', async () => {
    configure({ BOOTSTRAP_APPROVED_DOMAINS: 'alpha.test, beta.test' });
    await ensureDevelopmentSignIn();

    expect(await db.approvedDomain.findUnique({ where: { domain: 'alpha.test' } })).toBeTruthy();
    expect(await db.approvedDomain.findUnique({ where: { domain: 'beta.test' } })).toBeTruthy();
  });

  it('does nothing whatsoever in production', async () => {
    // The environment loader refuses a production environment carrying a demo credential, so this
    // reaches the guard through BOOTSTRAP_APPROVED_DOMAINS instead — the branch that could
    // otherwise widen a real allowlist without anyone asking.
    configure({
      NODE_ENV: 'production',
      BOOTSTRAP_APPROVED_DOMAINS: 'should-never-be-created.test',
      EMAIL_PROVIDER: 'postmark',
      OBJECT_STORAGE_PROVIDER: 's3',
      IP_HASH_PEPPER: 'a-real-pepper-value',
    });
    await ensureDevelopmentSignIn();

    expect(
      await db.approvedDomain.findUnique({ where: { domain: 'should-never-be-created.test' } }),
    ).toBeNull();

    Object.assign(process.env, { NODE_ENV: 'test' });
    clear('EMAIL_PROVIDER', 'OBJECT_STORAGE_PROVIDER');
    resetEnvCache();
  });

  it('never reactivates a domain an administrator switched off', async () => {
    await db.approvedDomain.create({ data: { domain: 'rfcomms.com', active: false } });
    configure({ DEMO_SIGN_IN_EMAIL: 'admin@rfcomms.com', DEMO_SIGN_IN_CODE: '010101' });
    await ensureDevelopmentSignIn();

    const domain = await db.approvedDomain.findUnique({ where: { domain: 'rfcomms.com' } });
    expect(domain?.active).toBe(false);
  });

  it('never reactivates or re-promotes an existing account', async () => {
    await db.user.create({
      data: { email: 'admin@rfcomms.com', systemRole: 'STANDARD_USER', status: 'DEACTIVATED' },
    });
    configure({ DEMO_SIGN_IN_EMAIL: 'admin@rfcomms.com', DEMO_SIGN_IN_CODE: '010101' });
    await ensureDevelopmentSignIn();

    const user = await db.user.findUnique({ where: { email: 'admin@rfcomms.com' } });
    expect(user?.status).toBe('DEACTIVATED');
    expect(user?.systemRole).toBe('STANDARD_USER');
  });

  it('runs once per process, however many times it is called', async () => {
    configure({ DEMO_SIGN_IN_EMAIL: 'admin@rfcomms.com', DEMO_SIGN_IN_CODE: '010101' });
    await Promise.all([
      ensureDevelopmentSignIn(),
      ensureDevelopmentSignIn(),
      ensureDevelopmentSignIn(),
    ]);
    await ensureDevelopmentSignIn();

    expect(await db.user.count({ where: { email: 'admin@rfcomms.com' } })).toBe(1);
    expect(await db.approvedDomain.count({ where: { domain: 'rfcomms.com' } })).toBe(1);
  });
});

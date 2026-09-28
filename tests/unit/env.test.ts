import { describe, it, expect } from 'vitest';
import { loadEnv, EnvironmentError, integrationStatus, approvedDomainsFromEnv, demoSignIn } from '@/lib/env';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  SESSION_SECRET: 'x'.repeat(48),
};

describe('environment validation', () => {
  it('accepts a minimal valid configuration and applies defaults', () => {
    const env = loadEnv(valid);
    expect(env.MODEL_PROVIDER).toBe('mock');
    expect(env.QUEUE_DRIVER).toBe('postgres');
  });

  it('treats a blank value as unset, the way .env.example ships optional settings', () => {
    const env = loadEnv({ ...valid, TIMESFM_URL: '', DEMO_SIGN_IN_EMAIL: '  ', ANTHROPIC_API_KEY: '' });
    expect(env.TIMESFM_URL).toBeUndefined();
    expect(env.DEMO_SIGN_IN_EMAIL).toBeUndefined();
    expect(() => loadEnv({ ...valid, TIMESFM_URL: 'not a url' })).toThrow(/TIMESFM_URL/);
    expect(() => loadEnv({ ...valid, DATABASE_URL: '' })).toThrow(EnvironmentError);
  });

  it('fails when required values are missing', () => {
    expect(() => loadEnv({})).toThrow(EnvironmentError);
  });

  it('refuses development adapters in production', () => {
    const prod = { ...valid, NODE_ENV: 'production', EMAIL_PROVIDER: 'dev' };
    expect(() => loadEnv(prod)).toThrow(/EMAIL_PROVIDER=dev is not permitted in production/);
  });

  it('refuses local object storage in production', () => {
    const prod = {
      ...valid, NODE_ENV: 'production', EMAIL_PROVIDER: 'postmark', OBJECT_STORAGE_PROVIDER: 'local',
    };
    expect(() => loadEnv(prod)).toThrow(/OBJECT_STORAGE_PROVIDER=local is not permitted in production/);
  });

  it('requires a key when the live model provider is selected', () => {
    const prod = {
      ...valid, NODE_ENV: 'production', EMAIL_PROVIDER: 'postmark', OBJECT_STORAGE_PROVIDER: 's3',
      IP_HASH_PEPPER: 'a-real-pepper', MODEL_PROVIDER: 'anthropic',
    };
    expect(() => loadEnv(prod)).toThrow(/requires ANTHROPIC_API_KEY/);
  });
});

describe('integration status', () => {
  it('reports mock providers as not connected, with an explanation', () => {
    const list = integrationStatus(loadEnv(valid));
    const model = list.find((i) => i.key === 'model');
    expect(model?.connected).toBe(false);
    expect(model?.note).toMatch(/labelled as mock/i);
    expect(list.find((i) => i.key === 'forecast')?.connected).toBe(false);
  });

  it('never exposes a secret value', () => {
    const env = loadEnv({ ...valid, MODEL_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-secret-value' });
    const serialised = JSON.stringify(integrationStatus(env));
    expect(serialised).not.toContain('sk-secret-value');
  });
});

describe('approved domains', () => {
  it('parses, trims and lowercases the bootstrap list', () => {
    const env = loadEnv({ ...valid, BOOTSTRAP_APPROVED_DOMAINS: ' Example.com , rf.com ,' });
    expect(approvedDomainsFromEnv(env)).toEqual(['example.com', 'rf.com']);
  });
});

describe('the demonstration sign-in credential', () => {
  const demoEnv = {
    ...valid,
    DEMO_SIGN_IN_EMAIL: 'admin@rfcomms.com',
    DEMO_SIGN_IN_CODE: '010101',
  };

  it('is available in development when both halves are set', () => {
    expect(demoSignIn(loadEnv(demoEnv))).toEqual({ email: 'admin@rfcomms.com', code: '010101' });
  });

  it('is nothing at all when only one half is set', () => {
    const { DEMO_SIGN_IN_CODE: _omitted, ...halfA } = demoEnv;
    const { DEMO_SIGN_IN_EMAIL: _also, ...halfB } = demoEnv;
    expect(demoSignIn(loadEnv(halfA))).toBeNull();
    expect(demoSignIn(loadEnv(halfB))).toBeNull();
  });

  it('refuses a code that is not six digits, rather than silently truncating it', () => {
    expect(() => loadEnv({ ...demoEnv, DEMO_SIGN_IN_CODE: '0101' })).toThrow(/exactly six digits/);
    expect(() => loadEnv({ ...demoEnv, DEMO_SIGN_IN_CODE: 'abcdef' })).toThrow(/exactly six digits/);
  });

  it('stops a production deployment from starting at all', () => {
    // Not "ignored in production" — refused, loudly, at boot. A fixed code that is quietly
    // disabled is a configuration someone will eventually believe is working.
    expect(() =>
      loadEnv({
        ...demoEnv,
        NODE_ENV: 'production',
        EMAIL_PROVIDER: 'postmark',
        OBJECT_STORAGE_PROVIDER: 's3',
        IP_HASH_PEPPER: 'a-real-pepper',
      }),
    ).toThrow(/not permitted in production/);
  });

  it('is named in the integration list so nobody has to read the environment to find it', () => {
    const entry = integrationStatus(loadEnv(demoEnv)).find((i) => i.key === 'demo-sign-in');
    expect(entry?.mode).toBe('fixed code');
    expect(entry?.note).toContain('admin@rfcomms.com');
    // The note must not repeat the code: this list is rendered in the browser.
    expect(entry?.note).not.toContain('010101');
  });

  it('reports itself as off when nothing is configured', () => {
    const entry = integrationStatus(loadEnv(valid)).find((i) => i.key === 'demo-sign-in');
    expect(entry?.mode).toBe('off');
    expect(entry?.note).toMatch(/Every sign-in code is random/);
  });
});

describe('judge and forecast integrations', () => {
  it('defaults TypeSafe to names-only and never exposes the key', () => {
    const e = loadEnv({ ...valid, TYPESAFE_API_KEY: 'apikey_secret_value' });
    expect(e.TYPESAFE_FEATURES).toBe('sensitive');
    const s = integrationStatus(e);
    const judge = s.find((x) => x.key === 'judge')!;
    expect(judge.connected).toBe(true);
    expect(JSON.stringify(s)).not.toContain('apikey_secret_value');
  });
  it('reports TimesFM as evaluation-only until approved', () => {
    const f = integrationStatus(loadEnv({ ...valid, TIMESFM_URL: 'http://timesfm:8080' })).find((x) => x.key === 'forecast')!;
    expect(f.mode).toMatch(/evaluation only/);
  });
});

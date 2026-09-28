/**
 * Typed environment access with fail-fast validation (prompt §16).
 *
 * Two rules are enforced here rather than by documentation:
 *  1. Development-only adapters (dev email, local storage, no-op scanning) are REFUSED in
 *     production. A misconfigured production deploy fails at boot, not silently at runtime.
 *  2. `ANTHROPIC_API_KEY` is read in this module only, is never exported, and is never
 *     serialised. Nothing under `app/` may import it.
 */
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  APP_VERSION: z.string().default('0.1.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  IP_HASH_PEPPER: z.string().min(8).default('dev-pepper-change-me'),
  MODEL_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_ID: z.string().default('claude-sonnet-4-5'),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(4000),
  AI_TEMPERATURE: z.coerce.number().min(0).max(1).default(0.7),
  AI_RUN_BUDGET_USD: z.coerce.number().nonnegative().default(5),
  AI_PROJECT_MONTHLY_BUDGET_USD: z.coerce.number().nonnegative().default(200),
  EMAIL_PROVIDER: z.enum(['dev', 'postmark', 'ses', 'sendgrid', 'smtp']).default('dev'),
  EMAIL_FROM: z.string().default('no-reply@example.com'),
  EMAIL_API_KEY: z.string().optional(),
  // SMTP relay (EMAIL_PROVIDER=smtp). Mailchimp Transactional: smtp.mandrillapp.com, 587, any
  // username, and a Mandrill API key as the password (EMAIL_API_KEY).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  OBJECT_STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  OBJECT_STORAGE_BUCKET: z.string().optional(),
  OBJECT_STORAGE_REGION: z.string().optional(),
  OBJECT_STORAGE_ENDPOINT: z.string().optional(),
  OBJECT_STORAGE_ACCESS_KEY_ID: z.string().optional(),
  OBJECT_STORAGE_SECRET_ACCESS_KEY: z.string().optional(),
  SCAN_PROVIDER: z.enum(['none', 'clamav', 'external']).default('none'),
  QUEUE_DRIVER: z.enum(['postgres', 'redis']).default('postgres'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_HEARTBEAT_MS: z.coerce.number().int().positive().default(15_000),
  BOOTSTRAP_APPROVED_DOMAINS: z.string().default(''),
  BOOTSTRAP_SUPER_ADMIN_EMAIL: z.string().optional(),

  /**
   * A fixed sign-in code for one nominated address, so a demonstration does not depend on
   * reading a terminal. Refused outright in production by the guards below.
   *
   * The code is still hashed with a per-challenge salt before storage, still expires, and is
   * still subject to the attempt cap — the only thing that changes is that it is predictable.
   * That is precisely why it cannot be allowed anywhere real.
   */
  DEMO_SIGN_IN_EMAIL: z.string().email().optional(),
  DEMO_SIGN_IN_CODE: z
    .string()
    .regex(/^\d{6}$/, 'DEMO_SIGN_IN_CODE must be exactly six digits')
    .optional(),

  /**
   * A folder of Mintel databooks to preload behind the demonstration credential, so that a demo
   * does not begin on an empty upload screen. Read only when a demonstration credential is
   * configured, and therefore never in production.
   */
  DEMO_DATASET_DIR: z.string().optional(),

  /**
   * TypeSafe System One — an external judge model used for advisory second opinions (sensitive
   * field names, stimulus injection, stance/rationale consistency). Read here and in
   * `src/judge/typesafe.ts` only; never serialised, never sent to the browser.
   */
  TYPESAFE_API_KEY: z.string().optional(),
  TYPESAFE_MODEL: z.string().default('jev-latest'),
  /**
   * Comma list of enabled checks: sensitive, stimulus, stance. Default is `sensitive` only — it
   * sends field NAMES, which are schema. `stimulus` and `stance` send client content (stimulus
   * text, persona rationales) and should be enabled only once a processing agreement is signed
   * and the governance notice names TypeSafe as a processor.
   */
  TYPESAFE_FEATURES: z.string().default('sensitive'),

  /** TimesFM sidecar (services/timesfm). Forecasts from it also need TIMESFM_APPROVED=true. */
  TIMESFM_URL: z.string().url().optional(),
  TIMESFM_TOKEN: z.string().optional(),
  TIMESFM_APPROVED: z.enum(['true', 'false']).default('false'),
});

export type AppEnv = z.infer<typeof schema>;

export class EnvironmentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n - ${issues.join('\n - ')}`);
    this.name = 'EnvironmentError';
  }
}

function productionGuards(env: AppEnv): string[] {
  if (env.NODE_ENV !== 'production') return [];
  const issues: string[] = [];
  if (env.DEMO_DATASET_DIR) {
    issues.push('DEMO_DATASET_DIR is not permitted in production — it preloads data nobody uploaded');
  }
  if (env.DEMO_SIGN_IN_EMAIL || env.DEMO_SIGN_IN_CODE) {
    issues.push(
      'DEMO_SIGN_IN_EMAIL / DEMO_SIGN_IN_CODE are not permitted in production — a fixed sign-in code is a published password',
    );
  }
  if (env.EMAIL_PROVIDER === 'dev') issues.push('EMAIL_PROVIDER=dev is not permitted in production — OTP codes would be written to logs');
  if (env.EMAIL_PROVIDER === 'smtp' && (!env.SMTP_HOST || !env.SMTP_USER || !env.EMAIL_API_KEY)) {
    issues.push('EMAIL_PROVIDER=smtp requires SMTP_HOST, SMTP_USER and EMAIL_API_KEY (the SMTP password)');
  }
  if (env.OBJECT_STORAGE_PROVIDER === 'local') issues.push('OBJECT_STORAGE_PROVIDER=local is not permitted in production — uploads would not survive a redeploy');
  if (env.SESSION_SECRET.startsWith('replace-with')) issues.push('SESSION_SECRET is still the placeholder value');
  if (env.IP_HASH_PEPPER === 'dev-pepper-change-me') issues.push('IP_HASH_PEPPER is still the placeholder value');
  if (env.MODEL_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) issues.push('MODEL_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  return issues;
}

let cached: AppEnv | null = null;

export function loadEnv(source: Record<string, string | undefined> = process.env): AppEnv {
  // An empty value ("TIMESFM_URL=", as .env.example ships it) means "not set", not "an invalid
  // value" — otherwise every optional URL or email left blank stops the app from starting.
  const present = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''));
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    throw new EnvironmentError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  const issues = productionGuards(parsed.data);
  if (issues.length > 0) throw new EnvironmentError(issues);
  return parsed.data;
}

export function env(): AppEnv {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Cleared between tests. */
export function resetEnvCache(): void {
  cached = null;
}

export function approvedDomainsFromEnv(env: AppEnv): string[] {
  return env.BOOTSTRAP_APPROVED_DOMAINS.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
}

export interface DemoSignIn {
  email: string;
  code: string;
}

/**
 * The demonstration credential, or null when there isn't one.
 *
 * Both halves must be present — a fixed address with a random code, or a fixed code with no
 * address, are both configuration mistakes rather than half a feature. The production check is
 * repeated here even though `loadEnv` already refuses to return such an environment: this
 * function is what the sign-in path actually calls, and a second guard costs nothing.
 */
export function demoSignIn(e: AppEnv = env()): DemoSignIn | null {
  if (e.NODE_ENV === 'production') return null;
  if (!e.DEMO_SIGN_IN_EMAIL || !e.DEMO_SIGN_IN_CODE) return null;
  return { email: e.DEMO_SIGN_IN_EMAIL.trim().toLowerCase(), code: e.DEMO_SIGN_IN_CODE };
}

/**
 * What the UI is allowed to know about integrations (prompt §5: no fake integration
 * disguised as complete). Never includes a secret — only whether one is present.
 */
export interface IntegrationStatus {
  key: string;
  label: string;
  mode: string;
  connected: boolean;
  note: string;
}

export function integrationStatus(e: AppEnv): IntegrationStatus[] {
  return [
    {
      key: 'model',
      label: 'AI model (Anthropic Claude)',
      mode: e.MODEL_PROVIDER,
      connected: e.MODEL_PROVIDER === 'anthropic' && Boolean(e.ANTHROPIC_API_KEY),
      note: e.MODEL_PROVIDER === 'mock'
        ? 'Mock provider. Outputs are generated locally and labelled as mock throughout the interface.'
        : 'Live provider. Calls are made server-side only.',
    },
    {
      key: 'email',
      label: 'Email delivery (OTP)',
      mode: e.EMAIL_PROVIDER,
      connected: e.EMAIL_PROVIDER !== 'dev',
      note: e.EMAIL_PROVIDER === 'dev'
        ? 'Development adapter. The sign-in code is written to the server log and is not emailed. Refused in production.'
        : 'Transactional provider configured.',
    },
    {
      key: 'demo-sign-in',
      label: 'Demonstration sign-in',
      mode: demoSignIn(e) ? 'fixed code' : 'off',
      connected: false,
      note: demoSignIn(e)
        ? `A fixed sign-in code is configured for ${demoSignIn(e)?.email}. It is stored hashed like any other code and is still rate-limited and attempt-capped, but it is predictable, so it is refused in production and this deployment will not start with it set.`
        : 'No fixed code. Every sign-in code is random.',
    },
    {
      key: 'storage',
      label: 'Object storage',
      mode: e.OBJECT_STORAGE_PROVIDER,
      connected: e.OBJECT_STORAGE_PROVIDER !== 'local',
      note: e.OBJECT_STORAGE_PROVIDER === 'local'
        ? 'Local disk under .storage/. Files do not survive a redeploy. Refused in production.'
        : 'S3-compatible bucket configured.',
    },
    {
      key: 'scan',
      label: 'Malware scanning',
      mode: e.SCAN_PROVIDER,
      connected: e.SCAN_PROVIDER !== 'none',
      note: e.SCAN_PROVIDER === 'none'
        ? 'No scanner configured. Every uploaded file records scanStatus=NOT_SCANNED so the gap is visible on the dataset.'
        : 'Scanner configured; files are scanned before parsing.',
    },
    {
      key: 'queue',
      label: 'Job queue',
      mode: e.QUEUE_DRIVER,
      connected: true,
      note: e.QUEUE_DRIVER === 'postgres'
        ? 'Postgres-backed queue using SKIP LOCKED. Durable across restarts.'
        : 'Redis transport with Postgres job records as the source of truth.',
    },
    {
      key: 'forecast',
      label: 'Forecasting model',
      mode: e.TIMESFM_URL ? (e.TIMESFM_APPROVED === 'true' ? 'timesfm-2.5 (approved)' : 'timesfm-2.5 (evaluation only)') : 'baselines + gate',
      connected: Boolean(e.TIMESFM_URL),
      note: e.TIMESFM_URL
        ? e.TIMESFM_APPROVED === 'true'
          ? 'TimesFM 2.5 (Apache-2.0 weights) sidecar configured and approved. The ten-question gate still decides whether any forecast is shown.'
          : 'TimesFM 2.5 sidecar configured for backtest evaluation only. Forecasts from it wait for legal and technical approval (PRD §24.8, U3).'
        : 'Classical baselines, rolling-origin backtests and trend classification computed in code. The ten-question gate decides whether a forecast may be shown (PRD §24.8).',
    },
    {
      key: 'judge',
      label: 'Judge model (TypeSafe System One)',
      mode: e.TYPESAFE_API_KEY ? `${e.TYPESAFE_MODEL} · ${e.TYPESAFE_FEATURES || 'no checks'}` : 'off',
      connected: Boolean(e.TYPESAFE_API_KEY) && e.TYPESAFE_FEATURES.trim() !== '',
      note: e.TYPESAFE_API_KEY
        ? 'Advisory second opinions: field names (never values), stimulus text and persona rationales are sent to TypeSafe. A judgement can add a warning or exclude a field; it never includes a field or changes a stance. Requires a data-processing agreement before client data is used.'
        : 'Not configured. The regex sensitive-field floor, untrusted-content wrapping and schema validation still apply.',
    },
  ];
}

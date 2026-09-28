/**
 * End-to-end fixtures.
 *
 * Signing in is done by creating a session row directly and setting the cookie, rather than by
 * reading a real one-time code. There is deliberately no way to retrieve a code from outside the
 * server — that is the property under protection — so a test hook that exposed one would weaken
 * the thing it was meant to verify. The code path itself is covered by integration tests against
 * the database, and the sign-in *form* is exercised through the browser below.
 *
 * Plain `pg` rather than Prisma: Playwright's loader does not execute the generated ESM client,
 * and a fixture has no need for a query builder.
 */
import { test as base, type Page } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { Client } from 'pg';

const CONNECTION =
  process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:55432/rfpi?host=/tmp';

export type Role = 'SUPER_ADMIN' | 'PLATFORM_ADMIN' | 'AUDITOR' | 'STANDARD_USER';

async function withDb<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: CONNECTION });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function id(prefix: string): string {
  return `${prefix}${randomBytes(12).toString('hex')}`;
}

export async function signInAs(page: Page, email: string, role: Role = 'STANDARD_USER') {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');

  await withDb(async (c) => {
    const existing = await c.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [
      email,
    ]);
    let userId = existing.rows[0]?.id;
    if (userId) {
      await c.query('UPDATE "User" SET "systemRole" = $1, status = $2 WHERE id = $3', [
        role,
        'ACTIVE',
        userId,
      ]);
    } else {
      userId = id('u');
      await c.query(
        'INSERT INTO "User" (id, email, "systemRole", status, "updatedAt") VALUES ($1,$2,$3,$4, now())',
        [userId, email, role, 'ACTIVE'],
      );
    }

    await c.query(
      `INSERT INTO "Session" (id, "userId", "tokenHash", "idleExpiresAt", "absoluteExpiresAt")
       VALUES ($1, $2, $3, now() + interval '8 hours', now() + interval '7 days')`,
      [id('s'), userId, tokenHash],
    );
    return userId;
  });

  const baseUrl = new URL(process.env.APP_BASE_URL ?? 'http://localhost:3500');
  await page.context().addCookies([
    {
      name: 'rfpi_session',
      value: token,
      domain: baseUrl.hostname,
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}

/** Ensures the domain used by fixture addresses can receive codes, for the sign-in form test. */
export async function ensureApprovedDomain(domain: string): Promise<void> {
  await withDb(async (c) => {
    await c.query(
      `INSERT INTO "ApprovedDomain" (id, domain, active) VALUES ($1, $2, true)
       ON CONFLICT (domain) DO UPDATE SET active = true`,
      [id('d'), domain],
    );
  });
}

/**
 * Wait until React has taken over on the client.
 *
 * Without this, a click can land on a control that is painted but not yet interactive — the click
 * succeeds, nothing happens, and the test fails for a reason that has nothing to do with the
 * behaviour under test.
 */
export async function goAndHydrate(page: Page, path: string) {
  const response = await page.goto(path);
  await page.waitForSelector('html[data-hydrated="true"]', { timeout: 15_000 });
  await expectNoErrorBoundary(page, path);
  return response;
}

/**
 * Fail loudly when a page has fallen into the global error boundary.
 *
 * Without this, a page that throws during hydration still renders valid, accessible HTML — so an
 * accessibility scan passes and only an interaction test notices, by timing out on a control that
 * is no longer on the page. Checking explicitly turns a confusing timeout into a clear failure.
 */
export async function expectNoErrorBoundary(page: Page, path: string) {
  const boundary = page.getByRole('heading', { name: 'This page could not be displayed' });
  if (await boundary.count()) {
    throw new Error(`${path} rendered the error boundary instead of the page.`);
  }
}

export const test = base;
export { expect } from '@playwright/test';

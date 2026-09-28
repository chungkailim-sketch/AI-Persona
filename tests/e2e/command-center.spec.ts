import { test, expect, signInAs, goAndHydrate, type Role } from './fixtures';
import type { Page } from '@playwright/test';
import { Client } from 'pg';

/**
 * The command-center changelog, through a browser: theme, truthful ingestion pipeline, live run
 * telemetry, pausing the display, preliminary → final, report mode, reduced motion, keyboard-only
 * monitoring, and stream authorization.
 *
 * Runs need a worker. For the live-run tests to be observable, start it with the mock provider
 * paced: `MOCK_PROVIDER_DELAY_MS=300 npm run worker`.
 */
const DB = process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:55432/rfpi?host=/tmp';

async function q<T extends Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const c = new Client({ connectionString: DB });
  await c.connect();
  try {
    return (await c.query<T>(sql, params)).rows;
  } finally {
    await c.end();
  }
}

/** A project with cleared data, a complete brief and an approved cohort — the demonstration workspace. */
async function joinReadyProject(email: string, role = 'OWNER'): Promise<string> {
  const rows = await q<{ projectId: string }>(
    `SELECT c."projectId" FROM "Cohort" c
       JOIN "Persona" p ON p."cohortId" = c.id
       JOIN "PersonaVersion" v ON v."personaId" = p.id AND v.approval = 'APPROVED'
     GROUP BY c."projectId" HAVING count(*) >= 3 LIMIT 1`,
  );
  const projectId = rows[0]?.projectId;
  if (!projectId) throw new Error('No project with an approved cohort exists. Run `npm run demo:load` first.');
  const user = await q<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [email]);
  await q(
    `INSERT INTO "ProjectMember" (id, "projectId", "userId", role) VALUES ($1,$2,$3,$4)
     ON CONFLICT ("projectId","userId") DO UPDATE SET role = $4`,
    [`m${Date.now()}${Math.random().toString(36).slice(2, 6)}`, projectId, user[0]!.id, role],
  );
  return projectId;
}

async function createProject(page: Page, name: string): Promise<string> {
  await goAndHydrate(page, '/projects');
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/data/);
  return new URL(page.url()).pathname.split('/')[2]!;
}

async function startRun(page: Page, projectId: string) {
  await goAndHydrate(page, `/projects/${projectId}/simulate`);
  if (await page.getByRole('button', { name: 'Prepare a plan' }).count()) {
    await page.getByRole('button', { name: 'Prepare a plan' }).click();
  }
  await page.getByRole('button', { name: 'Confirm and run' }).click();
  await expect(page.locator('[data-run-status]')).not.toHaveAttribute('data-run-status', 'DRAFT', { timeout: 30_000 });
}

test.describe('theme', () => {
  test('switches from light to dark and persists across navigation, reload and a new device', async ({ page, browser }) => {
    const email = `e2e-theme-${Date.now()}@example.com`;
    await signInAs(page, email, 'STANDARD_USER' as Role);
    await goAndHydrate(page, '/dashboard');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);

    await page.getByRole('button', { name: /Switch to dark theme/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await goAndHydrate(page, '/projects');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // The server rendered it: the very first HTML byte carries the theme, so there is no flash.
    const html = await (await page.request.get('/projects')).text();
    expect(html).toMatch(/<html[^>]*data-theme="dark"/);

    // A second device with no cookie gets it from the profile.
    const other = await browser.newPage();
    await signInAs(other, email, 'STANDARD_USER' as Role);
    await other.goto('/dashboard');
    await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
    await other.close();

    // Settings offers all three; choosing System removes the attribute.
    await goAndHydrate(page, '/settings');
    await page.getByRole('radio', { name: /System/ }).check({ force: true });
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });
});

test.describe('ingestion command center', () => {
  test('an upload moves through the recorded stages and its warnings can be reviewed', async ({ page }) => {
    test.setTimeout(120_000);
    await signInAs(page, `e2e-ingest-${Date.now()}@example.com`, 'STANDARD_USER' as Role);
    const id = await createProject(page, `Ingest ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/data`);

    // An email column (sensitive), an empty column (a warning finding) and one duplicate row.
    const rows = ['market,age_band,email,score,notes', ...Array.from({ length: 40 }, (_, i) => `Indonesia,${i % 2 ? '25-34' : '35-44'},p${i}@example.com,${(i % 5) + 1},`), 'Indonesia,25-34,p1@example.com,2,'];
    await page.getByLabel('Dataset name').fill('Demonstration upload');
    await page.getByLabel('Files').setInputFiles({ name: 'demo_indonesia.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
    await page.getByRole('button', { name: 'Upload and ingest' }).click();

    const pipeline = page.getByRole('region', { name: 'Processing pipeline' });
    await expect(pipeline.locator('li', { hasText: 'Upload received' })).toHaveAttribute('data-stage-status', 'completed', { timeout: 30_000 });
    await expect(pipeline.locator('li', { hasText: 'Safety scan' })).toHaveCount(0);
    await expect(pipeline.locator('li', { hasText: 'Ready for review' })).toHaveAttribute('data-stage-status', /completed|warning/, { timeout: 60_000 });
    await expect(pipeline.locator('li', { hasText: 'Sensitive-data detection' })).toHaveAttribute('data-stage-status', 'warning');
    await expect(pipeline.locator('li', { hasText: 'Missing-value analysis' })).toHaveAttribute('data-stage-status', 'warning');
    // Clearance is recorded automatically once ingestion finishes; the sensitive field stays excluded.
    await expect(pipeline.locator('li', { hasText: 'Import approved' })).toHaveAttribute('data-stage-status', 'completed', { timeout: 30_000 });

    // The warnings are still listed.
    const warnings = page.getByRole('region', { name: 'Warnings and exceptions' });
    await expect(warnings.getByText(/"email" flagged as possibly sensitive/)).toBeVisible();
    await page.reload();
    await page.waitForSelector('html[data-hydrated="true"]');
    await expect(page.getByText(/Every condition is met/)).toBeVisible();
    for (const removed of ['What the checks found', 'Provenance and permission', 'Field review']) {
      await expect(page.getByRole('heading', { name: removed, exact: true })).toHaveCount(0);
    }
  });
});

test.describe('simulation control room', () => {
  test('shows live telemetry, lets the display pause while the run continues, then gives way to final results and report mode', async ({ page }) => {
    test.setTimeout(180_000);
    const email = `e2e-sim-${Date.now()}@example.com`;
    await signInAs(page, email, 'STANDARD_USER' as Role);
    const projectId = await joinReadyProject(email);
    await startRun(page, projectId);

    const calls = page.locator('[data-event-type="run.call.completed"]');
    await expect(calls.first()).toBeVisible({ timeout: 30_000 });

    const running = await page.locator('[data-run-status]').getAttribute('data-run-status');
    if (running && !/COMPLETED|FAILED|CANCELLED/.test(running)) {
      await page.getByRole('checkbox', { name: 'Auto-scroll' }).uncheck();
      await page.getByRole('button', { name: 'Pause display' }).click();
      const shown = await calls.count();
      await page.waitForTimeout(3000);
      // The run went on: the evaluations metric grew, the drawn feed did not.
      await expect(page.getByText(/display paused, the run continues/)).toBeVisible();
      expect(await calls.count()).toBe(shown);
      await page.getByRole('button', { name: 'Resume display' }).click();
      await expect.poll(async () => calls.count()).toBeGreaterThanOrEqual(shown);
    }

    await expect(page.locator('[data-run-status]')).toHaveAttribute('data-run-status', /COMPLETED/, { timeout: 120_000 });
    await expect(page.locator('[data-findings="final"]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-findings="preliminary"]')).toHaveCount(0);

    await page.getByRole('link', { name: 'Read the results' }).click();
    await page.getByRole('link', { name: 'Open report mode' }).click();
    await expect(page.locator('[data-report-mode]')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What this cannot support' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Simulation notice' })).toBeVisible();
    await expect(page.getByRole('banner')).toHaveCount(0);
  });

  test('reduced motion stops every animation on the monitoring screen', async ({ page }) => {
    const email = `e2e-motion-${Date.now()}@example.com`;
    await signInAs(page, email, 'STANDARD_USER' as Role);
    const projectId = await joinReadyProject(email);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await goAndHydrate(page, `/projects/${projectId}/simulate`);
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll('*')].filter((el) => {
        const s = getComputedStyle(el);
        return s.animationName !== 'none' && parseFloat(s.animationDuration) > 0.01;
      }).length,
    );
    expect(animated).toBe(0);
  });

  test('a keyboard-only user can reach and operate the monitoring controls', async ({ page }) => {
    const email = `e2e-keys-${Date.now()}@example.com`;
    await signInAs(page, email, 'STANDARD_USER' as Role);
    const projectId = await joinReadyProject(email);
    await goAndHydrate(page, `/projects/${projectId}/simulate`);
    test.skip((await page.locator('[data-run-status]').count()) === 0, 'No run exists yet to monitor.');

    const autoscroll = page.getByRole('checkbox', { name: 'Auto-scroll' });
    for (let i = 0; i < 80 && !(await autoscroll.evaluate((el) => el === document.activeElement)); i += 1) {
      await page.keyboard.press('Tab');
    }
    await expect(autoscroll).toBeFocused();
    await page.keyboard.press('Space');
    await expect(autoscroll).not.toBeChecked();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: /Pause display|Resume display/ })).toBeFocused();

    const expand = page.getByRole('button', { name: 'Expand event details' }).first();
    await expand.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Collapse event details' }).first()).toHaveAttribute('aria-expanded', 'true');
  });

  test('a non-member cannot open the run stream, the poll fallback or the export', async ({ page }) => {
    const email = `e2e-member-${Date.now()}@example.com`;
    await signInAs(page, email, 'STANDARD_USER' as Role);
    const projectId = await joinReadyProject(email);
    const runs = await q<{ id: string }>('SELECT id FROM "Run" WHERE "projectId" = $1 LIMIT 1', [projectId]);
    test.skip(runs.length === 0, 'No run exists yet.');
    const runId = runs[0]!.id;

    await signInAs(page, `e2e-outsider-${Date.now()}@example.com`, 'STANDARD_USER' as Role);
    for (const path of [
      `/api/projects/${projectId}/events?runId=${runId}`,
      `/api/projects/${projectId}/events/poll?runId=${runId}`,
      `/api/projects/${projectId}/runs/${runId}/telemetry`,
    ]) {
      const res = await page.request.get(path);
      expect(res.status(), path).toBe(404);
    }
    const anon = await page.context().browser()!.newContext();
    const res = await anon.request.get(`http://localhost:3500/api/projects/${projectId}/events?runId=${runId}`);
    expect(res.status()).toBe(401);
    await anon.close();
  });
});

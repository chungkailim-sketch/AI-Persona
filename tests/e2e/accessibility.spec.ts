/**
 * Accessibility checks with axe.
 *
 * Automated checks catch a minority of real barriers, so these are a floor, not a certificate.
 * Phase 6 adds keyboard-path and screen-reader review; what is asserted here is that no page ships
 * with a serious or critical violation that a machine can already see.
 */
import AxeBuilder from '@axe-core/playwright';
import { test, expect, signInAs, expectNoErrorBoundary } from './fixtures';

const SIGNED_OUT = ['/', '/sign-in'];
const SIGNED_IN = ['/dashboard', '/projects', '/settings', '/datasets', '/methodology', '/briefs', '/runs'];
const WORKFLOW = ['data', 'brief', 'personas', 'simulate', 'results'];
const ADMIN = ['/admin', '/admin/users', '/admin/domains', '/admin/jobs', '/admin/usage', '/admin/audit'];

async function scan(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  // A page that threw still renders accessible HTML, so the scan alone would pass it.
  await expectNoErrorBoundary(page, path);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious,
    `${path}: ${serious.map((v) => `${v.id} (${v.nodes.length})`).join(', ')}`,
  ).toEqual([]);
}

for (const path of SIGNED_OUT) {
  test(`no serious accessibility violations: ${path}`, async ({ page }) => {
    await scan(page, path);
  });
}

test('no serious accessibility violations on signed-in pages', async ({ page }) => {
  await signInAs(page, 'e2e-a11y@example.com', 'STANDARD_USER');
  for (const path of SIGNED_IN) await scan(page, path);
});

test('no serious accessibility violations in the workflow steps', async ({ page }) => {
  await signInAs(page, 'e2e-a11y-wf@example.com', 'STANDARD_USER');
  await page.goto('/projects');
  await page.waitForSelector('html[data-hydrated="true"]');
  await page.getByLabel('Project name').fill(`A11y ${Date.now()}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/data/);
  const id = new URL(page.url()).pathname.split('/')[2];
  for (const step of WORKFLOW) await scan(page, `/projects/${id}/${step}`);
});

test('no serious accessibility violations in administration', async ({ page }) => {
  await signInAs(page, 'e2e-a11y-admin@example.com', 'SUPER_ADMIN');
  for (const path of ADMIN) await scan(page, path);
});

test('the skip link is the first thing a keyboard user reaches', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  const focused = page.locator(':focus');
  await expect(focused).toHaveText('Skip to main content');
  await focused.press('Enter');
  await expect(page.locator('#main')).toBeVisible();
});

/**
 * The command-center screens with real content — a project with ingested data, an approved cohort
 * and a completed run — in both themes. Colour contrast is checked by axe against what actually
 * rendered, not against the token table.
 */
for (const scheme of ['light', 'dark'] as const) {
  test(`no serious accessibility violations on the command-center screens (${scheme})`, async ({ page }) => {
    test.setTimeout(120_000);
    const { Client } = await import('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:55432/rfpi?host=/tmp' });
    await c.connect();
    const run = await c.query<{ projectId: string; id: string }>(
      `SELECT "projectId", id FROM "Run" WHERE status IN ('COMPLETED','COMPLETED_WITH_WARNINGS') ORDER BY "completedAt" DESC LIMIT 1`,
    );
    const email = `e2e-a11y-cc-${scheme}@example.com`;
    await signInAs(page, email, 'STANDARD_USER');
    const u = await c.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [email]);
    const target = run.rows[0];
    test.skip(!target, 'No completed run in the development database.');
    await c.query(
      `INSERT INTO "ProjectMember" (id, "projectId", "userId", role) VALUES ($1,$2,$3,'OWNER') ON CONFLICT ("projectId","userId") DO NOTHING`,
      [`m${Date.now()}`, target!.projectId, u.rows[0]!.id],
    );
    await c.end();
    await page.emulateMedia({ colorScheme: scheme });
    for (const step of WORKFLOW) await scan(page, `/projects/${target!.projectId}/${step}`);
    await scan(page, `/projects/${target!.projectId}/simulate?run=${target!.id}`);
    await scan(page, `/projects/${target!.projectId}/results/report?run=${target!.id}`);
  });
}

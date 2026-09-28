import { test, expect, signInAs, goAndHydrate } from './fixtures';

/**
 * Step 5 through a browser.
 *
 * These check placement and visibility, which is the whole point of this step. A caveat that exists
 * in the database and renders below the fold, or behind a disclosure triangle, has been designed
 * not to be read — and every server-side test would still pass.
 */

async function createProject(page: import('@playwright/test').Page, name: string): Promise<string> {
  await goAndHydrate(page, '/projects');
  await page.getByLabel('Project name').fill(name);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/data/);
  const id = new URL(page.url()).pathname.split('/')[2];
  if (!id) throw new Error('No project id in the URL after creation.');
  return id;
}

test.describe('step 5 — results', () => {
  test('says plainly that nothing has run, rather than showing an empty report', async ({ page }) => {
    await signInAs(page, 'e2e-results-empty@example.com', 'STANDARD_USER');
    const id = await createProject(page, `No results ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/results`);

    await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible();
    await expect(page.getByText(/No run has completed in this project yet/)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Go to the simulation step' })).toBeVisible();
  });
});

test.describe('the results page of a completed run', () => {
  /**
   * Built by driving the server functions directly, because getting to a completed run through the
   * browser would be a five-minute test that re-checks steps 1 to 4.
   */
  async function seedCompletedRun(email: string): Promise<{ projectId: string }> {
    const { Client } = await import('pg');
    const client = new Client({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:55432/rfpi?host=/tmp',
    });
    await client.connect();
    const run = await client.query<{ projectId: string }>(
      `SELECT "projectId" FROM "Run"
       WHERE status IN ('COMPLETED','COMPLETED_WITH_WARNINGS')
       ORDER BY "completedAt" DESC LIMIT 1`,
    );
    const projectId = run.rows[0]?.projectId;
    if (!projectId) {
      await client.end();
      throw new Error('No completed run exists in the development database to read.');
    }
    // Make the signing-in user an owner of that project so they can read its report.
    const user = await client.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [
      email,
    ]);
    await client.query(
      `INSERT INTO "ProjectMember" (id, "projectId", "userId", role)
       VALUES ($1, $2, $3, 'OWNER') ON CONFLICT ("projectId","userId") DO UPDATE SET role = 'OWNER'`,
      [`m${Date.now()}`, projectId, user.rows[0]?.id],
    );
    await client.end();
    return { projectId };
  }

  test('puts the limitations above the findings, not in an appendix', async ({ page }) => {
    await signInAs(page, 'e2e-results-read@example.com', 'STANDARD_USER');
    const { projectId } = await seedCompletedRun('e2e-results-read@example.com');
    await goAndHydrate(page, `/projects/${projectId}/results`);

    const limitations = page.getByRole('heading', { name: 'What this cannot support' });
    const findings = page.getByRole('heading', { name: 'Findings', exact: true });
    await expect(limitations).toBeVisible();
    await expect(findings).toBeVisible();

    const limitBox = await limitations.boundingBox();
    const findBox = await findings.boundingBox();
    expect(limitBox?.y ?? 0).toBeLessThan(findBox?.y ?? Number.MAX_SAFE_INTEGER);
  });

  test('states the simulation caveat without any interaction', async ({ page }) => {
    await signInAs(page, 'e2e-results-caveat@example.com', 'STANDARD_USER');
    const { projectId } = await seedCompletedRun('e2e-results-caveat@example.com');
    await goAndHydrate(page, `/projects/${projectId}/results`);

    // Visible on load, not behind a disclosure.
    await expect(
      page.getByText(/not evidence of what any real person thinks/i).first(),
    ).toBeVisible();
  });

  test('shows the threshold that was set before the run', async ({ page }) => {
    await signInAs(page, 'e2e-results-bar@example.com', 'STANDARD_USER');
    const { projectId } = await seedCompletedRun('e2e-results-bar@example.com');
    await goAndHydrate(page, `/projects/${projectId}/results`);

    await expect(page.getByRole('heading', { name: 'The bar, set before the run' })).toBeVisible();
    await expect(page.getByText(/Set in advance as the bar/)).toBeVisible();
  });

  test('opens an evidence drawer showing each persona before and after', async ({ page }) => {
    await signInAs(page, 'e2e-results-drawer@example.com', 'STANDARD_USER');
    const { projectId } = await seedCompletedRun('e2e-results-drawer@example.com');
    await goAndHydrate(page, `/projects/${projectId}/results`);

    const toggle = page.getByRole('button', { name: /Show what each persona said/ });
    await expect(toggle).toBeVisible();
    await toggle.click();

    await expect(page.getByRole('columnheader', { name: /Alone/ })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: /After challenge/ })).toBeVisible();
    await expect(
      page.getByText(/the only one that carries information about agreement/),
    ).toBeVisible();
  });

  test('reports the evidence grade on the finding itself', async ({ page }) => {
    await signInAs(page, 'e2e-results-grade@example.com', 'STANDARD_USER');
    const { projectId } = await seedCompletedRun('e2e-results-grade@example.com');
    await goAndHydrate(page, `/projects/${projectId}/results`);

    await expect(page.getByText('L3 simulation').first()).toBeVisible();
    await expect(
      page.getByText(/Produced by simulated personas\. Not an observation of anyone\./).first(),
    ).toBeVisible();
  });

  test('says what the claim check can and cannot do', async ({ page }) => {
    await signInAs(page, 'e2e-results-check@example.com', 'STANDARD_USER');
    const { projectId } = await seedCompletedRun('e2e-results-check@example.com');
    await goAndHydrate(page, `/projects/${projectId}/results`);

    await expect(page.getByRole('heading', { name: 'Claim check' })).toBeVisible();
    await expect(page.getByText(/cannot tell you whether a claim is true/i)).toBeVisible();
    await expect(page.getByText(/that judgement is yours/i)).toBeVisible();
  });

  test('offers no way to export without the limitations attached', async ({ page }) => {
    await signInAs(page, 'e2e-results-export@example.com', 'STANDARD_USER');
    const { projectId } = await seedCompletedRun('e2e-results-export@example.com');
    await goAndHydrate(page, `/projects/${projectId}/results`);

    await expect(page.getByRole('heading', { name: 'Export', exact: true })).toBeVisible();
    await expect(page.getByText(/no setting that removes it/i)).toBeVisible();
    // There is no control to strip caveats, by design.
    await expect(page.getByRole('checkbox', { name: /limitations|caveat/i })).toHaveCount(0);
  });

  test('refuses to export a mock run, and says why', async ({ page }) => {
    await signInAs(page, 'e2e-results-block@example.com', 'STANDARD_USER');
    const { projectId } = await seedCompletedRun('e2e-results-block@example.com');
    await goAndHydrate(page, `/projects/${projectId}/results`);

    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByText(/The export was refused/)).toBeVisible();
    await expect(page.getByText(/mock provider/i).first()).toBeVisible();
  });

  test('requires a substantial written reason to override a block', async ({ page }) => {
    await signInAs(page, 'e2e-results-override@example.com', 'STANDARD_USER');
    const { projectId } = await seedCompletedRun('e2e-results-override@example.com');
    await goAndHydrate(page, `/projects/${projectId}/results`);

    await page.getByRole('button', { name: /Export anyway, with a recorded reason/ }).click();
    await expect(
      page.getByText(/Recorded against your name, in the audit log and at the top of the exported file/),
    ).toBeVisible();

    // A word is not a reason: the export is still refused.
    await page.getByLabel(/Why is this export acceptable/).fill('fine');
    await page.getByRole('button', { name: 'Export', exact: true }).click();
    await expect(page.getByText(/The export was refused/)).toBeVisible();
  });
});

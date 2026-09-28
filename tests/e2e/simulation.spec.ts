import { test, expect, signInAs, goAndHydrate } from './fixtures';

/**
 * Steps 3 and 4 through a browser.
 *
 * The point of testing these in a browser rather than only through the server functions: the
 * guarantees here are about what a person is *told*. A confirmation gate that a user can miss, or a
 * mock run that does not say it is mock, would pass every server-side test and still mislead.
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

test.describe('step 3 — personas', () => {
  test('explains what each provenance label means before showing any persona', async ({ page }) => {
    await signInAs(page, 'e2e-persona-key@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Persona key ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/personas`);

    await expect(page.getByRole('heading', { name: 'What the labels mean' })).toBeVisible();
    await expect(page.getByText('Measured directly in the data.')).toBeVisible();
    await expect(page.getByText(/Generated\. Measures nothing and is not evidence\./)).toBeVisible();
  });

  test('says a cohort cannot be built before any data is attached', async ({ page }) => {
    await signInAs(page, 'e2e-persona-nodata@example.com', 'STANDARD_USER');
    const id = await createProject(page, `No data ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/personas`);

    await expect(page.getByText(/No dataset is attached to this project yet/)).toBeVisible();
    await expect(page.getByText(/A cohort describes segments in real data/)).toBeVisible();
  });

  test('states that the persona is a summary of a segment, not a character', async ({ page }) => {
    await signInAs(page, 'e2e-persona-frame@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Framing ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/personas`);

    await expect(
      page.getByText(/summary of a segment in your data, not an invented character/),
    ).toBeVisible();
  });
});

test.describe('step 4 — simulation', () => {
  test('says plainly that nothing runs until a plan is confirmed', async ({ page }) => {
    await signInAs(page, 'e2e-sim-gate@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Gate ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/simulate`);

    await expect(page.getByRole('heading', { name: 'Simulation' })).toBeVisible();
    await expect(page.getByText(/Nothing runs until you confirm a plan/)).toBeVisible();
  });

  test('lists every prerequisite at once rather than one at a time', async ({ page }) => {
    await signInAs(page, 'e2e-sim-blockers@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Blockers ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/simulate`);

    await expect(page.getByText('Not yet. Outstanding:')).toBeVisible();
    await expect(page.getByText(/No cohort has been generated/)).toBeVisible();
  });

  test('describes the method, including that half the panel must argue against', async ({ page }) => {
    await signInAs(page, 'e2e-sim-method@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Method ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/simulate`);

    await expect(page.getByText(/at least half.*argue against/is)).toBeVisible();
    await expect(page.getByText(/how much of the agreement survived that pressure/)).toBeVisible();
  });
});

test.describe('permissions in steps 3 and 4', () => {
  test('a viewer can read but not generate, approve or run', async ({ page, browser }) => {
    await signInAs(page, 'e2e-sim-owner@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Viewer sim ${Date.now()}`);

    const { Client } = await import('pg');
    const client = new Client({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:55432/rfpi?host=/tmp',
    });
    await client.connect();
    const viewer = await browser.newPage();
    await signInAs(viewer, 'e2e-sim-viewer@example.com', 'STANDARD_USER');
    const row = await client.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [
      'e2e-sim-viewer@example.com',
    ]);
    await client.query(
      `INSERT INTO "ProjectMember" (id, "projectId", "userId", role)
       VALUES ($1, $2, $3, 'VIEWER') ON CONFLICT ("projectId","userId") DO UPDATE SET role = 'VIEWER'`,
      [`m${Date.now()}`, id, row.rows[0]?.id],
    );
    await client.end();

    await goAndHydrate(viewer, `/projects/${id}/personas`);
    await expect(viewer.getByRole('heading', { name: 'Generate a cohort' })).toHaveCount(0);
    await expect(viewer.getByText(/You can read this cohort but not change it/)).toBeVisible();

    await goAndHydrate(viewer, `/projects/${id}/simulate`);
    await expect(viewer.getByRole('heading', { name: 'Plan a run' })).toHaveCount(0);
    await expect(viewer.getByText(/You can watch runs in this project but not start one/)).toBeVisible();

    await viewer.close();
  });
});

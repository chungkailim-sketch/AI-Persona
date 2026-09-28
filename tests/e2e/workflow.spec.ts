import { test, expect, signInAs, goAndHydrate } from './fixtures';

/**
 * The first two workflow steps through a browser.
 *
 * What these check that the integration tests cannot: that the refusals are actually *visible*. A
 * gate enforced only on the server, with an interface that shows a cheerful green tick, would pass
 * every server-side test and mislead every user.
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

test.describe('step 1 — source data', () => {
  test('a new project says plainly that it has no data and cannot proceed', async ({ page }) => {
    await signInAs(page, 'e2e-data@example.com', 'STANDARD_USER');
    await createProject(page, `Data step ${Date.now()}`);

    await expect(page.getByRole('heading', { name: 'Source data' })).toBeVisible();
    await expect(page.getByText('No data attached yet.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Attach data' })).toBeVisible();
  });

  test('declares that no malware scanner ran, rather than implying a clean scan', async ({ page }) => {
    await signInAs(page, 'e2e-scan@example.com', 'STANDARD_USER');
    await createProject(page, `Scan notice ${Date.now()}`);
    await expect(page.getByText(/No malware scanner is configured/)).toBeVisible();
    await expect(page.getByText(/NOT_SCANNED/)).toBeVisible();
  });

  test('the five-step indicator marks the current step for assistive technology', async ({ page }) => {
    await signInAs(page, 'e2e-steps@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Steps ${Date.now()}`);

    const nav = page.getByRole('navigation', { name: 'Project workflow' });
    await expect(nav.locator('[aria-current="step"]')).toHaveText(/Source data/);

    // Every step is reachable — the workflow has an order, but it is not a trap.
    await nav.getByRole('link', { name: /Brief/ }).click();
    await expect(page).toHaveURL(new RegExp(`/projects/${id}/brief`));
  });
});

test.describe('step 2 — brief', () => {
  test('refuses a hypothesis whose threshold is decided after the fact', async ({ page }) => {
    await signInAs(page, 'e2e-hyp@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Hypothesis ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/brief`);

    await page.getByRole('button', { name: 'Add a hypothesis' }).click();
    await page.getByLabel('The claim').fill('Premium buyers weigh provenance above price.');
    await page.getByLabel('What would count as support?').fill('we see it');
    await page.getByRole('button', { name: 'Add hypothesis' }).click();

    await expect(page.getByText(/Decide this before you see the result|before the result is seen/)).toBeVisible();
  });

  test('accepts a hypothesis with a real threshold and shows it back', async ({ page }) => {
    await signInAs(page, 'e2e-hyp2@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Hypothesis ok ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/brief`);

    await page.getByRole('button', { name: 'Add a hypothesis' }).click();
    await page.getByLabel('The claim').fill('Premium buyers weigh provenance above price.');
    await page
      .getByLabel('What would count as support?')
      .fill('At least two thirds of premium personas rank provenance above price, with dissent recorded.');
    await page.getByRole('button', { name: 'Add hypothesis' }).click();

    await expect(page.getByText('Premium buyers weigh provenance above price.')).toBeVisible();
    await expect(page.getByText(/What would count as support \(set in advance\)/)).toBeVisible();
    await expect(page.getByText(/two thirds of premium personas/)).toBeVisible();
  });

  test('says on the page that the desired outcome is withheld from the simulation', async ({ page }) => {
    await signInAs(page, 'e2e-withhold@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Withhold ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/brief`);

    await expect(page.getByText(/withheld from the simulation/i)).toBeVisible();
    await expect(page.getByText(/will tend to produce it/i)).toBeVisible();
  });

  test('says what the brief still needs, rather than just refusing later', async ({ page }) => {
    await signInAs(page, 'e2e-ready@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Readiness ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/brief`);

    await expect(page.getByRole('heading', { name: 'Is this ready to run?' })).toBeVisible();
    await expect(page.getByText('Not yet. Outstanding:')).toBeVisible();
    await expect(page.getByText(/no hypothesis has been stated/i)).toBeVisible();
  });

  test('refuses a brief with no decision behind it', async ({ page }) => {
    await signInAs(page, 'e2e-nodecision@example.com', 'STANDARD_USER');
    const id = await createProject(page, `No decision ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/brief`);

    await page
      .getByLabel('What are you trying to find out?')
      .fill('What do people think about the brand in general?');
    await page.getByLabel('Markets').fill('Indonesia');
    // Present but not substantive: the browser's `required` rule is satisfied, so the server's
    // rule is the one that has to speak.
    await page.getByLabel('What decision will this inform?').fill('dunno');
    await page.getByRole('button', { name: 'Save brief' }).click();

    await expect(page.getByText(/State the decision this run should inform/)).toBeVisible();
    await expect(page.getByText(/cannot be judged useful or useless/)).toBeVisible();
  });

  test('saves a complete brief and reports it ready', async ({ page }) => {
    await signInAs(page, 'e2e-complete@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Complete ${Date.now()}`);
    await goAndHydrate(page, `/projects/${id}/brief`);

    await page.getByRole('button', { name: 'Add a hypothesis' }).click();
    await page.getByLabel('The claim').fill('Mid-tier buyers switch on price alone.');
    await page
      .getByLabel('What would count as support?')
      .fill('A majority of mid-tier personas cite price as the deciding factor, with dissent recorded.');
    await page.getByRole('button', { name: 'Add hypothesis' }).click();
    await expect(page.getByText('Mid-tier buyers switch on price alone.')).toBeVisible();

    await page
      .getByLabel('What are you trying to find out?')
      .fill('Which tier should launch first in Indonesia?');
    await page
      .getByLabel('What decision will this inform?')
      .fill('Which product tier to launch first in Indonesia next quarter.');
    await page.getByLabel('Markets').fill('Indonesia');
    await page.getByRole('button', { name: 'Save brief' }).click();

    await expect(page.getByText('Brief saved.')).toBeVisible();
    await expect(page.getByText(/^Yes\. The question, the decision/)).toBeVisible();
  });
});

test.describe('permissions in the workflow', () => {
  test('a viewer sees the data but not the controls that change it', async ({ page, browser }) => {
    await signInAs(page, 'e2e-owner-wf@example.com', 'STANDARD_USER');
    const id = await createProject(page, `Viewer test ${Date.now()}`);

    // Add a second user as a viewer of the same project.
    const { Client } = await import('pg');
    const client = new Client({
      connectionString:
        process.env.DATABASE_URL ?? 'postgresql://postgres@localhost:55432/rfpi?host=/tmp',
    });
    await client.connect();
    const viewer = await browser.newPage();
    await signInAs(viewer, 'e2e-viewer-wf@example.com', 'STANDARD_USER');
    const row = await client.query<{ id: string }>('SELECT id FROM "User" WHERE email = $1', [
      'e2e-viewer-wf@example.com',
    ]);
    await client.query(
      `INSERT INTO "ProjectMember" (id, "projectId", "userId", role)
       VALUES ($1, $2, $3, 'VIEWER') ON CONFLICT ("projectId","userId") DO UPDATE SET role = 'VIEWER'`,
      [`m${Date.now()}`, id, row.rows[0]?.id],
    );
    await client.end();

    await goAndHydrate(viewer, `/projects/${id}/data`);
    await expect(viewer.getByRole('heading', { name: 'Source data' })).toBeVisible();
    // The upload form is absent, and the reason is stated rather than left to be inferred.
    await expect(viewer.getByRole('heading', { name: 'Attach data' })).toHaveCount(0);
    await expect(viewer.getByText(/You can view this project.s data but not change it/)).toBeVisible();
    await viewer.close();
  });
});

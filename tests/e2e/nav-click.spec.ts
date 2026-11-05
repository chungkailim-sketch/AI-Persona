import { test, expect, signInAs, goAndHydrate } from './fixtures';

/**
 * The step links in the top bar and in the strip under the project name must actually move to the
 * step they name when they are clicked — a click, not a typed address.
 */
test('the top bar and the step strip navigate between the steps on click', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

  await signInAs(page, `e2e-nav-${Date.now()}@example.com`, 'STANDARD_USER');
  await goAndHydrate(page, '/projects');
  await page.getByLabel('Project name').fill(`Nav ${Date.now()}`);
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/\/projects\/[^/]+\/data/);

  const topBar = page.getByRole('navigation', { name: 'Study steps' });
  for (const [label, path] of [['Brief', /\/brief$/], ['Personas', /\/personas$/], ['Roundtable', /\/simulate$/], ['Results', /\/results$/], ['Data', /\/data$/]] as const) {
    await topBar.getByRole('link', { name: new RegExp(label) }).click();
    await expect(page, `top bar → ${label}`).toHaveURL(path, { timeout: 15_000 });
  }

  const strip = page.getByRole('navigation', { name: 'Project workflow' });
  for (const [label, path] of [['Brief', /\/brief$/], ['Personas', /\/personas$/], ['Data', /\/data$/]] as const) {
    await strip.getByRole('link', { name: new RegExp(`Step \\d of 5: ${label}`) }).click();
    await expect(page, `step strip → ${label}`).toHaveURL(path, { timeout: 15_000 });
  }
  console.log('ERRORS', JSON.stringify(errors.slice(0, 8)));
});

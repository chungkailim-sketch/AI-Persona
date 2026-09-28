import { test, expect, signInAs, goAndHydrate } from './fixtures';

test.describe('unauthenticated visitors', () => {
  test('are sent to sign-in, and their destination is preserved', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fdashboard/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('can read the public landing page', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Persona Intelligence' })).toBeVisible();
    // Integration state is declared, not hidden.
    await expect(page.getByRole('heading', { name: 'Integration status' })).toBeVisible();
  });

  test('see the same response whether or not an address is eligible', async ({ page }) => {
    await goAndHydrate(page, '/sign-in');

    await page.getByLabel('Email address').fill('definitely-not-a-user@nowhere.invalid');
    await page.getByRole('button', { name: 'Send code' }).click();
    const first = await page.getByText(/sign-in code is on its way/i).textContent();

    await page.getByRole('button', { name: 'Use a different address' }).click();
    await page.getByLabel('Email address').fill('admin@example.com');
    await page.getByRole('button', { name: 'Send code' }).click();
    const second = await page.getByText(/sign-in code is on its way/i).textContent();

    expect(first).toBe(second);
  });

  test('are refused the admin console without being told it exists', async ({ page }) => {
    const response = await page.goto('/admin');
    // Redirected to sign-in rather than given a 403 that confirms the address is real.
    await expect(page).toHaveURL(/\/sign-in/);
    expect(response?.status()).toBeLessThan(400);
  });
});

test.describe('a standard user', () => {
  test('reaches the workspace but not administration', async ({ page }) => {
    await signInAs(page, 'e2e-standard@example.com', 'STANDARD_USER');

    await page.goto('/dashboard');
    await expect(page.getByRole('heading', { name: /welcome/i })).toBeVisible();
    await expect(page.getByRole('banner').getByRole('button', { name: /Account menu for e2e-standard@example\.com/ })).toBeVisible();

    // The admin link is not rendered…
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0);
    // …and the route itself refuses, which is the check that actually matters.
    const res = await page.goto('/admin');
    expect(res?.status()).toBe(404);
  });

  test('can create a project and is taken into its workflow', async ({ page }) => {
    await signInAs(page, 'e2e-creator@example.com', 'STANDARD_USER');
    await goAndHydrate(page, '/projects');

    const name = `E2E project ${Date.now()}`;
    await page.getByLabel('Project name').fill(name);
    await page.getByRole('button', { name: 'Create project' }).click();

    await expect(page).toHaveURL(/\/projects\/[^/]+\/data/);
    await page.goto('/projects');
    await expect(page.getByRole('link', { name: new RegExp(name) })).toBeVisible();
  });

  test('cannot see another user’s project', async ({ page, browser }) => {
    await signInAs(page, 'e2e-owner@example.com', 'STANDARD_USER');
    await goAndHydrate(page, '/projects');
    const name = `Private ${Date.now()}`;
    await page.getByLabel('Project name').fill(name);
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/projects\/[^/]+\/data/);

    const other = await browser.newPage();
    await signInAs(other, 'e2e-outsider@example.com', 'STANDARD_USER');
    await other.goto('/projects');
    await expect(other.getByText(name)).toHaveCount(0);
    await other.close();
  });

  test('can sign out, and the session stops working', async ({ page }) => {
    await signInAs(page, 'e2e-signout@example.com', 'STANDARD_USER');
    await goAndHydrate(page, '/dashboard');
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});

test.describe('an administrator', () => {
  test('reaches the console and sees the safety controls as locked', async ({ page }) => {
    await signInAs(page, 'e2e-admin@example.com', 'SUPER_ADMIN');
    await page.goto('/admin');

    await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Safety controls' })).toBeVisible();
    await expect(page.getByText('on · locked').first()).toBeVisible();
  });

  test('cannot change their own role', async ({ page }) => {
    await signInAs(page, 'e2e-selfadmin@example.com', 'SUPER_ADMIN');
    await page.goto('/admin/users');

    const row = page.getByRole('listitem').filter({ hasText: 'e2e-selfadmin@example.com' });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Change role' })).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
  });

  test('sees their own actions in the audit log', async ({ page }) => {
    await signInAs(page, 'e2e-auditadmin@example.com', 'SUPER_ADMIN');
    await goAndHydrate(page, '/admin/domains');
    await page.getByRole('textbox', { name: 'Domain' }).fill(`e2e-${Date.now()}.test`);
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.getByText(/may now receive sign-in codes/)).toBeVisible();

    await page.goto('/admin/audit');
    await expect(page.getByRole('cell', { name: 'domain.added' }).first()).toBeVisible();
  });
});

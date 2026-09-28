import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.APP_BASE_URL ?? 'http://localhost:3500',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use a Chromium that is already on the machine when one is provided, rather than
        // downloading a matching build. CI images commonly pin a browser revision that does not
        // match the Playwright package's expectation.
        ...(process.env.CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.CHROMIUM_PATH } } : {}),
      },
    },
  ],
  webServer: {
    // `next dev`, not `next start`: the production build refuses the development email and storage
    // adapters at boot, by design, and a local end-to-end run has neither a real mail provider nor
    // a bucket. The behaviour under test — routing, guards, accessibility — is the same either way.
    command: 'npx next dev -p 3500',
    url: process.env.APP_BASE_URL ?? 'http://localhost:3500',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

import { defineConfig, devices } from 'playwright/test';

// Real-browser tests for the security console. They run against `next dev --webpack` (the same bundler the production
// build uses) and the development-only page /dev/security, which serves synthetic fixtures with no login.
// Run:  npx playwright test
const PORT = 3101;

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev --webpack -p ${PORT}`,
    url: `http://localhost:${PORT}/dev/security?tab=data`,
    reuseExistingServer: false,
    // The Gen3 app shell asks its API base for /_status and /user at start-up. Point that base at this same server so the
    // tests can answer those two calls themselves (e2e/support.ts); no commons service is needed or contacted.
    env: { NEXT_PUBLIC_GEN3_API: `http://localhost:${PORT}` },
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});

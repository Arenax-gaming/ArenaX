import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E & Visual Regression Configuration (#703)
 *
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./e2e",

  // Run all tests in parallel (CI uses a single worker to avoid resource contention)
  fullyParallel: true,

  // Fail the build on CI if any test.only() is left in source
  forbidOnly: !!process.env.CI,

  // Retry failed tests on CI to reduce flakiness
  retries: process.env.CI ? 2 : 0,

  // Single worker on CI; let Playwright decide locally
  workers: process.env.CI ? 1 : undefined,

  reporter: [
    ["html", { open: "never" }],
    ["list"],
    // GitHub annotations in CI
    ...(process.env.CI ? ([["github"]] as [string][]) : []),
  ],

  use: {
    // Base URL — override with PLAYWRIGHT_BASE_URL env var in CI
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",

    // Collect trace on first retry to aid debugging
    trace: "on-first-retry",

    // Screenshot only on failure
    screenshot: "only-on-failure",

    // Retain video on failure
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 5"] },
    },
  ],

  // Start the Next.js dev server automatically unless CI provides a running server
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    // Reuse an already-running server locally; always start fresh in CI
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

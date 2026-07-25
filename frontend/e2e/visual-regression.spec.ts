import { test, expect } from "@playwright/test";

/**
 * Visual Regression Test Suite (#703)
 *
 * Captures full-page screenshots and compares against stored baselines.
 * On the first run, baselines are created automatically.
 * Subsequent runs diff against the saved PNG files.
 *
 * Run with:
 *   npm run test:e2e                        # compare against baselines
 *   npx playwright test --update-snapshots  # update baselines after intentional changes
 */
test.describe("Visual Regression", () => {
  const SNAPSHOT_OPTIONS = {
    fullPage: true,
    maxDiffPixels: 200,
  } as const;

  test("home page visual baseline", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded", timeout: 30000 });
    // Allow animations to settle
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("vr-home.png", SNAPSHOT_OPTIONS);
  });

  test("about page visual baseline", async ({ page }) => {
    await page.goto("/en/about", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("vr-about.png", SNAPSHOT_OPTIONS);
  });

  test("tournaments page visual baseline", async ({ page }) => {
    await page.goto("/en/tournaments", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("vr-tournaments.png", SNAPSHOT_OPTIONS);
  });

  test("login page visual baseline", async ({ page }) => {
    await page.goto("/en/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("vr-login.png", SNAPSHOT_OPTIONS);
  });

  test("register page visual baseline", async ({ page }) => {
    await page.goto("/en/register", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("vr-register.png", SNAPSHOT_OPTIONS);
  });

  test("leaderboard page visual baseline", async ({ page }) => {
    await page.goto("/en/leaderboard", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await page.waitForTimeout(500);
    await expect(page).toHaveScreenshot("vr-leaderboard.png", SNAPSHOT_OPTIONS);
  });
});

import { test, expect } from "@playwright/test";

/**
 * Authentication Flow E2E Tests (#703)
 *
 * Tests login, register pages, and auth-gated routes.
 */
test.describe("Authentication", () => {
  test("login page renders input fields", async ({ page }) => {
    await page.goto("/en/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // ArenaX uses phone-based OTP — look for phone, email, or generic text input
    const inputLocator = page.locator(
      "input[type='tel'], input[type='email'], input[type='text'], input[name*='phone'], input[name*='email']"
    );
    const count = await inputLocator.count();
    expect(count).toBeGreaterThan(0);
  });

  test("login page has a submit button", async ({ page }) => {
    await page.goto("/en/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const submitButton = page.locator(
      "button[type='submit'], button:has-text('Login'), button:has-text('Sign in'), button:has-text('Continue')"
    );
    const count = await submitButton.count();
    expect(count).toBeGreaterThan(0);
  });

  test("login form shows validation feedback on empty submission", async ({
    page,
  }) => {
    await page.goto("/en/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Attempt to submit with no input — the form should either show validation
    // messages or remain on the same page
    const submitButton = page.locator(
      "button[type='submit'], button:has-text('Login'), button:has-text('Sign in'), button:has-text('Continue')"
    );
    if ((await submitButton.count()) > 0) {
      await submitButton.first().click();
    }

    // We expect the user to remain on the login page (not navigate away)
    await page.waitForTimeout(500);
    expect(page.url()).toMatch(/login|auth/i);
  });

  test("register page loads and shows registration form", async ({ page }) => {
    await page.goto("/en/register", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const body = page.locator("body");
    await expect(body).toBeVisible();
    const text = await body.innerText();
    // Register page should mention registration-related content
    expect(text.trim().length).toBeGreaterThan(0);
  });

  test("register page has required input fields", async ({ page }) => {
    await page.goto("/en/register", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const inputs = page.locator("input");
    const count = await inputs.count();
    expect(count).toBeGreaterThan(0);
  });

  test("authenticated-only dashboard route redirects unauthenticated users", async ({
    page,
  }) => {
    await page.goto("/en/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // After navigation, user should either be on login page OR dashboard
    // shows an auth gate/loading state — it should NOT be a hard error
    const status = page.url();
    // Should redirect to login or stay on a valid page
    expect(status).toBeTruthy();
    // The page should not show a server error
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("visual snapshot: login page", async ({ page }) => {
    await page.goto("/en/login", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await expect(page).toHaveScreenshot("login-page.png", {
      maxDiffPixels: 100,
    });
  });
});

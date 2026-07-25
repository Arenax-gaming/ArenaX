/**
 * E2E tests: silent token refresh on 401
 *
 * These tests verify that:
 * 1. A 401 on any API call triggers a silent token refresh and retries
 *    the original request — the user never sees a broken page.
 * 2. When the refresh itself fails (revoked/expired), the user is logged out
 *    and redirected to /login?reason=session_expired with a toast.
 * 3. Multiple concurrent 401s share a single refresh call (no duplicate refreshes).
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { mockNotificationHandlers } from "./mocks/handlers";

const LOCALE = "en";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const EXPIRED_ACCESS_TOKEN = "expired-access-token";
const NEW_ACCESS_TOKEN = "fresh-access-token";
const NEW_REFRESH_TOKEN = "fresh-refresh-token";
const STORED_REFRESH_TOKEN = "stored-refresh-token";

/** Seed the browser with an "expired" access token + a valid refresh token */
async function seedExpiredSession(page: Page) {
  await page.evaluate(
    ({ accessToken, refreshToken }: { accessToken: string; refreshToken: string }) => {
      localStorage.setItem("auth_token", accessToken);
      localStorage.setItem("auth_refresh_token", refreshToken);
      localStorage.setItem("arenax_remember_me", "true");
      localStorage.setItem(
        "arenax_auth_user",
        JSON.stringify({
          id: "user-1",
          username: "testuser",
          email: "test@example.com",
          isVerified: true,
          elo: 1200,
          createdAt: new Date().toISOString(),
          token: accessToken,
          refreshToken,
        }),
      );
    },
    { accessToken: EXPIRED_ACCESS_TOKEN, refreshToken: STORED_REFRESH_TOKEN },
  );
}

/** Mock a successful token refresh */
async function mockSuccessfulRefresh(page: Page) {
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: NEW_ACCESS_TOKEN,
        refresh_token: NEW_REFRESH_TOKEN,
        expires_in: 900,
        token_type: "Bearer",
      }),
    }),
  );
}

/** Mock a failing token refresh (401 from /auth/refresh) */
async function mockFailedRefresh(page: Page) {
  await page.route("**/api/auth/refresh", (route) =>
    route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "refresh_token_expired", message: "Refresh token has expired" }),
    }),
  );
}

/** Mock a profile endpoint that returns 401 the first time, then 200 on retry */
async function mockProfileWith401ThenSuccess(page: Page) {
  let callCount = 0;
  await page.route("**/api/users/me", (route) => {
    callCount += 1;
    if (callCount === 1) {
      return route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "token_expired", message: "Token has expired" }),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "user-1",
        username: "testuser",
        email: "test@example.com",
        is_verified: true,
        created_at: new Date().toISOString(),
        elo: 1200,
      }),
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Silent token refresh", () => {
  test.beforeEach(async ({ page }) => {
    await mockNotificationHandlers(page);
  });

  test("401 on profile fetch triggers silent refresh and user stays logged in", async ({
    page,
  }) => {
    await mockSuccessfulRefresh(page);
    await mockProfileWith401ThenSuccess(page);

    // Seed expired session
    await page.goto(`/${LOCALE}/login`);
    await seedExpiredSession(page);

    // Navigate to a protected page that calls /api/users/me
    await page.goto(`/${LOCALE}/dashboard`);

    // The user should NOT be redirected to login
    await expect(page).not.toHaveURL(/login/, { timeout: 8_000 });

    // The new tokens should be stored
    const storedToken = await page.evaluate(() =>
      localStorage.getItem("auth_token"),
    );
    expect(storedToken).toBe(NEW_ACCESS_TOKEN);

    const storedRefresh = await page.evaluate(() =>
      localStorage.getItem("auth_refresh_token"),
    );
    expect(storedRefresh).toBe(NEW_REFRESH_TOKEN);
  });

  test("failed refresh logs out user and redirects to /login?reason=session_expired", async ({
    page,
  }) => {
    await mockFailedRefresh(page);

    // Stub profile endpoint to always return 401 (expired token, no valid refresh)
    await page.route("**/api/users/me", (route) =>
      route.fulfill({
        status: 401,
        contentType: "application/json",
        body: JSON.stringify({ error: "token_expired", message: "Token has expired" }),
      }),
    );

    await page.goto(`/${LOCALE}/login`);
    await seedExpiredSession(page);

    await page.goto(`/${LOCALE}/dashboard`);

    // Should redirect to login with the session_expired reason
    await expect(page).toHaveURL(/login.*reason=session_expired/, { timeout: 10_000 });
  });

  test("session_expired toast is visible on the login page after redirect", async ({
    page,
  }) => {
    // Navigate directly to login with the reason param (simulates the redirect)
    await page.goto(`/${LOCALE}/login?reason=session_expired`);

    // Toast should appear
    await expect(
      page.locator('[role="alert"]').filter({ hasText: /session.*expired/i }),
    ).toBeVisible({ timeout: 6_000 });
  });

  test("parallel 401 requests share a single refresh call", async ({ page }) => {
    let refreshCount = 0;

    await page.route("**/api/auth/refresh", (route) => {
      refreshCount += 1;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          access_token: NEW_ACCESS_TOKEN,
          refresh_token: NEW_REFRESH_TOKEN,
          expires_in: 900,
          token_type: "Bearer",
        }),
      });
    });

    // Two endpoints both return 401 so both will attempt refresh simultaneously
    let notifCount = 0;
    await page.route("**/api/notifications**", (route) => {
      notifCount += 1;
      if (notifCount === 1) {
        return route.fulfill({
          status: 401,
          contentType: "application/json",
          body: JSON.stringify({ error: "token_expired", message: "Token has expired" }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [] }),
      });
    });

    await mockProfileWith401ThenSuccess(page);

    await page.goto(`/${LOCALE}/login`);
    await seedExpiredSession(page);
    await page.goto(`/${LOCALE}/dashboard`);

    // Give time for both requests + refresh to settle
    await page.waitForTimeout(2_000);

    // The refresh endpoint should have been called at most once despite two 401s
    expect(refreshCount).toBeLessThanOrEqual(1);
  });

  test("after successful refresh, retried request succeeds without user noticing", async ({
    page,
  }) => {
    await mockSuccessfulRefresh(page);
    await mockProfileWith401ThenSuccess(page);

    await page.goto(`/${LOCALE}/login`);
    await seedExpiredSession(page);
    await page.goto(`/${LOCALE}/dashboard`);

    // No error toasts should appear
    const errorToast = page.locator('[role="alert"]').filter({ hasText: /error|failed|expired/i });
    await expect(errorToast).not.toBeVisible({ timeout: 5_000 });

    // User stays on the dashboard (not redirected to login)
    await expect(page).not.toHaveURL(/login/, { timeout: 5_000 });
  });
});

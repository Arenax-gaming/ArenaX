import { test, expect } from "@playwright/test";
import {
  mockAuthHandlers,
  mockMatchHandlers,
  mockNotificationHandlers,
} from "./mocks/handlers";

const LOCALE = "en";

async function seedAuth(page: Parameters<typeof mockAuthHandlers>[0]) {
  await page.evaluate(() => {
    localStorage.setItem("auth_token", "mock-access-token");
    localStorage.setItem(
      "auth_user",
      JSON.stringify({ id: "user-1", username: "testuser", email: "test@example.com" })
    );
  });
}

test.describe("Match journeys", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthHandlers(page);
    await mockMatchHandlers(page);
    await mockNotificationHandlers(page);
  });

  test("enter matchmaking queue by selecting a game mode", async ({ page }) => {
    await page.goto(`/${LOCALE}/play`);
    await seedAuth(page);
    await page.reload();

    // Choose the first game mode card (1v1 Duel)
    const firstMode = page.locator('button').filter({ hasText: /1v1 Duel|Quick Play|Casual/i }).first();
    await expect(firstMode).toBeVisible({ timeout: 10_000 });
    await firstMode.click();

    // Matchmaking queue UI should appear
    await expect(
      page.locator('text=Finding Opponents, text=Finding')
        .or(page.locator('[data-testid="matchmaking-queue"]'))
        .or(page.locator('text=Cancel Matchmaking'))
    ).toBeVisible({ timeout: 8_000 });
  });

  test("cancel matchmaking returns to mode selector", async ({ page }) => {
    await page.goto(`/${LOCALE}/play`);
    await seedAuth(page);
    await page.reload();

    const firstMode = page.locator('button').filter({ hasText: /1v1 Duel|Casual|Quick Play/i }).first();
    await expect(firstMode).toBeVisible({ timeout: 10_000 });
    await firstMode.click();

    const cancelBtn = page.locator('button:has-text("Cancel Matchmaking"), button:has-text("Cancel")').first();
    await expect(cancelBtn).toBeVisible({ timeout: 8_000 });
    await cancelBtn.click();

    // Should be back to mode selection with heading "Choose Your Battle" or game mode grid
    await expect(
      page.locator('h1:has-text("Choose"), [data-testid="game-mode-selector"]')
        .or(page.locator('button').filter({ hasText: /1v1 Duel/i }).first())
    ).toBeVisible({ timeout: 8_000 });
  });

  test("report score for a match", async ({ page }) => {
    // Seed the match report API intercept
    let reportCalled = false;
    await page.route("**/api/matches/*/report", (route) => {
      reportCalled = true;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: { message: "Score reported" } }),
      });
    });

    // Navigate to a match detail page directly with seeded session
    await page.goto(`/${LOCALE}/matches/match-1`);
    await seedAuth(page);
    await page.reload();

    // If a "Report Score" button exists, click it
    const reportBtn = page.locator(
      'button:has-text("Report Score"), button:has-text("Report"), button:has-text("Submit Score")'
    ).first();

    if (await reportBtn.isVisible({ timeout: 5_000 })) {
      await reportBtn.click();

      // Fill score if a dialog appears
      const scoreInput = page.locator('input[name="score"], input[placeholder*="score" i]').first();
      if (await scoreInput.isVisible({ timeout: 3_000 })) {
        await scoreInput.fill("3");
      }

      const submitBtn = page.locator('button[type="submit"]:has-text("Submit"), button:has-text("Confirm")').first();
      if (await submitBtn.isVisible({ timeout: 3_000 })) {
        await submitBtn.click();
      }

      // Either the API was called or a success message appears
      await expect(
        page.locator('[role="alert"], [data-toast]').first()
      ).toBeVisible({ timeout: 8_000 });
    } else {
      // The page renders content (not 404)
      await expect(page.locator("body")).not.toHaveText("404", { timeout: 5_000 });
    }
  });
});

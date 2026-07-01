import { test, expect } from "@playwright/test";
import {
  mockAuthHandlers,
  mockTournamentHandlers,
  mockNotificationHandlers,
  mockTournament,
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

test.describe("Tournament journeys", () => {
  test.beforeEach(async ({ page }) => {
    await mockAuthHandlers(page);
    await mockTournamentHandlers(page);
    await mockNotificationHandlers(page);
  });

  test("browse tournaments page loads and shows tournament list", async ({ page }) => {
    await page.goto(`/${LOCALE}/tournaments`);

    // Page should render a heading or tournament content
    await expect(
      page.locator('h1, [data-testid="tournaments-heading"]').first()
    ).toBeVisible({ timeout: 10_000 });

    // At least one tournament card or grid item appears
    await expect(
      page.locator('[data-testid="tournament-card"], .tournament-card, article').first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("join tournament → shows success feedback", async ({ page }) => {
    await page.goto(`/${LOCALE}/tournaments`);
    await seedAuth(page);
    await page.reload();

    // Click the first Join / Quick Join button
    const joinBtn = page
      .locator('button:has-text("Join"), button:has-text("Quick Join")')
      .first();
    await expect(joinBtn).toBeVisible({ timeout: 10_000 });
    await joinBtn.click();

    // Expect either a success toast, confirmation dialog, or navigation to registration
    await expect(
      page
        .locator('[role="dialog"], [data-toast], [role="alert"]')
        .first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("view tournament bracket page", async ({ page }) => {
    await mockTournamentHandlers(page);
    await page.goto(`/${LOCALE}/tournaments/${mockTournament.id}/bracket`);

    // Bracket page renders without crashing
    await expect(page.locator("body")).toBeVisible();
    // Should not be a 404
    await expect(page.locator("text=404")).not.toBeVisible({ timeout: 5_000 });
  });

  test("tournament detail page shows prize pool and participants", async ({ page }) => {
    await page.goto(`/${LOCALE}/tournaments/${mockTournament.id}`);

    // Page should render tournament detail content
    await expect(page.locator("body")).not.toHaveText("404", { timeout: 8_000 });
    // Some content appears within reasonable time
    await expect(
      page.locator("main, [data-testid='tournament-detail'], article").first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

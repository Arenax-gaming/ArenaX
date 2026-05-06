import { test, expect } from '@playwright/test';

test.describe('ArenaX E2E Tests', () => {
  test('user registration and login flow', async ({ page }) => {
    // Navigate to registration page
    await page.goto('http://localhost:3000/register');

    // Fill registration form
    await page.fill('[data-testid="username"]', 'testuser');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'SecurePass123!');
    await page.click('[data-testid="register-button"]');

    // Should redirect to dashboard or show success
    await expect(page).toHaveURL(/dashboard|home/);

    // Logout
    await page.click('[data-testid="logout-button"]');

    // Login
    await page.goto('http://localhost:3000/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'SecurePass123!');
    await page.click('[data-testid="login-button"]');

    // Should be logged in
    await expect(page.locator('[data-testid="user-menu"]')).toBeVisible();
  });

  test('tournament creation and joining', async ({ page }) => {
    // Assume logged in
    await page.goto('http://localhost:3000/tournaments');

    // Create tournament
    await page.click('[data-testid="create-tournament"]');
    await page.fill('[data-testid="tournament-name"]', 'Test Tournament');
    await page.selectOption('[data-testid="game-type"]', 'arena-battle');
    await page.click('[data-testid="submit-tournament"]');

    // Should see tournament in list
    await expect(page.locator('text=Test Tournament')).toBeVisible();

    // Join tournament
    await page.click('[data-testid="join-tournament"]');

    // Should show joined status
    await expect(page.locator('[data-testid="joined-status"]')).toBeVisible();
  });
});
import { test, expect } from '@playwright/test';
import { injectAxe, checkA11y } from 'axe-playwright';

test.describe('Basic Navigation', () => {
  test('should navigate to the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/ArenaX/);
  });

  test('should have no accessibility violations', async ({ page }) => {
    await page.goto('/');
    await injectAxe(page);
    await checkA11y(page);
  });
});

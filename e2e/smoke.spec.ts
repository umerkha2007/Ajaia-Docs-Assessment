import { expect, test } from '@playwright/test';

test.describe('End-to-End: application startup', () => {
  test('[P1-E2E-1] browser loads the app and the frontend reaches the backend and SQLite', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Ajaia Docs' })).toBeVisible();
    await expect(page.getByTestId('backend-status')).toHaveText(/^Backend: ok \(SQLite \d+\.\d+\.\d+/);
  });
});

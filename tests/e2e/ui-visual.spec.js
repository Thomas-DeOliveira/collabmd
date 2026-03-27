import { expect, openFile, test } from './helpers/app-fixture.js';
import { startTestServer } from '../node/helpers/test-server.js';

test.describe('ui visual regression', () => {
  test('matches the steady-state desktop workspace shell', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-theme', 'light');
      window.localStorage.setItem('collabmd-user-name', 'Audit User');
    });

    await openFile(page, 'README.md', { userName: 'Audit User', waitFor: 'preview' });
    await expect(page.locator('#previewContent')).toContainText('My Vault');
    await expect(page.locator('#activeFileName')).toHaveText('README');

    await expect(page).toHaveScreenshot('desktop-workspace-shell.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    });
  });

  test('matches the steady-state mobile preview shell', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem('collabmd-theme', 'light');
      window.localStorage.setItem('collabmd-user-name', 'Audit User');
    });

    await openFile(page, 'README.md', { userName: 'Audit User', waitFor: 'preview' });
    await expect(page.locator('#editorLayout')).toHaveAttribute('data-view', 'preview');
    await expect(page.locator('#previewContent')).toContainText('My Vault');

    await expect(page).toHaveScreenshot('mobile-preview-shell.png', {
      animations: 'disabled',
      caret: 'hide',
      fullPage: true,
      maxDiffPixelRatio: 0.015,
    });
  });

  test('matches the password auth gate', async ({ page }) => {
    const app = await startTestServer({
      auth: {
        password: 'visual-secret',
        strategy: 'password',
      },
    });

    try {
      await page.addInitScript(() => {
        window.localStorage.setItem('collabmd-theme', 'dark');
        window.localStorage.setItem('collabmd-user-name', 'Audit User');
      });

      await page.goto(`${app.baseUrl}/#file=test.md`);
      await expect(page.locator('.auth-gate-card')).toBeVisible();

      await expect(page).toHaveScreenshot('auth-gate-password.png', {
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        maxDiffPixelRatio: 0.015,
      });
    } finally {
      await app.close();
    }
  });
});

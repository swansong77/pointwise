import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** The search bar on a phone: floating button, full-screen dialog, a question answered (synthetic data). */
test.describe('Universal search on mobile', () => {
  test('PW-SRCH-M1 the floating button opens a full-screen bar and a question is answered', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold');
    await uiLogin(page, u.email);
    const fab = page.getByTestId('search-fab');
    await expect(fab).toBeVisible();
    await expect(page.getByTestId('search-trigger')).toBeHidden(); // the desktop pill is not shown on a phone
    await fab.click();
    const dialog = page.getByRole('dialog', { name: 'Search and ask PointWise' });
    await expect(dialog).toBeVisible();
    const box = dialog.getByRole('combobox');
    await expect(box).toBeFocused();
    const size = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    expect(size!.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(size!.height).toBeGreaterThanOrEqual(viewport.height - 1);
    await box.fill('Costco $1500');
    await box.press('Enter');
    await expect(page.getByTestId('search-summary')).toContainText('Best:');
    await dialog.getByRole('button', { name: 'Close search' }).click();
    await expect(dialog).toBeHidden();
    await expect(fab).toBeFocused(); // focus goes back to what opened it
  });

  test('PW-SRCH-M2 the header search icon also opens it', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.getByTestId('search-trigger-mobile').click();
    await expect(page.getByRole('dialog', { name: 'Search and ask PointWise' })).toBeVisible();
  });
});

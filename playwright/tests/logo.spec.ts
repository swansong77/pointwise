import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiRegister, uiLogin } from './helpers';

/** The Pointwise logo: landing page, sign-in, app header, tab icon and install manifest. */
test.describe('Logo', () => {
  test('LG-01 the logo is on the landing page, sign-in and the app header, and the page has an icon and manifest', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('logo')).toContainText('Pointwise');
    await page.goto('/login');
    await expect(page.getByTestId('logo')).toBeVisible();
    const icon = await page.locator('link[rel~="icon"]').first().getAttribute('href');
    expect(icon).toBeTruthy();
    expect((await request.get(icon!)).status()).toBe(200);
    const apple = await page.locator('link[rel="apple-touch-icon"]').first().getAttribute('href');
    expect((await request.get(apple!)).status()).toBe(200);
    const manifest = await page.locator('link[rel="manifest"]').first().getAttribute('href');
    const m = await (await request.get(manifest!)).json();
    expect(m).toMatchObject({ name: 'Pointwise', display: 'standalone' });
    expect(m.icons.map((i: { sizes: string }) => i.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));

    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await expect(page.locator('header').getByTestId('logo')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Pointwise home' })).toHaveAttribute('href', '/dashboard');
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
});

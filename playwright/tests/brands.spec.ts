import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Brand logos and icons: the directory page and where logos appear (synthetic data; fictional catalog issuers show monograms). */
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
};

test.describe('Brand logos', () => {
  test('BR-01 the directory lists every group, real icons actually load, monograms stand in where there is none', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.getByRole('link', { name: 'Brand logos' }).first().click();
    await expect(page.getByTestId('brands')).toBeVisible();
    await expect(page.getByTestId('brand-summary')).toContainText('with an icon');
    for (const k of ['ISSUER', 'NETWORK', 'AIRLINE', 'HOTEL', 'BANK_REWARDS', 'SHOPPING', 'MERCHANT', 'MEMBERSHIP']) await expect(page.getByTestId(`brand-group-${k}`)).toBeVisible();
    const chase = page.locator('[data-testid=brand-tile][data-brand=chase]');
    await expect(chase).toContainText('Icon · Simple Icons (CC0)');
    const img = chase.locator('img');
    await expect(img).toHaveAttribute('src', '/brands/chase.svg');
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
    const hyatt = page.locator('[data-testid=brand-tile][data-brand=hyatt]');
    await expect(hyatt).toContainText('Monogram · no icon available');
    await expect(hyatt.locator('[data-monogram=true]')).toHaveText('WH');
    await noSeriousA11y(page);
  });

  test('BR-02 search finds a brand by name, alias or program code', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/brands');
    await page.locator('#brand-search').fill('MAR_BONVOY');
    await expect(page.getByTestId('brand-tile')).toHaveCount(1);
    await expect(page.getByTestId('brand-tile')).toContainText('Marriott Bonvoy');
    await page.locator('#brand-search').fill('skymiles');
    await expect(page.locator('[data-testid=brand-tile][data-brand=delta]')).toBeVisible();
    await page.locator('#brand-search').fill('zzzz-nothing');
    await expect(page.getByText('No brand matches')).toBeVisible();
  });

  test('BR-03 cards, merchants and loyalty accounts show logos', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold');
    await uiLogin(page, u.email);
    await page.goto('/wallet');
    const art = page.getByTestId('wallet-card').first().getByTestId('card-art');
    await expect(art).toBeVisible();
    await expect(art).toHaveAttribute('aria-label', /Contoso Gold card/);
    await expect(art.getByTestId('brand-logo').first()).toBeVisible();
    await page.goto('/merchants');
    await expect(page.getByTestId('merchant-results').getByTestId('brand-logo').first()).toBeVisible();
    await noSeriousA11y(page);
  });
});

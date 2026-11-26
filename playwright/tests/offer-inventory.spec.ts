import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Unified offer inventory and the per-card detail page (synthetic data). */
const future = new Date(Date.now() + 20 * 86_400_000);
const us = `${String(future.getUTCMonth() + 1).padStart(2, '0')}/${String(future.getUTCDate()).padStart(2, '0')}/${future.getUTCFullYear()}`;
const later = new Date(Date.now() + 70 * 86_400_000);
const usLater = `${String(later.getUTCMonth() + 1).padStart(2, '0')}/${String(later.getUTCDate()).padStart(2, '0')}/${later.getUTCFullYear()}`;
const OFFERS = `Hilton: Spend $500, get $100 back, expires ${us}\nUber Eats - 10% back up to $20 - ends ${usLater}`;

const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
};

test.describe('Offer inventory and card detail', () => {
  test('PW-INV-01 the inventory lists every offer with its lifecycle, and quick filters and search narrow it', async ({ page, request }) => {
    const u = await apiRegister(request);
    const card = await apiAddCard(request, u.token, 'contoso-gold');
    const imported = await request.post(`${process.env.API_URL ?? 'http://backend:4000'}/api/v1/offers/intel/import`, {
      headers: { Authorization: `Bearer ${u.token}` },
      data: { walletCardId: card.id, text: OFFERS },
    });
    expect(imported.ok()).toBeTruthy();
    await uiLogin(page, u.email);
    await page.goto('/offers/inventory');
    await expect(page.getByTestId('inventory-totals')).toContainText('2');
    const rows = page.getByTestId('inventory-row');
    await expect(rows).toHaveCount(2);
    const hilton = rows.filter({ hasText: 'Hilton' });
    await expect(hilton).toContainText('$100 back on $500');
    await expect(hilton).toContainText('Added');
    await expect(hilton).toContainText('Expected');

    await page.getByRole('button', { name: 'Expiring in 30 days' }).click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Hilton');

    await page.getByRole('button', { name: 'All offers' }).click();
    await page.getByLabel('Search').fill('uber');
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('Uber Eats');
    await page.getByLabel('Search').fill('no such merchant');
    await expect(page.getByText('No offers match')).toBeVisible();
    await noSeriousA11y(page);
  });

  test('PW-INV-02 a card has a detail page with offers by status, benefits and savings', async ({ page, request }) => {
    const u = await apiRegister(request);
    const card = await apiAddCard(request, u.token, 'contoso-gold');
    await request.post(`${process.env.API_URL ?? 'http://backend:4000'}/api/v1/offers/intel/import`, {
      headers: { Authorization: `Bearer ${u.token}` },
      data: { walletCardId: card.id, text: OFFERS },
    });
    await uiLogin(page, u.email);
    await page.goto('/wallet');
    await page.getByRole('link', { name: /^Details for/ }).first().click();
    await expect(page.getByTestId('card-detail')).toBeVisible();
    await expect(page.getByTestId('card-detail-tiles')).toContainText('Annual Fee');

    await page.getByRole('button', { name: 'Offers', exact: true }).click();
    await page.getByRole('button', { name: /pending \(2\)/i }).click();
    await expect(page.getByTestId('card-offer-list').locator('li')).toHaveCount(2);
    await page.getByRole('button', { name: /active \(0\)/i }).click();
    await expect(page.getByText('No activated offers.')).toBeVisible();

    await page.getByRole('button', { name: 'Benefits & credits' }).click();
    await page.getByRole('button', { name: 'Savings' }).click();
    await expect(page.getByTestId('card-savings')).toContainText('Offer credits received');
    await noSeriousA11y(page);
  });

  test('PW-INV-03 the member filter limits offers to one cardholder', async ({ page, request }) => {
    const u = await apiRegister(request);
    const card = await apiAddCard(request, u.token, 'contoso-gold');
    await request.post(`${process.env.API_URL ?? 'http://backend:4000'}/api/v1/offers/intel/import`, {
      headers: { Authorization: `Bearer ${u.token}` },
      data: { walletCardId: card.id, text: OFFERS },
    });
    await uiLogin(page, u.email);
    await page.goto('/offers/inventory');
    const who = page.getByLabel('Cardholder');
    await expect(who.locator('option')).not.toHaveCount(1); // the household members have loaded
    const options = await who.locator('option').allTextContents();
    expect(options[0]).toBe('Everyone');
    expect(options.some((o) => o.includes('(you)'))).toBe(true);
    await who.selectOption({ index: 1 });
    await expect(page.getByTestId('inventory-row')).toHaveCount(2);
  });
});

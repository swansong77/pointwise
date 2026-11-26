import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Savings-and-planning dashboards: expirations, savings, household offers, merchant dashboard (synthetic data). */
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
};
const API = process.env.API_URL ?? 'http://backend:4000';

const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
};

async function setup(request: import('@playwright/test').APIRequestContext) {
  const u = await apiRegister(request);
  const card = await apiAddCard(request, u.token, 'contoso-gold');
  const headers = { Authorization: `Bearer ${u.token}` };
  await request.post(`${API}/api/v1/offers/intel/import`, { headers, data: { walletCardId: card.id, text: `Hilton: Spend $500, get $100 back, expires ${us(5)}\nUber Eats - 10% back up to $20 - ends ${us(45)}` } });
  return u;
}

test.describe('Savings and planning dashboards', () => {
  test('PW-DASH-01 the expiration dashboard groups what lapses and what it costs to miss it', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.goto('/offers/expirations');
    await expect(page.getByTestId('expiration-totals')).toContainText('At Risk');
    const week = page.getByTestId('bucket-WEEK');
    await expect(week).toContainText('Hilton');
    await expect(week).toContainText('Lost if missed');
    await expect(page.getByTestId('bucket-TWO_MONTHS')).toContainText('Uber Eats');
    await page.getByRole('button', { name: /^Credits/ }).click();
    await expect(page.locator('[data-testid="expiring-item"][data-kind="OFFER"]')).toHaveCount(0);
    await page.getByRole('button', { name: /^Offers/ }).click();
    await expect(page.locator('[data-testid="expiring-item"][data-kind="OFFER"]').first()).toBeVisible();
    await noSeriousA11y(page);
  });

  test('PW-DASH-02 the savings dashboard shows totals, a breakdown and the monthly chart', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.goto('/offers/savings');
    await expect(page.getByTestId('savings-totals')).toContainText('Saved So Far');
    await expect(page.getByTestId('savings-totals')).toContainText('Still Expected');
    await page.getByRole('button', { name: 'By member' }).click();
    await expect(page.getByTestId('savings-breakdown')).toBeVisible();
    await page.getByRole('button', { name: 'By merchant' }).click();
    await expect(page.getByTestId('savings-breakdown')).toContainText('Hilton');
    await expect(page.getByTestId('savings-months')).toBeVisible();
    await noSeriousA11y(page);
  });

  test('PW-DASH-03 household offers show who holds what and who should pay', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.goto('/offers/household');
    await expect(page.getByTestId('household-offer-totals')).toContainText('Offers Earning');
    await expect(page.getByTestId('household-member-offers').first()).toContainText('2 offers earning');
    const hilton = page.getByTestId('routing-row').filter({ hasText: 'Hilton' });
    await expect(hilton).toContainText('should pay at Hilton');
    await noSeriousA11y(page);
  });

  test('PW-DASH-04 the merchant page adds a dashboard with offers, multipliers and the best way to pay', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.goto('/merchants/hilton');
    await expect(page.getByTestId('merchant-ranking')).toBeVisible(); // the existing sections are still there
    const dash = page.getByTestId('merchant-dashboard');
    await expect(dash).toBeVisible();
    await expect(page.getByTestId('merchant-dashboard-tiles')).toContainText('Offers Earning');
    await expect(page.getByTestId('merchant-best-pay')).toContainText('returns about');
    await expect(page.getByTestId('merchant-offer-inventory')).toContainText('$100 back on $500');
    await expect(page.getByTestId('merchant-multipliers')).toBeVisible();
    await noSeriousA11y(page);
  });

  test('PW-DASH-05 the new pages are in the menu', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    for (const [name, path] of [['Expirations', '/offers/expirations'], ['Savings', '/offers/savings'], ['Household Offers', '/offers/household']] as const) {
      await page.getByRole('link', { name, exact: false }).first().click();
      await expect(page).toHaveURL(new RegExp(path));
    }
  });
});

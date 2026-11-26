import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Shopping planner: item-level plans, strategies, expiry impact, best time, upcoming purchases (synthetic data). */
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
};
const isoDate = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const API = process.env.API_URL ?? 'http://backend:4000';

const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);
};

test.describe('Shopping planner', () => {
  test('PW-SP-01 plan a hotel stay: strategies, what expires, best time, then save and mark it bought', async ({ page, request }) => {
    const u = await apiRegister(request);
    const card = await apiAddCard(request, u.token, 'contoso-gold');
    const headers = { Authorization: `Bearer ${u.token}` };
    await request.post(`${API}/api/v1/offers/intel/import`, { headers, data: { walletCardId: card.id, text: `Hilton: Spend $500, get $100 back, expires ${us(20)}` } });
    await uiLogin(page, u.email);
    await page.goto('/offers/plan');

    await page.getByLabel('Item (optional)').fill('Hilton stay');
    await page.locator('#pp-merchant').fill('Hilton');
    await page.locator('#pp-amount').fill('1200');
    await page.locator('#pp-when').fill(isoDate(40));
    await page.getByLabel('Priority').selectOption('HIGH');
    await page.getByTestId('plan-go').click();

    await expect(page.getByTestId('strategies')).toBeVisible();
    await expect(page.getByTestId('strategy').filter({ hasText: 'Best strategy' })).toBeVisible();
    await expect(page.getByTestId('strategy').filter({ hasText: 'Conservative strategy' })).toBeVisible();
    await expect(page.getByTestId('strategy').filter({ hasText: 'Maximum rewards strategy' })).toBeVisible();
    await expect(page.getByTestId('plan-breakdown')).toContainText('Net Cost');

    // the planned date is after the offer ends: it is flagged and the best day is earlier
    await expect(page.getByTestId('expiry-impact')).toContainText('before your planned date');
    await expect(page.getByTestId('best-time')).toContainText('Buying on');
    await noSeriousA11y(page);

    await page.getByTestId('plan-save').click();
    const row = page.getByTestId('planned-row');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Hilton stay');
    await expect(row).toContainText('high priority');
    await expect(row).toContainText('Recommended:');

    await row.getByRole('button', { name: 'Mark bought' }).click();
    await expect(row).toHaveAttribute('data-status', 'DONE');
    await row.getByLabel('Actual return in dollars').fill('250');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(row).toContainText(/Met the plan|short of the plan/);
  });

  test('PW-SP-02 an item alone is read as a category and the plan says so', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold');
    await uiLogin(page, u.email);
    await page.goto('/offers/plan');
    await page.getByLabel('Item (optional)').fill('MacBook Pro');
    await page.locator('#pp-amount').fill('2200');
    await page.getByTestId('plan-go').click();
    await expect(page.getByTestId('plans')).toBeVisible();
    await expect(page.getByTestId('plan-warnings').first()).toContainText(/No merchant was named|guessed from the item/);
    await expect(page.getByTestId('plan-evidence').first()).toContainText('card earn');
  });

  test('PW-SP-03 the planner needs an item or a merchant and an amount', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/offers/plan');
    const go = page.getByTestId('plan-go');
    await expect(go).toBeDisabled();
    await page.locator('#pp-amount').fill('100');
    await expect(go).toBeDisabled();
    await page.getByLabel('Item (optional)').fill('dinner out');
    await expect(go).toBeEnabled();
  });
});

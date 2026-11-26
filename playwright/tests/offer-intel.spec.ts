import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Merchant offer intelligence: import, ranking with reasons, assisted activation, planner (synthetic data). */
const future = new Date(Date.now() + 20 * 86_400_000);
const us = `${String(future.getUTCMonth() + 1).padStart(2, '0')}/${String(future.getUTCDate()).padStart(2, '0')}/${future.getUTCFullYear()}`;
const OFFERS = `Hilton: Spend $500, get $100 back, expires ${us}\nUber Eats - 10% back up to $20 - ends ${us}\nthis line is not an offer`;

const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
};

test.describe('Offer intelligence', () => {
  test('PW-OI-01 import offers, see source and reliability, rank with reasons, activate from the checklist', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold');
    await uiLogin(page, u.email);
    await page.goto('/offers/intel');
    await page.getByTestId('tab-inventory').click();
    await page.locator('#oi-text').fill(OFFERS);
    await page.getByTestId('import-offers').click();
    const result = page.getByTestId('import-result');
    await expect(result).toContainText('Added 2');
    await expect(result).toContainText('could not read 1');
    await expect(result).toContainText('this line is not an offer');

    const rows = page.getByTestId('inventory-row');
    await expect(rows).toHaveCount(2);
    const hilton = rows.filter({ hasText: 'Hilton' });
    await expect(hilton).toContainText('Hilton Worldwide Holdings Inc.');
    await expect(hilton).toContainText('Entered by you · 25');
    await expect(hilton).toContainText('confidence up to 25%');
    await expect(hilton).toContainText('Needs activation');

    await page.getByTestId('tab-opportunities').click();
    const opp = page.getByTestId('opportunity').first();
    await expect(opp).toContainText('Score');
    await opp.getByRole('button', { name: 'Why this score?' }).click();
    await expect(page.getByTestId('score-factors')).toContainText('Urgency');
    await expect(page.getByTestId('score-factors')).toContainText('Expected savings');
    await noSeriousA11y(page);

    await page.getByTestId('tab-activate').click();
    const items = page.getByTestId('activation-item');
    await expect(items).toHaveCount(2);
    await items.filter({ hasText: 'Hilton' }).getByTestId('mark-activated').click();
    await expect(items).toHaveCount(1);

    await page.getByTestId('tab-audit').click();
    const events = page.getByTestId('audit-event');
    await expect(events.filter({ hasText: 'Marked activated' })).toHaveCount(1);
    await expect(events.filter({ hasText: 'Imported' })).toHaveCount(2);
    await noSeriousA11y(page);
  });

  test('PW-OI-02 plan a purchase: best card, what to activate, evidence, and save it', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold');
    const wallet = await (await request.get('/api/v1/wallet/cards', { headers: { Authorization: `Bearer ${u.token}` } })).json();
    await request.post('/api/v1/offers/intel/import', { headers: { Authorization: `Bearer ${u.token}` }, data: { walletCardId: wallet[0].id, text: OFFERS } });
    await uiLogin(page, u.email);
    await page.goto('/offers/plan');
    await page.locator('#pp-merchant').fill('Hilton Hotels');
    await page.locator('#pp-amount').fill('600');
    await page.getByTestId('plan-go').click();
    const plans = page.getByTestId('plans');
    await expect(plans).toBeVisible();
    const best = page.getByTestId('plan').first();
    await expect(best).toContainText('Best');
    await expect(best).toContainText('Confidence');
    await expect(page.getByTestId('plan-actions')).toContainText('Activate "Hilton');
    await best.getByText(/Evidence \(/).click();
    await expect(page.getByTestId('plan-evidence')).toContainText('card earn');
    await expect(page.getByTestId('plan-evidence')).toContainText('offer');
    await noSeriousA11y(page);

    await page.getByTestId('plan-save').click();
    await expect(page.getByTestId('planned-list')).toContainText('Hilton');
    await page.getByTestId('planned-list').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByTestId('planned-list')).toHaveCount(0);
  });

  test('PW-OI-03 pages are reachable from the menu and empty states explain what to do', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.getByRole('link', { name: 'Offer Intelligence' }).first().click();
    await expect(page.getByTestId('offer-intel')).toBeVisible();
    await expect(page.getByText('No open offers')).toBeVisible();
    await page.getByRole('link', { name: 'Plan a Purchase' }).first().click();
    await expect(page.getByTestId('plan-purchase')).toBeVisible();
  });
});

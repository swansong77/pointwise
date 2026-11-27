import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** AI Mode phase 2: what-if, goals and memory (synthetic data; no cloud model). */
const API = process.env.API_URL ?? 'http://backend:4000';
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  // a colour measured mid-fade (a button leaving its disabled state) is not what the person sees once it settles
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))).toEqual([]);
};
async function household(request: import('@playwright/test').APIRequestContext) {
  const u = await apiRegister(request);
  const card = await apiAddCard(request, u.token, 'contoso-gold');
  await request.post(`${API}/api/v1/offers/intel/import`, { headers: { Authorization: `Bearer ${u.token}` }, data: { walletCardId: card.id, text: `Hilton: Spend $500, get $100 back, expires ${us(3)}` } });
  return u;
}

test.describe('AI Mode: what-if, goals, memory', () => {
  test('PW-COP-04 what-if comparisons: a labelled before/after table with assumptions and risks', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/copilot');
    await page.getByTestId('whatif-examples').getByRole('button', { name: 'What if I wait 3 months?' }).click();
    const view = page.getByTestId('whatif-view');
    await expect(view).toBeVisible();
    await expect(page.getByTestId('plan-headline')).toContainText('wait 3 months');
    await expect(view.getByRole('table')).toBeVisible();
    await expect(view.getByRole('columnheader', { name: 'Change' })).toBeVisible();
    await expect(page.getByTestId('plan-assumptions')).toBeVisible();
    await noSeriousA11y(page);

    await page.locator('#cp-q').fill('What if I cancel Contoso Gold?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByTestId('plan-headline')).toContainText('cancel Contoso Gold');
    await expect(page.getByTestId('whatif-view')).toContainText('does not remove it');
    await expect(page.getByTestId('whatif-view')).toContainText('retention offer');

    await page.locator('#cp-q').fill('What if I cancel it?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByTestId('plan-summary')).toContainText('which card');
    await expect(page.getByTestId('whatif-view')).toHaveCount(0);
  });

  test('PW-COP-05 what-if from the search bar in AI Mode', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const sw = page.getByRole('switch', { name: 'AI Mode' });
    await expect(sw).toBeEnabled();
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    const box = page.getByRole('combobox');
    await box.fill('What if I wait 2 weeks?');
    await box.press('Enter');
    await expect(page.getByTestId('whatif-view')).toBeVisible();
    await expect(page.getByTestId('plan-headline')).toContainText('wait 14 days');
  });

  test('PW-COP-06 goals: add, see progress computed from your data, finish, delete', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/copilot');
    const panel = page.getByTestId('goals-panel');
    await expect(panel.getByTestId('goals-empty')).toBeVisible();

    await panel.getByLabel('Goal type').selectOption('FEES');
    await panel.getByLabel('Name it').fill('No annual fees');
    await panel.getByLabel('Annual fees at most ($)').fill('0');
    await panel.getByRole('button', { name: 'Add goal' }).click();
    const fees = panel.getByTestId('goal').filter({ hasText: 'No annual fees' });
    await expect(fees).toContainText('Behind');
    await expect(fees.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /\d+/);

    await panel.getByLabel('Goal type').selectOption('FIVE24');
    await panel.getByLabel('Name it').fill('Stay under 5/24');
    await panel.getByRole('button', { name: 'Add goal' }).click();
    await expect(panel.getByTestId('goal').filter({ hasText: 'Stay under 5/24' })).toContainText('On track');

    await panel.getByLabel('Goal type').selectOption('CUSTOM');
    await panel.getByLabel('Name it').fill('Plan the Disney trip');
    await panel.getByRole('button', { name: 'Add goal' }).click();
    await expect(panel.getByTestId('goal')).toHaveCount(3);
    await noSeriousA11y(page);

    // a goal that is behind shows up in the plan
    await page.getByTestId('copilot-quick').getByRole('button', { name: 'This month' }).click();
    await expect(page.getByTestId('plan-view')).toContainText('Goal: No annual fees');

    page.on('dialog', (d) => d.accept());
    await panel.getByRole('button', { name: 'Mark done: Plan the Disney trip' }).click();
    await expect(panel.getByTestId('goal')).toHaveCount(2);
    await panel.getByRole('button', { name: 'Delete goal: No annual fees' }).click();
    await expect(panel.getByTestId('goal')).toHaveCount(1);
  });

  test('PW-COP-07 memory: snooze an item and it stays out of the plan until you show it again; preferences persist', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/copilot');
    await page.getByTestId('copilot-quick').getByRole('button', { name: 'This month' }).click();
    const hilton = page.getByTestId('plan-item').filter({ hasText: 'Hilton' }).first();
    await expect(hilton).toBeVisible();
    await hilton.getByRole('button', { name: 'Snooze 7 days' }).click();
    await expect(hilton.getByTestId('decision-result')).toContainText('Snoozed for 7 days');

    await page.getByTestId('copilot-quick').getByRole('button', { name: 'This month' }).click();
    await expect(page.getByTestId('plan-hidden')).toContainText('you put aside');
    await expect(page.getByTestId('plan-item').filter({ hasText: /Hilton.*ends/ })).toHaveCount(0);

    const mem = page.getByTestId('memory-panel');
    await expect(mem.getByTestId('memory-decisions')).toContainText('offer-exp');
    await mem.getByRole('button', { name: /^Show again/ }).first().click();
    await expect(mem.getByTestId('memory-decisions')).toContainText('Nothing');
    await page.getByTestId('copilot-quick').getByRole('button', { name: 'This month' }).click();
    await expect(page.getByTestId('plan-item').filter({ hasText: 'Hilton' }).first()).toBeVisible();

    await mem.getByLabel('Airlines you prefer').fill('Delta, United');
    await mem.getByLabel('Hotels you prefer').fill('Hyatt');
    await mem.getByTestId('priority-TRAVEL').click();
    await expect(mem.getByTestId('priority-TRAVEL')).toBeChecked();
    const saved = page.waitForResponse((r) => r.url().includes('/copilot/memory/preferences') && r.request().method() === 'PUT' && r.ok());
    await mem.getByRole('button', { name: 'Save preferences' }).click();
    await saved;
    await page.reload();
    await expect(page.getByTestId('memory-panel').getByLabel('Airlines you prefer')).toHaveValue('Delta, United');
    await expect(page.getByTestId('memory-panel').getByLabel('Hotels you prefer')).toHaveValue('Hyatt');
    await expect(page.getByTestId('memory-panel').getByTestId('priority-TRAVEL')).toBeChecked();
    await noSeriousA11y(page);
  });
});

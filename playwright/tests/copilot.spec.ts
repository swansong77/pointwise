import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** AI Mode (Copilot): plan, toggle, settings and consent (synthetic data; the offline demo model only). */
const API = process.env.API_URL ?? 'http://backend:4000';
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))).toEqual([]);
};

async function household(request: import('@playwright/test').APIRequestContext) {
  const u = await apiRegister(request);
  const card = await apiAddCard(request, u.token, 'contoso-gold');
  await request.post(`${API}/api/v1/offers/intel/import`, { headers: { Authorization: `Bearer ${u.token}` }, data: { walletCardId: card.id, text: `Hilton: Spend $500, get $100 back, expires ${us(3)}` } });
  return u;
}

test.describe('AI Mode', () => {
  test('PW-COP-01 turn on AI Mode in the search bar and ask what to do today: a plan with reasons, evidence and confidence', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const sw = page.getByRole('switch', { name: 'AI Mode' });
    await expect(sw).toBeEnabled();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: 'What should I do this month?' }).click();
    await expect(page.getByTestId('plan-view')).toBeVisible();
    await expect(page.getByTestId('plan-headline')).toContainText(/thing/);
    await expect(page.getByTestId('plan-view')).toContainText('Hilton');
    await expect(page.getByTestId('plan-view')).toContainText(/Confidence (High|Medium|Low)/);
    await page.getByTestId('plan-item').first().getByText('Why, evidence and risks').click();
    await expect(page.getByTestId('plan-item').first()).toContainText('Why:');
    await expect(page.getByTestId('plan-specialists')).toContainText('Specialists consulted');
    await noSeriousA11y(page);

    // a reminder from the plan
    const remind = page.getByTestId('plan-item').getByRole('button', { name: /^Remind me/ }).first();
    await remind.click();
    await expect(page.getByTestId('call-result').first()).toContainText('Reminder set');

    // the setting is remembered; turn it off and the standard engines answer again
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('switch', { name: 'AI Mode' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('switch', { name: 'AI Mode' }).click();
    const box = page.getByRole('combobox');
    await box.fill('How many points do I have?');
    await box.press('Enter');
    await expect(page.getByTestId('search-answer')).toBeVisible();
    await expect(page.getByTestId('plan-view')).toHaveCount(0);
  });

  test('PW-COP-02 the Copilot page: quick plans, a specific question and a mode', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.getByRole('link', { name: 'Copilot', exact: true }).click();
    await expect(page.getByTestId('copilot-page')).toBeVisible();
    await page.getByTestId('copilot-quick').getByRole('button', { name: 'This month' }).click();
    await expect(page.getByTestId('plan-view')).toContainText('Hilton');
    await page.getByLabel('Mode').selectOption('CARD_STRATEGY');
    await page.locator('#cp-q').fill('What should I do?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByTestId('plan-specialists')).toContainText('Card Strategy');
    await page.getByLabel('Mode').selectOption('');
    await page.locator('#cp-q').fill('What card should I use at Costco for $1,500?');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(page.getByTestId('plan-summary')).toContainText('Best:');
    await noSeriousA11y(page);
  });

  test('PW-COP-03 cloud sharing is off by default, needs its own consent, and shows what was sent', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/settings');
    const panel = page.getByTestId('copilot-settings');
    await expect(panel).toBeVisible();
    const consent = page.getByTestId('copilot-cloud-consent');
    const firstProvider = page.locator('[data-testid^="copilot-provider-"]').first();
    await expect(consent).not.toBeChecked();
    await expect(firstProvider).toBeDisabled();
    await expect(panel).toContainText('never sees names, e-mail addresses, card numbers');
    await expect(page.getByTestId('copilot-disclosures')).toContainText('Nothing yet');
    await consent.click();
    await expect(consent).toBeChecked();
    await expect(firstProvider).toBeEnabled();
    await consent.click();
    await expect(consent).not.toBeChecked();
    await expect(firstProvider).toBeDisabled();

    await page.getByTestId('copilot-enabled').click();
    await expect(page.getByTestId('copilot-enabled')).toBeChecked();
    await page.getByLabel('Default mode').selectOption('PLANNING');
    const saved = page.waitForResponse((r) => r.url().includes('/copilot/settings') && r.request().method() === 'PUT' && r.ok());
    await page.getByLabel('Response style').selectOption('CONCISE');
    await saved;
    await page.reload();
    await expect(page.getByTestId('copilot-enabled')).toBeChecked();
    await expect(page.getByLabel('Default mode')).toHaveValue('PLANNING');
    await expect(page.getByLabel('Response style')).toHaveValue('CONCISE');
    await noSeriousA11y(page);
  });
});

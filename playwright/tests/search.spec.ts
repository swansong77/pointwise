import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** The universal search bar: Ctrl/Cmd+K, suggestions as you type, plain-language answers, follow-ups, accessibility (synthetic data). */
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const API = process.env.API_URL ?? 'http://backend:4000';

const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))).toEqual([]);
};

async function setup(request: import('@playwright/test').APIRequestContext) {
  const u = await apiRegister(request);
  const card = await apiAddCard(request, u.token, 'contoso-gold');
  await request.post(API + '/api/v1/offers/intel/import', { headers: { Authorization: 'Bearer ' + u.token }, data: { walletCardId: card.id, text: 'Hilton: Spend $500, get $100 back, expires ' + us(10) } });
  return u;
}

test.describe('Universal search', () => {
  test('PW-SRCH-01 Ctrl+K opens it on any page, focuses the box, and Escape closes and returns focus', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.goto('/wallet');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Search and ask PointWise' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Search or ask a question' })).toBeFocused();
    await expect(page.getByTestId('command-list')).toContainText('What card should I use at Costco');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.keyboard.press('Control+k');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Control+k'); // the same shortcut toggles it
    await expect(dialog).toBeHidden();
    await page.getByTestId('search-trigger').click();
    await expect(dialog).toBeVisible();
  });

  test('PW-SRCH-02 suggestions as you type, and Enter opens a result', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox');
    await box.fill('hilton');
    const list = page.getByTestId('command-list');
    await expect(list).toContainText('Hilton');
    await expect(list.getByRole('option').filter({ hasText: 'Offer' }).first()).toBeVisible();
    const settled = page.waitForResponse((r) => r.url().includes('/search/suggest?q=expir'));
    await box.fill('expir'); // a page, by the start of its name
    await settled;
    await expect(list.getByRole('option').filter({ hasText: 'Expirations' })).toBeVisible();
    await box.press('ArrowDown');
    await box.press('ArrowDown');
    await box.press('Enter');
    await expect(page).toHaveURL(/\/offers\/expirations/);
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('PW-SRCH-03 plain-language questions get answers with reasoning, confidence and related items', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox');

    await box.fill('What card should I use at Costco for $1,500?');
    await box.press('Enter');
    await expect(page.getByTestId('search-summary')).toContainText('Best:');
    await expect(page.getByText(/Confidence (High|Medium)/)).toBeVisible();
    await expect(page.getByTestId('search-reasoning')).toBeVisible();
    await expect(page.getByTestId('search-related')).toContainText('Contoso Gold');
    await expect(page.getByTestId('search-actions').getByRole('link', { name: 'Open the purchase planner' })).toBeVisible();
    await noSeriousA11y(page);

    await box.fill('Show all Hilton offers');
    await box.press('Enter');
    await expect(page.getByTestId('search-related')).toContainText('Hilton');

    await box.fill('How many points do I have?');
    await box.press('Enter');
    await expect(page.getByTestId('search-answer')).toContainText('Your points and miles');

    await box.fill('What is my current 5/24 status?');
    await box.press('Enter');
    await expect(page.getByTestId('search-summary')).toContainText('5/24');
  });

  test('PW-SRCH-04 a follow-up keeps the context, and an answer opens the page behind it', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox');
    await box.fill('Hilton Chicago 3 nights');
    await box.press('Enter');
    await expect(page.getByTestId('search-warnings')).toContainText('amount');
    await page.getByTestId('search-followups').getByRole('button', { name: 'Hilton $1,200' }).click();
    await expect(page.getByTestId('search-summary')).toContainText('Best:');
    await box.fill('It will cost $2,000');
    await box.press('Enter');
    await expect(page.getByTestId('search-answer')).toContainText('$2,000');
    await page.getByTestId('search-related').getByRole('link').first().click();
    await expect(page).toHaveURL(/\/wallet\//);
  });

  test('PW-SRCH-05 a question it cannot read is not guessed, and the assistant is offered', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.getByTestId('search-trigger').click();
    const box = page.getByRole('combobox');
    await box.fill('purple monkey');
    await box.press('Enter');
    await expect(page.getByTestId('search-summary')).toContainText('could not tell');
    await expect(page.getByText(/Confidence/)).toHaveCount(0);
    await page.getByRole('link', { name: 'Ask the assistant' }).click();
    await expect(page).toHaveURL(/\/assistant\?q=purple%20monkey/);
  });

  test('PW-SRCH-06 the open dialog passes axe and keeps Tab inside', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('hil');
    await expect(page.getByTestId('command-list')).toBeVisible();
    await noSeriousA11y(page);
    for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => !!document.activeElement?.closest('[role=dialog]'));
    expect(inside).toBe(true);
  });
});

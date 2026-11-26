import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { ADMIN, apiLogin, apiRegister, uiLogin } from './helpers';

/** Phase D (next-card scorer, travel) and Phase E (streamed assistant, operations page). */
const FAMILY = { email: 'family@pointwise.local', password: 'Family12345!' };

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
}

test.describe('Next card', () => {
  test('PW-NC-01 household pick, ranked cards per member and 5/24 blockers', async ({ page }) => {
    await uiLogin(page, FAMILY.email, FAMILY.password);
    await page.goto('/next-card');
    await expect(page.getByTestId('nc-pick')).toContainText(/first-year value ~\$[\d,]+/);
    await expect(page.getByTestId('nc-household')).toContainText('Sam');
    const ranked = page.getByTestId('nc-ranked');
    await expect(ranked).toContainText('Jordan is 5/24');
    await expect(ranked.getByTestId('nc-card').filter({ hasText: 'Northwind ShopNow Card' })).toContainText('Northwind Bank usually denies applicants at 5/24');
    await page.getByTestId('nc-member').selectOption({ label: 'Riley' });
    await expect(ranked).toContainText('Riley is 3/24');
    const first = ranked.getByTestId('nc-card').first();
    await expect(first.getByTestId('nc-first-year')).toHaveText(/^-?\$[\d,]+$/);
    await expect(first).toContainText(/confidence/);
    await noSeriousA11y(page);
  });

  test('PW-NC-02 saving a spend profile switches the source from "typical household"', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/next-card');
    await expect(page.getByTestId('nc-spend')).toContainText('a typical household');
    await page.getByLabel('Dining').fill('800');
    await page.getByLabel('Groceries').fill('900');
    await page.getByTestId('nc-spend-save').click();
    await expect(page.getByTestId('nc-spend')).toContainText('Saved — rankings updated.');
    await expect(page.getByTestId('nc-spend')).toContainText('your spend profile');
    await expect(page.getByTestId('nc-ranked')).toContainText('Spend from your spend profile: $3,530/month'); // the editor starts from the typical-household estimate
  });
});

test.describe('Travel', () => {
  test('PW-TR-01 balances, best transfers and an award plan (family)', async ({ page }) => {
    await uiLogin(page, FAMILY.email, FAMILY.password);
    await page.goto('/travel');
    await expect(page.getByTestId('travel-balance')).toHaveCount(5);
    const advice = page.getByTestId('travel-advice');
    await expect(advice).toContainText('AeroLink Rewards');
    await expect(advice).toContainText('30 % transfer bonus');
    const planner = page.getByTestId('travel-planner');
    await planner.getByLabel('Program').selectOption({ label: 'SkyHigh Airlines Miles' });
    await planner.getByLabel('Award price (points)').fill('60k');
    await planner.getByRole('button', { name: 'Plan it' }).click();
    const plan = page.getByTestId('travel-plan');
    await expect(plan).toContainText('Use 12,500 SKYHIGH from Jordan');
    await expect(plan).toContainText('Transfers are one-way');
    await expect(page.getByTestId('travel-partners')).toContainText('Contoso Points');
    await noSeriousA11y(page);
  });

  test('PW-TR-02 add and remove a balance', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/travel');
    await expect(page.getByTestId('travel-balances')).toContainText('No balances yet');
    const form = page.getByTestId('travel-balance-form');
    await form.getByLabel('Member').selectOption({ index: 1 });
    await form.getByLabel('Points or miles').selectOption({ label: 'Contoso Points' });
    await form.getByLabel('Balance').fill('25,000');
    await form.getByRole('button', { name: 'Save balance' }).click();
    await expect(page.getByTestId('travel-balance')).toHaveCount(1);
    await expect(page.getByTestId('travel-balance')).toContainText('25,000');
    await expect(page.getByTestId('travel-advice')).toContainText('Best use: AeroLink Rewards');
    await page.getByRole('button', { name: /Remove .*Contoso Points/ }).click();
    await expect(page.getByTestId('travel-balance')).toHaveCount(0);
  });
});

test.describe('Credit band and fine print', () => {
  test('PW-NC-03 setting a credit band shows approval odds on premium cards', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/next-card');
    const reserve = page.getByTestId('nc-card').filter({ hasText: 'Northwind Voyager Reserve' });
    await expect(reserve).not.toContainText('Approval unlikely');
    await page.getByTestId('nc-credit').getByRole('combobox').selectOption('FAIR');
    await expect(reserve).toContainText('Approval unlikely');
    await expect(reserve).toContainText('is below what Northwind Voyager Reserve usually needs (excellent)');
    await noSeriousA11y(page);
  });

  test('PW-TR-03 fine-print search highlights matching card terms', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/travel');
    const box = page.getByTestId('terms-search');
    await box.getByLabel('Search card terms').fill('lounge access');
    await box.getByRole('button', { name: 'Search' }).click();
    const results = page.getByTestId('terms-results');
    await expect(results).toContainText('Northwind Voyager Reserve');
    await expect(results.locator('mark').first()).toHaveText(/lounge/i);
    await noSeriousA11y(page);
  });
});

test.describe('Streaming assistant and operations', () => {
  test('PW-AI-07 the assistant streams its answer (SSE)', async ({ page, request }) => {
    const token = await apiLogin(request, FAMILY.email, FAMILY.password);
    await request.put('/api/v1/ai/settings', { headers: { Authorization: `Bearer ${token}` }, data: { consent: true } });
    await uiLogin(page, FAMILY.email, FAMILY.password);
    await page.goto('/assistant');
    const streamed = page.waitForResponse((r) => r.url().endsWith('/api/v1/ai/chat/stream') && r.status() === 200);
    await page.getByLabel('Your question').fill('Who should apply for Northwind ShopNow Card?');
    await page.getByRole('button', { name: 'Ask' }).click();
    const res = await streamed;
    expect(res.headers()['content-type']).toContain('text/event-stream');
    const answer = page.getByTestId('ai-answer').last();
    await expect(answer).toContainText('Riley should apply for Northwind ShopNow Card');
    await expect(answer).toContainText('your data was not shared with the AI');
  });

  test('PW-OPS-01 operations page shows health, jobs, AI models and events', async ({ page }) => {
    await uiLogin(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin/ops');
    await expect(page.getByTestId('ops-status')).toContainText(/All systems normal|Degraded/);
    await expect(page.getByTestId('ops-tiles')).toContainText('Database');
    await expect(page.getByTestId('ops-jobs')).toContainText('refresh-card-sources');
    await expect(page.getByTestId('ops-ai')).toContainText(/Healthy|Circuit open/);
    await expect(page.getByTestId('ops-logs')).toBeVisible();
    await noSeriousA11y(page);
  });

  test('PW-OPS-02 non-admins cannot open the operations page or API', async ({ page, request }) => {
    const u = await apiRegister(request);
    expect((await request.get('/api/v1/admin/ops/health', { headers: { Authorization: `Bearer ${u.token}` } })).status()).toBe(403);
    await uiLogin(page, u.email);
    await page.goto('/admin/ops');
    await expect(page).not.toHaveURL(/\/admin\/ops$/);
  });
});

import AxeBuilder from '@axe-core/playwright';
import { APIRequestContext, expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/**
 * Merchant offer automation against the mock issuer (synthetic data; no real issuer is contacted): accounts, Sync Now
 * with live progress, the offer inbox with scores and reasons, adding offers, rules and enrollment mode.
 */
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
};

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

async function setup(request: APIRequestContext) {
  const u = await apiRegister(request);
  const wc = await apiAddCard(request, u.token, 'contoso-gold');
  const issuers = (await (await request.get('/api/v1/issuers')).json()) as Array<{ id: string; name: string }>;
  const card = await (await request.get('/api/v1/cards/contoso-gold')).json();
  const issuerId = issuers[0].id;
  void card;
  const acct = await request.post('/api/v1/offer-automation/accounts', {
    headers: auth(u.token),
    data: { issuerId, holderLabel: 'Alex Gold', connectorKind: 'MOCK', username: `pw${Date.now()}`, password: 'e2e-mock-password', automationOptIn: true, ackTermsRisk: true, walletCardIds: [wc.id] },
  });
  expect(acct.status(), await acct.text()).toBe(201);
  return { ...u, walletCardId: wc.id as string, issuerId, accountId: (await acct.json()).id as string };
}

test.describe('Offer automation', () => {
  test('PW-OA-01 Sync Now finds the offers, shows progress, scores each one and explains why', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.getByRole('link', { name: 'Offer Automation' }).first().click();
    await expect(page.getByRole('heading', { name: 'Offer Automation', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Sync Dashboard' }).click();
    await page.getByTestId('sync-now').click();
    const progress = page.getByTestId('sync-progress');
    await expect(progress).toContainText('Finished', { timeout: 20_000 });
    await expect(progress).toContainText('3 offer(s) found');
    await expect(progress).toContainText('3 added');
    await expect(page.getByTestId('run-row').first()).toContainText('Done');
    await expect(page.getByTestId('sync-account').first()).toContainText('Healthy');
    await expect(page.getByTestId('sync-account').first().getByTestId('brand-logo')).toBeVisible();
    await noSeriousA11y(page);

    await page.getByRole('button', { name: 'Offer Inbox' }).click();
    const items = page.getByTestId('inbox-item');
    await expect(items).toHaveCount(3);
    const hilton = items.filter({ hasText: 'Hilton' });
    await expect(hilton).toContainText('Recommended');
    await expect(hilton.getByTestId('brand-logo').first()).toBeVisible();
    await expect(hilton.getByTestId('card-art')).toBeVisible();
    await hilton.getByRole('button', { name: 'Why This Score?' }).click();
    await expect(hilton.getByTestId('score-detail')).toContainText('Offer value');
    await expect(hilton.getByTestId('score-detail')).toContainText('Should Add');
    await expect(items.filter({ hasText: 'Corner Coffee' })).toContainText('Ignored');
    await noSeriousA11y(page);
  });

  test('PW-OA-02 add a recommended offer from the inbox and see it as enrolled, with history', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.goto('/offers/automation');
    await page.getByRole('button', { name: 'Sync Dashboard' }).click();
    await page.getByTestId('sync-now').click();
    await expect(page.getByTestId('sync-progress')).toContainText('Finished', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Offer Inbox' }).click();
    await page.getByLabel(/Select Hilton/).check();
    await page.getByTestId('add-selected').click();
    await expect(page.getByTestId('approve-result')).toContainText('SUCCESS');
    await page.getByTestId('inbox-tab-enrolled').click();
    await expect(page.getByTestId('inbox-item')).toHaveCount(1);
    await expect(page.getByTestId('inbox-item').first()).toContainText('Hilton');
    await expect(page.getByTestId('inbox-item').first()).toContainText('Enrolled');
    await page.getByRole('button', { name: 'Offer History' }).click();
    const rows = page.getByTestId('history-row');
    await expect(rows.filter({ hasText: 'Discovered' }).first()).toBeVisible();
    await expect(rows.filter({ hasText: 'Enrolled' }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Savings Dashboard' }).click();
    await expect(page.getByTestId('savings')).toContainText('Enrolled and Waiting');
    await expect(page.getByTestId('savings')).toContainText('$250');
  });

  test('PW-OA-03 rules and automatic mode add the right offers and respect a never-rule', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.goto('/offers/automation');
    await page.getByRole('button', { name: 'Rules & Mode' }).click();
    await page.getByRole('button', { name: '+ Never Add Gambling Offers' }).click();
    await expect(page.getByTestId('rule').filter({ hasText: 'Never add gambling offers' })).toBeVisible();
    await page.getByTestId('mode-AUTO').check();
    await page.locator('#af-cat').fill('travel');
    await page.getByTestId('save-policy').click();
    await expect.poll(async () => (await (await request.get('/api/v1/offer-automation/policy', { headers: auth(u.token) })).json()).mode).toBe('AUTO');
    await noSeriousA11y(page);

    await page.getByRole('button', { name: 'Sync Dashboard' }).click();
    await page.getByTestId('sync-now').click();
    await expect(page.getByTestId('sync-progress')).toContainText('Finished', { timeout: 20_000 });
    await page.getByRole('button', { name: 'Offer Inbox' }).click();
    await page.getByTestId('inbox-tab-auto').click();
    await expect(page.getByTestId('inbox-item')).toHaveCount(1);
    await expect(page.getByTestId('inbox-item').first()).toContainText('Hilton');
    await expect(page.getByTestId('inbox-item').first()).toContainText('Auto-Enrolled');
    await page.getByTestId('inbox-tab-all').click();
    await expect(page.getByTestId('inbox-item').filter({ hasText: 'DraftKings' })).toContainText('Ignored');
  });

  test('PW-OA-04 accounts: the risk note, the acknowledgement, and an extension token shown once', async ({ page, request }) => {
    const u = await setup(request);
    await uiLogin(page, u.email);
    await page.goto('/offers/automation');
    await page.getByRole('button', { name: 'Accounts' }).click();
    const acct = page.getByTestId('account').first();
    await expect(acct).toContainText('Alex Gold');
    await expect(acct).toContainText('Healthy');
    await expect(acct).not.toContainText('e2e-mock-password');
    await page.getByRole('button', { name: 'Add Account' }).click();
    await page.locator('#oa-kind').selectOption('ISSUER_LOGIN');
    await expect(page.getByTestId('risk-note')).toContainText('may lock the account');
    await expect(page.getByTestId('risk-note')).toContainText('never been tested against the real sites');
    await page.locator('#oa-issuer').selectOption({ index: 1 });
    await page.locator('#oa-holder').fill('Chase login');
    await page.locator('#oa-user').fill('someone');
    await page.locator('#oa-pass').fill('a-password-1');
    await page.getByTestId('add-account').click();
    await expect(page.getByRole('alert').or(page.getByText(/no connector|terms-risk/i)).first()).toBeVisible();
    await page.getByTestId('new-token').click();
    await expect(page.getByTestId('token-once')).toContainText('pw_pat_');
    await noSeriousA11y(page);
  });
});

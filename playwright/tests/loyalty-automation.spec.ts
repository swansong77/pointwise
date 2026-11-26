import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiRegister, uiLogin } from './helpers';

/** Loyalty automation UI: refresh health, imports, email tester, extension token (synthetic data). */
const H = (t: string) => ({ Authorization: `Bearer ${t}` });
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
};

test.describe('Loyalty automation', () => {
  test('LA-01 refresh health shows source, confidence, freshness and the household health score', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/loyalty');
    const members = await (await request.get('/api/v1/household/members', { headers: H(u.token) })).json();
    await request.post('/api/v1/loyalty/accounts', { headers: H(u.token), data: { profileId: members[0].id, customName: 'Auto Miles', customKind: 'AIRLINE', balance: 50_000 } });
    await page.reload();
    await expect(page.getByTestId('health-score')).toBeVisible();
    await page.getByTestId('tab-refresh').click();
    const row = page.getByTestId('refresh-account').filter({ hasText: 'Auto Miles' });
    await expect(row).toContainText('Manual entry · 25');
    await expect(row).toContainText('Confidence');
    await expect(page.getByTestId('refresh-summary')).toContainText('Fresh');
    await expect(page.getByTestId('audit')).toContainText('What loyalty assets are expiring next?');
    await expect(page.getByTestId('health-programs')).toBeVisible();
    await noSeriousA11y(page);
    await page.getByTestId('tab-miles').click();
    await expect(page.getByTestId('miles-tab')).toContainText('Auto Miles');
  });

  test('LA-02 email tester previews what would be read, without saving; unknown senders say so', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/loyalty');
    await page.getByTestId('tab-imports').click();
    await expect(page.getByTestId('no-conflicts')).toBeVisible();
    await page.locator('#es-from').fill('e.marriott.com');
    await page.locator('#es-text').fill('Your current points balance is 85,400. Your Platinum Elite status is valid through February 28, 2027.');
    await page.getByTestId('preview-email').click();
    const out = page.getByTestId('email-result');
    await expect(out).toContainText('Marriott Bonvoy');
    await expect(out).toContainText('Balance: 85,400');
    await expect(out).toContainText('Status: Platinum Elite');
    await page.locator('#es-from').fill('example.org');
    await page.getByTestId('preview-email').click();
    await expect(out).toContainText('Unknown sender');
    await noSeriousA11y(page);
  });

  test('LA-03 extension token: shown once, listed, revoked', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/loyalty');
    await page.getByTestId('tab-imports').click();
    await page.getByTestId('create-token').click();
    await expect(page.getByTestId('new-token')).toContainText('pw_pat_');
    const item = page.getByTestId('token-list').locator('li').first();
    await expect(item).toContainText('My browser');
    await expect(item).toContainText('never used');
    await item.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByTestId('token-list').locator('li')).toHaveCount(0);
  });
});

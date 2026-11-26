import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, apiRegister, uiLogin } from './helpers';

/** Phase C: admin-reviewed card data refresh and offer history. */
const PAGE_TEXT = 'Everyday rewards card. No annual fee. Earn a $200 cash bonus after spending $500 within the first three months. Offer expires on March 1, 2027. No annual fee for authorized users.';

test.describe('Card data (admin)', () => {
  test('PW-CD-01 pasted page text becomes proposals; approval updates the card; history is shown', async ({ page }) => {
    await uiLogin(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin/catalog');
    await page.getByRole('button', { name: 'Sources' }).click();
    const add = page.getByTestId('add-source');
    await add.getByLabel('Card').selectOption({ label: 'Fabrikam Flex' });
    await add.getByLabel(/paste the page text/).fill(PAGE_TEXT);
    await add.getByRole('button', { name: 'Extract changes' }).click();
    await expect(add.getByRole('status')).toContainText('changes proposed for review');
    await page.getByRole('button', { name: 'Review changes' }).click();
    const exp = page.getByTestId('proposal').filter({ hasText: 'Fabrikam Flex' }).filter({ hasText: 'Offer expires' }).first();
    await expect(exp).toContainText('2027-03-01');
    await expect(exp).toContainText('Offer expires on March 1, 2027');
    await exp.getByLabel(/Corrected value/).fill('2027-03-31');
    await exp.getByRole('button', { name: 'Approve with correction' }).click();
    await expect(page.getByTestId('proposal').filter({ hasText: 'Fabrikam Flex' }).filter({ hasText: 'Offer expires' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Welcome offers' }).click();
    await page.getByTestId('welcome-offers').getByRole('button', { name: /Contoso Gold/ }).click();
    await expect(page.getByTestId('offer-timeline')).toContainText('40K → 50K →');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  test('PW-CR-01 research tab: needs a Claude model in the offline stack, lists runs, accessible; API is admin-only', async ({ page, request }) => {
    await uiLogin(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin/catalog');
    await page.getByRole('button', { name: 'Research' }).click();
    const start = page.getByTestId('research-start');
    await expect(start.getByRole('status')).toContainText('needs a Claude model');
    await expect(start.getByRole('button', { name: 'Start research' })).toBeDisabled();
    await start.getByLabel('Task').selectOption('VERIFY');
    await expect(start.getByLabel('Card', { exact: true })).toBeVisible();
    await expect(page.getByTestId('research-runs')).toBeVisible();
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    const u = await apiRegister(request);
    expect((await request.post('/api/v1/admin/card-research', { headers: { Authorization: `Bearer ${u.token}` }, data: { kind: 'DISCOVER', issuer: 'Chase' } })).status()).toBe(403);
  });

  test('PW-CD-02 non-admins cannot open the card data page or its API', async ({ page, request }) => {
    const u = await apiRegister(request);
    const res = await request.get('/api/v1/admin/card-proposals', { headers: { Authorization: `Bearer ${u.token}` } });
    expect(res.status()).toBe(403);
    await uiLogin(page, u.email);
    await page.goto('/admin/catalog');
    await expect(page).not.toHaveURL(/\/admin\/catalog$/);
  });
});

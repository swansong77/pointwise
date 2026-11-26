import AxeBuilder from '@axe-core/playwright';
import { APIRequestContext, expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Portfolio revision: 5/24, portfolio, benefits, household, import. */
const FAMILY = { email: 'family@pointwise.local', password: 'Family12345!' };

async function proUser(request: APIRequestContext) {
  const u = await apiRegister(request);
  const res = await request.post('/api/v1/subscription/checkout', { headers: { Authorization: `Bearer ${u.token}` }, data: { interval: 'month' } });
  expect(res.status()).toBe(201);
  return u;
}

test.describe('Portfolio & benefits', () => {
  test('PW-524-01 5/24 per household member with gauge, next slot and reasons', async ({ page }) => {
    await uiLogin(page, FAMILY.email, FAMILY.password);
    await page.goto('/five24');
    const members = page.getByTestId('five24-member');
    await expect(members).toHaveCount(3);
    await expect(members.filter({ hasText: 'Jordan' }).getByRole('img', { name: '5/24 status 5/24' })).toBeVisible();
    await expect(members.filter({ hasText: 'Jordan' }).getByText('At or over 5/24')).toBeVisible();
    await expect(members.filter({ hasText: 'Jordan' }).getByTestId('next-slot')).not.toHaveText('—');
    await expect(members.filter({ hasText: 'Jordan' }).getByText('Business card reported to personal bureaus')).toBeVisible();
    await expect(members.filter({ hasText: 'Riley' }).getByRole('img', { name: '5/24 status 3/24' })).toBeVisible();
    await expect(members.filter({ hasText: 'Sam' }).getByRole('img', { name: '5/24 status 1/24' })).toBeVisible();
  });

  test('PW-PORT-01 portfolio groups and value analytics', async ({ page }) => {
    await uiLogin(page, FAMILY.email, FAMILY.password);
    await page.goto('/portfolio');
    await expect(page.getByTestId('portfolio-totals')).toContainText('Annual fees');
    await expect(page.getByRole('button', { name: 'Active (7)' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('portfolio-row')).toHaveCount(7);
    await page.getByRole('button', { name: 'Authorized user (2)' }).click();
    await expect(page.getByTestId('portfolio-row')).toHaveCount(2);
    await page.getByRole('button', { name: 'Closed (1)' }).click();
    await expect(page.getByTestId('portfolio-row')).toContainText('Fabrikam Flex');
    // filter to one cardholder
    await page.getByLabel('Cardholder').selectOption({ label: 'Sam (Child)' });
    await page.getByRole('button', { name: /Authorized user/ }).click();
    await expect(page.getByTestId('portfolio-row')).toHaveCount(1);
  });

  test('PW-BEN-01 log benefit usage and see remaining value update', async ({ page, request }) => {
    const u = await proUser(request);
    await apiAddCard(request, u.token, 'northwind-voyager-reserve', new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10));
    await uiLogin(page, u.email);
    await page.goto('/benefits');
    const row = page.getByTestId('benefit-row').filter({ hasText: 'Annual travel credit' });
    await expect(row).toContainText('$0 of $300 used');
    await row.getByRole('button', { name: 'Log use' }).click();
    await row.getByLabel('Amount used ($)').fill('120');
    await row.getByLabel('Note (optional)').fill('Train');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('benefit-row').filter({ hasText: 'Annual travel credit' })).toContainText('$120 of $300 used');
    await expect(page.getByTestId('benefit-totals')).toContainText('$120');
  });

  test('PW-BEN-02 add a custom benefit', async ({ page, request }) => {
    const u = await proUser(request);
    await apiAddCard(request, u.token, 'fabrikam-double', '2026-01-10');
    await uiLogin(page, u.email);
    await page.goto('/benefits');
    const form = page.getByTestId('add-benefit');
    await form.getByLabel('Card').selectOption({ index: 1 });
    await form.getByLabel('Benefit').fill('Cell phone protection credit');
    await form.getByLabel('Resets').selectOption('QUARTERLY');
    await form.getByLabel('Amount per period ($)').fill('15');
    await form.getByRole('button', { name: 'Add benefit' }).click();
    await expect(page.getByTestId('benefit-row').filter({ hasText: 'Cell phone protection credit' })).toContainText('Quarterly');
  });

  test('PW-HH-01 add a household member and see it on the household page', async ({ page, request }) => {
    const u = await proUser(request);
    await uiLogin(page, u.email);
    await page.goto('/household');
    await expect(page.getByTestId('household-member')).toHaveCount(1);
    const form = page.getByTestId('add-member');
    await form.getByLabel('Name').fill('Alex');
    await form.getByLabel('Relationship').selectOption('SPOUSE');
    await form.getByRole('button', { name: 'Add member' }).click();
    await expect(page.getByTestId('household-member')).toHaveCount(2);
    await expect(page.getByTestId('household-member').filter({ hasText: 'Alex' })).toContainText('Spouse');
  });

  test('PW-IMP-01 import a CSV: preview, commit, cards appear in the portfolio', async ({ page, request }) => {
    const u = await proUser(request);
    await uiLogin(page, u.email);
    await page.goto('/import');
    const csv = [
      'Owner,Card,Last digits,Issuer,Annual fee,Open date,Status,Notes',
      'Me,Travel Rewards Card,1234,Example Bank,95,2025-03-14,Open,',
      'Partner,Travel Rewards Card,5678,Example Bank,0,2025-04,Open,Authorized user on my account',
      'Me,Old Card,9999,Other Bank,0,2019-02-01,Closed,',
      'Me,Travel Rewards Card,1234,Example Bank,95,2025-03-14,Open,duplicate row',
    ].join('\n');
    const summary = page.getByTestId('import-summary');
    // retry the upload if the click landed before hydration (a native submit reloads the page and drops the file)
    await expect(async () => {
      await page.getByLabel('Spreadsheet file').setInputFiles({ name: 'cards.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await page.getByRole('button', { name: 'Preview import' }).click();
      await expect(summary).toBeVisible({ timeout: 4000 });
    }).toPass({ timeout: 20_000 });
    await expect(summary).toContainText('New cards3');
    await expect(summary).toContainText('Duplicates / errors1');
    await expect(page.getByTestId('import-row')).toHaveCount(4);
    await page.getByTestId('import-commit').click();
    await expect(page.getByTestId('import-done')).toContainText('Imported 3 cards');
    await page.goto('/portfolio');
    await expect(page.getByTestId('portfolio-row')).toHaveCount(1); // active, primary
    await page.getByRole('button', { name: 'Authorized user (1)' }).click();
    await expect(page.getByTestId('portfolio-row')).toContainText('Partner');
  });

  test('PW-IMP-02 rejects unsupported files before upload', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/import');
    await page.getByLabel('Spreadsheet file').setInputFiles({ name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF') });
    await expect(page.getByRole('alert').filter({ hasText: 'Only .xlsx workbooks and .csv files' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Preview import' })).toBeDisabled();
  });

  test('PW-PORT-A11Y new pages pass axe (family account with data)', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await uiLogin(page, FAMILY.email, FAMILY.password);
    for (const path of ['/portfolio', '/benefits', '/five24', '/household', '/import']) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious, `${path}: ${serious.map((v) => `${v.id}(${v.nodes.length})`).join(', ')}`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });
});

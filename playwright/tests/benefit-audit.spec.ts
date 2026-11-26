import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Account-level benefit tracking, audit trail, reconciliation and statement validation (synthetic data). */
const now = new Date();
const today = `${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}/${now.getUTCFullYear()}`;
const csv = (rows: string[]) => Buffer.from(['Transaction Date,Description,Amount', ...rows.map((r) => `${today},${r}`)].join('\n'));

const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
};

test.describe('Benefit audit & reconciliation', () => {
  test('PW-BA-01 two cards of one product keep separate usage; evidence can be rejected', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold', undefined, '1001');
    await apiAddCard(request, u.token, 'contoso-gold', undefined, '1002');
    await uiLogin(page, u.email);
    await page.goto('/spending');
    const bulk = page.getByTestId('bulk-statements');
    await bulk.locator('#bulk-files').setInputFiles([
      { name: 'Gold1001_Activity.csv', mimeType: 'text/csv', buffer: csv(['UBER *TRIP HELP.UBER.COM,-10.00', 'FIXTURE HARDWARE,-25.00']) },
    ]);
    await bulk.getByRole('button', { name: 'Import 1 statement' }).click();
    await expect(page.getByTestId('bulk-result').getByRole('status')).toContainText('1 imported');

    await page.goto('/benefits/audit');
    const audit = page.getByTestId('benefit-audit');
    await expect(audit.getByTestId('audit-summary')).toContainText('Detected');
    const rows = audit.getByTestId('audit-item').filter({ hasText: 'Rideshare credit' });
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: '··1001' })).toContainText('$10 / $10');
    await expect(rows.filter({ hasText: '··1002' })).toContainText('$0 / $10');

    // four levels: the product level adds both accounts, the account level keeps them apart
    await page.getByTestId('level-select').selectOption('account');
    await expect(page.getByTestId('rollup-group')).toHaveCount(2);
    await page.getByTestId('level-select').selectOption('product');
    await expect(page.getByTestId('rollup-group')).toHaveCount(1);
    await expect(page.getByTestId('rollup-group')).toContainText('2 accounts');

    await rows.filter({ hasText: '··1001' }).getByRole('button', { name: 'Show evidence' }).click();
    const det = page.getByTestId('detection').first();
    await expect(det).toContainText('UBER');
    await expect(det).toContainText('Exact match');
    await expect(det).toContainText('imported');
    await noSeriousA11y(page);
    await det.getByRole('button', { name: 'Not this benefit' }).click();
    await expect(rows.filter({ hasText: '··1001' })).toContainText('$0 / $10');
    await expect(page.getByTestId('audit-summary')).toContainText('Manual overrides');
  });

  test('PW-BA-02 reconciliation lists expected, missing and suggested actions per account', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold', new Date(now.getTime() - 400 * 86_400_000).toISOString(), '2001');
    await uiLogin(page, u.email);
    await page.goto('/benefits/reconciliation');
    const rec = page.getByTestId('reconciliation');
    await expect(rec.getByTestId('recon-totals')).toContainText('Expected credits');
    await expect(rec.getByTestId('all-row').filter({ hasText: 'Dining credit' })).toContainText('··2001');
    await expect(rec.getByTestId('actions')).toBeVisible();
    await expect(rec.getByTestId('action').first()).toContainText('··2001');
    await noSeriousA11y(page);
  });

  test('PW-BA-03 a statement with an unreadable line shows a validation report', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold', undefined, '3003');
    await uiLogin(page, u.email);
    await page.goto('/spending');
    const bulk = page.getByTestId('bulk-statements');
    await bulk.locator('#bulk-files').setInputFiles([
      { name: 'Gold3003.csv', mimeType: 'text/csv', buffer: Buffer.from(['Transaction Date,Description,Amount', `${today},FIXTURE SHOP,-5.00`, 'not-a-date,BROKEN LINE,-9.00'].join('\n')) },
    ]);
    await bulk.getByRole('button', { name: 'Import 1 statement' }).click();
    const report = page.getByTestId('validation-report');
    await expect(report).toBeVisible();
    await expect(page.getByTestId('validation-status')).not.toHaveText('PASS');
    await expect(report).toContainText('Statement transactions');
  });
});

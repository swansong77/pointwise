import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiRegister, uiLogin } from './helpers';

/** Credit Karma report → open dates / new cards for 5/24 (pasted text; synthetic report). */
test('PW-CRK-01 pasted Credit Karma report: preview, choose actions, save; 5/24 counts the new card', async ({ page, request }) => {
  const u = await apiRegister(request);
  await uiLogin(page, u.email);
  const d = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 6, 3));
  const opened = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/03/${d.getUTCFullYear()}`;
  const report = ['TransUnion', 'CAPITAL ONE', 'Account type: Credit card', `Date opened: ${opened}`, 'Account status: Open', 'Account number: ****9876', 'CAPITAL ONE AUTO', 'Account type: Auto loan', 'Date opened: 05/01/2022'].join('\n');
  await page.goto('/import');
  const panel = page.getByTestId('credit-report-import');
  await panel.getByLabel('…or paste the report text').fill(report);
  await panel.getByRole('button', { name: 'Read reports' }).click();
  const preview = page.getByTestId('credit-report-preview');
  await expect(preview.getByRole('status')).toContainText('TransUnion report: 1 credit card account · 1 other account skipped (CAPITAL ONE AUTO)');
  await expect(preview.getByTestId('credit-report-account')).toContainText('Opened in the last 24 months');
  await expect(preview.getByLabel('What to do with CAPITAL ONE')).toHaveValue('ADD');
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await preview.getByRole('button', { name: 'Save open dates' }).click();
  await expect(page.getByTestId('credit-report-result')).toContainText('0 cards updated, 1 added, 0 skipped');
  const five24 = await (await request.get('/api/v1/five24', { headers: { Authorization: `Bearer ${u.token}` } })).json();
  expect(five24.members[0].status.count).toBe(1);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, apiRegister, uiLogin } from './helpers';

/** Personal vs business cards in the catalog search; issuer coverage for admins. */
test('PW-COV-01 card search filters personal and business cards', async ({ page, request }) => {
  const u = await apiRegister(request);
  await uiLogin(page, u.email);
  await page.goto('/wallet');
  await page.getByRole('button', { name: '+ Add card' }).click();
  const panel = page.getByTestId('add-card-panel');
  const results = panel.getByTestId('card-search-results');
  await panel.getByRole('group', { name: 'Card type' }).getByRole('button', { name: 'Business' }).click();
  await expect(results).toContainText('Litware Business Ink');
  await expect(results).toContainText('Business ·');
  await expect(results).not.toContainText('Contoso Gold');
  await panel.getByRole('group', { name: 'Card type' }).getByRole('button', { name: 'Personal' }).click();
  await expect(results).toContainText('Contoso Gold');
  await expect(results).not.toContainText('Litware Business Ink');
});

test('PW-COV-02 admin coverage tab: totals, issuer table, research needs a Claude model; accessible', async ({ page }) => {
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/catalog');
  await page.getByRole('button', { name: 'Coverage' }).click();
  await expect(page.getByTestId('coverage-totals')).toContainText('Issuers');
  await expect(page.getByTestId('coverage')).toContainText('No public list covers every card');
  await expect(page.getByRole('button', { name: /Research all issuers/ })).toBeDisabled();
  await page.getByRole('group', { name: 'Institution type' }).getByRole('button', { name: 'Credit unions' }).click();
  await expect(page.getByRole('button', { name: /Research credit unions/ })).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, Page } from '@playwright/test';
import { ADMIN, freshUserWithCards, uiLogin } from './helpers';

/** Cash-back sites: the administrator keeps the rates, a household says which sites it uses, the shopping plan recommends one (fictional data). */
async function axe(page: Page) {
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test('the administrator adds, imports and reads rates; a household picks its sites; the plan recommends one', async ({ page, request, browser }) => {
  // administrator: three ways to get rates in
  await uiLogin(page, ADMIN.email, ADMIN.password);
  await page.goto('/admin/cashback');
  await expect(page.getByTestId('admin-site').first()).toBeVisible();
  await expect(page.getByTestId('admin-sites')).toContainText('Rakuten');
  await axe(page);

  const add = page.getByTestId('admin-add-rate');
  await add.getByLabel('Site').selectOption('rakuten');
  await add.getByLabel('Store').fill('Hilton');
  await add.getByLabel('Cash back (%)').fill('2');
  await add.getByTestId('admin-add-rate-submit').click();
  await expect(page.getByTestId('admin-rates')).toContainText('Hilton at rakuten: 2%');

  await page.getByLabel('CSV rows').fill('site,merchant,rate,conditions\ntopcashback,Hilton,up to 9%,selected stays\nrakuten,no-such-store,4%,');
  await page.getByTestId('admin-import-go').click();
  // one good row (added the first time, updated on a repeat run) and one bad row
  await expect(page.getByTestId('admin-import-result')).toHaveText(/^(1 added, 0 updated|0 added, 1 updated), 1 problem$/);
  await expect(page.getByTestId('admin-import-errors')).toContainText('Line 3');

  const paste = page.getByTestId('admin-paste');
  await paste.getByLabel('Site').selectOption('befrugal');
  await paste.getByLabel('Store').fill('Hilton');
  await paste.getByLabel('Page text').fill('Hilton: 3% Cash Back on every stay. Exclusive 7% Cash Back offer on selected rooms.');
  await paste.getByTestId('admin-paste-read').click();
  await expect(page.getByTestId('admin-paste-result')).toContainText('Found: 3%');
  await expect(page.getByTestId('admin-paste-result')).toContainText('Also on the page, not used: 7% Cash Back');
  await paste.getByTestId('admin-paste-save').click();
  await expect(page.getByTestId('admin-paste-result')).toContainText('Saved: 3%');
  await expect(page.getByTestId('admin-rates')).toContainText('Hilton at befrugal: 3%');

  // a whole comparison page for one store: every known site at once, after a preview
  const compare = page.getByTestId('admin-compare');
  await compare.getByLabel('Store').fill('Hilton');
  await expect(compare.getByRole('link', { name: 'Open the store on Cashback Monitor' })).toHaveAttribute('href', 'https://www.cashbackmonitor.com/cashback-store/hilton/');
  await compare.getByLabel('Comparison table text').fill('Portal\tRate\nShopBack\t5%\nTop Cashback\t4%\nMr. Rebates\t1%*\nSome New Portal 3%');
  await compare.getByTestId('admin-compare-read').click();
  await expect(page.getByTestId('admin-compare-result')).toContainText('Found 3 sites for Hilton');
  await expect(page.getByTestId('admin-compare-result')).toContainText('Mr. Rebates: up to 1%');
  await expect(page.getByTestId('admin-compare-result')).toContainText('Some New Portal');
  await compare.getByTestId('admin-compare-save').click();
  await expect(page.getByTestId('admin-compare-result')).toContainText('Saved');
  await expect(page.getByTestId('admin-rates')).toContainText('Hilton at shopback: 5%');
  await axe(page);

  // a household: tick the site it uses, then plan a purchase
  const ctx = await browser.newContext({ baseURL: (test.info().project.use as { baseURL?: string }).baseURL });
  const u = await ctx.newPage();
  await freshUserWithCards(u, ctx.request, ['contoso-gold']);
  await u.goto('/cashback');
  const rakuten = u.locator('[data-testid="cashback-site"][data-site="rakuten"]');
  await expect(rakuten).toBeVisible();
  const saved = u.waitForResponse((r) => r.url().includes('/cashback/accounts/rakuten') && r.request().method() === 'PUT');
  await rakuten.getByRole('checkbox').click();
  await saved;
  await expect(rakuten.getByRole('checkbox')).toBeChecked();
  await expect(u.getByTestId('cashback-sites')).toContainText('1 of');
  await axe(u);

  await u.goto('/offers/plan');
  await u.getByLabel('Merchant').fill('Hilton');
  await u.getByLabel('Amount ($)').fill('500');
  await u.getByTestId('plan-go').click();
  const card = u.getByTestId('cashback-card');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('cashback-pick')).toContainText('Use Rakuten');
  await expect(card.getByTestId('cashback-steps')).toContainText('Sign in to Rakuten');
  await expect(card.getByTestId('cashback-consider')).toContainText('ShopBack');
  await expect(card.getByTestId('cashback-ranked').getByTestId('cashback-row')).toHaveCount(5);
  await expect(card.getByTestId('cashback-monitor-link')).toHaveAttribute('href', 'https://www.cashbackmonitor.com/cashback-store/hilton/');
  await axe(u);

  // the lookup on the sites page gives the same answer
  await u.goto('/cashback');
  await u.getByLabel('Store').fill('Hilton');
  await u.getByLabel('Amount ($)').fill('500');
  await u.getByRole('button', { name: 'Find the best site' }).click();
  await expect(u.getByTestId('cashback-pick')).toContainText('Rakuten');
  await ctx.close();
  void request;
});

test('only an administrator reaches the cash-back administration page', async ({ page, request }) => {
  await freshUserWithCards(page, request, ['contoso-gold']);
  await page.goto('/admin/cashback');
  await expect(page).not.toHaveURL(/\/admin\/cashback/);
});

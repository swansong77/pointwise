import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, freshUserWithCards, shot, uiLogin } from './helpers';

test.describe('Card management', () => {
  test('PW-WAL-01 search and add a card, then edit nickname and remove it', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/wallet');
    await page.getByRole('button', { name: '+ Add card' }).click();
    await page.getByLabel('Search cards').fill('Voyager');
    await page.getByLabel('Approval date (optional)').fill('2026-02-01');
    await page.getByRole('button', { name: 'Add Northwind Voyager', exact: true }).click();
    const row = page.getByTestId('wallet-card').filter({ hasText: 'Northwind Voyager' });
    await expect(row).toBeVisible();
    await shot(page, '03-wallet');

    await row.getByRole('button', { name: 'Edit' }).click();
    await row.getByLabel('Nickname').fill('Trips');
    await row.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('wallet-card').filter({ hasText: 'Trips' })).toBeVisible();

    page.once('dialog', (d) => d.accept());
    const trips = page.getByTestId('wallet-card').filter({ hasText: 'Trips' });
    await trips.getByRole('button', { name: 'Edit' }).click();
    await trips.getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText('Your wallet is empty')).toBeVisible();
  });

  test('PW-WAL-02 last-4 field rejects a full card number', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/wallet');
    await page.getByRole('button', { name: '+ Add card' }).click();
    await page.getByLabel('Last 4 digits (optional)').fill('41');
    await expect(page.getByRole('alert').filter({ hasText: 'last 4' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add Contoso Gold', exact: true })).toBeDisabled();
  });

  test('PW-WAL-03 free plan blocks the 6th card with an upgrade message', async ({ page, request }) => {
    const u = await apiRegister(request);
    for (const s of ['contoso-gold', 'northwind-voyager', 'fabrikam-flex', 'fabrikam-double', 'litware-blue-cash']) await apiAddCard(request, u.token, s);
    await uiLogin(page, u.email);
    await page.goto('/wallet');
    await page.getByRole('button', { name: '+ Add card' }).click();
    await page.getByLabel('Search cards').fill('Tailspin Everyday');
    await page.getByRole('button', { name: 'Add Tailspin Everyday Plus' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'limit' })).toBeVisible();
  });

  test('PW-WAL-04 activating a rotating category changes the best gas card', async ({ page, request }) => {
    await freshUserWithCards(page, request, ['fabrikam-flex', 'fabrikam-double']);
    await page.goto('/categories/gas');
    await expect(page.getByTestId('ranked-card').first()).toContainText('Fabrikam Double Cash');
    await page.goto('/wallet');
    const flex = page.getByTestId('wallet-card').filter({ hasText: 'Fabrikam Flex' });
    await flex.getByRole('button', { name: 'Edit' }).click();
    // Controlled checkbox: state updates after the PATCH round-trip, so click then wait.
    await flex.getByLabel('Gas').click();
    await expect(flex.getByLabel('Gas')).toBeChecked();
    await page.goto('/categories/gas');
    await expect(page.getByTestId('ranked-card').first()).toContainText('Fabrikam Flex');
    await expect(page.getByTestId('ranked-card').first()).toContainText('5¢/$');
  });
});

test.describe('Rewards / recommendations', () => {
  test('PW-REC-01 dashboard shows best card per category with correct value', async ({ page, request }) => {
    await freshUserWithCards(page, request);
    const dining = page.getByTestId('best-by-category').getByRole('link', { name: /Dining/ });
    await expect(dining).toContainText('Contoso Gold');
    await expect(dining).toContainText('5¢/$');
    await shot(page, '04-dashboard');
  });

  test('PW-REC-02 pin a card for a category and unpin it', async ({ page, request }) => {
    await freshUserWithCards(page, request);
    await page.goto('/categories/dining');
    await page.getByRole('button', { name: 'Always use Fabrikam Double Cash for Dining' }).click();
    await expect(page.getByTestId('ranked-card').first()).toContainText('pinned');
    await expect(page.getByTestId('ranked-card').first()).toContainText('Fabrikam Double Cash');
    await page.getByRole('button', { name: 'Unpin Fabrikam Double Cash', exact: true }).click(); // the header button; each row also has its own Unpin
    await expect(page.getByTestId('ranked-card').first()).toContainText('Contoso Gold');
  });

  test('PW-REC-03 merchant search → merchant page ranks merchant-specific card first', async ({ page, request }) => {
    await freshUserWithCards(page, request, ['northwind-shopper', 'fabrikam-double']);
    await page.goto('/merchants');
    await page.getByLabel('Search merchants').fill('ShopNow');
    await page.getByTestId('merchant-results').getByRole('link', { name: /ShopNow/ }).click();
    await expect(page.getByRole('heading', { name: 'ShopNow' })).toBeVisible();
    await expect(page.getByTestId('ranked-card').first()).toContainText('Northwind ShopNow Card');
    await shot(page, '05-merchant');
  });

  test('PW-REC-04 nearby (demo location) lists stores sorted by distance with a best card', async ({ page, request }) => {
    await freshUserWithCards(page, request);
    await page.goto('/nearby');
    await page.getByTestId('demo-location').click();
    const items = page.getByTestId('nearby-item');
    await expect(items.first()).toBeVisible();
    expect(await items.count()).toBeGreaterThan(3);
    // Nearest seeded store to the demo point is Bean Street Coffee (~117 m, Dining → Contoso Gold 4X).
    await expect(items.first()).toContainText('Bean Street Coffee');
    await expect(items.first()).toContainText('Contoso Gold');
    await shot(page, '06-nearby');
  });

  test('PW-REC-05 nearby via browser geolocation', async ({ page, request }) => {
    await freshUserWithCards(page, request);
    await page.goto('/nearby');
    await page.getByRole('button', { name: /Use my location/ }).click();
    await expect(page.getByTestId('nearby-item').first()).toBeVisible();
  });

  test('PW-REC-06 calculator computes rewards, fees and net value', async ({ page, request }) => {
    await freshUserWithCards(page, request);
    await page.goto('/calculator');
    await page.getByTestId('calculate').click();
    await expect(page.getByTestId('calc-results')).toBeVisible();
    await expect(page.getByTestId('gross')).toContainText('$');
    await expect(page.getByLabel('Compare a new card (Pro)')).toBeDisabled();
    await page.getByLabel(/Dining/).fill('abc');
    await expect(page.getByText('Enter dollar amounts')).toBeVisible();
    await expect(page.getByTestId('calculate')).toBeDisabled();
    await shot(page, '07-calculator');
  });
});

import { expect, test } from '@playwright/test';
import { ADMIN, apiAddCard, apiLogin, apiRegister, freshUserWithCards, shot, uiLogin } from './helpers';

test.describe('Offers', () => {
  test('PW-OFF-01 add an eligible offer, record partial use, then redeem', async ({ page, request }) => {
    await freshUserWithCards(page, request, ['contoso-gold']);
    await page.goto('/offers');
    const eligible = page.getByTestId('eligible-offers');
    await eligible.getByRole('button', { name: /Add offer FreshCart/ }).click();
    const row = page.getByTestId('offer-row').filter({ hasText: 'FreshCart' });
    await expect(row).toBeVisible();
    await row.getByLabel('Amount used in dollars').fill('4');
    await row.getByRole('button', { name: 'Save amount' }).click();
    await expect(row).toContainText('Used $4');
    await row.getByTestId('redeem').click();
    await expect(page.getByTestId('offer-row').filter({ hasText: 'FreshCart' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Redeemed' }).click();
    await expect(page.getByTestId('offer-row').filter({ hasText: 'FreshCart' })).toBeVisible();
    await shot(page, '08-offers-redeemed');
  });

  test('PW-OFF-02 over-use is rejected with a business-rule error', async ({ page, request }) => {
    await freshUserWithCards(page, request, ['contoso-gold']);
    await page.goto('/offers');
    await page.getByTestId('eligible-offers').getByRole('button', { name: /Add offer FreshCart/ }).click();
    const row = page.getByTestId('offer-row').filter({ hasText: 'FreshCart' });
    await row.getByLabel('Amount used in dollars').fill('500');
    await row.getByRole('button', { name: 'Save amount' }).click();
    await expect(row.getByRole('alert')).toContainText('cannot exceed');
  });

  test('PW-OFF-03 create a custom offer, favorite it, snooze it', async ({ page, request }) => {
    await freshUserWithCards(page, request, ['fabrikam-double']);
    await page.goto('/offers');
    await page.getByRole('button', { name: '+ Custom offer' }).click();
    const form = page.getByTestId('custom-offer-form');
    await form.getByLabel('Card').selectOption({ label: 'Fabrikam Double Cash' });
    await form.getByLabel('Title').fill('Bakery $5 off');
    await form.getByLabel('Value ($)').fill('5');
    await form.getByRole('button', { name: 'Save offer' }).click();
    const row = page.getByTestId('offer-row').filter({ hasText: 'Bakery $5 off' });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: 'Favorite' }).click();
    await expect(row).toContainText('★');
    await row.getByRole('button', { name: 'Snooze 7d' }).click();
    await expect(page.getByTestId('offer-row').filter({ hasText: 'Bakery $5 off' })).toHaveCount(0);
  });

  test('PW-OFF-04 sorting by value puts the most valuable first', async ({ page }) => {
    await uiLogin(page, 'demo@pointwise.local', 'Demo12345!');
    await page.goto('/offers');
    const rows = page.getByTestId('offer-row');
    await expect(rows.first()).toBeVisible();
    await page.getByLabel('Sort').selectOption('value');
    await expect(rows.first()).toBeVisible();
    // Favorites are pinned to the top by design; the remaining rows must be in non-increasing value order.
    // Poll: the re-sorted list arrives asynchronously after the sort query key changes.
    const readValues = () =>
      rows.evaluateAll((els) =>
        els
          .filter((e) => !e.textContent?.includes('★'))
          .map((e) => Number(e.querySelector('[data-testid=offer-value]')?.getAttribute('data-cents') ?? 'NaN')),
      );
    await expect
      .poll(async () => {
        const v = await readValues();
        return v.length > 1 && v.every((x, i) => i === 0 || v[i - 1] >= x);
      })
      .toBe(true);
  });
});

test.describe('Notifications', () => {
  test('PW-NOT-01 expiring-offer job creates a notification; read-all clears the badge', async ({ page, request }) => {
    const u = await apiRegister(request);
    const wc = await apiAddCard(request, u.token, 'contoso-gold');
    const eligible = await (await request.get('/api/v1/offers/eligible', { headers: { Authorization: `Bearer ${u.token}` } })).json();
    const fresh = eligible.find((e: { offer: { title: string } }) => e.offer.title.startsWith('FreshCart'));
    await request.post('/api/v1/offers/mine', { headers: { Authorization: `Bearer ${u.token}` }, data: { offerId: fresh.offer.id, walletCardId: wc.id } });
    const admin = await apiLogin(request, ADMIN.email, ADMIN.password);
    const job = await request.post('/api/v1/admin/jobs/scan-expiring-offers/run', { headers: { Authorization: `Bearer ${admin}` } });
    expect(job.ok()).toBeTruthy();

    await uiLogin(page, u.email);
    await expect(page.getByTestId('unread-badge')).toBeVisible();
    await page.getByTestId('nav-notifications').click();
    await expect(page.getByTestId('notification').filter({ hasText: 'Offer expiring' })).toBeVisible();
    await shot(page, '09-notifications');
    await page.getByTestId('read-all').click();
    await expect(page.getByTestId('unread-badge')).toHaveCount(0);
  });

  test('PW-NOT-02 notification preferences persist', async ({ page, request }) => {
    await freshUserWithCards(page, request, ['contoso-gold']);
    await page.goto('/settings');
    const prefs = page.getByTestId('notification-prefs');
    const box = prefs.getByLabel('Email me a daily digest');
    await expect(box).toBeChecked();
    // Controlled checkbox: state flips after the PUT round-trip.
    await box.click();
    await expect(box).not.toBeChecked();
    await page.reload();
    await expect(page.getByTestId('notification-prefs').getByLabel('Email me a daily digest')).not.toBeChecked();
  });
});

test.describe('Subscriptions', () => {
  test('PW-SUB-01 upgrade to Pro (monthly), unlocks compare, then cancel at period end', async ({ page, request }) => {
    await freshUserWithCards(page, request);
    await page.goto('/settings');
    await page.getByTestId('plan-month').click();
    await expect(page.getByTestId('subscription')).toContainText('PRO');
    await shot(page, '10-settings-pro');
    await page.goto('/calculator');
    await expect(page.getByLabel('Compare a new card (Pro)')).toBeEnabled();
    await page.getByLabel('Compare a new card (Pro)').selectOption({ label: 'Northwind Voyager Reserve' });
    await page.getByTestId('calculate').click();
    await expect(page.getByTestId('comparison')).toContainText('first-year value');
    await page.goto('/settings');
    await page.getByTestId('cancel-subscription').click();
    await expect(page.getByTestId('subscription')).toContainText('canceled');
    await expect(page.getByTestId('subscription')).toContainText('PRO');
  });

  test('PW-SUB-02 annual plan starts a trial', async ({ page, request }) => {
    await freshUserWithCards(page, request, ['contoso-gold']);
    await page.goto('/settings');
    await page.getByTestId('plan-year').click();
    await expect(page.getByTestId('subscription')).toContainText('trialing');
  });
});

test.describe('Admin & privacy', () => {
  test('PW-ADM-01 admin creates a catalog offer and runs a job', async ({ page }) => {
    await uiLogin(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin');
    const form = page.getByTestId('admin-offer-form');
    const title = `E2E admin offer ${Date.now()}`;
    await form.getByLabel('Title').fill(title);
    await form.getByLabel('Value ($)').fill('12');
    await form.getByLabel('Merchant').selectOption({ label: 'FreshCart Market' });
    await form.getByRole('button', { name: 'Create offer' }).click();
    await expect(form).toContainText('Offer created');
    await page.getByRole('button', { name: 'Run expire-offers' }).click();
    await expect(page.getByTestId('admin-jobs').getByRole('status')).toContainText('expire-offers');
    await shot(page, '11-admin');
  });

  test('PW-PRIV-01 export data and delete account', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/settings');
    const download = page.waitForEvent('download');
    await page.getByTestId('export-data').click();
    expect((await download).suggestedFilename()).toBe('pointwise-export.json');
    await page.getByLabel('Type DELETE to confirm').fill('DELETE');
    await page.getByRole('button', { name: 'Delete account' }).click();
    await expect(page).toHaveURL(/\/$|\/login/);
    const res = await request.post('/api/v1/auth/login', { data: { email: u.email, password: 'e2e-password-1' } });
    expect(res.status()).toBe(401);
  });
});

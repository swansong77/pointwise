import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiRegister, uiLogin } from './helpers';

/** Loyalty asset management: accounts, expiration risk, certificates, status, memberships, valuation, award travel (synthetic data). */
const DAY = 86_400_000;
const ymd = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
};
const H = (t: string) => ({ Authorization: `Bearer ${t}` });

test.describe('Loyalty assets', () => {
  test('LY-01 add a custom account, see its expiration risk and record activity', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/loyalty');
    await expect(page.getByTestId('loyalty')).toBeVisible();
    await expect(page.getByText('Nothing tracked yet')).toBeVisible();

    await page.getByTestId('tab-points').click();
    const form = page.getByTestId('add-account');
    await form.locator('#la-custom').fill('Corner Cafe Club');
    await form.locator('#la-balance').fill('5000');
    await form.getByTestId('save-account').click();
    const row = page.getByTestId('account').filter({ hasText: 'Corner Cafe Club' });
    await expect(row).toContainText('5,000 points');
    await row.getByRole('button', { name: 'Details' }).click();
    const details = row.getByTestId('account-details');
    await expect(details).toContainText('Policy not known');
    await expect(details).toContainText('Confidence');
    await details.locator('input[type=number]').fill('1000');
    await details.getByRole('button', { name: 'Record' }).click();
    await expect(row).toContainText('6,000 points');
    await expect(row.getByTestId('history')).toBeVisible();
    await noSeriousA11y(page);
  });

  test('LY-02 certificates: add, see "use first", mark used', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/loyalty');
    await page.getByTestId('tab-certificates').click();
    await page.locator('#ct-name').fill('IHG free night');
    await page.locator('#ct-exp').fill(ymd(45));
    await page.locator('#ct-val').fill('480');
    await page.getByTestId('save-cert').click();
    const cert = page.getByTestId('cert').filter({ hasText: 'IHG free night' });
    await expect(cert).toContainText('Free night');
    await expect(cert).toContainText('$480');
    await expect(page.getByTestId('cert-opportunities')).toContainText('You have a IHG free night expiring in 4');
    await expect(page.getByTestId('cert-opportunities')).toContainText('Potential value: $480.');
    await noSeriousA11y(page);
    await cert.getByRole('button', { name: 'Mark used' }).click();
    await expect(cert).toContainText('Used');
    await page.getByTestId('tab-valuation').click();
    await expect(page.getByTestId('valuation')).toContainText('Recovered Value');
    await expect(page.getByTestId('valuation')).toContainText('$480');
  });

  test('LY-03 status progress and memberships', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/loyalty');
    await page.getByTestId('tab-status').click();
    await page.locator('#st-prog').fill('Marriott');
    await page.locator('#st-level').fill('Platinum');
    await page.locator('#st-exp').fill(ymd(95));
    await page.locator('#st-prog-n').fill('38');
    await page.locator('#st-req').fill('50');
    await page.getByTestId('save-status').click();
    const row = page.getByTestId('status-row');
    await expect(row).toContainText('Marriott Platinum');
    await expect(row).toContainText('76% there, needs 12 nights');
    await expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '76');

    await page.locator('#mb-exp').fill(ymd(181));
    await page.locator('#mb-cost').fill('120');
    await page.getByTestId('save-membership').click();
    await expect(page.getByTestId('membership')).toContainText('Global Entry expires in 6 months.');
    await noSeriousA11y(page);
  });

  test('LY-04 expirations, forecast and award travel', async ({ page, request }) => {
    const u = await apiRegister(request);
    // data through the API: a household member profile exists after the first visit
    await uiLogin(page, u.email);
    await page.goto('/loyalty');
    const members = await (await request.get('/api/v1/household/members', { headers: H(u.token) })).json();
    const profileId = members[0].id;
    await request.post('/api/v1/loyalty/accounts', { headers: H(u.token), data: { profileId, customName: 'Sky Club Miles', customKind: 'AIRLINE', customCentsPerPoint: 1.5, balance: 90_000, expiresAt: new Date(Date.now() + 20 * DAY).toISOString() } });
    await page.reload();
    await page.getByTestId('tab-expirations').click();
    const item = page.getByTestId('expiration-item').filter({ hasText: 'Sky Club Miles' });
    await expect(item).toContainText('High risk');
    await expect(item).toContainText('expire in');
    await expect(item).toContainText('Confidence 90%');
    await expect(page.getByTestId('forecast-next30')).toContainText('Sky Club Miles');
    await noSeriousA11y(page);

    await page.getByTestId('tab-award').click();
    await page.locator('#at-dest').fill('Tokyo');
    await page.locator('#at-from').fill(ymd(120));
    await page.locator('#at-to').fill(ymd(130));
    await page.locator('#at-pts').fill('80000');
    await page.locator('#at-air').fill('Sky Club');
    await page.getByTestId('plan-trip').click();
    await expect(page.getByTestId('award-travel')).toBeVisible();
    // a custom program has no transfer routes; the plan says so instead of inventing one
    await expect(page.getByText(/No program in reach|Best/i).first()).toBeVisible();
    await page.getByTestId('tab-household').click();
    await expect(page.getByTestId('household')).toContainText('Combined Points');
    await expect(page.getByTestId('household-members')).toContainText('90,000');
  });
});

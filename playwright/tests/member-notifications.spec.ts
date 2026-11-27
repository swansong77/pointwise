import AxeBuilder from '@axe-core/playwright';
import { expect, test, APIRequestContext, Page } from '@playwright/test';
import { ADMIN, PASSWORD, apiLogin, apiRegister, uniqueEmail } from './helpers';

/** A household member's own notifications, settings and briefings (synthetic data). */
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function axe(page: Page) {
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

/** An owner and a spouse with their own sign-in; every card renews in about ten days. */
async function household(request: APIRequestContext) {
  const owner = await apiRegister(request);
  await request.post('/api/v1/subscription/checkout', { headers: auth(owner.token), data: { interval: 'month' } });
  const hh = await (await request.get('/api/v1/household', { headers: auth(owner.token) })).json();
  const primary = hh.members.find((m: { isPrimary: boolean }) => m.isPrimary);
  const riley = await (await request.post('/api/v1/household/members', { headers: auth(owner.token), data: { nickname: 'Riley', relationship: 'SPOUSE' } })).json();
  const gold = await (await request.get('/api/v1/cards/contoso-gold')).json();
  const opened = new Date(Date.now() - 365 * 86_400_000 + 10 * 86_400_000).toISOString();
  for (const [profileId, lastFour] of [[primary.id, '1111'], [riley.id, '2222']] as const) {
    await request.post('/api/v1/wallet/cards', { headers: auth(owner.token), data: { cardId: gold.id, profileId, lastFour, approvedAt: opened } });
  }
  const inv = await (await request.post(`/api/v1/household/members/${riley.id}/invite`, { headers: auth(owner.token) })).json();
  const email = uniqueEmail('riley');
  const acc = await request.post('/api/v1/auth/accept-invite', { data: { token: new URL(inv.url).pathname.split('/join/')[1], email, password: PASSWORD + '-riley', name: 'Riley' } });
  expect(acc.status()).toBe(200);
  return { owner, email };
}

async function memberLogin(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD + '-riley');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/my$/);
}

test('a member gets their own notification, reads it, sets their own preferences and sees their own briefing', async ({ page, request }) => {
  const h = await household(request);
  // the scheduled scan, run by an administrator
  const admin = await apiLogin(request, ADMIN.email, ADMIN.password);
  for (const job of ['scan-renewals', 'member-daily']) {
    const r = await request.post(`/api/v1/admin/jobs/${job}/run`, { headers: auth(admin) });
    expect(r.status()).toBe(201);
  }

  await memberLogin(page, h.email);
  // the bell shows their own unread count and opens their own list
  await expect(page.getByTestId('nav-notifications')).toBeVisible();
  await expect(page.getByTestId('unread-badge')).toBeVisible();
  await page.getByTestId('nav-notifications').click();
  await expect(page).toHaveURL(/\/my\/notifications$/);
  const items = page.getByTestId('notification-list').locator('li');
  await expect(items.filter({ hasText: /renews in/ })).toHaveCount(1);
  await expect(items.filter({ hasText: 'Your daily briefing' })).toHaveCount(1);
  await axe(page);
  await page.getByTestId('read-all').click();
  await expect(page.getByTestId('unread-badge')).toHaveCount(0);

  // their own briefing, built only from their own card
  await page.getByRole('link', { name: 'Briefings' }).click();
  await expect(page).toHaveURL(/\/my\/briefings$/);
  await expect(page.getByTestId('briefing-headline')).toContainText('Riley');
  await expect(page.getByTestId('briefing-body')).toContainText('renews');
  await expect(page.getByTestId('brief-list').getByRole('button')).toHaveCount(1);
  await page.getByTestId('brief-now-weekly').click();
  await expect(page.getByTestId('brief-list').getByRole('button')).toHaveCount(2);
  await axe(page);

  // their own settings: saved for them, not for the owner
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/my\/settings$/);
  await expect(page.getByTestId('my-signin')).toContainText(h.email);
  const quiet = page.getByLabel(/Quiet Mode/);
  await expect(quiet).not.toBeChecked();
  const saved = page.waitForResponse((r) => r.url().includes('/notifications/preferences') && r.request().method() === 'PUT');
  await quiet.click();
  await saved;
  await expect(quiet).toBeChecked();
  await page.reload();
  await expect(page.getByLabel(/Quiet Mode/)).toBeChecked();
  await axe(page);
  const ownerPrefs = await (await request.get('/api/v1/notifications/preferences', { headers: auth(h.owner.token) })).json();
  expect(ownerPrefs.quietMode).toBe(false);

  // the owner still has all of their own notifications
  const ownerList = await (await request.get('/api/v1/notifications', { headers: auth(h.owner.token) })).json();
  expect(ownerList.filter((n: { type: string }) => n.type === 'CARD_RENEWAL').length).toBeGreaterThanOrEqual(2);
});

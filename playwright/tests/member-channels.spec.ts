import AxeBuilder from '@axe-core/playwright';
import { expect, test, APIRequestContext, Page } from '@playwright/test';
import { PASSWORD, apiRegister, uiLogin, uniqueEmail } from './helpers';

/** A household member's own alert address and mail page; the owner assigns mailboxes per person (synthetic data). */
const SECRET = process.env.INBOUND_EMAIL_SECRET;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function axe(page: Page) {
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

async function household(request: APIRequestContext) {
  const owner = await apiRegister(request);
  await request.post('/api/v1/subscription/checkout', { headers: auth(owner.token), data: { interval: 'month' } });
  const hh = await (await request.get('/api/v1/household', { headers: auth(owner.token) })).json();
  const primary = hh.members.find((m: { isPrimary: boolean }) => m.isPrimary);
  const riley = await (await request.post('/api/v1/household/members', { headers: auth(owner.token), data: { nickname: 'Riley', relationship: 'SPOUSE' } })).json();
  const gold = await (await request.get('/api/v1/cards/contoso-gold')).json();
  const opened = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const add = async (profileId: string, lastFour: string) =>
    (await (await request.post('/api/v1/wallet/cards', { headers: auth(owner.token), data: { cardId: gold.id, profileId, lastFour, approvedAt: opened } })).json()).id as string;
  const ownerCard = await add(primary.id, '4321');
  const rileyCard = await add(riley.id, '4321');
  const inv = await (await request.post(`/api/v1/household/members/${riley.id}/invite`, { headers: auth(owner.token) })).json();
  const email = uniqueEmail('riley');
  const acc = await request.post('/api/v1/auth/accept-invite', { data: { token: new URL(inv.url).pathname.split('/join/')[1], email, password: PASSWORD + '-riley', name: 'Riley' } });
  expect(acc.status()).toBe(200);
  return { owner, riley, ownerCard, rileyCard, email, memberToken: (await acc.json()).accessToken as string };
}

test.describe('Member mail and alerts', () => {
  test.skip(!SECRET, 'inbound email is not configured for this run');

  test('the member has their own alert address, sees only their cards, and their alert lands on their card', async ({ page, request }) => {
    const h = await household(request);
    const ownerAddr = (await (await request.get('/api/v1/capture/status', { headers: auth(h.owner.token) })).json()).inbox.address as string;

    await page.goto('/login');
    await page.getByLabel('Email').fill(h.email);
    await page.getByLabel('Password').fill(PASSWORD + '-riley');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/my$/);

    await page.getByRole('link', { name: 'Mail & alerts' }).click();
    await expect(page).toHaveURL(/\/my\/mail$/);
    const panel = page.getByTestId('auto-capture');
    await expect(panel).toContainText(/0 of 1 cards automated/i);
    await expect(panel.getByTestId('capture-card')).toHaveCount(1);
    const address = (await panel.getByTestId('inbox-address').textContent()) ?? '';
    expect(address).toMatch(/@in\.pointwise\.test$/);
    expect(address).not.toBe(ownerAddr);
    await expect(panel.getByRole('link', { name: 'bank connection' })).toHaveCount(0);
    await expect(page.getByTestId('mailbox-panel')).toBeVisible();
    await expect(page.getByTestId('mailbox-feeds')).toHaveCount(0);
    await axe(page);

    // an alert for digits that two household cards share lands on the member's own card
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const mail = [
      'Authentication-Results: mx.pointwise.test; dkim=pass header.d=chase.com',
      'From: Chase <no.reply.alerts@chase.com>',
      'To: me@example.com',
      'Subject: Your $23.45 transaction with UBER *TRIP',
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <pw-mc-${Date.now()}@test.example>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      `You made a $23.45 transaction with UBER *TRIP on ${today}. Account ending in (...4321)`,
    ].join('\r\n');
    const r = await request.post('/api/v1/inbound/email', { headers: { 'x-inbound-secret': SECRET!, 'x-envelope-to': address, 'content-type': 'message/rfc822' }, data: Buffer.from(mail) });
    expect(await r.json()).toEqual({ accepted: true, kind: 'ALERT', status: 'PROCESSED' });
    await page.reload();
    await expect(page.getByTestId('auto-capture')).toContainText(/UBER|automated/);
    await page.goto('/my');
    await expect(page.getByTestId('my-transactions')).toContainText('UBER');

    // the owner sees health on the member, not addresses, and can assign a mailbox to a person
    await page.context().clearCookies();
    await uiLogin(page, h.owner.email);
    await page.goto('/household');
    const m = page.getByTestId('household-member').filter({ hasText: 'Riley' });
    await expect(m.getByTestId('member-channels')).toContainText('alert address on');
    await page.goto('/spending');
    const feeds = page.getByTestId('mailbox-feeds').getByRole('combobox');
    await expect(feeds.locator('option')).toHaveText(['The whole household', /./, 'Riley']);
  });
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiRegister, uiLogin } from './helpers';

/** Automatic import: a forwarded card alert email becomes a transaction and updates benefits without any upload. */
const SECRET = process.env.INBOUND_EMAIL_SECRET;

test.describe('Automatic import', () => {
  test.skip(!SECRET, 'inbound email is not configured for this run');

  test('PW-CAP-01 forwarded alert → transaction + benefit; the page shows the address, card status and is accessible', async ({ page, request }) => {
    const u = await apiRegister(request);
    const auth = { Authorization: `Bearer ${u.token}` };
    const card = await (await request.get('/api/v1/cards/contoso-gold')).json();
    const add = await request.post('/api/v1/wallet/cards', { headers: auth, data: { cardId: card.id, lastFour: '4321', approvedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() } });
    expect(add.status()).toBe(201);
    const status = await (await request.get('/api/v1/capture/status', { headers: auth })).json();
    const address = status.inbox.address as string;
    expect(address).toMatch(/@in\.pointwise\.test$/);
    const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const mail = [
      'Authentication-Results: mx.pointwise.test; dkim=pass header.d=chase.com',
      'From: Chase <no.reply.alerts@chase.com>',
      'To: me@example.com',
      'Subject: Your $23.45 transaction with UBER *TRIP',
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <pw-${Date.now()}@test.example>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      `You made a $23.45 transaction with UBER *TRIP on ${today}. Account ending in (...4321)`,
    ].join('\r\n');
    const r = await request.post('/api/v1/inbound/email', { headers: { 'x-inbound-secret': SECRET!, 'x-envelope-to': address, 'content-type': 'message/rfc822' }, data: Buffer.from(mail) });
    expect(r.status()).toBe(202);
    expect(await r.json()).toEqual({ accepted: true, kind: 'ALERT', status: 'PROCESSED' });

    await uiLogin(page, u.email);
    await page.goto('/spending');
    const panel = page.getByTestId('auto-capture');
    await expect(panel.getByTestId('inbox-address')).toHaveText(address);
    await expect(panel).toContainText('1 of 1 cards automated');
    await expect(panel.getByTestId('capture-card')).toContainText('Alert emails');
    await expect(page.getByTestId('transaction').filter({ hasText: 'UBER *TRIP' })).toContainText('Rideshare credit: $10 credit expected');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, APIRequestContext, Page } from '@playwright/test';
import { PASSWORD, apiRegister, uiLogin, uniqueEmail } from './helpers';

/** Household members with their own sign-in: the owner invites in the UI, the member joins through the link (synthetic data). */

async function checkout(request: APIRequestContext, token: string) {
  const r = await request.post('/api/v1/subscription/checkout', { headers: { Authorization: `Bearer ${token}` }, data: { interval: 'month' } });
  expect(r.status()).toBe(201);
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function household(request: APIRequestContext) {
  const owner = await apiRegister(request);
  await checkout(request, owner.token);
  const hh = await (await request.get('/api/v1/household', { headers: auth(owner.token) })).json();
  const primary = hh.members.find((m: { isPrimary: boolean }) => m.isPrimary);
  const riley = await (await request.post('/api/v1/household/members', { headers: auth(owner.token), data: { nickname: 'Riley', relationship: 'SPOUSE' } })).json();
  const gold = await (await request.get('/api/v1/cards/contoso-gold')).json();
  await request.post('/api/v1/wallet/cards', { headers: auth(owner.token), data: { cardId: gold.id, profileId: primary.id, lastFour: '1111' } });
  await request.post('/api/v1/wallet/cards', { headers: auth(owner.token), data: { cardId: gold.id, profileId: riley.id, lastFour: '2222' } });
  return { owner, riley };
}

async function axe(page: Page) {
  // let any fade finish so contrast is measured on the settled page
  await page.addStyleTag({ content: '*{transition:none!important;animation:none!important}' });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
}

test('the owner invites a member, who joins through the link and sees only their own view', async ({ page, browser, request }) => {
  const { owner } = await household(request);
  await uiLogin(page, owner.email);
  await page.goto('/household');
  const panel = page.getByTestId('household-member').filter({ hasText: 'Riley' });
  await expect(panel.getByTestId('member-login')).toContainText('None');
  await panel.getByTestId('invite-member').click();
  const url = await panel.getByTestId('invite-url').inputValue();
  expect(url).toMatch(/\/join\/[A-Za-z0-9_-]{40,}$/);
  await expect(panel.getByTestId('member-login')).toContainText('only time the link is shown');
  await axe(page);

  // the member, in a separate browser with no session
  const ctx = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const m = await ctx.newPage();
  await m.goto(new URL(url).pathname);
  await expect(m.getByRole('heading', { name: 'Welcome, Riley' })).toBeVisible();
  await axe(m);
  const email = uniqueEmail('riley');
  await m.getByLabel('Your e-mail').fill(email);
  await m.getByLabel('Choose a password').fill('short');
  await m.getByRole('button', { name: 'Create my sign-in' }).click();
  await expect(m.getByText(/at least 10 characters/i).first()).toBeVisible();
  await m.getByLabel('Choose a password').fill(PASSWORD + '-riley');
  await m.getByRole('button', { name: 'Create my sign-in' }).click();
  await expect(m).toHaveURL(/\/my$/);
  await expect(m.getByRole('heading', { name: 'Hi, Riley' })).toBeVisible();

  // only their own card
  const cards = m.getByTestId('my-cards');
  await expect(cards).toContainText('··2222');
  await expect(cards).not.toContainText('··1111');
  // a restricted shell: no search, no bell, no general navigation
  await expect(m.getByTestId('search-trigger')).toHaveCount(0);
  await expect(m.getByTestId('nav-notifications')).toHaveCount(0);
  await expect(m.getByRole('link', { name: 'Wallet' })).toHaveCount(0);
  await axe(m);

  // any other page sends the member back to their own view
  await m.goto('/wallet');
  await expect(m).toHaveURL(/\/my$/);
  await m.goto('/household');
  await expect(m).toHaveURL(/\/my$/);
  // and the server refuses the data as well
  const status = await m.evaluate(async () => {
    const s = await (await fetch('/api/auth/session')).json();
    return (await fetch('/api/v1/household', { headers: { Authorization: `Bearer ${s.accessToken}` } })).status;
  });
  expect(status).toBe(403);
  // the household overview is not shared yet
  await m.goto('/my/household');
  await expect(m.getByText(/not shared with this sign-in/i)).toBeVisible();

  // the owner now sees an active sign-in, shares the overview, then removes it
  await page.reload();
  await expect(panel.getByTestId('member-login')).toContainText('Active');
  await expect(panel.getByTestId('member-login')).toContainText(email);
  await panel.getByTestId('visibility').selectOption('HOUSEHOLD');
  await expect.poll(async () => (await m.evaluate(async () => {
    const s = await (await fetch('/api/auth/session')).json();
    return (await fetch('/api/v1/member/household', { headers: { Authorization: `Bearer ${s.accessToken}` } })).status;
  }))).toBe(200);
  await m.goto('/my/household');
  await expect(m.getByTestId('my-household-member')).toHaveCount(2);
  await expect(m.locator('body')).not.toContainText(owner.email);

  page.once('dialog', (d) => void d.accept());
  await panel.getByTestId('remove-login').click();
  await expect(panel.getByTestId('member-login')).toContainText('None');
  // the member is locked out at once, even though their page is still open
  const after = await m.evaluate(async () => {
    const s = await (await fetch('/api/auth/session')).json();
    return (await fetch('/api/v1/member/me', { headers: { Authorization: `Bearer ${s.accessToken}` } })).status;
  });
  expect(after).toBe(401);
  // the card they had is still in the household
  await page.goto('/household');
  await expect(page.getByTestId('household-member').filter({ hasText: 'Riley' })).toContainText('Contoso');
  await ctx.close();
});

test('a used or garbage invitation link shows a plain message', async ({ page, request }) => {
  const { owner, riley } = await household(request);
  const inv = await (await request.post(`/api/v1/household/members/${riley.id}/invite`, { headers: auth(owner.token) })).json();
  const token = new URL(inv.url).pathname.split('/join/')[1];
  const ok = await request.post('/api/v1/auth/accept-invite', { data: { token, email: uniqueEmail('r'), password: PASSWORD + '-x', name: 'R' } });
  expect(ok.status()).toBe(200);
  await page.goto(`/join/${token}`);
  await expect(page.getByTestId('invite-invalid')).toBeVisible();
  await expect(page.getByTestId('join-form')).toHaveCount(0);
  await axe(page);
  await page.goto('/join/definitely-not-a-real-token-0000000');
  await expect(page.getByTestId('invite-invalid')).toBeVisible();
});

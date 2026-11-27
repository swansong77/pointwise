import AxeBuilder from '@axe-core/playwright';
import { expect, test, APIRequestContext, Page } from '@playwright/test';
import { ADMIN, PASSWORD, apiLogin, apiRegister, uiLogin, uniqueEmail } from './helpers';

/** The owner lets a member edit their own cards and points, and stops being told about them (synthetic data). */
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

test('the owner lets a member edit; the member adds a card and points, edits, and marks a credit used', async ({ page, browser, request }) => {
  const h = await household(request);

  // by default the member can look but not change
  const ctx = await browser.newContext({ baseURL: (test.info().project.use as { baseURL?: string }).baseURL });
  const m = await ctx.newPage();
  await m.goto('/login');
  await m.getByLabel('Email').fill(h.email);
  await m.getByLabel('Password').fill(PASSWORD + '-riley');
  await m.getByTestId('login-submit').click();
  await expect(m).toHaveURL(/\/my$/);
  await expect(m.getByRole('heading', { name: 'Hi, Riley' })).toBeVisible();
  await expect(m.getByTestId('member-add-card')).toHaveCount(0);

  // the owner allows it
  await uiLogin(page, h.owner.email);
  await page.goto('/household');
  const panel = page.getByTestId('household-member').filter({ hasText: 'Riley' });
  const saved = page.waitForResponse((r) => r.url().includes('/household/members/') && r.request().method() === 'PATCH');
  await panel.getByTestId('can-edit').click();
  await saved;
  await expect(panel.getByTestId('can-edit')).toBeChecked();

  // the member sees the controls without signing in again (the server reads the setting live)
  await m.reload();
  await expect(m.getByTestId('member-add-card')).toBeVisible();
  await axe(m);

  // add a card
  await m.getByLabel('Find the card').fill('Gold');
  const select = m.getByLabel('Card', { exact: true });
  await expect(select.locator('option')).not.toHaveCount(1);
  await select.selectOption({ index: 1 });
  await m.getByLabel(/Last 4 digits/).first().fill('5555');
  await m.getByTestId('member-add-card-submit').click();
  const cards = m.getByTestId('my-cards');
  await expect(cards).toContainText('··5555');
  await expect(cards).toContainText('··2222');
  await expect(cards).not.toContainText('··1111');

  // edit its nickname
  const added = cards.locator('li').filter({ hasText: '··5555' });
  await added.getByTestId('member-card-edit').click();
  await added.getByLabel('Nickname').fill('Everyday card');
  await added.getByRole('button', { name: 'Save' }).click();
  await expect(cards).toContainText('Everyday card');

  // mark a credit used
  const credits = m.getByTestId('my-benefits');
  await expect(credits.getByTestId('member-use-credit').first()).toBeVisible();
  const used = m.waitForResponse((r) => r.url().includes('/member/benefits/') && r.request().method() === 'POST');
  await credits.getByTestId('member-use-credit').first().click();
  expect((await used).status()).toBe(201);

  // add a points account
  const program = m.getByLabel('Program');
  await expect(program.locator('option')).not.toHaveCount(1);
  await program.selectOption({ index: 1 });
  await m.getByLabel('Current balance').fill('5000');
  await m.getByTestId('member-add-account-submit').click();
  await expect(m.getByTestId('my-loyalty')).toContainText('5,000');
  await m.getByTestId('member-account-edit').click();
  await m.getByTestId('my-loyalty').getByLabel('Balance').fill('7500');
  await m.getByTestId('member-account-save').click();
  await expect(m.getByTestId('my-loyalty')).toContainText('7,500');
  await axe(m);

  // the owner sees the card on Riley (it is in the household), and the owner's own card is untouched
  await page.reload();
  await expect(page.getByTestId('household-member').filter({ hasText: 'Riley' })).toContainText('Everyday card');

  // taking the permission away is immediate
  const off = page.waitForResponse((r) => r.url().includes('/household/members/') && r.request().method() === 'PATCH');
  await page.getByTestId('household-member').filter({ hasText: 'Riley' }).getByTestId('can-edit').click();
  await off;
  await m.reload();
  await expect(m.getByTestId('member-add-card')).toHaveCount(0);
  await ctx.close();
});

test('the owner stops being told about a member, who still is', async ({ page, request }) => {
  const h = await household(request);
  await uiLogin(page, h.owner.email);
  await page.goto('/household');
  const panel = page.getByTestId('household-member').filter({ hasText: 'Riley' });
  await expect(panel.getByTestId('notify-owner')).toBeChecked();
  const saved = page.waitForResponse((r) => r.url().includes('/household/members/') && r.request().method() === 'PATCH');
  await panel.getByTestId('notify-owner').click();
  await saved;
  await expect(panel.getByTestId('notify-owner')).not.toBeChecked();
  await axe(page);

  const admin = await apiLogin(request, ADMIN.email, ADMIN.password);
  expect((await request.post('/api/v1/admin/jobs/scan-renewals/run', { headers: auth(admin) })).status()).toBe(201);
  const ownerNotes = await (await request.get('/api/v1/notifications', { headers: auth(h.owner.token) })).json();
  // only the owner's own card: Riley's renewal is not sent to the owner
  expect(ownerNotes.filter((n: { type: string }) => n.type === 'CARD_RENEWAL')).toHaveLength(1);
  const login = await request.post('/api/v1/auth/login', { data: { email: h.email, password: PASSWORD + '-riley' } });
  const memberNotes = await (await request.get('/api/v1/notifications', { headers: auth((await login.json()).accessToken) })).json();
  expect(memberNotes.filter((n: { type: string }) => n.type === 'CARD_RENEWAL')).toHaveLength(1);
});

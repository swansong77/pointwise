import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, login, register, uniqueEmail } from './helpers';

const V = '/api/v1';
let app: INestApplication;
const prisma = new PrismaClient();

beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const cardId = async (slug: string) => (await prisma.creditCard.findUniqueOrThrow({ where: { slug } })).id;
const categoryId = async (slug: string) => (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;

describe('health & docs', () => {
  it('GET /health', async () => {
    const res = await api(app).get('/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'up' });
  });
});

describe('auth', () => {
  it('register → me → refresh → logout', async () => {
    const u = await register(app);
    const me = await api(app).get(`${V}/me`).set(bearer(u.token)).expect(200);
    expect(me.body).toMatchObject({ email: u.email, role: 'USER', hasPassword: true });
    expect(me.body.passwordHash).toBeUndefined();

    const r1 = await api(app).post(`${V}/auth/refresh`).send({ refreshToken: u.refresh }).expect(200);
    expect(r1.body.refreshToken).not.toBe(u.refresh);
    // reusing the old refresh token is detected and revokes the family
    await api(app).post(`${V}/auth/refresh`).send({ refreshToken: u.refresh }).expect(401);
    await api(app).post(`${V}/auth/refresh`).send({ refreshToken: r1.body.refreshToken }).expect(401);

    const fresh = await api(app).post(`${V}/auth/login`).send({ email: u.email, password: 'integration-pass-1' }).expect(200);
    await api(app).post(`${V}/auth/logout`).send({ refreshToken: fresh.body.refreshToken }).expect(204);
    await api(app).post(`${V}/auth/refresh`).send({ refreshToken: fresh.body.refreshToken }).expect(401);
  });

  it('normalizes email case and rejects duplicates', async () => {
    const email = uniqueEmail('Case');
    await api(app).post(`${V}/auth/register`).send({ email: email.toUpperCase(), password: 'integration-pass-1' }).expect(201);
    await api(app).post(`${V}/auth/register`).send({ email, password: 'integration-pass-1' }).expect(409);
    await login(app, email.toUpperCase(), 'integration-pass-1');
  });

  it('validates input', async () => {
    const res = await api(app).post(`${V}/auth/register`).send({ email: 'not-an-email', password: 'short' }).expect(400);
    expect(res.body.message).toEqual(expect.arrayContaining([expect.stringMatching(/email/), expect.stringMatching(/password/)]));
    await api(app).post(`${V}/auth/register`).send({ email: uniqueEmail(), password: 'onlyletterslong' }).expect(400);
    await api(app).post(`${V}/auth/register`).send({ email: uniqueEmail(), password: 'integration-pass-1', role: 'ADMIN' }).expect(400);
  });

  it('wrong password → 401 with generic message', async () => {
    const res = await api(app).post(`${V}/auth/login`).send({ email: 'demo@pointwise.local', password: 'wrong-password' }).expect(401);
    expect(res.body.message).toBe('Invalid email or password');
  });

  it('protected routes require a valid token', async () => {
    await api(app).get(`${V}/me`).expect(401);
    await api(app).get(`${V}/me`).set(bearer('garbage')).expect(401);
  });

  it('oauth exchange requires the internal secret', async () => {
    const body = { provider: 'google', providerAccountId: `g-${Date.now()}`, email: uniqueEmail('oauth'), name: 'O' };
    await api(app).post(`${V}/auth/oauth`).send(body).expect(403);
    const ok = await api(app).post(`${V}/auth/oauth`).set('x-internal-secret', process.env.INTERNAL_API_SECRET as string).send(body).expect(200);
    expect(ok.body.user.email).toBe(body.email);
    // second time logs into the same account
    const again = await api(app).post(`${V}/auth/oauth`).set('x-internal-secret', process.env.INTERNAL_API_SECRET as string).send(body).expect(200);
    expect(again.body.user.id).toBe(ok.body.user.id);
  });

  it('forgot-password always 202 and reset with bad token 401', async () => {
    await api(app).post(`${V}/auth/forgot-password`).send({ email: 'nobody@nowhere.test' }).expect(202);
    await api(app).post(`${V}/auth/reset-password`).send({ token: 'x'.repeat(30), password: 'new-password-1' }).expect(401);
  });
});

describe('catalog (public)', () => {
  it('search cards with filters & pagination', async () => {
    const all = await api(app).get(`${V}/cards?pageSize=5`).expect(200);
    expect(all.body.items).toHaveLength(5);
    expect(all.body.total).toBeGreaterThanOrEqual(12);
    const q = await api(app).get(`${V}/cards?q=voyager`).expect(200);
    expect(q.body.items.every((c: { name: string }) => /voyager/i.test(c.name))).toBe(true);
    const noFee = await api(app).get(`${V}/cards?maxFeeCents=0&type=PERSONAL`).expect(200);
    expect(noFee.body.items.every((c: { annualFeeCents: number }) => c.annualFeeCents === 0)).toBe(true);
    await api(app).get(`${V}/cards?pageSize=1000`).expect(400);
    await api(app).get(`${V}/cards?network=BOGUS`).expect(400);
  });
  it('card detail by slug includes rewards and 404s', async () => {
    const res = await api(app).get(`${V}/cards/contoso-gold`).expect(200);
    expect(res.body.rewards.length).toBeGreaterThan(0);
    expect(res.body.currency.code).toBe('CONTOSO_PTS');
    await api(app).get(`${V}/cards/does-not-exist`).expect(404);
  });
  it('categories, issuers, merchants', async () => {
    const cats = await api(app).get(`${V}/categories`).expect(200);
    expect(cats.body.find((c: { isFallback: boolean }) => c.isFallback)).toBeTruthy();
    await api(app).get(`${V}/categories/dining`).expect(200);
    await api(app).get(`${V}/issuers`).expect(200);
    const m = await api(app).get(`${V}/merchants?q=fresh`).expect(200);
    expect(m.body.items[0].slug).toBe('freshcart');
    const byHost = await api(app).get(`${V}/merchants/by-host?host=www.shopnow.example`).expect(200);
    expect(byHost.body.slug).toBe('shopnow');
    const detail = await api(app).get(`${V}/merchants/freshcart`).expect(200);
    expect(detail.body.offers.length).toBeGreaterThan(0);
  });
});

describe('wallet, recommendations & calculator', () => {
  let t: string;
  let goldWc: string;
  beforeAll(async () => {
    t = (await register(app)).token;
  });

  it('adds cards and enforces free plan limit of 5', async () => {
    const slugs = ['contoso-gold', 'northwind-voyager', 'fabrikam-flex', 'fabrikam-double', 'litware-blue-cash'];
    for (const s of slugs) {
      const res = await api(app).post(`${V}/wallet/cards`).set(bearer(t)).send({ cardId: await cardId(s), approvedAt: '2026-01-10' }).expect(201);
      if (s === 'contoso-gold') goldWc = res.body.id;
    }
    const over = await api(app).post(`${V}/wallet/cards`).set(bearer(t)).send({ cardId: await cardId('tailspin-everyday-plus') }).expect(403);
    expect(over.body.message).toMatch(/limit/);
    const list = await api(app).get(`${V}/wallet/cards`).set(bearer(t)).expect(200);
    expect(list.body).toHaveLength(5);
  });

  it('rejects full card numbers and invalid input', async () => {
    await api(app).post(`${V}/wallet/cards`).set(bearer(t)).send({ cardId: await cardId('contoso-gold'), lastFour: '4111111111111111' }).expect(400);
    await api(app).post(`${V}/wallet/cards`).set(bearer(t)).send({ cardId: 'not-a-uuid' }).expect(400);
  });

  it('best card for dining is Contoso Gold (4X × 1.25¢ = 5¢)', async () => {
    const res = await api(app).get(`${V}/recommendations/categories/dining`).set(bearer(t)).expect(200);
    expect(res.body.ranked[0]).toMatchObject({ name: 'Contoso Gold', multiplier: 4, centsPerDollar: 5 });
  });

  it('activating a rotating category changes the gas winner', async () => {
    const before = await api(app).get(`${V}/recommendations/categories/gas`).set(bearer(t)).expect(200);
    expect(before.body.ranked[0].name).toBe('Litware Blue Cash'); // 3% vs Flex inactive 1%
    const flex = (await api(app).get(`${V}/wallet/cards`).set(bearer(t))).body.find((w: { card: { slug: string } }) => w.card.slug === 'fabrikam-flex');
    await api(app).patch(`${V}/wallet/cards/${flex.id}`).set(bearer(t)).send({ selectedCategoryIds: [await categoryId('gas')] }).expect(200);
    const after = await api(app).get(`${V}/recommendations/categories/gas`).set(bearer(t)).expect(200);
    expect(after.body.ranked[0]).toMatchObject({ name: 'Fabrikam Flex', centsPerDollar: 5 });
  });

  it('valuation override and pinning', async () => {
    const miles = await prisma.rewardCurrency.findUniqueOrThrow({ where: { code: 'NW_MILES' } });
    await api(app).put(`${V}/wallet/valuations`).set(bearer(t)).send({ currencyId: miles.id, centsPerPoint: 2.2 }).expect(200);
    const dining = await api(app).get(`${V}/recommendations/categories/dining`).set(bearer(t)).expect(200);
    expect(dining.body.ranked[0]).toMatchObject({ name: 'Northwind Voyager', centsPerDollar: 6.6 });
    await api(app).post(`${V}/wallet/pins`).set(bearer(t)).send({ walletCardId: goldWc, categoryId: await categoryId('dining') }).expect(201);
    const pinned = await api(app).get(`${V}/recommendations/categories/dining`).set(bearer(t)).expect(200);
    expect(pinned.body.ranked[0]).toMatchObject({ name: 'Contoso Gold', pinned: true });
    await api(app).delete(`${V}/wallet/pins?categoryId=${await categoryId('dining')}`).set(bearer(t)).expect(204);
  });

  it('merchant recommendation applies merchant-specific rules', async () => {
    const res = await api(app).get(`${V}/recommendations/merchants/freshcart`).set(bearer(t)).expect(200);
    expect(res.body.merchant.slug).toBe('freshcart');
    expect(res.body.ranked[0].name).toBe('Litware Blue Cash'); // 6% groceries
  });

  it('all-categories summary', async () => {
    const res = await api(app).get(`${V}/recommendations/categories`).set(bearer(t)).expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(16);
  });

  it('calculator: wallet value; compare requires Pro', async () => {
    const spend = [
      { categoryId: await categoryId('dining'), annualSpendCents: 600_000 },
      { categoryId: await categoryId('groceries'), annualSpendCents: 600_000 },
    ];
    const res = await api(app).post(`${V}/calculator`).set(bearer(t)).send({ spend }).expect(201);
    expect(res.body.result.grossRewardsCents).toBeGreaterThan(0);
    expect(res.body.result.categories).toHaveLength(2);
    await api(app).post(`${V}/calculator`).set(bearer(t)).send({ spend, candidateCardId: await cardId('northwind-voyager-reserve') }).expect(403);
    await api(app).post(`${V}/calculator`).set(bearer(t)).send({ spend: [{ categoryId: 'x', annualSpendCents: -5 }] }).expect(400);
  });

  it('IDOR: another user cannot modify my card', async () => {
    const other = (await register(app)).token;
    await api(app).patch(`${V}/wallet/cards/${goldWc}`).set(bearer(other)).send({ nickname: 'pwned' }).expect(403);
    await api(app).delete(`${V}/wallet/cards/${goldWc}`).set(bearer(other)).expect(403);
  });

  it('update validations and delete', async () => {
    await api(app).patch(`${V}/wallet/cards/${goldWc}`).set(bearer(t)).send({ approvedAt: '2026-05-01', closedAt: '2026-01-01' }).expect(400);
    await api(app).patch(`${V}/wallet/cards/${goldWc}`).set(bearer(t)).send({ nickname: 'Dining card', notes: 'keep' }).expect(200);
    const list = (await api(app).get(`${V}/wallet/cards`).set(bearer(t))).body as Array<{ id: string }>;
    await api(app).put(`${V}/wallet/order`).set(bearer(t)).send({ walletCardIds: list.map((w) => w.id).reverse() }).expect(204);
  });
});

describe('offers, transactions, dashboard & nearby', () => {
  let t: string;
  let wcId: string;
  beforeAll(async () => {
    t = (await register(app)).token;
    const res = await api(app).post(`${V}/wallet/cards`).set(bearer(t)).send({ cardId: await cardId('contoso-gold'), approvedAt: new Date(Date.now() - 30 * 86_400_000).toISOString() }).expect(201);
    wcId = res.body.id;
  });

  it('eligible → add → redeem partially → fully → listing by status', async () => {
    const eligible = await api(app).get(`${V}/offers/eligible`).set(bearer(t)).expect(200);
    const fresh = eligible.body.find((e: { offer: { title: string } }) => e.offer.title.startsWith('FreshCart'));
    expect(fresh).toBeTruthy();
    const added = await api(app).post(`${V}/offers/mine`).set(bearer(t)).send({ offerId: fresh.offer.id, walletCardId: wcId }).expect(201);
    await api(app).post(`${V}/offers/mine`).set(bearer(t)).send({ offerId: fresh.offer.id, walletCardId: wcId }).expect(409);

    await api(app).patch(`${V}/offers/mine/${added.body.id}`).set(bearer(t)).send({ amountUsedCents: 400 }).expect(200);
    await api(app).patch(`${V}/offers/mine/${added.body.id}`).set(bearer(t)).send({ amountUsedCents: 999_999 }).expect(422);
    const done = await api(app).patch(`${V}/offers/mine/${added.body.id}`).set(bearer(t)).send({ amountUsedCents: 1000 }).expect(200);
    expect(done.body.status).toBe('REDEEMED');
    const redeemed = await api(app).get(`${V}/offers/mine?status=REDEEMED`).set(bearer(t)).expect(200);
    expect(redeemed.body.map((o: { id: string }) => o.id)).toContain(added.body.id);
  });

  it('custom offer, snooze, favorite, delete', async () => {
    const ends = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const c = await api(app).post(`${V}/offers/custom`).set(bearer(t)).send({ walletCardId: wcId, title: 'Local bakery $5 off', kind: 'CASH', valueCents: 500, endsAt: ends }).expect(201);
    await api(app).patch(`${V}/offers/mine/${c.body.id}`).set(bearer(t)).send({ isFavorite: true, snoozedUntil: new Date(Date.now() + 86_400_000).toISOString() }).expect(200);
    const active = await api(app).get(`${V}/offers/mine`).set(bearer(t)).expect(200);
    expect(active.body.find((o: { id: string }) => o.id === c.body.id)).toBeUndefined(); // snoozed hidden
    const withSnoozed = await api(app).get(`${V}/offers/mine?includeSnoozed=true`).set(bearer(t)).expect(200);
    expect(withSnoozed.body[0]).toMatchObject({ id: c.body.id, isFavorite: true, snoozed: true });
    await api(app).patch(`${V}/offers/mine/${c.body.id}`).set(bearer(t)).send({ snoozedUntil: '2000-01-01T00:00:00Z' }).expect(422);
    await api(app).post(`${V}/offers/custom`).set(bearer(t)).send({ walletCardId: wcId, title: 'x', kind: 'PERCENT', valueCents: 1 }).expect(400);
    await api(app).post(`${V}/offers/custom`).set(bearer(t)).send({ walletCardId: wcId, title: 'bad url', kind: 'CASH', valueCents: 1, url: 'javascript:alert(1)' }).expect(400);
    await api(app).delete(`${V}/offers/mine/${c.body.id}`).set(bearer(t)).expect(204);
  });

  it('IDOR on offers', async () => {
    const other = (await register(app)).token;
    const mine = (await api(app).get(`${V}/offers/mine?status=ALL`).set(bearer(t))).body;
    await api(app).patch(`${V}/offers/mine/${mine[0].id}`).set(bearer(other)).send({ isFavorite: true }).expect(403);
    await api(app).get(`${V}/offers/mine?walletCardId=${wcId}`).set(bearer(other)).expect(403);
  });

  it('transactions update bonus progress; dashboard reflects it', async () => {
    const tx = await api(app).post(`${V}/transactions`).set(bearer(t)).send({ walletCardId: wcId, amountCents: 150_000, description: 'Groceries' }).expect(201);
    const dash = await api(app).get(`${V}/dashboard`).set(bearer(t)).expect(200);
    expect(dash.body.plan).toBe('FREE');
    expect(dash.body.bonuses[0]).toMatchObject({ spentCents: 150_000, requiredSpendCents: 600_000, percent: 25 });
    expect(dash.body.fiveTwentyFour.count).toBe(1);
    expect(dash.body.bestByCategory.length).toBeGreaterThan(0);
    await api(app).delete(`${V}/transactions/${tx.body.id}`).set(bearer(t)).expect(204);
    const dash2 = await api(app).get(`${V}/dashboard`).set(bearer(t)).expect(200);
    expect(dash2.body.bonuses[0].spentCents).toBe(0);
    const list = await api(app).get(`${V}/transactions`).set(bearer(t)).expect(200);
    expect(list.body).toHaveLength(0);
  });

  it('nearby returns sorted merchants with best card; validates coords', async () => {
    const res = await api(app).get(`${V}/nearby?lat=37.7749&lng=-122.4194&radius=2000`).set(bearer(t)).expect(200);
    expect(res.body.length).toBeGreaterThan(3);
    const d = res.body.map((r: { distanceM: number }) => r.distanceM);
    expect([...d].sort((a, b) => a - b)).toEqual(d);
    expect(res.body[0].bestCard.name).toBe('Contoso Gold');
    await api(app).get(`${V}/nearby?lat=200&lng=0`).set(bearer(t)).expect(400);
    const far = await api(app).get(`${V}/nearby?lat=0&lng=0`).set(bearer(t)).expect(200);
    expect(far.body).toEqual([]);
  });
});

describe('subscriptions, profiles & alerts (plan gating)', () => {
  it('free → pro via mock checkout unlocks alerts and profiles; cancel keeps pro until period end', async () => {
    const t = (await register(app)).token;
    await api(app).post(`${V}/me/alerts`).set(bearer(t)).send({ keywords: ['coffee'] }).expect(403);
    await api(app).post(`${V}/me/profiles`).set(bearer(t)).send({ nickname: 'Partner' }).expect(403);
    const plans = await api(app).get(`${V}/subscription/plans`).expect(200);
    expect(plans.body.year.cents).toBeGreaterThan(0);
    await api(app).post(`${V}/subscription/checkout`).set(bearer(t)).send({ interval: 'weekly' }).expect(400);
    const sub = await api(app).post(`${V}/subscription/checkout`).set(bearer(t)).send({ interval: 'month' }).expect(201);
    expect(sub.body).toMatchObject({ plan: 'PRO', status: 'ACTIVE', effectivePlan: 'PRO' });
    const alert = await api(app).post(`${V}/me/alerts`).set(bearer(t)).send({ keywords: ['coffee', ' '], minValueCents: 100 }).expect(201);
    expect(alert.body.keywords).toEqual(['coffee']);
    await api(app).patch(`${V}/me/alerts/${alert.body.id}`).set(bearer(t)).send({ keywords: ['tea'], isActive: false }).expect(200);
    const p = await api(app).post(`${V}/me/profiles`).set(bearer(t)).send({ nickname: 'Partner' }).expect(201);
    expect((await api(app).get(`${V}/me/profiles`).set(bearer(t))).body).toHaveLength(2);
    await api(app).delete(`${V}/me/profiles/${p.body.id}`).set(bearer(t)).expect(204);
    const canceled = await api(app).post(`${V}/subscription/cancel`).set(bearer(t)).expect(201);
    expect(canceled.body).toMatchObject({ status: 'CANCELED', effectivePlan: 'PRO' });
    const resumed = await api(app).post(`${V}/subscription/resume`).set(bearer(t)).expect(201);
    expect(resumed.body.status).toBe('ACTIVE');
    await api(app).delete(`${V}/me/alerts/${alert.body.id}`).set(bearer(t)).expect(204);
    await api(app).delete(`${V}/me/alerts/${alert.body.id}`).set(bearer(t)).expect(404);
  });
});

describe('notifications & jobs', () => {
  it('expiring-offer job notifies a user idempotently; read flows', async () => {
    const admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
    const u = await register(app);
    const demo = u.token;
    const wc = await api(app).post(`${V}/wallet/cards`).set(bearer(demo)).send({ cardId: await cardId('contoso-gold') }).expect(201);
    const fresh = await prisma.offer.findFirstOrThrow({ where: { title: { startsWith: 'FreshCart' }, isCustom: false } });
    await api(app).post(`${V}/offers/mine`).set(bearer(demo)).send({ offerId: fresh.id, walletCardId: wc.body.id }).expect(201);

    const r1 = await api(app).post(`${V}/admin/jobs/scan-expiring-offers/run`).set(bearer(admin)).expect(201);
    expect(r1.body.created).toBeGreaterThan(0);
    const mine = { userId: u.userId, type: 'OFFER_EXPIRING' as const };
    expect(await prisma.notification.count({ where: mine })).toBe(1);
    await api(app).post(`${V}/admin/jobs/scan-expiring-offers/run`).set(bearer(admin)).expect(201);
    expect(await prisma.notification.count({ where: mine })).toBe(1); // dedupe
    for (const job of ['scan-renewals', 'scan-bonus-deadlines', 'match-offer-alerts', 'expire-offers']) {
      await api(app).post(`${V}/admin/jobs/${job}/run`).set(bearer(admin)).expect(201);
    }
    await api(app).post(`${V}/admin/jobs/not-a-job/run`).set(bearer(admin)).expect(400);

    const list = await api(app).get(`${V}/notifications?unreadOnly=true`).set(bearer(demo)).expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    await api(app).post(`${V}/notifications/${list.body[0].id}/read`).set(bearer(demo)).expect(204);
    await api(app).post(`${V}/notifications/read-all`).set(bearer(demo)).expect(204);
    expect((await api(app).get(`${V}/notifications/unread-count`).set(bearer(demo))).body.count).toBe(0);
    const prefs = await api(app).put(`${V}/notifications/preferences`).set(bearer(demo)).send({ expiringDays: 14 }).expect(200);
    expect(prefs.body.expiringDays).toBe(14);
    await api(app).put(`${V}/notifications/preferences`).set(bearer(demo)).send({ expiringDays: 0 }).expect(400);
    await api(app).put(`${V}/notifications/preferences`).set(bearer(demo)).send({ expiringDays: 7 }).expect(200);
  });
});

describe('admin RBAC & audit', () => {
  it('non-admin is forbidden; admin CRUD is audited', async () => {
    const user = (await register(app)).token;
    await api(app).get(`${V}/admin/stats`).set(bearer(user)).expect(403);
    await api(app).post(`${V}/admin/jobs/expire-offers/run`).set(bearer(user)).expect(403);

    const admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
    const stats = await api(app).get(`${V}/admin/stats`).set(bearer(admin)).expect(200);
    expect(stats.body.users).toBeGreaterThan(0);
    const issuer = await prisma.issuer.findFirstOrThrow();
    const cur = await prisma.rewardCurrency.findFirstOrThrow({ where: { code: 'CASH' } });
    const dining = await categoryId('dining');
    const slug = `test-card-${Date.now()}`;
    const card = await api(app).post(`${V}/admin/cards`).set(bearer(admin)).send({
      slug, name: 'Test Card', issuerId: issuer.id, network: 'VISA', currencyId: cur.id, annualFeeCents: 0,
      rewards: [{ categoryId: dining, multiplier: 3, description: '3% dining' }],
    }).expect(201);
    await api(app).patch(`${V}/admin/cards/${card.body.id}`).set(bearer(admin)).send({ name: 'Test Card 2', rewards: [{ categoryId: dining, multiplier: 4, description: '4% dining' }] }).expect(200);
    const detail = await api(app).get(`${V}/cards/${slug}`).expect(200);
    expect(detail.body.rewards[0].multiplier).toBe('4');
    await api(app).post(`${V}/admin/cards`).set(bearer(admin)).send({ slug: 'Bad Slug!', name: 'x' }).expect(400);
    await api(app).delete(`${V}/admin/cards/${card.body.id}`).set(bearer(admin)).expect(204);

    const cat = await api(app).post(`${V}/admin/categories`).set(bearer(admin)).send({ slug: `cat-${Date.now()}`, name: 'Test Cat' }).expect(201);
    await api(app).patch(`${V}/admin/categories/${cat.body.id}`).set(bearer(admin)).send({ name: 'Test Cat 2' }).expect(200);
    const mer = await api(app).post(`${V}/admin/merchants`).set(bearer(admin)).send({ slug: `mer-${Date.now()}`, name: 'Test Merchant', categoryId: cat.body.id, hosts: ['test-merchant.example'] }).expect(201);
    await api(app).patch(`${V}/admin/merchants/${mer.body.id}`).set(bearer(admin)).send({ isPopular: true }).expect(200);
    const offer = await api(app).post(`${V}/admin/offers`).set(bearer(admin)).send({ title: 'Admin offer', kind: 'CASH', valueCents: 500, merchantId: mer.body.id, endsAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(201);
    await api(app).patch(`${V}/admin/offers/${offer.body.id}`).set(bearer(admin)).send({ valueCents: 700 }).expect(200);
    await api(app).delete(`${V}/admin/offers/${offer.body.id}`).set(bearer(admin)).expect(204);

    const audit = await api(app).get(`${V}/admin/audit?pageSize=50`).set(bearer(admin)).expect(200);
    expect(audit.body.some((a: { entityId: string; action: string }) => a.entityId === card.body.id && a.action === 'deactivate')).toBe(true);
    const users = await api(app).get(`${V}/admin/users?q=pointwise.local`).set(bearer(admin)).expect(200);
    expect(users.body.total).toBeGreaterThanOrEqual(2);
  });

  it('admin can change roles', async () => {
    const admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
    const u = await register(app);
    await api(app).patch(`${V}/admin/users/${u.userId}/role`).set(bearer(admin)).send({ role: 'ADMIN' }).expect(200);
    await api(app).patch(`${V}/admin/users/${u.userId}/role`).set(bearer(admin)).send({ role: 'ROOT' }).expect(400);
  });
});

describe('privacy: export & delete', () => {
  it('exports without secrets and hard-deletes the account', async () => {
    const u = await register(app);
    await api(app).patch(`${V}/me`).set(bearer(u.token)).send({ name: 'Renamed', countryCode: 'ca' }).expect(200);
    const exp = await api(app).get(`${V}/me/export`).set(bearer(u.token)).expect(200);
    expect(exp.body.user.email).toBe(u.email);
    expect(exp.body.user.countryCode).toBe('CA');
    expect(JSON.stringify(exp.body)).not.toContain('passwordHash');
    await api(app).post(`${V}/analytics/events`).set(bearer(u.token)).send({ name: 'page_viewed', properties: { page: '/x' } }).expect(202);
    await api(app).post(`${V}/analytics/events`).set(bearer(u.token)).send({ name: 'Bad Name' }).expect(400);
    await api(app).delete(`${V}/me`).set(bearer(u.token)).expect(204);
    expect(await prisma.user.findUnique({ where: { id: u.userId } })).toBeNull();
    await api(app).post(`${V}/auth/login`).send({ email: u.email, password: 'integration-pass-1' }).expect(401);
  });
});

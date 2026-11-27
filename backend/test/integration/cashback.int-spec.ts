import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CashbackService } from '../../src/cashback/cashback.service';
import { seedCashbackSites } from '../../src/seed/cashback-sites';
import { api, bearer, createApp, login, register } from './helpers';

/** Cash-back sites: status, rates (typed, CSV, pasted), the household's accounts, and the recommendation in the shopping plan (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let svc: CashbackService;
let admin: string;
let merchant: { id: string; slug: string; name: string };

beforeAll(async () => {
  process.env.MAILBOX_ALLOW_PRIVATE_HOSTS = 'true'; // no DNS lookups in tests
  app = await createApp();
  svc = app.get(CashbackService);
  admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
  merchant = await prisma.merchant.findFirstOrThrow({ where: { slug: { not: 'hilton' } }, select: { id: true, slug: true, name: true }, orderBy: { slug: 'asc' } });
});
afterAll(async () => {
  delete process.env.MAILBOX_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await prisma.portalRate.deleteMany({ where: { merchantId: merchant.id } });
  await prisma.cashbackSite.updateMany({ data: { reachable: null, lastCheckedAt: null, failures: 0, httpStatus: null, lastError: null } });
  svc.fetcher = async () => ({ status: 200 });
});

const get = (t: string, path: string) => api(app).get(V + path).set(bearer(t));
const put = (t: string, path: string, body: object) => api(app).put(V + path).set(bearer(t)).send(body);
const post = (t: string, path: string, body: object = {}) => api(app).post(V + path).set(bearer(t)).send(body);
const rate = (body: object) => post(admin, '/admin/cashback/rates', { merchant: merchant.slug, ...body });

describe('TC-CB: the list of sites and who may change it', () => {
  it('starts with the common sites, none checked yet, and is seeded without overwriting the administrator', async () => {
    const u = (await register(app)).token;
    const sites = (await get(u, '/cashback/sites').expect(200)).body;
    expect(sites.map((s: any) => s.code)).toEqual(expect.arrayContaining(['rakuten', 'topcashback', 'swagbucks', 'aadvantage-eshopping']));
    expect(sites.find((s: any) => s.code === 'rakuten')).toMatchObject({ kind: 'CASHBACK', health: 'UNKNOWN', accounts: [], autoRead: false });
    expect(sites.find((s: any) => s.code === 'swagbucks').kind).toBe('POINTS');
    // an administrator's edit survives a re-seed
    await api(app).put(`${V}/admin/cashback/sites/rakuten`).set(bearer(admin)).send({ notes: 'my note' }).expect(200);
    expect(await seedCashbackSites(prisma)).toBe(0);
    expect((await prisma.cashbackSite.findUniqueOrThrow({ where: { code: 'rakuten' } })).notes).toBe('my note');
    await api(app).put(`${V}/admin/cashback/sites/rakuten`).set(bearer(admin)).send({ notes: null }).expect(200);
  });

  it('only an administrator edits sites and rates', async () => {
    const u = (await register(app)).token;
    for (const r of [get(u, '/admin/cashback/sites'), post(u, '/admin/cashback/rates', {}), post(u, '/admin/cashback/status', {}), post(u, '/admin/cashback/rates/import', { csv: 'site,merchant,rate\na,b,1' }), put(u, '/admin/cashback/sites/rakuten', { notes: 'x' })]) {
      expect((await r).status).toBe(403);
    }
    await get('', '/cashback/sites').expect(401);
  });

  it('adds a site (https only) and refuses a bad address or an incomplete new site', async () => {
    await put(admin, '/admin/cashback/sites/my-portal', { name: 'My Portal', homeUrl: 'http://insecure.example.test' }).expect(400);
    await put(admin, '/admin/cashback/sites/my-portal', { name: 'My Portal' }).expect(400);
    await put(admin, '/admin/cashback/sites/Bad_Code', { name: 'x', homeUrl: 'https://x.example.test' }).expect(400);
    const s = (await put(admin, '/admin/cashback/sites/my-portal', { name: 'My Portal', homeUrl: 'https://portal.example.test', kind: 'POINTS', pointCents: 1.2 }).expect(200)).body;
    expect(s).toMatchObject({ code: 'my-portal', kind: 'POINTS', autoRead: false, isActive: true });
    await prisma.cashbackSite.delete({ where: { code: 'my-portal' } });
  });
});

describe('TC-CB-STATUS: is the site answering?', () => {
  it('records an answer, calls a site down only after repeated failures, and recovers', async () => {
    const u = (await register(app)).token;
    svc.fetcher = async (url) => ({ status: url.includes('topcashback') ? 503 : 200 });
    expect((await post(admin, '/admin/cashback/status', { site: 'rakuten' }).expect(200)).body[0]).toMatchObject({ state: 'UP', httpStatus: 200 });
    expect((await post(admin, '/admin/cashback/status', { site: 'topcashback' }).expect(200)).body[0].state).toBe('UNKNOWN');
    expect((await post(admin, '/admin/cashback/status', { site: 'topcashback' }).expect(200)).body[0].state).toBe('DOWN');
    const sites = (await get(u, '/cashback/sites').expect(200)).body;
    expect(sites.find((s: any) => s.code === 'rakuten').health).toBe('UP');
    expect(sites.find((s: any) => s.code === 'topcashback')).toMatchObject({ health: 'DOWN' });
    svc.fetcher = async () => ({ status: 200 });
    expect((await post(admin, '/admin/cashback/status', { site: 'topcashback' }).expect(200)).body[0].state).toBe('UP');
    expect((await prisma.cashbackSite.findUniqueOrThrow({ where: { code: 'topcashback' } })).failures).toBe(0);
  });

  it('a site that answers with a client error is still up; a network failure is a failure; the scheduled job checks every site', async () => {
    svc.fetcher = async () => ({ status: 403 });
    expect((await post(admin, '/admin/cashback/status', { site: 'rakuten' }).expect(200)).body[0].state).toBe('UP');
    svc.fetcher = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    await post(admin, '/admin/cashback/status', { site: 'rakuten' }).expect(200);
    expect((await prisma.cashbackSite.findUniqueOrThrow({ where: { code: 'rakuten' } }))).toMatchObject({ reachable: false, failures: 1 });
    svc.fetcher = async () => ({ status: 200 });
    const n = await svc.checkAll();
    expect(n).toBe(await prisma.cashbackSite.count({ where: { isActive: true } }));
    await post(admin, '/admin/cashback/status', { site: 'no-such-site' }).expect(404);
  });
});

describe('TC-CB-RATES: getting offers in', () => {
  it('a rate is entered, replaced rather than duplicated, and refused for an unknown site or store', async () => {
    const a = (await rate({ site: 'rakuten', ratePercent: 2 }).expect(201)).body;
    expect(a).toMatchObject({ created: true, site: 'Rakuten', merchant: merchant.name });
    const b = (await rate({ site: 'rakuten', ratePercent: 3, conditions: 'new members' }).expect(201)).body;
    expect(b.created).toBe(false);
    const rows = (await get(admin, `/admin/cashback/rates?merchant=${merchant.slug}`).expect(200)).body;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ site: 'rakuten', ratePercent: 3, method: 'MANUAL', conditions: 'new members', expired: false });
    await rate({ site: 'nonesuch', ratePercent: 2 }).expect(400);
    await post(admin, '/admin/cashback/rates', { merchant: 'no-such-store', site: 'rakuten', ratePercent: 2 }).expect(400);
    await rate({ site: 'rakuten' }).expect(400);
    await rate({ site: 'rakuten', ratePercent: 500 }).expect(400);
    await del(admin, rows[0].id);
    expect((await get(admin, `/admin/cashback/rates?merchant=${merchant.slug}`).expect(200)).body).toHaveLength(0);
  });

  it('a CSV is imported with the good rows kept and the bad ones reported by line', async () => {
    const csv = ['site,merchant,rate,expires,conditions', `rakuten,${merchant.slug},2%,2099-12-31,selected items`, `topcashback,${merchant.slug},up to 6%,,`, `rakuten,no-such-store,4%,,`, `nonesuch,${merchant.slug},4%,,`, `rakuten,${merchant.slug},lots,,`].join('\n');
    const r = (await post(admin, '/admin/cashback/rates/import', { csv }).expect(200)).body;
    expect(r).toMatchObject({ created: 2, updated: 0 });
    expect(r.errors.map((e: any) => e.line)).toEqual([4, 5, 6]);
    const again = (await post(admin, '/admin/cashback/rates/import', { csv: csv.split('\n').slice(0, 3).join('\n') }).expect(200)).body;
    expect(again).toMatchObject({ created: 0, updated: 2 });
    expect((await prisma.portalRate.findMany({ where: { merchantId: merchant.id } })).map((x) => x.method)).toEqual(['CSV', 'CSV']);
  });

  it('pasted store-page text is read, shown for confirmation, and only saved when asked', async () => {
    const text = 'Get up to 9% of the price back with our offers. Also 2% Cash Back on electronics';
    const preview = (await post(admin, '/admin/cashback/rates/paste', { site: 'topcashback', merchant: merchant.slug, text, save: false }).expect(200)).body;
    expect(preview).toMatchObject({ saved: false, ratePercent: 9, upTo: true });
    expect(await prisma.portalRate.count({ where: { merchantId: merchant.id } })).toBe(0);
    const saved = (await post(admin, '/admin/cashback/rates/paste', { site: 'topcashback', merchant: merchant.slug, text, save: true }).expect(200)).body;
    expect(saved).toMatchObject({ saved: true, created: true });
    expect(await prisma.portalRate.findFirstOrThrow({ where: { merchantId: merchant.id } })).toMatchObject({ method: 'PASTE', upTo: true });
    await post(admin, '/admin/cashback/rates/paste', { site: 'topcashback', merchant: merchant.slug, text: 'Free shipping over $50', save: true }).expect(400);
  });
});

describe('TC-CB-CMP: a comparison page pasted for one store', () => {
  const table = 'Portal\tRate\nShopBack\t5%\nTop Cashback\t2%\nRakuten\t1%*\nMr. Rebates\t3%\nSome New Portal 4%';

  it('shows what was read for each known site first, then saves them all, replacing rather than duplicating', async () => {
    const preview = (await post(admin, '/admin/cashback/rates/compare', { merchant: merchant.slug, text: table, save: false }).expect(200)).body;
    expect(preview).toMatchObject({ saved: false, merchant: merchant.name });
    expect(preview.rates.map((r: any) => [r.site, r.ratePercent, r.upTo, r.inList])).toEqual([['shopback', 5, false, true], ['topcashback', 2, false, true], ['rakuten', 1, true, true], ['mrrebates', 3, false, true]]);
    expect(preview.unknown).toEqual(['Some New Portal']);
    expect(preview.monitorUrl).toMatch(/^https:\/\/www\.cashbackmonitor\.com\/cashback-store\/[a-z0-9-]+\/$/);
    expect(await prisma.portalRate.count({ where: { merchantId: merchant.id } })).toBe(0);
    const saved = (await post(admin, '/admin/cashback/rates/compare', { merchant: merchant.slug, text: table, save: true }).expect(200)).body;
    expect(saved).toMatchObject({ saved: true, created: 4, updated: 0, skipped: [] });
    const again = (await post(admin, '/admin/cashback/rates/compare', { merchant: merchant.slug, text: table, save: true }).expect(200)).body;
    expect(again).toMatchObject({ created: 0, updated: 4 });
    const rows = await prisma.portalRate.findMany({ where: { merchantId: merchant.id }, orderBy: { portal: 'asc' } });
    expect(rows.map((r) => [r.portal, Number(r.ratePercent), r.upTo, r.method])).toEqual([['mrrebates', 3, false, 'PASTE'], ['rakuten', 1, true, 'PASTE'], ['shopback', 5, false, 'PASTE'], ['topcashback', 2, false, 'PASTE']]);
    expect(rows.find((r) => r.portal === 'rakuten')!.conditions).toMatch(/special rate/);
  });

  it('skips a site that is not in this server\'s list, refuses text with no known site, an unknown store, and a non-administrator', async () => {
    await prisma.cashbackSite.update({ where: { code: 'shopback' }, data: { isActive: true } });
    await prisma.cashbackSite.delete({ where: { code: 'shopback' } });
    try {
      const r = (await post(admin, '/admin/cashback/rates/compare', { merchant: merchant.slug, text: table, save: true }).expect(200)).body;
      expect(r.skipped).toEqual(['ShopBack']);
      expect(r.created).toBe(3);
    } finally {
      await seedCashbackSites(prisma);
    }
    await post(admin, '/admin/cashback/rates/compare', { merchant: merchant.slug, text: 'Nothing useful here 100%', save: false }).expect(400);
    await post(admin, '/admin/cashback/rates/compare', { merchant: 'no-such-store', text: table, save: false }).expect(400);
    const u = (await register(app)).token;
    await post(u, '/admin/cashback/rates/compare', { merchant: merchant.slug, text: table, save: false }).expect(403);
  });

  it('the recommendation carries the store\'s Cashback Monitor page for comparison', async () => {
    const u = (await register(app)).token;
    await rate({ site: 'rakuten', ratePercent: 2 }).expect(201);
    const r = (await get(u, `/cashback/recommend?merchant=${merchant.slug}`).expect(200)).body;
    expect(r.monitorUrl).toMatch(/cashbackmonitor\.com\/cashback-store\//);
  });
});

describe('TC-CB-REC: which site to use', () => {
  const del = (t: string, id: string) => api(app).delete(`${V}/admin/cashback/rates/${id}`).set(bearer(t)).expect(204);
  void del;

  async function setup() {
    const u = await register(app);
    await rate({ site: 'rakuten', ratePercent: 2 }).expect(201);
    await rate({ site: 'topcashback', ratePercent: 9, upTo: true }).expect(201);
    return u;
  }
  const rec = async (t: string, amount = 50_000) => (await get(t, `/cashback/recommend?merchant=${merchant.slug}&amount=${amount}&payWith=Gold%20Card`).expect(200)).body;

  it('with no accounts recorded it names the best site overall and asks which you use', async () => {
    const u = await setup();
    const r = await rec(u.token);
    expect(r).toMatchObject({ haveAccounts: false, merchant: { name: merchant.name } });
    expect(r.pick).toMatchObject({ site: 'topcashback', upTo: true, expectedCents: 2700 });
    expect(r.warnings.join(' ')).toMatch(/does not know which of these sites you use/);
  });

  it('recommends only the sites the household uses, suggests a better one to join, and names who has the account', async () => {
    const u = await setup();
    await put(u.token, '/cashback/accounts/rakuten', { has: true }).expect(204);
    const r = await rec(u.token);
    expect(r.haveAccounts).toBe(true);
    expect(r.pick).toMatchObject({ site: 'rakuten', expectedCents: 1000, hasAccount: true });
    expect(r.pick.holders).toHaveLength(1);
    expect(r.consider).toMatchObject({ site: 'topcashback', extraCents: 1700 });
    expect(r.steps[0]).toContain('Sign in to Rakuten');
    expect(r.steps.join(' ')).toContain('Pay with Gold Card');
    // the sites list shows the account, and removing it takes it away
    expect((await get(u.token, '/cashback/sites').expect(200)).body.find((s: any) => s.code === 'rakuten').accounts).toHaveLength(1);
    await put(u.token, '/cashback/accounts/rakuten', { has: false }).expect(204);
    expect((await rec(u.token)).haveAccounts).toBe(false);
  });

  it('a household member can be the one who has the account, and nobody can record an account for someone else\'s household', async () => {
    const owner = await register(app);
    await post(owner.token, '/subscription/checkout', { interval: 'month' }).expect(201);
    const riley = (await post(owner.token, '/household/members', { nickname: 'Riley', relationship: 'SPOUSE' }).expect(201)).body;
    await rate({ site: 'rakuten', ratePercent: 2 }).expect(201);
    await put(owner.token, '/cashback/accounts/rakuten', { has: true, profileId: riley.id }).expect(204);
    const r = await rec(owner.token);
    expect(r.pick.holders).toEqual(['Riley']);
    expect(r.steps[0]).toContain('Riley has the account');
    const stranger = await register(app);
    await put(stranger.token, '/cashback/accounts/rakuten', { has: true, profileId: riley.id }).expect(404);
    await put(owner.token, '/cashback/accounts/no-such-site', { has: true }).expect(404);
    expect(await prisma.userCashbackAccount.count({ where: { userId: owner.userId } })).toBe(1);
  });

  it('skips a site that looks down, an expired rate and a store with no cash back; says so when nothing is left', async () => {
    const u = await setup();
    svc.fetcher = async () => ({ status: 503 });
    await post(admin, '/admin/cashback/status', { site: 'topcashback' }).expect(200);
    await post(admin, '/admin/cashback/status', { site: 'topcashback' }).expect(200);
    let r = await rec(u.token);
    expect(r.pick.site).toBe('rakuten');
    expect(r.ranked.find((x: any) => x.site === 'topcashback')).toMatchObject({ usable: false, health: 'DOWN' });
    await prisma.portalRate.updateMany({ where: { merchantId: merchant.id, portal: 'rakuten' }, data: { expiresAt: new Date(Date.now() - 86_400_000) } });
    r = await rec(u.token);
    expect(r.pick).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/No cash-back rate is on file|No usable cash-back rate/);
    await get(u.token, '/cashback/recommend?merchant=no-such-store').expect(404);
    await get(u.token, '/cashback/recommend').expect(400);
  });

  it('an old rate is flagged and trusted less than a fresh one', async () => {
    const u = await setup();
    const fresh = (await rec(u.token)).ranked.find((x: any) => x.site === 'rakuten');
    await prisma.portalRate.updateMany({ where: { merchantId: merchant.id, portal: 'rakuten' }, data: { observedAt: new Date(Date.now() - 45 * 86_400_000) } });
    const old = (await rec(u.token)).ranked.find((x: any) => x.site === 'rakuten');
    expect(old.freshness).toBe('STALE');
    expect(old.reliability).toBeLessThan(fresh.reliability);
    expect(old.warnings.join(' ')).toMatch(/45 days ago/);
  });
});

describe('TC-CB-PLAN: in the shopping plan', () => {
  it('the plan counts the best site the household uses, cites it, and carries the recommendation with the card to pay with', async () => {
    const u = await register(app);
    const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
    await post(u.token, '/wallet/cards', { cardId: card.id, approvedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }).expect(201);
    await rate({ site: 'rakuten', ratePercent: 2 }).expect(201);
    await rate({ site: 'topcashback', ratePercent: 9, upTo: true }).expect(201);
    await put(u.token, '/cashback/accounts/rakuten', { has: true }).expect(204);
    const r = (await post(u.token, '/offers/intel/plan', { merchantText: merchant.name, amountCents: 50_000 }).expect(201)).body;
    expect(r.cashback.pick).toMatchObject({ site: 'rakuten' });
    expect(r.cashback.consider.site).toBe('topcashback');
    expect(r.plans[0].portal).toEqual({ portal: 'Rakuten', cents: 1000 });
    expect(r.plans[0].evidence.join(' ')).toMatch(/portal Rakuten: 2%/);
    expect(r.cashback.steps.join(' ')).toContain(`Pay with ${r.plans[0].legs[0].cardName}`);
    // a user who uses no listed site gets the best overall, at the "up to" haircut
    const other = await register(app);
    await post(other.token, '/wallet/cards', { cardId: card.id, approvedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }).expect(201);
    const o = (await post(other.token, '/offers/intel/plan', { merchantText: merchant.name, amountCents: 50_000 }).expect(201)).body;
    expect(o.plans[0].portal).toEqual({ portal: 'TopCashback', cents: 2700 });
  });

  it('a merchant with no rate has no recommendation and the plan is unchanged', async () => {
    const u = await register(app);
    const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
    await post(u.token, '/wallet/cards', { cardId: card.id, approvedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }).expect(201);
    const r = (await post(u.token, '/offers/intel/plan', { merchantText: merchant.name, amountCents: 50_000 }).expect(201)).body;
    expect(r.cashback.pick).toBeNull();
    expect(r.plans[0].portal).toBeNull();
    expect(r.cashback.warnings[0]).toMatch(/No cash-back rate is on file/);
  });
});

async function del(t: string, id: string) {
  await api(app).delete(`${V}/admin/cashback/rates/${id}`).set(bearer(t)).expect(204);
}

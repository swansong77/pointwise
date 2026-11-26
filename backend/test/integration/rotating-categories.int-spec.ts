import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { runRotatingJob } from '../../src/jobs/rotating.job';
import { applyRotating } from '../../src/seed/rotating.apply';
import { api, bearer, createApp, login, register } from './helpers';

/** Quarterly rotating categories: applying a quarter, replacing it, the daily job's notices, and the admin import. Synthetic card only. */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let userId: string;
let cardId: string;
const SLUG = 'rotating-test-card';
const Q4 = new Date('2026-11-26T12:00:00Z');
const entry = (quarter: string, cats: string[], extra = {}) => ({ cards: [SLUG], quarter, categories: cats.map((cat) => ({ cat, mult: 5, desc: `5% on ${cat} once activated` })), capDollars: 1500, sourceUrl: 'https://example.com/rotating', checkedOn: '2026-11-26', ...extra });
const notices: Array<{ userId: string; title: string; key?: string }> = [];
const notify = async (u: string, _t: 'SYSTEM', title: string, _b: string, _l?: string, key?: string) => {
  notices.push({ userId: u, title, key });
};

beforeAll(async () => {
  app = await createApp();
  const u = await register(app);
  token = u.token;
  userId = u.userId;
  const cash = await prisma.rewardCurrency.findUniqueOrThrow({ where: { code: 'CASH' } });
  const issuer = await prisma.issuer.findFirstOrThrow();
  const base = await prisma.category.findUniqueOrThrow({ where: { slug: 'everything-else' } });
  const card = await prisma.creditCard.create({ data: { slug: SLUG, name: 'Rotating Test', issuerId: issuer.id, currencyId: cash.id, network: 'VISA', annualFeeCents: 0, catalogSource: 'SEED', rewards: { create: [{ categoryId: base.id, multiplier: 1, description: '1%' }] } } });
  cardId = card.id;
  await api(app).post(`${V}/wallet/cards`).set(bearer(token)).send({ cardId }).expect(201);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.creditCard.deleteMany({ where: { id: cardId } });
  await app.close();
  await prisma.$disconnect();
});

const rotatingRows = () => prisma.reward.findMany({ where: { cardId, isRotating: true }, include: { category: true }, orderBy: { category: { slug: 'asc' } } });

describe('applying a quarter', () => {
  it('creates one rotating row per category with the quarter dates and cap, and repeating changes nothing', async () => {
    const a = await applyRotating(prisma, [entry('2026-Q4', ['groceries', 'dining'])]);
    expect([a.created, a.updated, a.removed, a.problems]).toEqual([2, 0, 0, []]);
    const rows = await rotatingRows();
    expect(rows.map((r) => r.category!.slug)).toEqual(['dining', 'groceries']);
    expect(rows[0]).toMatchObject({ capCents: 150000, capPeriod: 'QUARTER', conditional: false });
    expect(rows[0].startsAt!.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(rows[0].endsAt!.toISOString()).toBe('2026-12-31T23:59:59.000Z');
    const b = await applyRotating(prisma, [entry('2026-Q4', ['groceries', 'dining'])]);
    expect([b.created, b.updated, b.removed]).toEqual([0, 2, 0]);
    expect(await rotatingRows()).toHaveLength(2);
  });

  it('a corrected entry replaces the old one for that quarter and keeps other quarters', async () => {
    await applyRotating(prisma, [entry('2027-Q1', ['gas'])]);
    const r = await applyRotating(prisma, [entry('2026-Q4', ['groceries', 'streaming'])]);
    expect([r.created, r.removed]).toEqual([1, 1]);
    const slugs = (await rotatingRows()).map((x) => `${x.startsAt!.toISOString().slice(0, 7)}:${x.category!.slug}`);
    expect(slugs.sort()).toEqual(['2026-10:groceries', '2026-10:streaming', '2027-01:gas']);
  });

  it('refuses bad entries without writing anything', async () => {
    const before = await rotatingRows();
    const r = await applyRotating(prisma, [entry('2026-Q4', ['not-a-category']), { ...entry('2026-Q4', ['gas']), cards: ['no-such-card'] }]);
    expect(r.problems.join(' ')).toMatch(/unknown category/);
    expect(r.problems.join(' ')).toMatch(/no such card/);
    expect(await rotatingRows()).toHaveLength(before.length);
  });

  it('leaves a card an admin edited alone', async () => {
    await prisma.creditCard.update({ where: { id: cardId }, data: { catalogSource: 'ADMIN' } });
    const r = await applyRotating(prisma, [entry('2026-Q4', ['gas'])]);
    expect(r.entries).toBe(0);
    await prisma.creditCard.update({ where: { id: cardId }, data: { catalogSource: 'SEED' } });
  });
});

describe('the quarter changes the ranking only for a selected, in-date category', () => {
  it('ranks the rotating rate in its quarter and not outside it', async () => {
    const groceries = await prisma.category.findUniqueOrThrow({ where: { slug: 'groceries' } });
    const wc = await prisma.walletCard.findFirstOrThrow({ where: { cardId } });
    const rank = async () => ((await api(app).get(`${V}/recommendations/categories/groceries`).set(bearer(token)).expect(200)).body.ranked as Array<{ name: string; multiplier: number }>).find((r) => r.name === 'Rotating Test')!.multiplier;
    expect(await rank()).toBe(1); // not selected
    await prisma.walletCard.update({ where: { id: wc.id }, data: { selectedCategoryIds: [groceries.id] } });
    // the clock decides: the 2026-Q4 rows end 2026-12-31, so what the API shows depends on today's quarter
    const today = new Date();
    const inQ4 = today >= new Date('2026-10-01') && today <= new Date('2026-12-31T23:59:59Z');
    expect(await rank()).toBe(inQ4 ? 5 : 1);
  });
});

describe('the daily job', () => {
  it('tells the holder once per quarter and not again', async () => {
    await applyRotating(prisma, [entry('2026-Q4', ['groceries', 'dining'])]);
    notices.length = 0;
    const n = await runRotatingJob(prisma, notify, Q4);
    expect(n).toBeGreaterThanOrEqual(1);
    const mine = notices.filter((x) => x.userId === userId);
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Rotating Test: 2026 Q4 categories');
    expect(mine[0].key).toMatch(/^rotating:.+:2026-Q4$/);
    notices.length = 0;
    await runRotatingJob(prisma, notify, Q4);
    expect(notices.filter((x) => x.userId === userId).map((x) => x.key)).toHaveLength(1); // the same dedupe key each run: the notifier stores it once
  });

  it('warns admins in the last weeks of a quarter when the next quarter is missing', async () => {
    await prisma.reward.deleteMany({ where: { cardId, startsAt: new Date('2027-01-01T00:00:00Z') } }); // earlier tests added 2027-Q1
    const admin = { id: (await register(app)).userId };
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'ADMIN' } });
    notices.length = 0;
    await runRotatingJob(prisma, notify, new Date('2026-12-15T12:00:00Z'));
    const warn = notices.filter((x) => x.userId === admin.id);
    expect(warn).toHaveLength(1);
    expect(warn[0].title).toBe('Rotating categories for 2027 Q1 are missing');
    expect(warn[0].key).toBe('rotating-missing:2027-Q1');
    notices.length = 0;
    await runRotatingJob(prisma, notify, new Date('2026-11-20T12:00:00Z')); // more than 21 days left: no warning
    expect(notices.filter((x) => x.userId === admin.id)).toHaveLength(0);
    await prisma.user.deleteMany({ where: { id: admin.id } });
  });
});

describe('admin import', () => {
  it('is for admins only, applies a quarter, and rejects bad input', async () => {
    await api(app).post(`${V}/admin/rotating-categories`).set(bearer(token)).send(entry('2027-Q2', ['gas'])).expect(403);
    const reg = await register(app);
    await prisma.user.update({ where: { id: reg.userId }, data: { role: 'ADMIN' } });
    const admin = { ...reg, token: await login(app, reg.email, 'integration-pass-1') };
    const ok = await api(app).post(`${V}/admin/rotating-categories`).set(bearer(admin.token)).send(entry('2027-Q2', ['gas'])).expect(200);
    expect(ok.body).toMatchObject({ created: 1, problems: [] });
    await api(app).post(`${V}/admin/rotating-categories`).set(bearer(admin.token)).send(entry('2027-Q2', ['nope'])).expect(400);
    await api(app).post(`${V}/admin/rotating-categories`).set(bearer(admin.token)).send({ ...entry('2027-Q2', ['gas']), quarter: 'soon' }).expect(400);
    const status = (await api(app).get(`${V}/admin/rotating-categories`).set(bearer(admin.token)).expect(200)).body as Array<{ slug: string; hasCurrent: boolean }>;
    expect(status.some((s) => s.slug === SLUG)).toBe(true);
    const settings = (await api(app).get(`${V}/admin/rotating-categories/settings`).set(bearer(admin.token)).expect(200)).body;
    expect(settings).toMatchObject({ autoFetch: true, schedule: '0 4 * * *' });
    expect(settings.sources.length).toBeGreaterThan(0);
    await api(app).get(`${V}/admin/rotating-categories/settings`).set(bearer(token)).expect(403);
    const log = await prisma.auditLog.findFirst({ where: { actorId: admin.userId, action: 'ROTATING_CATEGORIES' } });
    expect(log?.entityId).toBe('2027-Q2');
    await prisma.user.deleteMany({ where: { id: admin.userId } });
  });
});

import { fetchRotating } from '../../src/jobs/rotating.job';

describe('reading the issuer page (public page, no login)', () => {
  const src = { cards: [SLUG], url: 'https://creditcards.chase.com/test-page' };
  const page = (body: string, status: 'OK' | 'BLOCKED' = 'OK') => ({ fetch: async () => ({ status, url: src.url, body, reason: status === 'BLOCKED' ? 'Disallowed by robots.txt' : undefined }) });
  const text = '<p>Earn 5% bonus on streaming and gas stations from July - September 2027, up to $1,500 in purchases each quarter when you activate.</p>';
  const now = new Date('2027-08-10T00:00:00Z');

  it('adds the quarter the page states, then does not fetch again once it has it', async () => {
    const a = await fetchRotating(prisma, page(text), now, [src]);
    expect([a.fetched, a.applied, a.problems]).toEqual([1, 1, []]);
    const rows = await prisma.reward.findMany({ where: { cardId, startsAt: new Date('2027-07-01T00:00:00Z') }, include: { category: true } });
    expect(rows.map((r) => r.category!.slug).sort()).toEqual(['gas', 'streaming']);
    expect(rows[0]).toMatchObject({ sourceUrl: src.url, capCents: 150000 });
    const b = await fetchRotating(prisma, { fetch: async () => { throw new Error('should not be called'); } }, now, [src]);
    expect(b.fetched).toBe(0);
  });
  it('reports a blocked page, an unreadable page and a quarter that is already there, without writing', async () => {
    const later = new Date('2027-11-10T00:00:00Z');
    expect((await fetchRotating(prisma, page('', 'BLOCKED'), later, [src])).problems[0]).toMatch(/robots/);
    expect((await fetchRotating(prisma, page('<p>nothing useful</p>'), later, [src])).problems[0]).toMatch(/no quarter/);
    const t = await fetchRotating(prisma, { fetch: async () => { throw new Error('network down'); } }, later, [src]);
    expect(t.problems[0]).toMatch(/network down/);
    expect(await prisma.reward.count({ where: { cardId, startsAt: { gte: new Date('2027-10-01') }, endsAt: { lte: new Date('2028-01-01') } } })).toBe(0);
  });
  it('skips a source marked unreadable', async () => {
    const r = await fetchRotating(prisma, { fetch: async () => { throw new Error('no'); } }, now, [{ ...src, unreadable: 'script rendered, checked today' }]);
    expect(r.fetched).toBe(0);
  });
});

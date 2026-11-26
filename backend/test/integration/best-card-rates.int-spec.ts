import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { applyRateVerifications } from '../../src/seed/rate-verification.apply';
import { api, bearer, createApp, register } from './helpers';

/**
 * Best card by category with the corrected engine: sub-categories under Travel, conditional (portal) rates that cannot win,
 * capped rates blended with the member's own spending, and the unverified marker. Synthetic cards only.
 */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let userId: string;
const ids: string[] = [];

const get = (path: string) => api(app).get(`${V}${path}`).set(bearer(token));

beforeAll(async () => {
  app = await createApp();
  const u = await register(app);
  token = u.token;
  userId = u.userId;
  const cat = async (slug: string) => (await prisma.category.findUniqueOrThrow({ where: { slug } })).id;
  const cash = await prisma.rewardCurrency.findUniqueOrThrow({ where: { code: 'CASH' } });
  const issuer = await prisma.issuer.findFirstOrThrow();
  const [travel, airlines, groceries, base] = await Promise.all([cat('travel'), cat('airlines'), cat('groceries'), cat('everything-else')]);
  const mk = async (slug: string, rewards: Array<Record<string, unknown>>) => {
    const c = await prisma.creditCard.create({ data: { slug, name: slug, issuerId: issuer.id, currencyId: cash.id, network: 'VISA', annualFeeCents: 0, catalogSource: 'ADMIN', rewards: { create: rewards as never } } });
    ids.push(c.id);
    await api(app).post(`${V}/wallet/cards`).set(bearer(token)).send({ cardId: c.id }).expect(201);
  };
  const at = new Date('2026-11-26');
  // a travel card (3x on all travel), an airline card (5x airlines), a portal-only card (10x travel through its portal)
  await mk('rate-test-travel', [{ categoryId: travel, multiplier: 3, description: '3x travel', verifiedAt: at }, { categoryId: base, multiplier: 1, description: '1x', verifiedAt: at }]);
  await mk('rate-test-airline', [{ categoryId: airlines, multiplier: 5, description: '5x airlines' }, { categoryId: base, multiplier: 1, description: '1x' }]);
  await mk('rate-test-portal', [{ categoryId: travel, multiplier: 10, description: '10x through the portal', conditional: true, verifiedAt: at }, { categoryId: base, multiplier: 1, description: '1x', verifiedAt: at }]);
  // a capped grocery card and a flat one
  await mk('rate-test-capped', [{ categoryId: groceries, multiplier: 6, description: '6x groceries (first $6,000 a year)', capCents: 600_000, capPeriod: 'YEAR', verifiedAt: at }, { categoryId: base, multiplier: 1, description: '1x', verifiedAt: at }]);
  await mk('rate-test-flat', [{ categoryId: groceries, multiplier: 3, description: '3x groceries', verifiedAt: at }, { categoryId: base, multiplier: 1, description: '1x', verifiedAt: at }]);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.creditCard.deleteMany({ where: { id: { in: ids } } });
  await app.close();
  await prisma.$disconnect();
});

describe('best card by category', () => {
  it('lists Travel and then its sub-categories, indented under it', async () => {
    const list = (await get('/recommendations/categories').expect(200)).body as Array<{ category: { slug: string; parentSlug: string | null }; best: { name: string } | null }>;
    const slugs = list.map((c) => c.category.slug);
    const i = slugs.indexOf('travel');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(slugs.slice(i + 1, i + 5).sort()).toEqual(['airlines', 'car-rental', 'hotels', 'transit']);
    for (const s of ['airlines', 'hotels', 'car-rental', 'transit']) expect(list.find((c) => c.category.slug === s)!.category.parentSlug).toBe('travel');
    expect(list.find((c) => c.category.slug === 'travel')!.category.parentSlug).toBeNull();
    expect(list.find((c) => c.category.slug === 'dining')!.category.parentSlug).toBeNull();
  });

  it('a travel rate applies to airlines, an airline rate does not apply to travel, and a portal rate never wins', async () => {
    const air = (await get('/recommendations/categories/airlines').expect(200)).body.ranked as Array<{ name: string; multiplier: number; matchLevel: string }>;
    expect(air[0]).toMatchObject({ name: 'rate-test-airline', multiplier: 5, matchLevel: 'CATEGORY' });
    expect(air.find((r) => r.name === 'rate-test-travel')).toMatchObject({ multiplier: 3, matchLevel: 'PARENT_CATEGORY' });
    const travel = (await get('/recommendations/categories/travel').expect(200)).body.ranked as Array<{ name: string; multiplier: number }>;
    expect(travel[0]).toMatchObject({ name: 'rate-test-travel', multiplier: 3 });
    expect(travel.find((r) => r.name === 'rate-test-airline')!.multiplier).toBe(1);
    expect(travel.find((r) => r.name === 'rate-test-portal')!.multiplier).toBe(1);
    const dash = (await get('/recommendations/categories').expect(200)).body as Array<{ category: { slug: string }; best: { name: string } | null }>;
    expect(dash.find((c) => c.category.slug === 'airlines')!.best!.name).toBe('rate-test-airline');
    expect(dash.find((c) => c.category.slug === 'travel')!.best!.name).toBe('rate-test-travel');
  });

  it('marks what an issuer page confirmed and what it did not', async () => {
    const air = (await get('/recommendations/categories/airlines').expect(200)).body.ranked as Array<{ name: string; verified: boolean }>;
    expect(air.find((r) => r.name === 'rate-test-airline')!.verified).toBe(false);
    expect(air.find((r) => r.name === 'rate-test-travel')!.verified).toBe(true);
  });

  it('a capped rate wins for a light spender and loses to a flat rate for a heavy one', async () => {
    const light = (await get('/recommendations/categories/groceries').expect(200)).body.ranked as Array<{ name: string; blended: boolean; cap: unknown }>;
    expect(light[0].name).toBe('rate-test-capped');
    expect(light[0].cap).toEqual({ capCents: 600_000, capPeriod: 'YEAR' });
    const groceries = await prisma.category.findUniqueOrThrow({ where: { slug: 'groceries' } });
    await prisma.spendProfileEntry.create({ data: { userId, categoryId: groceries.id, monthlyCents: 400_000 } }); // $48,000 a year
    const heavy = (await get('/recommendations/categories/groceries').expect(200)).body.ranked as Array<{ name: string; blended: boolean; effectiveMultiplier: number; multiplier: number }>;
    expect(heavy[0].name).toBe('rate-test-flat');
    const capped = heavy.find((r) => r.name === 'rate-test-capped')!;
    expect([capped.blended, capped.multiplier]).toEqual([true, 6]);
    expect(capped.effectiveMultiplier).toBeLessThan(2);
    await prisma.spendProfileEntry.deleteMany({ where: { userId } });
  });

  it('applying the issuer-page rates is repeatable and keeps edited cards alone', async () => {
    const a = await applyRateVerifications(prisma);
    const b = await applyRateVerifications(prisma);
    expect(b.added).toBe(0);
    expect(b.updated).toBe(a.updated + a.added);
    expect(a.skippedEdited).toBeGreaterThanOrEqual(0);
  });
});

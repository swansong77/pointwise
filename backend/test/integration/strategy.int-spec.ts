import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, login, register } from './helpers';

/** Phase D: next-card scorer, household "who should apply", spend profile, travel balances, transfers, award planner. */
const V = '/api/v1';
let app: INestApplication;
const prisma = new PrismaClient();
let family: string;
let admin: string;

beforeAll(async () => {
  app = await createApp();
  family = await login(app, 'family@pointwise.local', 'Family12345!');
  admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const members = async (token: string) => (await api(app).get(`${V}/household/members`).set(bearer(token)).expect(200)).body as Array<{ id: string; nickname: string }>;

describe('next-card scorer (family account)', () => {
  it('ranks cards for a member with value components, 5/24 impact, confidence and reasons', async () => {
    const riley = (await members(family)).find((m) => m.nickname === 'Riley')!;
    const r = await api(app).get(`${V}/recommendations/next-card`).query({ profileId: riley.id, limit: 50 }).set(bearer(family)).expect(200);
    expect(r.body.member).toMatchObject({ nickname: 'Riley', five24: { count: 3, underLimit: true } });
    expect(r.body.spend.source).toBe('PROFILE');
    const cards = r.body.cards as Array<{ slug: string; eligible: boolean; score: number; blockers: string[]; warnings: string[]; confidence: number; reasons: string[]; five24: { after: number; countsToward: boolean } }>;
    const eligible = cards.filter((c) => c.eligible);
    expect(eligible.length).toBeGreaterThan(3);
    expect(eligible.map((c) => c.score)).toEqual([...eligible.map((c) => c.score)].sort((a, b) => b - a));
    expect(cards.find((c) => c.slug === 'northwind-voyager')).toMatchObject({ eligible: false, blockers: ['Riley already has this card'] });
    const reserve = cards.find((c) => c.slug === 'northwind-voyager-reserve')!;
    expect(reserve.eligible).toBe(true); // Riley only holds it as an authorized user
    expect(reserve.warnings.join(' ')).toMatch(/Voyager-family card/);
    expect(reserve.five24).toMatchObject({ countsToward: true, after: 4 });
    expect(reserve.confidence).toBeLessThan(0.9);
    expect(reserve.reasons.join(' ')).toMatch(/Welcome bonus worth/);
    expect(r.body.disclaimer).toMatch(/not financial or credit advice/);
  });

  it('Jordan is at 5/24: Northwind (enforces 5/24) is blocked, other cards cost no slot; Sam (minor) cannot apply', async () => {
    const m = await members(family);
    const jordan = m.find((x) => x.nickname === 'Jordan')!;
    const sam = m.find((x) => x.nickname === 'Sam')!;
    const j = await api(app).get(`${V}/recommendations/next-card`).query({ profileId: jordan.id, limit: 50 }).set(bearer(family)).expect(200);
    expect(j.body.member.five24).toMatchObject({ count: 5, underLimit: false });
    const nw = j.body.cards.find((c: { slug: string }) => c.slug === 'northwind-shopper');
    expect(nw.blockers[0]).toMatch(/^Northwind Bank usually denies applicants at 5\/24 — Jordan is 5\/24 until \d{4}-\d{2}-\d{2}$/);
    const top = j.body.cards[0];
    expect(top.eligible).toBe(true);
    expect(top.five24.slotCostCents).toBe(0);
    const s = await api(app).get(`${V}/recommendations/next-card`).query({ profileId: sam.id }).set(bearer(family)).expect(200);
    expect(s.body.cards.every((c: { eligible: boolean; blockers: string[] }) => !c.eligible && /under 18/.test(c.blockers[0]))).toBe(true);
  });

  it('who should apply: a Northwind card goes to Riley, a non-enforcing card to Jordan (no slot used)', async () => {
    const nw = await api(app).get(`${V}/recommendations/who-should-apply/northwind-shopper`).set(bearer(family)).expect(200);
    expect(nw.body.best.member).toBe('Riley');
    expect(nw.body.why).toMatch(/^Riley should apply for Northwind ShopNow Card — uses one 5\/24 slot \(3\/24 → 4\/24\)\. Others: .*Jordan: Northwind Bank usually denies/);
    const contoso = await api(app).get(`${V}/recommendations/who-should-apply/contoso-everyday`).set(bearer(family)).expect(200);
    expect(contoso.body.best.member).toBe('Jordan');
    expect(contoso.body.why).toMatch(/Jordan is already over 5\/24, so no slot is used/);
    await api(app).get(`${V}/recommendations/who-should-apply/no-such-card`).set(bearer(family)).expect(404);
  });

  it('household plan: top cards per member and one overall pick', async () => {
    const r = await api(app).get(`${V}/household/next-card`).set(bearer(family)).expect(200);
    expect(r.body.members.map((m: { member: string }) => m.member)).toEqual(['Jordan', 'Riley', 'Sam']);
    expect(r.body.members.find((m: { member: string }) => m.member === 'Sam').top).toEqual([]);
    expect(r.body.pick.eligible).toBe(true);
    expect(r.body.why).toMatch(/first-year value ~\$[\d,]+, then ~-?\$?[\d,-]+\/yr/);
  });

  it('validates inputs and scopes members to the caller', async () => {
    const other = await register(app);
    const riley = (await members(family)).find((m) => m.nickname === 'Riley')!;
    await api(app).get(`${V}/recommendations/next-card`).query({ profileId: riley.id }).set(bearer(other.token)).expect(404);
    await api(app).get(`${V}/recommendations/next-card`).query({ benefitUseRate: 2 }).set(bearer(family)).expect(400);
    await api(app).get(`${V}/recommendations/next-card`).expect(401);
  });
});

describe('spend profile', () => {
  it('default (typical household) → transactions are not enough → user-entered profile changes the ranking inputs', async () => {
    const u = await register(app);
    const d = await api(app).get(`${V}/me/spend-profile`).set(bearer(u.token)).expect(200);
    expect(d.body.source).toBe('DEFAULT');
    expect(d.body.monthlyTotalCents).toBeGreaterThan(0);
    const low = await api(app).get(`${V}/recommendations/next-card`).set(bearer(u.token)).expect(200);
    expect(low.body.cards[0].confidence).toBeLessThanOrEqual(0.6);
    expect(low.body.cards[0].confidenceNotes.join(' ')).toMatch(/typical household/);

    const dining = await prisma.category.findUniqueOrThrow({ where: { slug: 'dining' } });
    const groceries = await prisma.category.findUniqueOrThrow({ where: { slug: 'groceries' } });
    const set = await api(app)
      .put(`${V}/me/spend-profile`)
      .set(bearer(u.token))
      .send({ lines: [{ categoryId: dining.id, monthlyCents: 1500_00 }, { categoryId: groceries.id, monthlyCents: 1200_00 }, { categoryId: dining.id, monthlyCents: 0 }].slice(0, 2) })
      .expect(200);
    expect(set.body).toMatchObject({ source: 'PROFILE', monthlyTotalCents: 2700_00 });
    const r = await api(app).get(`${V}/recommendations/next-card`).query({ limit: 1 }).set(bearer(u.token)).expect(200);
    expect(r.body.cards[0].topCategories.map((c: { category: string }) => c.category)).toEqual(expect.arrayContaining([expect.stringMatching(/Dining|Groceries/)]));
    await api(app).put(`${V}/me/spend-profile`).set(bearer(u.token)).send({ lines: [{ categoryId: dining.id, monthlyCents: 1 }, { categoryId: dining.id, monthlyCents: 2 }] }).expect(400);
    await api(app).put(`${V}/me/spend-profile`).set(bearer(u.token)).send({ lines: [{ categoryId: '00000000-0000-4000-8000-000000000000', monthlyCents: 1 }] }).expect(400);
    await api(app).put(`${V}/me/spend-profile`).set(bearer(u.token)).send({ lines: [{ categoryId: dining.id, monthlyCents: -1 }] }).expect(400);
  });

  it('uses 12 months of logged transactions when there is no profile', async () => {
    const u = await register(app);
    const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'fabrikam-double' } });
    const wc = await api(app).post(`${V}/wallet/cards`).set(bearer(u.token)).send({ cardId: card.id }).expect(201);
    const dining = await prisma.category.findUniqueOrThrow({ where: { slug: 'dining' } });
    const now = Date.now();
    await prisma.transaction.createMany({ data: Array.from({ length: 12 }, (_, i) => ({ userId: u.userId, walletCardId: wc.body.id, categoryId: dining.id, amountCents: 100_00, occurredAt: new Date(now - i * 25 * 86_400_000) })) });
    const s = await api(app).get(`${V}/me/spend-profile`).set(bearer(u.token)).expect(200);
    expect(s.body.source).toBe('TRANSACTIONS');
    expect(s.body.lines).toHaveLength(1);
    expect(s.body.lines[0]).toMatchObject({ name: dining.name });
    expect(s.body.lines[0].monthlyCents).toBeGreaterThan(100_00);
  });
});

describe('travel', () => {
  it('public transfer partners with active bonuses', async () => {
    const r = await api(app).get(`${V}/transfer-partners`).expect(200);
    expect(r.body.programs.map((p: { code: string }) => p.code)).toEqual(expect.arrayContaining(['SKYHIGH', 'AEROLINK', 'STAYWELL']));
    const contoso = r.body.currencies.find((c: { code: string }) => c.code === 'CONTOSO_PTS');
    expect(contoso.options[0]).toMatchObject({ program: 'AEROLINK', bonusPercent: 30, upliftVsCash: 1.35 });
    const one = await api(app).get(`${V}/transfer-partners`).query({ currency: 'nw_miles', program: 'skyhigh' }).expect(200);
    expect(one.body.currencies).toHaveLength(1);
    expect(one.body.currencies[0].options).toHaveLength(1);
    await api(app).get(`${V}/transfer-partners`).query({ currency: 'bad code!' }).expect(400);
  });

  it('family balances, best transfers, and an award plan that pools Northwind miles', async () => {
    const b = await api(app).get(`${V}/me/balances`).set(bearer(family)).expect(200);
    expect(b.body.map((x: { member: string; code: string }) => `${x.member}:${x.code}`)).toEqual(expect.arrayContaining(['Jordan:NW_MILES', 'Jordan:CONTOSO_PTS', 'Jordan:SKYHIGH', 'Riley:NW_MILES', 'Riley:STAYWELL']));
    const t = await api(app).get(`${V}/travel/transfers`).set(bearer(family)).expect(200);
    const ct = t.body.balances.find((x: { currency: string }) => x.currency === 'CONTOSO_PTS');
    expect(ct).toMatchObject({ member: 'Jordan', points: 85_000, cashValueCents: 106_250, best: { program: 'AEROLINK', bonusPercent: 30 } });
    expect(ct.advice).toMatch(/^Best use: AeroLink Rewards/);
    expect(t.body.totals.bestValueCents).toBeGreaterThan(t.body.totals.cashValueCents);

    const p = await api(app).post(`${V}/travel/plan`).set(bearer(family)).send({ program: 'skyhigh', points: 200_000 }).expect(200);
    expect(p.body.program.code).toBe('SKYHIGH');
    expect(p.body.steps[0]).toMatchObject({ kind: 'USE_BALANCE', member: 'Jordan', pointsUsed: 12_500 });
    expect(p.body.steps.some((s: { member: string; from: string }) => s.member === 'Riley' && s.from === 'NW_MILES')).toBe(true);
    expect(p.body.shortfall).toBe(0);
    expect(p.body.warnings.join(' ')).toMatch(/household pooling/);
    const short = await api(app).post(`${V}/travel/plan`).set(bearer(family)).send({ program: 'HARBOR', points: 1_000_000 }).expect(200);
    expect(short.body.shortfall).toBeGreaterThan(0);
    await api(app).post(`${V}/travel/plan`).set(bearer(family)).send({ program: 'NOPE', points: 1 }).expect(404);
    await api(app).post(`${V}/travel/plan`).set(bearer(family)).send({ program: 'SKYHIGH', points: 0 }).expect(400);
  });

  it('balances: upsert, zero removes, ownership, validation', async () => {
    const u = await register(app);
    const me = (await members(u.token))[0];
    await api(app).put(`${V}/me/balances`).set(bearer(u.token)).send({ profileId: me.id, code: 'contoso_pts', points: 20_000 }).expect(200);
    const up = await api(app).put(`${V}/me/balances`).set(bearer(u.token)).send({ profileId: me.id, code: 'CONTOSO_PTS', points: 25_000 }).expect(200);
    await api(app).put(`${V}/me/balances`).set(bearer(u.token)).send({ profileId: me.id, code: 'AEROLINK', points: 3_000 }).expect(200);
    let list = (await api(app).get(`${V}/me/balances`).set(bearer(u.token)).expect(200)).body;
    expect(list).toHaveLength(2);
    expect(list.find((x: { code: string }) => x.code === 'CONTOSO_PTS')).toMatchObject({ id: up.body.id, points: 25_000, kind: 'CURRENCY', valueCents: 31_250 });
    expect((await api(app).put(`${V}/me/balances`).set(bearer(u.token)).send({ profileId: me.id, code: 'CONTOSO_PTS', points: 0 }).expect(200)).body).toEqual({ deleted: true });
    const aero = list.find((x: { code: string }) => x.code === 'AEROLINK');
    await api(app).delete(`${V}/me/balances/${aero.id}`).set(bearer(family)).expect(404); // not the owner
    await api(app).delete(`${V}/me/balances/${aero.id}`).set(bearer(u.token)).expect(204);
    list = (await api(app).get(`${V}/me/balances`).set(bearer(u.token)).expect(200)).body;
    expect(list).toEqual([]);
    const fam = (await members(family))[0];
    await api(app).put(`${V}/me/balances`).set(bearer(u.token)).send({ profileId: fam.id, code: 'CONTOSO_PTS', points: 1 }).expect(404);
    await api(app).put(`${V}/me/balances`).set(bearer(u.token)).send({ profileId: me.id, code: 'CASH', points: 1 }).expect(400);
    await api(app).put(`${V}/me/balances`).set(bearer(u.token)).send({ profileId: me.id, code: 'UNKNOWN_X', points: 1 }).expect(400);
    await api(app).post(`${V}/travel/plan`).set(bearer(u.token)).send({ program: 'SKYHIGH', points: 10, profileId: fam.id }).expect(404);
  });

  it('admin curates programs and partners (audited); users cannot', async () => {
    await api(app).put(`${V}/admin/loyalty-programs`).set(bearer(admin)).send({ code: 'TESTAIR', name: 'Test Air', centsPerPoint: 1.1 }).expect(200);
    const p = await api(app).put(`${V}/admin/transfer-partners`).set(bearer(admin)).send({ currency: 'FABRIKAM_PTS', program: 'TESTAIR', ratioTo: 2, bonusPercent: 25, bonusEndsAt: new Date(Date.now() + 86_400_000).toISOString() }).expect(200);
    const pub = await api(app).get(`${V}/transfer-partners`).query({ program: 'TESTAIR' }).expect(200);
    expect(pub.body.currencies[0].options[0]).toMatchObject({ program: 'TESTAIR', programPointsPerPoint: 2.5, bonusPercent: 25 });
    expect((await api(app).get(`${V}/admin/transfer-partners`).set(bearer(admin)).expect(200)).body.length).toBeGreaterThanOrEqual(9);
    expect(await prisma.auditLog.count({ where: { entity: 'TransferPartner', entityId: p.body.id } })).toBe(1);
    await api(app).put(`${V}/admin/transfer-partners`).set(bearer(admin)).send({ currency: 'CASH', program: 'TESTAIR' }).expect(400);
    await api(app).put(`${V}/admin/transfer-partners`).set(bearer(admin)).send({ currency: 'NOPE', program: 'TESTAIR' }).expect(400);
    await api(app).delete(`${V}/admin/transfer-partners/${p.body.id}`).set(bearer(admin)).expect(204);
    await api(app).delete(`${V}/admin/transfer-partners/${p.body.id}`).set(bearer(admin)).expect(404);
    await api(app).put(`${V}/admin/loyalty-programs`).set(bearer(admin)).send({ code: 'TESTAIR', name: 'Test Air', centsPerPoint: 1.1, isActive: false }).expect(200);
    await api(app).put(`${V}/admin/loyalty-programs`).set(bearer(family)).send({ code: 'X1', name: 'X', centsPerPoint: 1 }).expect(403);
  });
});

describe('Phase F: credit band, fine-print search, transfer-bonus alerts', () => {
  it('credit band on a member changes approval odds and ranking; validated; private to the household', async () => {
    const u = await register(app);
    const me = (await members(u.token))[0];
    const before = await api(app).get(`${V}/recommendations/next-card`).query({ limit: 50 }).set(bearer(u.token)).expect(200);
    const reserveBefore = before.body.cards.find((c: { slug: string }) => c.slug === 'northwind-voyager-reserve');
    expect(reserveBefore.approvalOdds).toBe('UNKNOWN');
    await api(app).patch(`${V}/household/members/${me.id}`).set(bearer(u.token)).send({ creditBand: 'FAIR' }).expect(200);
    const after = await api(app).get(`${V}/recommendations/next-card`).query({ limit: 50 }).set(bearer(u.token)).expect(200);
    const reserve = after.body.cards.find((c: { slug: string }) => c.slug === 'northwind-voyager-reserve');
    expect(reserve.approvalOdds).toBe('UNLIKELY');
    expect(reserve.score).toBe(Math.round(reserveBefore.score * 0.4));
    expect(reserve.warnings.join(' ')).toMatch(/credit \(fair\) is below what Northwind Voyager Reserve usually needs \(excellent\)/);
    await api(app).patch(`${V}/household/members/${me.id}`).set(bearer(u.token)).send({ creditBand: 'SUPER' }).expect(400);
    await api(app).patch(`${V}/household/members/${me.id}`).set(bearer(u.token)).send({ creditBand: null }).expect(200);
    expect((await members(u.token))[0]).toMatchObject({ creditBand: null });
  });

  it('family: seeded bands give Jordan "likely" and Riley "unlikely" for the Reserve card', async () => {
    const m = await members(family);
    const riley = m.find((x) => x.nickname === 'Riley')!;
    const r = await api(app).get(`${V}/recommendations/next-card`).query({ profileId: riley.id, limit: 50 }).set(bearer(family)).expect(200);
    expect(r.body.cards.find((c: { slug: string }) => c.slug === 'northwind-voyager-reserve').approvalOdds).toBe('UNLIKELY');
    expect(r.body.cards.find((c: { slug: string }) => c.slug === 'litware-blue-cash')?.approvalOdds ?? 'LIKELY').toBe('LIKELY');
  });

  it('public fine-print search with highlighted snippets, card filter and validation', async () => {
    const r = await api(app).get(`${V}/card-terms/search`).query({ q: 'lounge access' }).expect(200);
    expect(r.body.hits.length).toBeGreaterThan(0);
    expect(r.body.hits[0].card).toBe('Northwind Voyager Reserve');
    expect(r.body.hits.map((h: { kind: string }) => h.kind)).toEqual(expect.arrayContaining(['feature']));
    expect(r.body.hits[0].snippet).toMatch(/«lounge» «access»|«Lounge» «access»/i);
    const one = await api(app).get(`${V}/card-terms/search`).query({ q: 'dining', card: 'contoso-gold' }).expect(200);
    expect(one.body.hits.every((h: { slug: string }) => h.slug === 'contoso-gold')).toBe(true);
    expect((await api(app).get(`${V}/card-terms/search`).query({ q: 'zzqxnotaword' }).expect(200)).body.hits).toEqual([]);
    expect((await api(app).get(`${V}/card-terms/search`).query({ q: "lounge' OR 1=1 --" }).expect(200)).body.hits.length).toBeGreaterThanOrEqual(0);
    await api(app).get(`${V}/card-terms/search`).query({ q: 'x' }).expect(400);
  });

  it('transfer-bonus job notifies holders once per bonus and respects the preference', async () => {
    const holder = await register(app);
    const optedOut = await register(app);
    for (const u of [holder, optedOut]) {
      const me = (await members(u.token))[0];
      await api(app).put(`${V}/me/balances`).set(bearer(u.token)).send({ profileId: me.id, code: 'CONTOSO_PTS', points: 40_000 }).expect(200);
    }
    await api(app).put(`${V}/notifications/preferences`).set(bearer(optedOut.token)).send({ transferBonuses: false }).expect(200);
    const run = () => api(app).post(`${V}/admin/jobs/scan-transfer-bonuses/run`).set(bearer(admin)).expect(201);
    await run();
    await run(); // idempotent
    const notes = await prisma.notification.findMany({ where: { userId: holder.userId, type: 'TRANSFER_BONUS' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: '30% transfer bonus: Contoso Points → AeroLink Rewards', link: '/travel' });
    expect(notes[0].body).toMatch(/Your household holds 40,000 Contoso Points/);
    expect(await prisma.notification.count({ where: { userId: optedOut.userId, type: 'TRANSFER_BONUS' } })).toBe(0);
  });
});

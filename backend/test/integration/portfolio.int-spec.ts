import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { trackerXlsx } from '../fixtures/tracker';
import { api, bearer, createApp, login, register } from './helpers';

/** Portfolio revision: households, 5/24, benefits, imports, credit reports, connections, alerts. */
const V = '/api/v1';
let app: INestApplication;
const prisma = new PrismaClient();
const DAY = 86_400_000;

beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const cardId = async (slug: string) => (await prisma.creditCard.findUniqueOrThrow({ where: { slug } })).id;
const isoDaysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString().slice(0, 10);

async function proUser() {
  const u = await register(app);
  await api(app).post(`${V}/subscription/checkout`).set(bearer(u.token)).send({ interval: 'month' }).expect(201);
  return u;
}

describe('households', () => {
  it('creates the household and SELF member on first use; free plan cannot add members', async () => {
    const u = await register(app);
    const hh = await api(app).get(`${V}/household`).set(bearer(u.token)).expect(200);
    expect(hh.body.members).toHaveLength(1);
    expect(hh.body.members[0]).toMatchObject({ relationship: 'SELF', isPrimary: true });
    // concurrent first loads must not create two SELF members
    const u2 = await register(app);
    await Promise.all([1, 2, 3].map(() => api(app).get(`${V}/household/members`).set(bearer(u2.token)).expect(200)));
    expect(await prisma.profile.count({ where: { userId: u2.userId, isPrimary: true } })).toBe(1);
    await api(app).post(`${V}/household/members`).set(bearer(u.token)).send({ nickname: 'Riley', relationship: 'SPOUSE' }).expect(403);
  });

  it('pro: add / rename / update / delete members; validation and child rules', async () => {
    const u = await proUser();
    const t = bearer(u.token);
    await api(app).patch(`${V}/household`).set(t).send({ name: 'Test family' }).expect(200);
    const spouse = await api(app).post(`${V}/household/members`).set(t).send({ nickname: 'Riley', relationship: 'SPOUSE' }).expect(201);
    const kid = await api(app).post(`${V}/household/members`).set(t).send({ nickname: 'Sam', relationship: 'CHILD', birthYear: 2010 }).expect(201);
    await api(app).post(`${V}/household/members`).set(t).send({ nickname: 'Me again', relationship: 'SELF' }).expect(400);
    await api(app).post(`${V}/household/members`).set(t).send({ nickname: '' }).expect(400);

    // child cards must be authorized-user cards
    const gold = await cardId('contoso-gold');
    await api(app).post(`${V}/wallet/cards`).set(t).send({ cardId: gold, profileId: kid.body.id }).expect(400);
    const au = await api(app).post(`${V}/wallet/cards`).set(t).send({ cardId: gold, profileId: kid.body.id, cardholder: 'AUTHORIZED_USER' }).expect(201);
    await api(app).patch(`${V}/wallet/cards/${au.body.id}`).set(t).send({ cardholder: 'PRIMARY' }).expect(400);
    // a member holding primary cards cannot become a CHILD
    await api(app).post(`${V}/wallet/cards`).set(t).send({ cardId: gold, profileId: spouse.body.id }).expect(201);
    await api(app).patch(`${V}/household/members/${spouse.body.id}`).set(t).send({ relationship: 'CHILD' }).expect(400);
    await api(app).patch(`${V}/household/members/${spouse.body.id}`).set(t).send({ nickname: 'Riley R.' }).expect(200);

    const hh = await api(app).get(`${V}/household`).set(t).expect(200);
    expect(hh.body).toMatchObject({ name: 'Test family' });
    expect(hh.body.members.map((m: { nickname: string }) => m.nickname)).toEqual(expect.arrayContaining(['Riley R.', 'Sam']));
    const self = hh.body.members.find((m: { isPrimary: boolean }) => m.isPrimary);
    await api(app).delete(`${V}/household/members/${self.id}`).set(t).expect(403);
    await api(app).delete(`${V}/household/members/${spouse.body.id}`).set(t).expect(204);

    // IDOR: another user cannot touch these members
    const other = await register(app);
    await api(app).patch(`${V}/household/members/${kid.body.id}`).set(bearer(other.token)).send({ nickname: 'x' }).expect(404);
  });
});

describe('5/24 and portfolio (family demo account)', () => {
  let token: string;
  beforeAll(async () => {
    token = await login(app, 'family@pointwise.local', 'Family12345!');
  });

  it('computes 5/24 per member: business card from a reporting issuer counts, closed old card does not, AU cards count', async () => {
    const res = await api(app).get(`${V}/five24`).set(bearer(token)).expect(200);
    const by = Object.fromEntries(res.body.members.map((m: { profile: { nickname: string }; status: unknown }) => [m.profile.nickname, m.status]));
    expect(by.Jordan).toMatchObject({ count: 5, label: '5/24', underLimit: false });
    expect(by.Jordan.contributing.map((c: { reason: string }) => c.reason)).toContain('BUSINESS_REPORTS_TO_PERSONAL');
    expect(by.Jordan.excluded.map((c: { reason: string }) => c.reason)).toContain('OUTSIDE_WINDOW');
    expect(by.Jordan.nextSlotAt).not.toBeNull();
    expect(by.Riley).toMatchObject({ count: 3, label: '3/24' });
    expect(by.Sam).toMatchObject({ count: 1 });
    const timeline = res.body.members.find((m: { profile: { nickname: string } }) => m.profile.nickname === 'Jordan').timeline;
    expect(timeline[0]).toMatchObject({ event: 'NOW', count: 5 });
    expect(timeline.length).toBeGreaterThan(1);
  });

  it('filters by member and validates the query', async () => {
    const hh = await api(app).get(`${V}/household`).set(bearer(token)).expect(200);
    const riley = hh.body.members.find((m: { nickname: string }) => m.nickname === 'Riley');
    const res = await api(app).get(`${V}/five24?profileId=${riley.id}&horizonMonths=12`).set(bearer(token)).expect(200);
    expect(res.body.members).toHaveLength(1);
    await api(app).get(`${V}/five24?horizonMonths=999`).set(bearer(token)).expect(400);
  });

  it('portfolio groups active / AU / closed cards and computes values', async () => {
    const res = await api(app).get(`${V}/portfolio`).set(bearer(token)).expect(200);
    expect(res.body.counts).toMatchObject({ total: 10, closed: 1, authorizedUser: 2, active: 7 });
    expect(res.body.totals.annualFeeCents).toBeGreaterThan(0);
    expect(res.body.totals.rewardsCents).toBeGreaterThan(0);
    expect(res.body.totals.spendCents).toBeGreaterThan(0);
    const reserve = res.body.groups.active.find((c: { card: { name: string } }) => c.card.name === 'Northwind Voyager Reserve');
    expect(reserve).toMatchObject({ benefitCount: 4, annualFeeCents: 55000 });
    expect(reserve.faceBenefitCents).toBe(30000 + 3000 + 12000); // travel + GE (120/4y) + dining 10×12
    expect(reserve.realizedBenefitCents).toBe(18000);
    expect(res.body.byHolder.length).toBe(3);
    const closed = res.body.groups.closed[0];
    expect(closed.annualFeeCents).toBe(0);
  });

  it('household dashboard lists members with cards and totals', async () => {
    const res = await api(app).get(`${V}/household/dashboard`).set(bearer(token)).expect(200);
    expect(res.body.household.name).toBe('The Rivera household');
    const sam = res.body.members.find((m: { profile: { nickname: string } }) => m.profile.nickname === 'Sam');
    expect(sam.cards).toHaveLength(1);
    expect(sam.five24.count).toBe(1);
  });

  it('benefit summary buckets', async () => {
    const res = await api(app).get(`${V}/benefits/summary`).set(bearer(token)).expect(200);
    expect(res.body.totals.annualValueCents).toBeGreaterThan(0);
    expect(res.body.totals.usedThisYearCents).toBeGreaterThan(0);
    expect(Object.keys(res.body.counts)).toEqual(['UNUSED', 'PARTIAL', 'COMPLETED', 'EXPIRED', 'EXPIRING_SOON']);
    const list = await api(app).get(`${V}/benefits?status=COMPLETED`).set(bearer(token)).expect(200);
    expect(list.body.every((b: { currentPeriod: { status: string } }) => b.currentPeriod.status === 'COMPLETED')).toBe(true);
  });
});

describe('benefits CRUD and usage', () => {
  it('template copy on add, custom benefit, usage within allocation, IDOR', async () => {
    const u = await proUser();
    const t = bearer(u.token);
    const reserve = await cardId('northwind-voyager-reserve');
    const wc = await api(app).post(`${V}/wallet/cards`).set(t).send({ cardId: reserve, approvedAt: isoDaysAgo(100) }).expect(201);
    const list = await api(app).get(`${V}/benefits?walletCardId=${wc.body.id}`).set(t).expect(200);
    expect(list.body.map((b: { name: string }) => b.name).sort()).toEqual(['Airport lounge access', 'Annual travel credit', 'Dining credit', 'Global Entry / TSA PreCheck credit']);
    expect((await api(app).post(`${V}/benefits/apply-templates/${wc.body.id}`).set(t).expect(201)).body).toEqual({ added: 0 });

    const catalog = await api(app).get(`${V}/benefits/catalog?cardId=${reserve}`).set(t).expect(200);
    expect(catalog.body).toHaveLength(4);
    await api(app).get(`${V}/benefits/catalog?cardId=nope`).set(t).expect(400);
    expect((await api(app).get(`${V}/benefits/categories`).set(t).expect(200)).body.length).toBeGreaterThan(5);

    // duplicate template
    await api(app).post(`${V}/benefits`).set(t).send({ walletCardId: wc.body.id, benefitId: catalog.body[0].id }).expect(400);
    // custom: missing fields, MULTI_YEAR without months, template from another card
    await api(app).post(`${V}/benefits`).set(t).send({ walletCardId: wc.body.id, name: 'X' }).expect(400);
    await api(app).post(`${V}/benefits`).set(t).send({ walletCardId: wc.body.id, name: 'X', amountPerPeriodCents: 100, period: 'MULTI_YEAR' }).expect(400);
    const goldTpl = (await api(app).get(`${V}/benefits/catalog?cardId=${await cardId('contoso-gold')}`).set(t)).body[0];
    await api(app).post(`${V}/benefits`).set(t).send({ walletCardId: wc.body.id, benefitId: goldTpl.id }).expect(400);

    const custom = await api(app)
      .post(`${V}/benefits`)
      .set(t)
      .send({ walletCardId: wc.body.id, name: 'Quarterly shopping credit', period: 'QUARTERLY', amountPerPeriodCents: 5000, howIssued: 'Statement credit' })
      .expect(201);
    expect(custom.body).toMatchObject({ annualValueCents: 20000, periodMonths: 3, currentPeriod: { status: expect.any(String), remainingCents: 5000 } });

    const used = await api(app).post(`${V}/benefits/${custom.body.id}/usage`).set(t).send({ amountCents: 3000, note: 'shoes' }).expect(201);
    expect(used.body.currentPeriod).toMatchObject({ usedCents: 3000, remainingCents: 2000 });
    await api(app).post(`${V}/benefits/${custom.body.id}/usage`).set(t).send({ amountCents: 2500 }).expect(400); // over allocation
    await api(app).post(`${V}/benefits/${custom.body.id}/usage`).set(t).send({ amountCents: 100, usedOn: '2099-01-01' }).expect(400);
    const usageId = used.body.usages[0].id;

    const upd = await api(app).patch(`${V}/benefits/${custom.body.id}`).set(t).send({ amountPerPeriodCents: 6000, enabled: false }).expect(200);
    expect(upd.body).toMatchObject({ enabled: false, amountPerPeriodCents: 6000 });
    await api(app).patch(`${V}/benefits/${custom.body.id}`).set(t).send({ period: 'MULTI_YEAR' }).expect(400);
    await api(app).patch(`${V}/benefits/${custom.body.id}`).set(t).send({ period: 'MULTI_YEAR', periodMonths: 48 }).expect(200);

    const other = await register(app);
    await api(app).post(`${V}/benefits/${custom.body.id}/usage`).set(bearer(other.token)).send({ amountCents: 1 }).expect(403);
    await api(app).post(`${V}/benefits`).set(bearer(other.token)).send({ walletCardId: wc.body.id, name: 'x', amountPerPeriodCents: 1 }).expect(403);
    await api(app).post(`${V}/benefits/apply-templates/${wc.body.id}`).set(bearer(other.token)).expect(403);

    await api(app).delete(`${V}/benefits/${custom.body.id}/usage/${usageId}`).set(t).expect(204);
    await api(app).delete(`${V}/benefits/${custom.body.id}/usage/${usageId}`).set(t).expect(404);
    await api(app).delete(`${V}/benefits/${custom.body.id}`).set(t).expect(204);
    await api(app).delete(`${V}/benefits/${custom.body.id}`).set(t).expect(404);
  });
});

describe('benefit expiration alerts', () => {
  it('sends one in-app alert per period/threshold and records email delivery; re-runs are idempotent', async () => {
    const u = await proUser();
    const t = bearer(u.token);
    const voyager = await cardId('northwind-voyager'); // template: Hotel credit, annual, cardmember year
    // cardmember year ends in ~5 days → 7-day threshold is due
    const opened = new Date(Date.now() - (365 - 5) * DAY).toISOString().slice(0, 10);
    await api(app).post(`${V}/wallet/cards`).set(t).send({ cardId: voyager, approvedAt: opened }).expect(201);
    const admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
    await api(app).post(`${V}/admin/jobs/scan-benefit-expirations/run`).set(bearer(admin)).expect(201);
    await api(app).post(`${V}/admin/jobs/scan-benefit-expirations/run`).set(bearer(admin)).expect(201);
    const notes = await api(app).get(`${V}/notifications`).set(t).expect(200);
    const alerts = notes.body.filter((n: { type: string }) => n.type === 'BENEFIT_EXPIRING');
    expect(alerts).toHaveLength(1);
    expect(alerts[0].title).toMatch(/Hotel credit expires in \d+ days/);
    expect(alerts[0].emailedAt).not.toBeNull(); // email channel handles it; the digest won't repeat it
    const log = await prisma.benefitNotification.findMany({ where: { userBenefit: { walletCard: { wallet: { userId: u.userId } } } } });
    expect(log.map((l) => [l.channel, l.thresholdDays]).sort()).toEqual([
      ['EMAIL', 7],
      ['IN_APP', 7],
    ]);
  });

  it('respects preferences (benefit alerts off)', async () => {
    const u = await proUser();
    const t = bearer(u.token);
    await api(app).put(`${V}/notifications/preferences`).set(t).send({ benefitExpiring: false }).expect(200);
    const opened = new Date(Date.now() - (365 - 5) * DAY).toISOString().slice(0, 10);
    await api(app).post(`${V}/wallet/cards`).set(t).send({ cardId: await cardId('northwind-voyager'), approvedAt: opened }).expect(201);
    const admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
    await api(app).post(`${V}/admin/jobs/scan-benefit-expirations/run`).set(bearer(admin)).expect(201);
    const notes = await api(app).get(`${V}/notifications`).set(t).expect(200);
    expect(notes.body.filter((n: { type: string }) => n.type === 'BENEFIT_EXPIRING')).toHaveLength(0);
  });

  it('snapshot-524 and sync-bank-connections jobs run', async () => {
    const admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
    const r = await api(app).post(`${V}/admin/jobs/snapshot-524/run`).set(bearer(admin)).expect(201);
    expect(r.body.created).toBeGreaterThan(0);
    await api(app).post(`${V}/admin/jobs/snapshot-524/run`).set(bearer(admin)).expect(201); // idempotent per day
    const b = await api(app).post(`${V}/admin/jobs/sync-bank-connections/run`).set(bearer(admin)).expect(201);
    expect(b.body).toEqual({ job: 'sync-bank-connections', created: 0 });
  });
});

describe('spreadsheet / CSV import', () => {
  it('preview → commit creates members, cards, benefits and usage; catalog stays clean', async () => {
    const u = await proUser();
    const t = bearer(u.token);
    const xlsx = await trackerXlsx();
    const prev = await api(app).post(`${V}/imports`).set(t).attach('file', xlsx, 'Benefits Tracker.xlsx').expect(201);
    expect(prev.body.status).toBe('PREVIEW');
    expect(prev.body.summary).toMatchObject({
      owners: ['Me', 'Spouse'],
      cards: { NEW: 5, UPDATE: 0, DUPLICATE: 1, ERROR: 1 },
      closedCards: 1,
      authorizedUserCards: 1,
    });
    // nothing written yet
    expect((await api(app).get(`${V}/wallet/cards`).set(t)).body).toHaveLength(0);
    const err = prev.body.rows.find((r: { result: string }) => r.result === 'ERROR');
    expect(err.message).toMatch(/full card number/);
    expect(JSON.stringify(prev.body)).not.toContain('4111111111111111');

    const res = await api(app).post(`${V}/imports/${prev.body.id}/commit`).set(t).expect(201);
    expect(res.body).toMatchObject({ cardsCreated: 5, cardsUpdated: 0, membersCreated: 1 });
    expect(res.body.benefitsCreated).toBe(8); // hotel, dining, streaming, travel ×2, GE ×2, free-night certificate
    await api(app).post(`${V}/imports/${prev.body.id}/commit`).set(t).expect(409);
    await api(app).delete(`${V}/imports/${prev.body.id}`).set(t).expect(409);

    const wallet = (await api(app).get(`${V}/wallet/cards`).set(t)).body as Array<Record<string, unknown> & { card: { name: string } }>;
    expect(wallet).toHaveLength(5);
    const plat = wallet.find((w) => w.card.name === 'Metro Platinum')!;
    expect(plat).toMatchObject({ lastFour: '41007', source: 'SPREADSHEET', status: 'APPROVED' });
    expect(wallet.find((w) => w.card.name === 'Old Cash Card')).toMatchObject({ status: 'CLOSED' });
    expect(wallet.filter((w) => w.cardholder === 'AUTHORIZED_USER')).toHaveLength(1);
    const reserve = wallet.find((w) => w.lastFour === '1234')!;
    expect(reserve).toMatchObject({ openDatePrecision: 'MONTH' });

    const hh = await api(app).get(`${V}/household`).set(t).expect(200);
    expect(hh.body.members.map((m: { nickname: string; relationship: string }) => [m.nickname, m.relationship])).toEqual(
      expect.arrayContaining([['Spouse', 'SPOUSE']]),
    );

    const hotel = (await api(app).get(`${V}/benefits`).set(t)).body.find((b: { name: string }) => b.name === 'Hotel credit');
    expect(hotel).toMatchObject({ period: 'SEMIANNUAL', amountPerPeriodCents: 30000 });
    expect(hotel.year.usedThisYearCents).toBe(30000);

    // private cards never appear in the public catalog
    expect((await api(app).get(`${V}/cards?q=Metro`).set(t).expect(200)).body.total).toBe(0);
    await api(app).get(`${V}/cards/${plat.cardId}`).set(t).expect(404);

    // re-import the same file → cards match existing ones (UPDATE), benefits already tracked
    const again = await api(app).post(`${V}/imports`).set(t).attach('file', xlsx, 'Benefits Tracker.xlsx').expect(201);
    expect(again.body.summary.cards).toMatchObject({ NEW: 0, UPDATE: 5 });
    expect(again.body.summary.benefits.NEW).toBe(0);
    await api(app).delete(`${V}/imports/${again.body.id}`).set(t).expect(204);

    // GDPR export includes the new personal data
    const exp = await api(app).get(`${V}/me/export`).set(t).expect(200);
    expect(exp.body.user.household).toBeTruthy();
    expect(exp.body.user.importJobs.length).toBeGreaterThan(0);
    expect(exp.body.user.wallet.cards.some((c: { benefits: unknown[] }) => c.benefits.length > 0)).toBe(true);
    expect(JSON.stringify(exp.body)).not.toContain('accessTokenEnc');

    const jobs = await api(app).get(`${V}/imports`).set(t).expect(200);
    expect(jobs.body.map((j: { status: string }) => j.status)).toEqual(['DISCARDED', 'COMMITTED']);

    // other users cannot see or commit the job
    const other = await register(app);
    await api(app).get(`${V}/imports/${prev.body.id}`).set(bearer(other.token)).expect(404);
  });

  it('free plan: import over the card limit or with extra owners is refused at commit', async () => {
    const u = await register(app);
    const t = bearer(u.token);
    const prev = await api(app).post(`${V}/imports`).set(t).attach('file', await trackerXlsx(), 'tracker.xlsx').expect(201);
    await api(app).post(`${V}/imports/${prev.body.id}/commit`).set(t).expect(403);
    const csv = 'Card,Last 4,Issuer,Annual fee,Open date\nSolo Card,1111,Citi,0,2026-01-15\n';
    const prev2 = await api(app).post(`${V}/imports`).set(t).attach('file', Buffer.from(csv), 'cards.csv').expect(201);
    expect(prev2.body.source).toBe('CSV');
    const ok = await api(app).post(`${V}/imports/${prev2.body.id}/commit`).set(t).expect(201);
    expect(ok.body.cardsCreated).toBe(1);
    const prev3 = await api(app).post(`${V}/imports`).set(t).attach('file', Buffer.from('Owner,Card,Last 4\nMe,Second Card,3333\nPat,Other Card,2222\n'), 'o.csv').expect(201);
    await api(app).post(`${V}/imports/${prev3.body.id}/commit`).set(t).expect(403);
  });

  it('rejects missing, unsupported, corrupt and oversize files; serves the CSV template', async () => {
    const u = await register(app);
    const t = bearer(u.token);
    await api(app).post(`${V}/imports`).set(t).expect(400);
    await api(app).post(`${V}/imports`).set(t).attach('file', Buffer.from('hello'), 'notes.pdf').expect(400);
    await api(app).post(`${V}/imports`).set(t).attach('file', Buffer.from('PK\u0003\u0004garbage'), 'x.xlsx').expect(400);
    await api(app).post(`${V}/imports`).set(t).attach('file', Buffer.alloc(6 * 1024 * 1024, 0x41), 'big.csv').expect(413);
    const failed = await api(app).post(`${V}/imports`).set(t).attach('file', Buffer.from('foo,bar\n1,2\n'), 'x.csv').expect(201);
    expect(failed.body.status).toBe('FAILED');
    const tpl = await api(app).get(`${V}/imports/template.csv`).set(t).expect(200);
    expect(tpl.headers['content-type']).toMatch(/text\/csv/);
    expect(tpl.text).toMatch(/^Owner,Card,Last digits/);
    await api(app).post(`${V}/imports`).attach('file', Buffer.from('a'), 'x.csv').expect(401);
  });
});

describe('credit-report accounts', () => {
  it('auto-matches a tradeline by last digits and applies the month-precision open date', async () => {
    const u = await register(app);
    const t = bearer(u.token);
    const wc = await api(app).post(`${V}/wallet/cards`).set(t).send({ cardId: await cardId('contoso-gold'), lastFour: '31005' }).expect(201);
    const providers = await api(app).get(`${V}/credit-reports/providers`).set(t).expect(200);
    expect(providers.body.map((p: { id: string; status: string }) => [p.id, p.status])).toEqual([
      ['manual', 'AVAILABLE'],
      ['bureau-reports', 'FILE_IMPORT'],
      ['experian', 'REQUIRES_AGREEMENT'],
      ['credit-karma', 'FILE_IMPORT'],
    ]);
    const acct = await api(app)
      .post(`${V}/credit-reports/accounts`)
      .set(t)
      .send({ bureau: 'EXPERIAN', creditorName: 'Contoso Financial', lastDigits: '31005', openedOn: '2025-08-01', isAuthorizedUser: true })
      .expect(201);
    expect(acct.body.walletCardId).toBe(wc.body.id);
    const applied = await api(app).post(`${V}/credit-reports/accounts/${acct.body.id}/apply`).set(t).expect(201);
    expect(applied.body).toMatchObject({ openDatePrecision: 'MONTH', cardholder: 'AUTHORIZED_USER' });
    expect(applied.body.approvedAt).toBe('2025-08-01T00:00:00.000Z');

    const unmatched = await api(app).post(`${V}/credit-reports/accounts`).set(t).send({ creditorName: 'Unknown Bank', openedOn: '2024-01-01' }).expect(201);
    expect(unmatched.body.walletCardId).toBeNull();
    await api(app).post(`${V}/credit-reports/accounts/${unmatched.body.id}/apply`).set(t).expect(400);
    await api(app).post(`${V}/credit-reports/accounts`).set(t).send({ creditorName: 'Future', openedOn: '2099-01-01' }).expect(400);
    await api(app).post(`${V}/credit-reports/accounts`).set(t).send({ creditorName: 'Bad', openedOn: '2024-01-01', lastDigits: '4111111111111111' }).expect(400);
    expect((await api(app).get(`${V}/credit-reports/accounts`).set(t).expect(200)).body).toHaveLength(2);

    const other = await register(app);
    await api(app).post(`${V}/credit-reports/accounts`).set(bearer(other.token)).send({ creditorName: 'x', openedOn: '2024-01-01', walletCardId: wc.body.id }).expect(404);
    await api(app).delete(`${V}/credit-reports/accounts/${acct.body.id}`).set(bearer(other.token)).expect(404);
    await api(app).delete(`${V}/credit-reports/accounts/${acct.body.id}`).set(t).expect(204);
  });
});

describe('bank connections & push (not configured in tests)', () => {
  it('reports disabled status and 503 for provider calls', async () => {
    const u = await register(app);
    const t = bearer(u.token);
    expect((await api(app).get(`${V}/connections/status`).set(t).expect(200)).body).toMatchObject({ enabled: false });
    expect((await api(app).get(`${V}/connections`).set(t).expect(200)).body).toEqual([]);
    await api(app).post(`${V}/connections/plaid/link-token`).set(t).expect(503);
    await api(app).post(`${V}/connections/plaid/exchange`).set(t).send({ publicToken: 'public-sandbox-123456' }).expect(503);
  });

  it('push: no public key; subscribe refused', async () => {
    const u = await register(app);
    const t = bearer(u.token);
    expect((await api(app).get(`${V}/notifications/push/key`).set(t).expect(200)).body).toEqual({ publicKey: null });
    await api(app)
      .post(`${V}/notifications/push/subscriptions`)
      .set(t)
      .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } })
      .expect(400);
    await api(app).delete(`${V}/notifications/push/subscriptions`).set(t).send({ endpoint: 'https://fcm.googleapis.com/x' }).expect(204);
  });
});

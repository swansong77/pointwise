import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register } from './helpers';
import { BoardService } from '../../src/copilot/board.service';
import { BriefingService } from '../../src/copilot/briefing.service';
import { SCHEDULE } from '../../src/jobs/jobs.module';
import { JOB_NAMES } from '../../src/jobs/jobs.service';

/** Chief of Staff, phase 2: the command center, the annual fee review board and the monthly board report (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let otherId: string;
let walletCardId: string;
let catalogCardId: string;
const DAY = 86_400_000;
const us = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const get = (path: string, t = token) => api(app).get(V + path).set(bearer(t));
const post = (path: string, body: object, t = token) => api(app).post(V + path).set(bearer(t)).send(body);
const put = (path: string, body: object, t = token) => api(app).put(V + path).set(bearer(t)).send(body);

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  const b = await register(app);
  token = a.token;
  other = b.token;
  userId = a.userId;
  otherId = b.userId;
  await post('/subscription/checkout', { interval: 'month' }).expect(201);
  await post('/household/members', { nickname: 'Rileyquist', relationship: 'SPOUSE' }).expect(201);
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  catalogCardId = gold.id;
  walletCardId = (await post('/wallet/cards', { cardId: gold.id }).expect(201)).body.id;
  await post('/offers/intel/import', { walletCardId, text: 'Hilton: Spend $500, get $100 back, expires ' + us(4) }).expect(201);
  const primary = await prisma.profile.findFirstOrThrow({ where: { userId, isPrimary: true } });
  await prisma.loyaltyCertificate.create({ data: { userId, profileId: primary.id, category: 'FREE_NIGHT', name: 'Hyatt free night', expiresAt: new Date(Date.now() + 20 * DAY), potentialValueCents: 25_000, eligible: ['Hyatt'] } });
  // a card with a fee that came due soon, so the board has something to say
  await prisma.walletCard.update({ where: { id: walletCardId }, data: { annualFeeOverrideCents: 39_500, approvedAt: new Date(Date.now() - 335 * DAY) } });
});
afterAll(async () => {
  await prisma.retentionOfferReport.deleteMany({ where: { userId } });
  await app.close();
  await prisma.$disconnect();
});

describe('TC-COS: command center', () => {
  it('shows what the household is worth, five scores with reasons, risks, opportunities and the year’s outlook', async () => {
    const c = (await get('/chief/command-center').expect(200)).body;
    for (const k of ['totalHouseholdCents', 'pointsCents', 'benefitsCents', 'certificatesCents', 'travelCreditsCents', 'offersAvailableCents', 'expiringAssetsCents', 'recentSavingsCents', 'savingsThisYearCents', 'opportunitiesCount', 'projectedSavingsCents']) expect(typeof c.values[k]).toBe('number');
    expect(c.values.certificatesCents).toBeGreaterThan(0);
    expect(c.values.expiringAssetsCents).toBeGreaterThan(0);
    expect(c.scores.map((s: any) => s.key)).toEqual(['HOUSEHOLD', 'LOYALTY', 'PORTFOLIO', 'OFFERS', 'TRAVEL']);
    for (const s of c.scores) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
      expect(['STRONG', 'GOOD', 'FAIR', 'WEAK']).toContain(s.grade);
      expect(s.reasons.length).toBeGreaterThan(0);
    }
    expect(c.outlook).toMatchObject({ version: 'cos-scores/1' });
    expect(c.outlook.lowCents).toBeLessThanOrEqual(c.outlook.netCents);
    expect(c.outlook.highCents).toBeGreaterThanOrEqual(c.outlook.netCents);
    expect(c.outlook.assumptions.join(' ')).toMatch(/estimate/);
    expect(c.risks.length).toBeLessThanOrEqual(10);
    expect(c.risks.every((i: any) => i.impact.atRiskCents > 0)).toBe(true);
    expect(c.top.length).toBeLessThanOrEqual(10);
    expect(c.today.length).toBeLessThanOrEqual(5);
  });

  it('is private and needs a login', async () => {
    const c = (await get('/chief/command-center', other).expect(200)).body;
    expect(JSON.stringify(c)).not.toMatch(/Hilton|Hyatt free night/);
    expect(c.values.certificatesCents).toBe(0);
    await api(app).get(V + '/chief/command-center').expect(401);
    await api(app).get(V + '/chief/fee-review').expect(401);
    await api(app).get(V + '/chief/board').expect(401);
  });
});

describe('TC-COS: annual fee review board', () => {
  it('suggests a retention call when members report accepting an offer and the renewal is near', async () => {
    await prisma.retentionOfferReport.createMany({ data: [{ userId, cardId: catalogCardId, offer: '30,000 bonus points', accepted: true }, { userId, cardId: catalogCardId, offer: '$200 statement credit', accepted: true }, { userId, cardId: catalogCardId, offer: 'nothing', accepted: false }] });
    const r = (await get('/chief/fee-review').expect(200)).body;
    const v = r.verdicts.find((x: any) => /Contoso Gold/.test(x.card));
    expect(v).toBeTruthy();
    expect(v.verdict).toBe('RETENTION_CALL');
    expect(v.justification).toMatch(/2 members who reported one accepted a retention offer/);
    expect(v.justification).toMatch(/Call before it renews/);
    expect(v.daysToRenewal).toBeLessThanOrEqual(90);
    expect(v.impactCents).toBeGreaterThan(0);
    expect(v.alternatives.length).toBeGreaterThan(0);
    expect(v.evidence.join(' ')).toMatch(/Retention reports: 2 of 3/);
    expect(r.totals).toMatchObject({ cards: 1, feesCents: 39_500 });
    expect(r.totals.counts.RETENTION_CALL).toBe(1);
  });

  it('without reports it still says what to do, in dollars, and never "keep" a card that does not earn its fee', async () => {
    await prisma.retentionOfferReport.deleteMany({ where: { userId } });
    const v = (await get('/chief/fee-review').expect(200)).body.verdicts.find((x: any) => /Contoso Gold/.test(x.card));
    expect(v.verdict).not.toBe('KEEP');
    expect(v.justification).toMatch(/\$/);
    expect(v.netCents).toBeLessThan(0);
  });

  it('a card with no fee is simply kept, and each member sees only their own cards', async () => {
    expect((await get('/chief/fee-review', other).expect(200)).body.verdicts).toEqual([]);
    await prisma.walletCard.update({ where: { id: walletCardId }, data: { annualFeeOverrideCents: 0 } });
    const v = (await get('/chief/fee-review').expect(200)).body.verdicts.find((x: any) => /Contoso Gold/.test(x.card));
    expect(v.verdict).toBe('KEEP');
    await prisma.walletCard.update({ where: { id: walletCardId }, data: { annualFeeOverrideCents: 39_500 } });
  });
});

describe('TC-COS: monthly board report', () => {
  it('is the executive summary of the month, written once per month', async () => {
    const first = (await post('/chief/board', {}).expect(201)).body;
    expect(first.created).toBe(true);
    const b = first.board.content;
    expect(b).toMatchObject({ kind: 'BOARD', version: 'copilot-brief/1' });
    expect(b.headline).toMatch(/^Board report for \w+ \d{4}: \$[\d,]+ saved, -?\$[\d,]+ net portfolio value$/);
    expect(b.sections.map((s: any) => s.key)).toEqual(['savings', 'value', 'missed', 'status', 'net', 'fees', 'household']);
    expect(b.sections.find((s: any) => s.key === 'fees').lines.length).toBeGreaterThan(0);
    expect(b.sections.find((s: any) => s.key === 'household').lines.some((l: any) => /^Household health: \d+\/100/.test(l.text))).toBe(true);
    expect(b.summary).toMatch(/Outlook for the year/);
    expect(JSON.stringify(b)).not.toMatch(/automatically (apply|cancel|transfer|book)/i);

    const again = (await post('/chief/board', {}).expect(201)).body;
    expect(again.created).toBe(false);
    expect(again.board.id).toBe(first.board.id);
    expect((await post('/chief/board?fresh=true', {}).expect(201)).body.board.id).toBe(first.board.id);
    expect(await prisma.copilotBriefing.count({ where: { userId, kind: 'BOARD' } })).toBe(1);
    const list = (await get('/chief/board').expect(200)).body;
    expect(list).toHaveLength(1);
    await get('/chief/board/' + list[0].id).expect(200);
    await get('/chief/board/' + list[0].id, other).expect(404);
    expect((await get('/chief/board', other).expect(200)).body).toEqual([]);
  });

  it('the scheduled run writes it once for members who turned the Chief of Staff on, and announces only the board report', async () => {
    expect(JOB_NAMES).toContain('cos-board');
    expect(SCHEDULE['cos-board']).toBe('55 13 1 * *');
    expect(Number(SCHEDULE['cos-board'].split(' ')[0])).toBeGreaterThan(Number(SCHEDULE['copilot-monthly'].split(' ')[0]));
    expect(Number(SCHEDULE['cos-board'].split(' ')[1])).toBeLessThan(14);

    await prisma.copilotBriefing.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId, type: 'COPILOT' } });
    await put('/copilot/settings', { aiModeEnabled: true, chiefOfStaff: true }).expect(200);
    const at = new Date('2027-02-01T13:55:00Z');
    expect(await app.get(BoardService).runDue(at)).toBeGreaterThanOrEqual(1);
    expect(await app.get(BoardService).runDue(at)).toBe(0);
    // the member who has it off gets nothing
    expect(await prisma.copilotBriefing.count({ where: { userId: otherId, kind: 'BOARD' } })).toBe(0);

    await app.get(BriefingService).runDue('MONTHLY', at);
    const notes = await prisma.notification.findMany({ where: { userId, type: 'COPILOT' } });
    expect(notes.map((n) => n.dedupeKey)).toEqual(['copilot:board:2027-02']);
    expect(notes[0].title).toBe('Your monthly board report');
    expect(await prisma.copilotBriefing.count({ where: { userId, kind: 'MONTHLY', periodKey: '2027-02' } })).toBe(1); // kept, not announced twice

    // without the Chief of Staff, the monthly briefing is announced as before
    await put('/copilot/settings', { chiefOfStaff: false }).expect(200);
    await prisma.notification.deleteMany({ where: { userId, type: 'COPILOT' } });
    await prisma.copilotBriefing.deleteMany({ where: { userId, kind: 'MONTHLY' } });
    await app.get(BriefingService).runDue('MONTHLY', at);
    expect((await prisma.notification.findMany({ where: { userId, type: 'COPILOT' } })).map((n) => n.dedupeKey)).toEqual(['copilot:monthly:2027-02']);
  });

  it('the board report is part of the member export', async () => {
    await post('/chief/board?fresh=true', {}).expect(201);
    const exp = JSON.parse((await get('/me/data-export').expect(200)).text);
    expect(JSON.stringify(exp.models.CopilotBriefing)).toContain('BOARD');
  });
});

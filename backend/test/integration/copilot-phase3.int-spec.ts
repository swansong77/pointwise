import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register } from './helpers';
import { defaultProviderFactory } from '../../src/ai/providers';
import { ModelRouter } from '../../src/ai/router';
import { ChatRequest, ChatResponse } from '../../src/ai/types';
import { BriefingService } from '../../src/copilot/briefing.service';
import { CopilotService } from '../../src/copilot/copilot.service';
import { JOB_NAMES } from '../../src/jobs/jobs.service';
import { SCHEDULE } from '../../src/jobs/jobs.module';

/** AI Mode phase 3: briefings, alerts, scheduling and the dashboard (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let otherId: string;
let off: { token: string; id: string };
let cloudName: string;
let cloudProviderId: string;
let cloudModelId: string;
let cloudSeen: ChatRequest[] = [];
const DAY = 86_400_000;
const us = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const get = (path: string, t = token) => api(app).get(V + path).set(bearer(t));
const post = (path: string, body: object, t = token) => api(app).post(V + path).set(bearer(t)).send(body);
const put = (path: string, body: object, t = token) => api(app).put(V + path).set(bearer(t)).send(body);

async function household(t: string, id: string) {
  await post('/subscription/checkout', { interval: 'month' }, t).expect(201);
  await post('/household/members', { nickname: 'Rileyquist', relationship: 'SPOUSE' }, t).expect(201);
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  const w = (await post('/wallet/cards', { cardId: gold.id, lastFour: '7391' }, t).expect(201)).body.id;
  await post('/offers/intel/import', { walletCardId: w, text: 'Hilton: Spend $500, get $100 back, expires ' + us(3) }, t).expect(201);
  const primary = await prisma.profile.findFirstOrThrow({ where: { userId: id, isPrimary: true } });
  await prisma.loyaltyCertificate.create({ data: { userId: id, profileId: primary.id, category: 'FREE_NIGHT', name: 'Hyatt free night', expiresAt: new Date(Date.now() + 20 * DAY), potentialValueCents: 25_000, eligible: ['Hyatt'] } });
}

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  const b = await register(app);
  const c = await register(app);
  token = a.token;
  other = b.token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  otherId = (await prisma.user.findFirstOrThrow({ where: { email: b.email } })).id;
  off = { token: c.token, id: (await prisma.user.findFirstOrThrow({ where: { email: c.email } })).id };
  await household(token, userId);
  await household(off.token, off.id);
  await post('/copilot/goals', { kind: 'FEES', title: 'Zebra fee goal', target: { maxCents: 0 } }).expect(201);
  // AI Mode is on for the first member only; the third has it on but switched briefings off
  await put('/copilot/settings', { aiModeEnabled: true }).expect(200);
  await put('/copilot/settings', { aiModeEnabled: true, briefingDaily: false, briefingWeekly: false, briefingMonthly: false, copilotAlerts: false }, off.token).expect(200);

  process.env.TEST_COPILOT_KEY = 'sk-test-not-real';
  cloudName = 'Test Cloud ' + Math.random().toString(36).slice(2, 8);
  const provider = await prisma.aiProvider.create({ data: { name: cloudName, kind: 'ANTHROPIC', status: 'ACTIVE', apiKeyEnv: 'TEST_COPILOT_KEY' } });
  cloudProviderId = provider.id;
  cloudModelId = (await prisma.aiModel.create({ data: { providerId: provider.id, modelId: 'fake-3', displayName: 'Fake Cloud ' + cloudName, status: 'ACTIVE', capabilities: [] } })).id;
  app.get(ModelRouter).factory = (p) =>
    p.id === cloudProviderId
      ? {
          kind: p.kind,
          chat: async (req: ChatRequest): Promise<ChatResponse> => {
            cloudSeen.push(JSON.parse(JSON.stringify(req)));
            return { text: 'Start with item 1.', toolCalls: [], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
          },
        }
      : defaultProviderFactory(p);
});
afterAll(async () => {
  await prisma.aiModel.deleteMany({ where: { id: cloudModelId } });
  await prisma.aiProvider.deleteMany({ where: { name: cloudName } });
  await app.close();
  await prisma.$disconnect();
});
beforeEach(() => {
  cloudSeen = [];
});

describe('TC-BRIEF: briefings', () => {
  it('daily, weekly and monthly are built from the member’s own data, once per period', async () => {
    const d = (await post('/copilot/briefings/daily', {}).expect(201)).body;
    expect(d.created).toBe(true);
    expect(d.briefing.content).toMatchObject({ kind: 'DAILY', version: 'copilot-brief/1' });
    const sec = (b: any, k: string) => b.content.sections.find((s: any) => s.key === k);
    expect(JSON.stringify(sec(d.briefing, 'week').lines) + JSON.stringify(sec(d.briefing, 'today').lines)).toMatch(/Hilton/);
    expect(d.briefing.content.sections.map((s: any) => s.key)).toEqual(['today', 'week', 'month', 'new', 'travel', 'goals', 'household']);
    expect(JSON.stringify(sec(d.briefing, 'goals').lines)).toMatch(/Zebra fee goal/); // the member's own page shows their own words

    const again = (await post('/copilot/briefings/daily', {}).expect(201)).body;
    expect(again.created).toBe(false);
    expect(again.briefing.id).toBe(d.briefing.id);
    const fresh = (await post('/copilot/briefings/daily?fresh=true', {}).expect(201)).body;
    expect(fresh.briefing.id).toBe(d.briefing.id);
    expect(await prisma.copilotBriefing.count({ where: { userId, kind: 'DAILY' } })).toBe(1);

    const w = (await post('/copilot/briefings/weekly', {}).expect(201)).body.briefing;
    expect(w.content.sections.map((s: any) => s.key)).toEqual(['changed', 'savings', 'missed', 'health', 'recommendations']);
    const m = (await post('/copilot/briefings/monthly', {}).expect(201)).body.briefing;
    expect(m.content.sections.map((s: any) => s.key)).toEqual(['cards', 'fees', 'apply', 'transfer', 'redeem', 'wait', 'goals']);
    expect(sec(m, 'cards').lines[0].text).toMatch(/Contoso Gold/);
    expect(JSON.stringify(m.content)).not.toMatch(/automatically (apply|cancel|transfer|book)/i);
    await post('/copilot/briefings/hourly', {}).expect(404);
  });

  it('can be listed, fetched and is private', async () => {
    const list = (await get('/copilot/briefings').expect(200)).body;
    expect(list.map((b: any) => b.kind).sort()).toEqual(['DAILY', 'MONTHLY', 'WEEKLY']);
    expect((await get('/copilot/briefings?kind=WEEKLY').expect(200)).body).toHaveLength(1);
    const latest = (await get('/copilot/briefings/latest').expect(200)).body;
    expect(latest.DAILY.content.kind).toBe('DAILY');
    await get('/copilot/briefings/' + list[0].id).expect(200);
    await get('/copilot/briefings/' + list[0].id, other).expect(404);
    expect((await get('/copilot/briefings', other).expect(200)).body).toEqual([]);
    expect((await get('/copilot/briefings/latest', other).expect(200)).body).toEqual({ DAILY: null, WEEKLY: null, MONTHLY: null });
    await api(app).get(V + '/copilot/briefings').expect(401);
  });

  it('never reaches a cloud model unless sharing is on, and then only the redacted view', async () => {
    await post('/copilot/briefings/daily?fresh=true', {}).expect(201);
    expect(cloudSeen).toHaveLength(0);
    await put('/copilot/settings', { cloudShare: true, cloudProviders: [cloudName] }).expect(200);
    await prisma.aiSettings.update({ where: { userId }, data: { preferredModelId: cloudModelId } });
    const r = (await post('/copilot/briefings/weekly?fresh=true', {}).expect(201)).body.briefing;
    expect(cloudSeen).toHaveLength(1);
    const sent = JSON.stringify(cloudSeen[0]);
    expect(sent).not.toMatch(/Zebra|Rileyquist|7391|Contoso Gold \(|@/);
    expect(r.narration).toMatchObject({ provider: cloudName, local: false });
    expect(await prisma.aiDisclosure.count({ where: { userId, provider: cloudName } })).toBeGreaterThan(0);
    await put('/copilot/settings', { cloudShare: false }).expect(200);
    await prisma.aiSettings.update({ where: { userId }, data: { preferredModelId: null } });
  });
});

describe('TC-BRIEF: the scheduled run', () => {
  it('is on the schedule, before the 14:00 digest that carries it', () => {
    for (const j of ['copilot-daily', 'copilot-weekly', 'copilot-monthly', 'copilot-alerts', 'copilot-cleanup']) {
      expect(JOB_NAMES).toContain(j);
      expect(SCHEDULE[j as keyof typeof SCHEDULE]).toMatch(/^\d+ \d+ [\d*]+ \* [\d*]$/);
    }
    for (const j of ['copilot-daily', 'copilot-weekly', 'copilot-monthly', 'copilot-alerts'] as const) expect(Number(SCHEDULE[j].split(' ')[1])).toBeLessThan(14);
    expect(SCHEDULE['copilot-weekly'].split(' ')[4]).toBe('1');
    expect(SCHEDULE['copilot-monthly'].split(' ')[2]).toBe('1');
  });

  it('writes one briefing and one notification per member who has AI Mode on and the kind enabled; running twice adds nothing', async () => {
    await prisma.copilotBriefing.deleteMany({ where: { userId } });
    await prisma.notification.deleteMany({ where: { userId, type: 'COPILOT' } });
    const svc = app.get(BriefingService);
    const at = new Date('2026-12-02T13:10:00Z');
    const first = await svc.runDue('DAILY', at);
    expect(first).toBeGreaterThanOrEqual(1);
    expect(await svc.runDue('DAILY', at)).toBe(0);
    const mine = await prisma.notification.findMany({ where: { userId, type: 'COPILOT' } });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'Your daily Copilot briefing', link: '/copilot#briefings' });
    expect(mine[0].dedupeKey).toBe('copilot:daily:2026-12-02');
    // not for the member who has AI Mode off, nor the one who switched briefings off
    expect(await prisma.copilotBriefing.count({ where: { userId: otherId } })).toBe(0);
    expect(await prisma.copilotBriefing.count({ where: { userId: off.id } })).toBe(0);
    expect((await get('/notifications').expect(200)).text).toContain('Your daily Copilot briefing');
    expect((await get('/notifications', other).expect(200)).text).not.toContain('Copilot briefing');
    // weekly and monthly use their own switches and keys
    await svc.runDue('WEEKLY', new Date('2026-12-07T13:40:00Z'));
    await svc.runDue('MONTHLY', new Date('2027-01-01T13:50:00Z'));
    expect((await prisma.notification.findMany({ where: { userId, type: 'COPILOT' } })).map((n) => n.dedupeKey).sort()).toEqual(['copilot:daily:2026-12-02', 'copilot:monthly:2027-01', 'copilot:weekly:2026-12-07']);
  });

  it('a briefing the member asked for does not also notify them', async () => {
    await prisma.notification.deleteMany({ where: { userId, type: 'COPILOT' } });
    await post('/copilot/briefings/daily?fresh=true', {}).expect(201);
    expect(await prisma.notification.count({ where: { userId, type: 'COPILOT' } })).toBe(0);
  });

  it('nothing is kept past 90 days', async () => {
    await prisma.copilotBriefing.create({ data: { userId, kind: 'DAILY', periodKey: '2020-01-01', content: {}, createdAt: new Date(Date.now() - 100 * DAY) } });
    expect(await app.get(CopilotService).purgeDisclosures(new Date())).toBeGreaterThanOrEqual(1);
    expect(await prisma.copilotBriefing.count({ where: { userId, periodKey: '2020-01-01' } })).toBe(0);
  });
});

describe('TC-ALERTS: proactive alerts', () => {
  it('names what is worth interrupting for, with a link', async () => {
    const a = (await get('/copilot/alerts').expect(200)).body;
    const goal = a.find((x: any) => x.key.startsWith('goal:'));
    expect(goal).toMatchObject({ link: '/copilot#goals' });
    expect(goal.title).toMatch(/Zebra fee goal/);
    expect(a.length).toBeLessThanOrEqual(3);
    for (const x of a) {
      expect(x.dedupeKey).toMatch(/^copilot:/);
      expect(x.body).not.toMatch(/automatically/i);
    }
    expect((await get('/copilot/alerts', other).expect(200)).body.some((x: any) => /Zebra/.test(x.title))).toBe(false);
  });

  it('are sent once, only to members who want them', async () => {
    await prisma.notification.deleteMany({ where: { userId, type: 'COPILOT' } });
    const svc = app.get(BriefingService);
    const at = new Date('2026-12-03T13:20:00Z');
    expect(await svc.runAlerts(at)).toBeGreaterThanOrEqual(1);
    const before = await prisma.notification.count({ where: { userId, type: 'COPILOT' } });
    expect(before).toBeGreaterThanOrEqual(1);
    await svc.runAlerts(at);
    await svc.runAlerts(new Date('2026-12-04T13:20:00Z')); // same week and month: the keys repeat
    expect(await prisma.notification.count({ where: { userId, type: 'COPILOT' } })).toBe(before);
    expect(await prisma.notification.count({ where: { userId: off.id, type: 'COPILOT' } })).toBe(0);
    expect(await prisma.notification.count({ where: { userId: otherId, type: 'COPILOT' } })).toBe(0);
  });
});

describe('TC-DASH: the Copilot dashboard', () => {
  it('shows today’s tasks, what is expiring, actions, the household, travel, savings, health and goals', async () => {
    const d = (await get('/copilot/dashboard').expect(200)).body;
    expect(Object.keys(d)).toEqual(expect.arrayContaining(['headline', 'today', 'expiring', 'actions', 'travel', 'savings', 'household', 'portfolio', 'goals', 'recommendations', 'briefing', 'counts']));
    expect(d.today.length).toBeGreaterThan(0);
    expect(JSON.stringify(d.today)).toMatch(/Hilton/);
    expect(d.expiring.some((i: any) => /Hyatt free night/.test(i.title))).toBe(true);
    expect(d.household.members.length).toBeGreaterThanOrEqual(2);
    expect(d.portfolio).toMatchObject({ cards: 1 });
    expect(typeof d.portfolio.feesCents).toBe('number');
    expect(d.savings.totalCents).toBe(d.savings.offersCents + d.savings.creditsCents);
    expect(d.goals.find((g: any) => g.title === 'Zebra fee goal').progress.state).toBe('BEHIND');
    expect(d.briefing).toMatchObject({ kind: expect.any(String), headline: expect.any(String) });
    for (const i of [...d.today, ...d.actions]) for (const c of i.calls) expect(c.kind).toBe('REMINDER');
  });
  it('is private', async () => {
    const d = (await get('/copilot/dashboard', other).expect(200)).body;
    expect(JSON.stringify(d)).not.toMatch(/Hilton|Hyatt free night|Zebra/);
    await api(app).get(V + '/copilot/dashboard').expect(401);
  });
});

describe('TC-BRIEF: settings and export', () => {
  it('each kind and the alerts can be switched off, and briefings are in the member export', async () => {
    expect((await get('/copilot/settings').expect(200)).body.briefings).toEqual({ daily: true, weekly: true, monthly: true, alerts: true });
    expect((await put('/copilot/settings', { briefingWeekly: false, copilotAlerts: false }).expect(200)).body.briefings).toEqual({ daily: true, weekly: false, monthly: true, alerts: false });
    await put('/copilot/settings', { briefingWeekly: true, copilotAlerts: true }).expect(200);
    const exp = JSON.parse((await get('/me/data-export').expect(200)).text);
    expect(Object.keys(exp.models)).toContain('CopilotBriefing');
    expect(JSON.stringify(exp.models.CopilotBriefing)).toContain('DAILY');
  });
});

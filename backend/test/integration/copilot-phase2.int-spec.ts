import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register } from './helpers';
import { defaultProviderFactory } from '../../src/ai/providers';
import { ModelRouter } from '../../src/ai/router';
import { ChatRequest, ChatResponse } from '../../src/ai/types';

/** AI Mode phase 2: what-if analysis, goals, and what Copilot remembers (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let spouseId: string;
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
const patch = (path: string, body: object, t = token) => api(app).patch(V + path).set(bearer(t)).send(body);
const del = (path: string, t = token) => api(app).delete(V + path).set(bearer(t));
const ask = async (q: string, t = token, mode = 'PLANNING') => (await post('/copilot/ask', { q, mode }, t).expect(201)).body;

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  token = a.token;
  other = (await register(app)).token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  await post('/subscription/checkout', { interval: 'month' }).expect(201);
  spouseId = (await post('/household/members', { nickname: 'Rileyquist', relationship: 'SPOUSE' }).expect(201)).body.id;
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  const w = (await post('/wallet/cards', { cardId: gold.id }).expect(201)).body.id;
  await post('/offers/intel/import', { walletCardId: w, text: 'Hilton: Spend $500, get $100 back, expires ' + us(3) }).expect(201);
  const primary = await prisma.profile.findFirstOrThrow({ where: { userId, isPrimary: true } });
  await prisma.loyaltyCertificate.create({ data: { userId, profileId: primary.id, category: 'FREE_NIGHT', name: 'Hyatt free night', expiresAt: new Date(Date.now() + 20 * DAY), potentialValueCents: 25_000, eligible: ['Hyatt'] } });

  process.env.TEST_COPILOT_KEY = 'sk-test-not-real';
  cloudName = 'Test Cloud ' + Math.random().toString(36).slice(2, 8);
  const provider = await prisma.aiProvider.create({ data: { name: cloudName, kind: 'ANTHROPIC', status: 'ACTIVE', apiKeyEnv: 'TEST_COPILOT_KEY' } });
  cloudProviderId = provider.id;
  cloudModelId = (await prisma.aiModel.create({ data: { providerId: provider.id, modelId: 'fake-2', displayName: 'Fake Cloud ' + cloudName, status: 'ACTIVE', capabilities: [] } })).id;
  const router = app.get(ModelRouter);
  router.factory = (p) => {
    if (p.id === cloudProviderId) {
      return {
        kind: p.kind,
        chat: async (req: ChatRequest): Promise<ChatResponse> => {
          cloudSeen.push(JSON.parse(JSON.stringify(req)));
          return { text: 'Start with item 1.', toolCalls: [], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
        },
      };
    }
    return defaultProviderFactory(p);
  };
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

describe('TC-WHATIF: asked in plain language', () => {
  it('"What if I cancel <card>?" compares fee, rewards, benefits, 5/24 and the household', async () => {
    const r = await ask('What if I cancel Contoso Gold?');
    expect(r.plan.kind).toBe('WHATIF');
    const o = r.plan.whatIf;
    expect(o).toMatchObject({ scenario: 'CANCEL', version: 'what-if/1' });
    expect(o.title).toMatch(/Contoso Gold/);
    expect(o.deltas.map((d: any) => d.dimension)).toEqual(expect.arrayContaining(['FINANCIAL', 'BENEFITS', 'FIVE24', 'POINTS']));
    expect(o.deltas.find((d: any) => d.dimension === 'FIVE24').change).toMatch(/does not remove it/);
    expect(o.assumptions.length).toBeGreaterThan(0);
    expect(o.risks.join(' ')).toMatch(/credit/);
    expect(o.alternatives.join(' ')).toMatch(/retention/);
    expect(typeof o.netCents).toBe('number');
    expect(r.plan.items[0]).toMatchObject({ lens: 'CARD_STRATEGY' });
    // read-only: nothing was cancelled
    expect((await get('/wallet/cards').expect(200)).body.length).toBeGreaterThan(0);
    expect(await prisma.walletCard.count({ where: { wallet: { userId }, status: 'CLOSED' } })).toBe(0);
  });

  it('"What if I wait 3 months?" shows 5/24 and what lapses', async () => {
    const o = (await ask('What if I wait 3 months?')).plan.whatIf;
    expect(o).toMatchObject({ scenario: 'WAIT' });
    expect(o.title).toBe('What if you wait 3 months?');
    expect(o.summary).toMatch(/Hilton/);
    expect(o.deltas.some((d: any) => /lapse/.test(d.label))).toBe(true);
  });

  it('"What if my spouse applies instead?" uses the best next card and says so', async () => {
    const o = (await ask('What if my spouse applies instead?')).plan.whatIf;
    expect(o).toMatchObject({ scenario: 'APPLY' });
    expect(o.title).toMatch(/Rileyquist/);
    expect(o.assumptions[0]).toMatch(/No card was named/);
    expect(o.deltas.some((d: any) => d.dimension === 'HOUSEHOLD')).toBe(true);
  });

  it('a named card: "What if my spouse applies for Northwind Voyager Reserve?"', async () => {
    const r = await ask('What if my spouse applies for Northwind Voyager Reserve?');
    expect(r.plan.whatIf?.scenario).toBe('APPLY');
    expect(r.plan.whatIf.title).toMatch(/Northwind Voyager Reserve/);
  });

  it('transfers and product changes are compared, never done', async () => {
    const t = (await ask('What if I transfer 60,000 points to AeroLink Rewards?')).plan.whatIf;
    expect(t).toMatchObject({ scenario: 'TRANSFER' });
    expect(t.risks.join(' ')).toMatch(/cannot be undone/);
    expect(t.recommendation).toMatch(/never makes one/);
    const c = (await ask('What if I upgrade Contoso Gold to Northwind Voyager Reserve?')).plan.whatIf;
    expect(c).toMatchObject({ scenario: 'CHANGE' });
    expect(c.deltas.find((d: any) => d.dimension === 'FIVE24')).toBeTruthy();
  });

  it('asks for what is missing, and says plainly when a card is not there', async () => {
    const miss = await ask('What if I cancel it?');
    expect(miss.plan.headline).toMatch(/need a little more/);
    expect(miss.plan.summary).toMatch(/which card/);
    const none = await ask('What if I cancel Platinum Unicorn Card?');
    expect(none.plan.kind).toBe('ANSWER');
    const noProg = await ask('What if I transfer points?');
    expect(noProg.plan.summary).toMatch(/which program/);
  });

  it('is private to the caller and audited', async () => {
    const r = await ask('What if I cancel Contoso Gold?', other);
    expect(r.plan.kind).toBe('ANSWER'); // the other member has no such card
    const mine = await ask('What if I wait 2 weeks?');
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: mine.runId }, include: { steps: true } });
    expect(run.steps.map((s) => s.engine)).toEqual(['what-if']);
  });

  it('never goes to a cloud model, even with sharing on', async () => {
    await put('/copilot/settings', { cloudShare: true, cloudProviders: [cloudName] }).expect(200);
    await prisma.aiSettings.update({ where: { userId }, data: { preferredModelId: cloudModelId } });
    await ask('What if I cancel Contoso Gold?');
    await ask('What if I wait 3 months?');
    expect(cloudSeen).toHaveLength(0);
    await put('/copilot/settings', { cloudShare: false }).expect(200);
  });
});

describe('TC-GOALS: goals with progress from the household’s own data', () => {
  let ids: Record<string, string> = {};

  it('creates goals of each kind and computes progress', async () => {
    const five = (await post('/copilot/goals', { kind: 'FIVE24', title: 'Stay under 5/24', target: { max: 4 } }).expect(201)).body;
    ids.five = five.id;
    expect(five.progress).toMatchObject({ state: 'ON_TRACK' });
    const fees = (await post('/copilot/goals', { kind: 'FEES', title: 'Keep fees at $0', target: { maxCents: 0 } }).expect(201)).body;
    ids.fees = fees.id;
    expect(fees.progress.state).toBe('BEHIND');
    expect(fees.progress.detail).toMatch(/over your limit/);
    const miles = (await post('/copilot/goals', { kind: 'MILES', title: 'Build Delta miles', target: { program: 'Delta', points: 100000 } }).expect(201)).body;
    ids.miles = miles.id;
    expect(miles.progress.state).toBe('UNKNOWN');
    const custom = (await post('/copilot/goals', { kind: 'CUSTOM', title: 'Plan the Disney trip' }).expect(201)).body;
    ids.custom = custom.id;
    const list = (await get('/copilot/goals').expect(200)).body;
    expect(list.map((g: any) => g.id)).toEqual(expect.arrayContaining(Object.values(ids)));
    expect(list.every((g: any) => g.progress && typeof g.progress.state === 'string')).toBe(true);
  });

  it('rejects bad goals', async () => {
    await post('/copilot/goals', { kind: 'NOPE', title: 'x y' }).expect(400);
    await post('/copilot/goals', { kind: 'FIVE24', title: 'x y', target: { max: 99 } }).expect(400);
    await post('/copilot/goals', { kind: 'STATUS', title: 'Globalist', target: { program: 'Hyatt' } }).expect(400);
    await post('/copilot/goals', { kind: 'CUSTOM', title: 'x y', dueAt: '2020-01-01' }).expect(400);
    await post('/copilot/goals', { kind: 'CUSTOM', title: 'x y', profileId: '11111111-1111-4111-8111-111111111111' }).expect(404);
    await api(app).post(V + '/copilot/goals').send({ kind: 'CUSTOM', title: 'x y' }).expect(401);
  });

  it('only custom goals take a hand-set progress; goals can be finished and dropped', async () => {
    await patch(`/copilot/goals/${ids.five}`, { manualProgress: 50 }).expect(400);
    const c = (await patch(`/copilot/goals/${ids.custom}`, { manualProgress: 60 }).expect(200)).body;
    expect(c.progress).toMatchObject({ pct: 60, state: 'ON_TRACK' });
    await patch(`/copilot/goals/${ids.custom}`, { manualProgress: 160 }).expect(400);
    const done = (await patch(`/copilot/goals/${ids.custom}`, { status: 'DONE' }).expect(200)).body;
    expect(done.status).toBe('DONE');
    expect(done.completedAt).toBeTruthy();
    expect((await get('/copilot/goals').expect(200)).body.map((g: any) => g.id)).not.toContain(ids.custom);
    expect((await get('/copilot/goals?status=all').expect(200)).body.map((g: any) => g.id)).toContain(ids.custom);
    await patch(`/copilot/goals/${ids.miles}`, { title: 'Build more Delta miles', target: { program: 'Delta', points: 120000 } }).expect(200);
  });

  it('are private, capped, and removable', async () => {
    expect((await get('/copilot/goals', other).expect(200)).body).toEqual([]);
    await patch(`/copilot/goals/${ids.fees}`, { status: 'DROPPED' }, other).expect(404);
    await del(`/copilot/goals/${ids.fees}`, other).expect(404);
    const t = (await register(app)).token;
    for (let i = 0; i < 20; i++) await post('/copilot/goals', { kind: 'CUSTOM', title: 'Goal number ' + i }, t).expect(201);
    await post('/copilot/goals', { kind: 'CUSTOM', title: 'One too many' }, t).expect(400);
    await del(`/copilot/goals/${ids.fees}`).expect(204);
    await del(`/copilot/goals/${ids.fees}`).expect(404);
  });

  it('the plan includes goals that need attention, but a cloud model never sees a goal’s words', async () => {
    await post('/copilot/goals', { kind: 'FEES', title: 'Zebra fee goal', target: { maxCents: 0 } }).expect(201);
    const r = await ask('What should I do this month?');
    const item = r.plan.items.find((i: any) => /Zebra fee goal/.test(i.title));
    expect(item).toMatchObject({ lens: 'GOAL' });
    expect(r.plan.lenses.find((l: any) => l.lens === 'GOAL')).toBeTruthy();

    await put('/copilot/settings', { cloudShare: true, cloudProviders: [cloudName] }).expect(200);
    await prisma.aiSettings.update({ where: { userId }, data: { preferredModelId: cloudModelId } });
    await ask('What should I do this month?', token, 'RESEARCH');
    expect(cloudSeen).toHaveLength(1);
    const sent = JSON.stringify(cloudSeen[0]);
    expect(sent).not.toMatch(/Zebra|Rileyquist|Contoso Gold \(|Delta|Visit/);
    const view = JSON.parse((cloudSeen[0].messages[0] as { text: string }).text);
    expect(view.items.find((i: any) => i.kind === 'goal')).toMatchObject({ lens: 'goal', verdict: 'behind' });
    await put('/copilot/settings', { cloudShare: false }).expect(200);
  });
});

describe('TC-MEMORY: preferences and decisions', () => {
  it('preferences are validated, merged and private', async () => {
    expect((await get('/copilot/memory/preferences').expect(200)).body).toMatchObject({ airlines: [], hotels: [], priorities: [] });
    await put('/copilot/memory/preferences', { airlines: ['Delta', 'delta', 'United'], priorities: ['TRAVEL'] }).expect(200);
    const p = (await put('/copilot/memory/preferences', { hotels: ['Hyatt'] }).expect(200)).body;
    expect(p).toMatchObject({ airlines: ['Delta', 'United'], hotels: ['Hyatt'], priorities: ['TRAVEL'] });
    await put('/copilot/memory/preferences', { priorities: ['FUN'] }).expect(400);
    await put('/copilot/memory/preferences', { hotels: Array.from({ length: 13 }, (_, i) => 'h' + i) }).expect(400);
    expect((await get('/copilot/memory/preferences', other).expect(200)).body.airlines).toEqual([]);
  });

  it('a preference raises matching items and says why', async () => {
    await put('/copilot/memory/preferences', { hotels: ['Hyatt'], priorities: [] }).expect(200);
    const r = await ask('What should I do this month?');
    const cert = r.plan.items.find((i: any) => /Hyatt free night/.test(i.title));
    expect(cert.factors.map((f: any) => f.label)).toContain('Matches your preferences');
    expect(r.plan.memory.boosted).toBeGreaterThan(0);
  });

  it('snoozing or dismissing an item hides it, says so, and can be undone by forgetting', async () => {
    const before = await ask('What should I do this month?');
    const target = before.plan.items.find((i: any) => /Hilton/.test(i.title));
    expect(target).toBeTruthy();
    await post('/copilot/memory/decisions', { itemId: target.id, action: 'SNOOZE', days: 5 }).expect(201);
    const after = await ask('What should I do this month?');
    expect(after.plan.items.map((i: any) => i.id)).not.toContain(target.id);
    expect(after.plan.memory.hidden.map((h: any) => h.id)).toContain(target.id);
    expect(after.plan.summary).toMatch(/snoozed or dismissed/);
    const mem = (await get('/copilot/memory').expect(200)).body;
    const row = mem.find((m: any) => m.kind === 'DECISION' && m.key === target.id);
    expect(row).toBeTruthy();
    await del(`/copilot/memory/${row.id}`).expect(204);
    expect((await ask('What should I do this month?')).plan.items.map((i: any) => i.id)).toContain(target.id);
    await post('/copilot/memory/decisions', { itemId: target.id, action: 'SNOOZE', days: 0 }).expect(400);
    await post('/copilot/memory/decisions', { itemId: target.id, action: 'EXPLODE' }).expect(400);
    await post('/copilot/memory/decisions', { itemId: '', action: 'DONE' }).expect(400);
  });

  it('remembers what it recommended, can forget it all, and is private', async () => {
    const mem = (await get('/copilot/memory').expect(200)).body;
    expect(mem.some((m: any) => m.kind === 'RECOMMENDATION' && m.value.shown >= 1)).toBe(true);
    expect((await get('/copilot/memory', other).expect(200)).body.every((m: any) => m.userId !== userId)).toBe(true);
    const gone = (await del('/copilot/memory?kind=RECOMMENDATION').expect(200)).body;
    expect(gone.removed).toBeGreaterThan(0);
    expect((await get('/copilot/memory').expect(200)).body.some((m: any) => m.kind === 'RECOMMENDATION')).toBe(false);
    expect((await del('/copilot/memory').expect(200)).body.removed).toBeGreaterThanOrEqual(1);
    expect((await get('/copilot/memory/preferences').expect(200)).body.hotels).toEqual([]);
  });

  it('goals and memory are part of the member export', async () => {
    await put('/copilot/memory/preferences', { airlines: ['Delta'] }).expect(200);
    await post('/copilot/goals', { kind: 'CUSTOM', title: 'Exported goal' }).expect(201);
    const exp = JSON.parse((await get('/me/data-export').expect(200)).text);
    expect(Object.keys(exp.models)).toEqual(expect.arrayContaining(['Goal', 'CopilotMemory']));
    expect(JSON.stringify(exp.models.Goal)).toContain('Exported goal');
    expect(JSON.stringify(exp.models.CopilotMemory)).toContain('Delta');
    expect(spouseId).toBeTruthy();
  });
});

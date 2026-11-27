import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register } from './helpers';
import { defaultProviderFactory } from '../../src/ai/providers';
import { ModelRouter } from '../../src/ai/router';
import { ChatRequest, ChatResponse } from '../../src/ai/types';

/** Chief of Staff, phase 3: governance, roadmaps, life events and the household chief (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let cloudName: string;
let cloudProviderId: string;
let cloudModelId: string;
let cloudSeen: ChatRequest[] = [];
const DAY = 86_400_000;
const TITLE = 'Zebra Disney week';
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const us = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const get = (path: string, t = token) => api(app).get(V + path).set(bearer(t));
const post = (path: string, body: object, t = token) => api(app).post(V + path).set(bearer(t)).send(body);
const put = (path: string, body: object, t = token) => api(app).put(V + path).set(bearer(t)).send(body);
const patch = (path: string, body: object, t = token) => api(app).patch(V + path).set(bearer(t)).send(body);
const del = (path: string, t = token) => api(app).delete(V + path).set(bearer(t));
const trip = { kind: 'FAMILY_VACATION', title: TITLE, destination: 'Orlando', startsOn: iso(45), endsOn: iso(52), travelers: 4, budgetCents: 400_000 };

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  const b = await register(app);
  token = a.token;
  other = b.token;
  userId = a.userId;
  await post('/subscription/checkout', { interval: 'month' }).expect(201);
  await post('/household/members', { nickname: 'Rileyquist', relationship: 'SPOUSE' }).expect(201);
  await post('/household/members', { nickname: 'Samtheyoung', relationship: 'CHILD', birthYear: 2013 }).expect(201);
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  const w = (await post('/wallet/cards', { cardId: gold.id, lastFour: '7391' }).expect(201)).body.id;
  await post('/offers/intel/import', { walletCardId: w, text: 'Hilton: Spend $500, get $100 back, expires ' + us(5) }).expect(201);
  const primary = await prisma.profile.findFirstOrThrow({ where: { userId, isPrimary: true } });
  await prisma.loyaltyCertificate.create({ data: { userId, profileId: primary.id, category: 'FREE_NIGHT', name: 'Hyatt free night', expiresAt: new Date(Date.now() + 200 * DAY), potentialValueCents: 25_000, eligible: ['Hyatt'] } });
  await put('/copilot/settings', { aiModeEnabled: true }).expect(200);
  void b;

  process.env.TEST_COPILOT_KEY = 'sk-test-not-real';
  cloudName = 'Test Cloud ' + Math.random().toString(36).slice(2, 8);
  const provider = await prisma.aiProvider.create({ data: { name: cloudName, kind: 'ANTHROPIC', status: 'ACTIVE', apiKeyEnv: 'TEST_COPILOT_KEY' } });
  cloudProviderId = provider.id;
  cloudModelId = (await prisma.aiModel.create({ data: { providerId: provider.id, modelId: 'fake-5', displayName: 'Fake Cloud ' + cloudName, status: 'ACTIVE', capabilities: [] } })).id;
  app.get(ModelRouter).factory = (p) =>
    p.id === cloudProviderId
      ? { kind: p.kind, chat: async (req: ChatRequest): Promise<ChatResponse> => (cloudSeen.push(JSON.parse(JSON.stringify(req))), { text: 'Start with item 1.', toolCalls: [], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }) }
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

describe('TC-LIFE: life events', () => {
  let id: string;

  it('saves an event, lists it, and rejects bad ones', async () => {
    const e = (await post('/chief/life-events', trip).expect(201)).body;
    id = e.id;
    expect(e).toMatchObject({ kind: 'FAMILY_VACATION', title: TITLE, destination: 'Orlando', travelers: 4, budgetCents: 400_000, status: 'PLANNING' });
    expect((await get('/chief/life-events').expect(200)).body.map((x: any) => x.id)).toContain(id);
    await post('/chief/life-events', { ...trip, kind: 'NOPE' }).expect(400);
    await post('/chief/life-events', { ...trip, title: ' ' }).expect(400);
    await post('/chief/life-events', { ...trip, destination: '' }).expect(400);
    await post('/chief/life-events', { ...trip, endsOn: iso(10) }).expect(400);
    await post('/chief/life-events', { ...trip, startsOn: iso(-20) }).expect(400);
    await post('/chief/life-events', { ...trip, travelers: 99 }).expect(400);
    await api(app).post(V + '/chief/life-events').send(trip).expect(401);
  });

  it('works out what the member’s own cards, credits and certificates can do for it, and says what it assumed', async () => {
    const r = (await post(`/chief/life-events/${id}/estimate`, {}).expect(201)).body;
    const e = r.estimate;
    expect(e).toMatchObject({ version: 'life/1', kind: 'FAMILY_VACATION' });
    expect(e.bestCards.map((c: any) => c.use)).toEqual(expect.arrayContaining(['Flights', 'Lodging']));
    for (const c of e.bestCards) {
      expect(c.card).toBeTruthy();
      expect(typeof c.expectedCents).toBe('number');
    }
    expect(e.certificates.find((c: any) => c.name === 'Hyatt free night')).toMatchObject({ cents: 25_000, usable: true });
    expect(e.travelCredits).toHaveProperty('cents');
    expect(e.expectedValueCents).toBe(e.bestCards.reduce((s: number, c: any) => s + Math.max(0, c.expectedCents), 0) + e.travelCredits.cents + 25_000);
    expect(e.assumptions.join(' ')).toMatch(/Points are shown separately/);
    expect(e.confidence).toBeGreaterThan(0);
    expect(r.event.estimatedAt).toBeTruthy();
    expect((await get('/chief/life-events').expect(200)).body.find((x: any) => x.id === id).estimate.version).toBe('life/1');
  });

  it('assumes what is missing and says so; a purchase is worked out as a purchase', async () => {
    const bare = (await post('/chief/life-events', { kind: 'INTERNATIONAL', title: 'Seoul someday', destination: 'Seoul' }).expect(201)).body;
    const e = (await post(`/chief/life-events/${bare.id}/estimate`, {}).expect(201)).body.estimate;
    expect(e.assumed.join(' ')).toMatch(/No start date/);
    expect(e.assumed.join(' ')).toMatch(/No budget/);
    expect(e.confidence).toBeLessThan(70);
    const move = (await post('/chief/life-events', { kind: 'MOVING', title: 'Move to Austin', budgetCents: 300_000 }).expect(201)).body;
    const m = (await post(`/chief/life-events/${move.id}/estimate`, {}).expect(201)).body.estimate;
    expect(m.bestCards.map((c: any) => c.use)).toEqual(['Purchase']);
    expect(m.certificates).toEqual([]);
  });

  it('changing what it was based on makes the estimate stale; it is private; reading it changes nothing', async () => {
    const before = await prisma.walletCard.count({ where: { wallet: { userId } } });
    const edited = (await patch(`/chief/life-events/${id}`, { destination: 'Lisbon' }).expect(200)).body;
    expect(edited.estimate).toBeNull();
    expect(edited.estimatedAt).toBeNull();
    await patch(`/chief/life-events/${id}`, { status: 'BOOKED' }).expect(200);
    await post(`/chief/life-events/${id}/estimate`, {}, other).expect(404);
    await patch(`/chief/life-events/${id}`, { title: 'x y' }, other).expect(404);
    await del(`/chief/life-events/${id}`, other).expect(404);
    expect((await get('/chief/life-events', other).expect(200)).body).toEqual([]);
    expect(await prisma.walletCard.count({ where: { wallet: { userId } } })).toBe(before);
    await patch(`/chief/life-events/${id}`, { destination: 'Orlando' }).expect(200);
  });

  it('shows up as something to prepare for, and the event’s own words never reach a cloud model', async () => {
    const o = (await get('/chief/overview').expect(200)).body;
    const all = (await get('/chief/actions').expect(200)).body.flatMap((h: any) => h.items);
    expect(all.some((i: any) => i.id.startsWith('life:') && i.title.includes(TITLE))).toBe(true);
    expect(o.summary.totalActions).toBeGreaterThan(0);

    await put('/copilot/settings', { cloudShare: true, cloudProviders: [cloudName], chiefOfStaff: true }).expect(200);
    await prisma.aiSettings.update({ where: { userId }, data: { preferredModelId: cloudModelId } });
    await post('/copilot/briefings/daily?fresh=true', {}).expect(201);
    expect(cloudSeen.length).toBeGreaterThan(0);
    const sent = JSON.stringify(cloudSeen);
    expect(sent).not.toMatch(/Zebra|Orlando|Lisbon|Rileyquist|Samtheyoung|7391/);
    await put('/copilot/settings', { cloudShare: false, chiefOfStaff: false }).expect(200);
    await prisma.aiSettings.update({ where: { userId }, data: { preferredModelId: null } });
  });

  it('can be finished, removed, is capped, and is part of the member export', async () => {
    await patch(`/chief/life-events/${id}`, { status: 'DONE' }).expect(200);
    expect((await get('/chief/life-events').expect(200)).body.map((x: any) => x.id)).not.toContain(id);
    expect((await get('/chief/life-events?all=true').expect(200)).body.map((x: any) => x.id)).toContain(id);
    const exp = JSON.parse((await get('/me/data-export').expect(200)).text);
    expect(JSON.stringify(exp.models.LifeEvent)).toContain(TITLE);
    await del(`/chief/life-events/${id}`).expect(204);
    await del(`/chief/life-events/${id}`).expect(404);
    const t = (await register(app)).token;
    for (let i = 0; i < 40; i++) await post('/chief/life-events', { kind: 'OTHER', title: 'Event number ' + i }, t).expect(201);
    await post('/chief/life-events', { kind: 'OTHER', title: 'One too many' }, t).expect(400);
  });
});

describe('TC-GOV: application governance', () => {
  it('shows each member’s 5/24, the best next card and who should apply, as suggestions', async () => {
    const g = (await get('/chief/governance').expect(200)).body;
    expect(g.version).toBe('cos-governance/1');
    expect(g.members.length).toBeGreaterThanOrEqual(2);
    for (const m of g.members) {
      expect(m.label).toMatch(/^\d+\/24$/);
      expect(['OPEN', 'ONE_LEFT', 'AT_LIMIT']).toContain(m.state);
    }
    expect(g.headline.length).toBeGreaterThan(5);
    for (const a of g.advice) {
      expect(['WAIT', 'APPLY', 'MOVE', 'BUSINESS', 'BONUS', 'LAST_SLOT']).toContain(a.kind);
      expect(a.detail).not.toMatch(/automatically/i);
    }
    const apply = g.advice.find((a: any) => a.kind === 'APPLY');
    if (apply) expect(apply.detail).toMatch(/yours to decide/);
    expect(JSON.stringify((await get('/chief/governance', other).expect(200)).body)).not.toMatch(/Rileyquist/);
    await api(app).get(V + '/chief/governance').expect(401);
  });
});

describe('TC-ROAD: roadmaps', () => {
  it('lays the next 90 days out in three phases and the year in four, with dated events and focus areas', async () => {
    const r = (await get('/chief/roadmap?days=90').expect(200)).body;
    expect(r).toMatchObject({ version: 'cos-roadmap/1', span: 90 });
    expect(r.phases.map((p: any) => p.label)).toEqual(['Next 30 days', 'Days 31–60', 'Days 61–90']);
    expect(r.phases[0].events.some((e: any) => /Hilton/.test(e.title))).toBe(true);
    expect(r.eventCount).toBeGreaterThan(0);
    expect(r.focus.length).toBeLessThanOrEqual(3);
    for (const f of r.focus) expect(f.advice.length).toBeGreaterThan(5);
    const dates = r.phases.flatMap((p: any) => p.events.map((e: any) => e.date));
    expect([...dates].sort()).toEqual(dates);
    const y = (await get('/chief/roadmap?days=365').expect(200)).body;
    expect(y.span).toBe(365);
    expect(y.phases.map((p: any) => p.label)).toEqual(['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']);
    expect(y.eventCount).toBeGreaterThanOrEqual(r.eventCount);
    expect((await get('/chief/roadmap?days=bogus').expect(200)).body.span).toBe(90);
  });

  it('includes life events, and is private', async () => {
    const e = (await post('/chief/life-events', { kind: 'MISSION_TRIP', title: 'Honduras mission', destination: 'Honduras', startsOn: iso(60), endsOn: iso(67) }).expect(201)).body;
    const r = (await get('/chief/roadmap?days=90').expect(200)).body;
    expect(r.phases.flatMap((p: any) => p.events).some((x: any) => x.area === 'LIFE' && /Honduras mission starts/.test(x.title))).toBe(true);
    const o = (await get('/chief/roadmap?days=90', other).expect(200)).body;
    expect(JSON.stringify(o)).not.toMatch(/Hilton|Honduras/);
    await del(`/chief/life-events/${e.id}`).expect(204);
    await api(app).get(V + '/chief/roadmap').expect(401);
  });

  it('answers strategic questions asked in plain language, and leaves ordinary questions alone', async () => {
    const q90 = (await post('/copilot/ask', { q: 'What should I do over the next 90 days?' }).expect(201)).body;
    expect(q90.plan.kind).toBe('ROADMAP');
    expect(q90.plan.roadmap.span).toBe(90);
    expect(q90.plan.items.length).toBeLessThanOrEqual(3);
    expect(q90.plan.headline).toBe('Your next 90 days');
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: q90.runId } });
    expect(run).toMatchObject({ workflow: 'copilot-roadmap', userId });
    const year = (await post('/copilot/ask', { q: 'What should I focus on this year?' }).expect(201)).body;
    expect(year.plan.roadmap.span).toBe(365);
    expect((await post('/copilot/ask', { q: 'How do I maximize value from my cards?' }).expect(201)).body.plan.kind).toBe('ROADMAP');
    expect((await post('/copilot/ask', { q: 'What card should I use this year at Costco for $1,500?' }).expect(201)).body.plan.kind).toBe('ANSWER');
    expect((await post('/copilot/ask', { q: 'What should I do today?' }).expect(201)).body.plan.kind).toBe('AGENDA');
    await post('/copilot/ask', { q: 'What should I do over the next 90 days?' }, other).expect(201);
  });
});

describe('TC-HOUSE: the household chief', () => {
  it('gives each member their own actions, keeps the rest for the household, and shows the best card per category', async () => {
    const h = (await get('/chief/household').expect(200)).body;
    expect(h.version).toBe('cos-household/1');
    expect(h.members.map((m: any) => m.member)).toEqual(expect.arrayContaining(['Rileyquist', 'Samtheyoung']));
    expect(h.members.find((m: any) => m.member === 'Samtheyoung').relationship).toBe('CHILD');
    const own = h.members.flatMap((m: any) => m.actions.map((a: any) => a.id));
    const shared = h.shared.map((a: any) => a.id);
    expect(own.filter((id: string) => shared.includes(id))).toEqual([]);
    expect(Array.isArray(h.authorizedUsers)).toBe(true);
    expect(Array.isArray(h.bestCardByCategory)).toBe(true);
    for (const c of h.bestCardByCategory) expect(c.text).toMatch(/earns [\d.]+¢ per dollar/);
    expect(h.headline).toMatch(/of \d+ members? (has|have) something to do/);
    expect((await get('/chief/household', other).expect(200)).body.members.map((m: any) => m.member)).not.toContain('Rileyquist');
    await api(app).get(V + '/chief/household').expect(401);
  });
});

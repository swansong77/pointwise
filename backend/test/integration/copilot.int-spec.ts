import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register } from './helpers';
import { ToolRegistry } from '../../src/ai/tools';
import { defaultProviderFactory } from '../../src/ai/providers';
import { ModelRouter } from '../../src/ai/router';
import { ChatRequest, ChatResponse } from '../../src/ai/types';
import { CopilotService } from '../../src/copilot/copilot.service';

/**
 * AI Mode (Copilot): the plan is built by the engines; a model may only reword a redacted, pseudonymized view, and only with the
 * member's separate consent and an allowed provider. All data is synthetic.
 */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let email: string;
let userName: string;
let cloudName: string;
let cloudProviderId: string;
let cloudModelId: string;
const DAY = 86_400_000;
const us = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const get = (path: string, t = token) => api(app).get(V + path).set(bearer(t));
const post = (path: string, body: object, t = token) => api(app).post(V + path).set(bearer(t)).send(body);
const put = (path: string, body: object, t = token) => api(app).put(V + path).set(bearer(t)).send(body);

/** the requests a fake cloud provider received, and what it should answer */
let cloudSeen: ChatRequest[] = [];
let allSeen: Array<{ provider: string; req: ChatRequest }> = [];
let cloudReply: (view: any) => string = () => '';
const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  token = a.token;
  email = a.email;
  other = (await register(app)).token;
  const u = await prisma.user.findFirstOrThrow({ where: { email } });
  userId = u.id;
  userName = u.name ?? '';
  await post('/subscription/checkout', { interval: 'month' }).expect(201);
  await post('/household/members', { nickname: 'Rileyquist', relationship: 'SPOUSE' }).expect(201);
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  const w = (await post('/wallet/cards', { cardId: gold.id, lastFour: '7391' }).expect(201)).body.id;
  await post('/offers/intel/import', { walletCardId: w, text: 'Hilton: Spend $500, get $100 back, expires ' + us(3) }).expect(201);
  const primary = await prisma.profile.findFirstOrThrow({ where: { userId, isPrimary: true } });
  await prisma.loyaltyCertificate.create({ data: { userId, profileId: primary.id, category: 'FREE_NIGHT', name: 'Hyatt free night', expiresAt: new Date(Date.now() + 20 * DAY), potentialValueCents: 25_000, eligible: ['Hyatt'] } });

  process.env.TEST_COPILOT_KEY = 'sk-test-not-real';
  cloudName = 'Test Cloud ' + Math.random().toString(36).slice(2, 8);
  const provider = await prisma.aiProvider.create({ data: { name: cloudName, kind: 'ANTHROPIC', status: 'ACTIVE', apiKeyEnv: 'TEST_COPILOT_KEY' } });
  cloudProviderId = provider.id;
  cloudModelId = (await prisma.aiModel.create({ data: { providerId: provider.id, modelId: 'fake-1', displayName: 'Fake Cloud ' + cloudName, status: 'ACTIVE', capabilities: [] } })).id;

  const router = app.get(ModelRouter);
  router.factory = (p) => {
    if (p.id === cloudProviderId) {
      return {
        kind: p.kind,
        chat: async (req: ChatRequest): Promise<ChatResponse> => {
          const copy = JSON.parse(JSON.stringify(req)) as ChatRequest;
          cloudSeen.push(copy);
          allSeen.push({ provider: cloudName, req: copy });
          const m = copy.messages[0] as { text: string };
          return { text: cloudReply(JSON.parse(m.text)), toolCalls: [], stopReason: 'end', usage };
        },
      };
    }
    const inner = defaultProviderFactory(p);
    return { kind: inner.kind, chat: (req: ChatRequest) => (allSeen.push({ provider: p.kind, req: JSON.parse(JSON.stringify(req)) }), inner.chat(req)) };
  };
  await prisma.aiSettings.upsert({ where: { userId }, update: { preferredModelId: cloudModelId }, create: { userId, preferredModelId: cloudModelId } });
});
afterAll(async () => {
  await prisma.aiModel.deleteMany({ where: { id: cloudModelId } });
  await prisma.aiProvider.deleteMany({ where: { name: cloudName } });
  await app.close();
  await prisma.$disconnect();
});
beforeEach(() => {
  cloudSeen = [];
  allSeen = [];
  cloudReply = (v) => `You have ${v.items.length} things to look at. Start with item 1.`;
});

describe('TC-COPILOT: settings', () => {
  it('cloud sharing is off by default, and other settings validate', async () => {
    const s = (await get('/copilot/settings').expect(200)).body;
    expect(s).toMatchObject({ aiModeEnabled: false, mode: 'QUICK', responseStyle: 'BALANCED', cloudShare: { consented: false, providers: [] } });
    expect(s.modes.map((m: any) => m.key)).toEqual(['QUICK', 'PLANNING', 'RESEARCH', 'TRAVEL', 'CARD_STRATEGY', 'AUDIT']);
    expect(s.providers.find((p: any) => p.name === cloudName)).toMatchObject({ local: false, enabled: true });
    await put('/copilot/settings', { mode: 'NOPE' }).expect(400);
    await put('/copilot/settings', { temperature: 2 }).expect(400);
    await put('/copilot/settings', { responseStyle: 'LOUD' }).expect(400);
    await put('/copilot/settings', { reasoningDepth: 'EXTREME' }).expect(400);
    await put('/copilot/settings', { cloudProviders: ['No Such Provider'] }).expect(400);
    const ok = (await put('/copilot/settings', { aiModeEnabled: true, mode: 'PLANNING', temperature: 0.3, reasoningDepth: 'HIGH', responseStyle: 'DETAILED' }).expect(200)).body;
    expect(ok).toMatchObject({ aiModeEnabled: true, mode: 'PLANNING', temperature: 0.3, reasoningDepth: 'HIGH', responseStyle: 'DETAILED' });
    await put('/copilot/settings', { aiModeEnabled: false, mode: 'QUICK', temperature: null, reasoningDepth: null, responseStyle: 'BALANCED' }).expect(200);
    expect((await get('/copilot/settings', other).expect(200)).body.aiModeEnabled).toBe(false);
    await api(app).get(V + '/copilot/settings').expect(401);
  });
});

describe('TC-COPILOT: the plan', () => {
  it('"What should I do today?" returns an explainable, prioritized plan from the household’s own data', async () => {
    const r = (await post('/copilot/ask', { q: 'What should I do this month?', mode: 'PLANNING' }).expect(201)).body;
    expect(r.plan.kind).toBe('AGENDA');
    expect(r.plan.items.length).toBeGreaterThan(0);
    const hilton = r.plan.items.find((i: any) => /Hilton/.test(i.title));
    expect(hilton).toBeTruthy();
    expect(hilton).toMatchObject({ lens: 'OFFER', horizon: 'WEEK' });
    for (const i of r.plan.items) {
      expect(i.reason).toBeTruthy();
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.confidence).toBeGreaterThan(0);
      expect(i.factors.length).toBeGreaterThan(0);
    }
    expect(r.plan.items.filter((i: any) => /Hyatt free night/.test(i.title))).toHaveLength(1); // listed once, by the loyalty specialist
    expect(r.plan.lenses.map((l: any) => l.label)).toEqual(expect.arrayContaining(['Merchant Offers', 'Loyalty', 'Benefits']));
    // the run is audited
    const run = await prisma.agentRun.findUniqueOrThrow({ where: { id: r.runId }, include: { steps: true } });
    expect(run).toMatchObject({ workflow: 'copilot', status: 'COMPLETED', userId });
    expect(run.steps.length).toBeGreaterThanOrEqual(8);
    expect(JSON.stringify(run.result)).toContain('confidence');
  });

  it('a specific question is answered by the search engines in the same explainable shape, with follow-ups', async () => {
    const first = (await post('/copilot/ask', { q: 'What card should I use at Costco for $1,500?' }).expect(201)).body;
    expect(first.plan.kind).toBe('ANSWER');
    expect(first.plan.summary).toMatch(/Best:/);
    expect(first.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.narration).toBeNull();
    const second = (await post('/copilot/ask', { q: 'It will cost $2,000', sessionId: first.sessionId }).expect(201)).body;
    expect(second.plan.summary).toMatch(/2000|2,000/);
  });

  it('is private to the caller', async () => {
    const r = (await post('/copilot/ask', { q: 'What should I do today?' }, other).expect(201)).body;
    expect(JSON.stringify(r)).not.toMatch(/Hilton|Hyatt free night/);
    await post('/copilot/ask', { q: '' }).expect(400);
    await api(app).post(V + '/copilot/ask').send({ q: 'hi' }).expect(401);
  });
});

describe('TC-COPILOT: what a model may see (ADR-004a)', () => {
  const settle = async (body: object) => put('/copilot/settings', body).expect(200);
  const agenda = async () => (await post('/copilot/ask', { q: 'What should I do this month?', mode: 'RESEARCH' }).expect(201)).body;

  it('consent off: the cloud provider receives nothing, and the plan still arrives', async () => {
    await settle({ cloudShare: false, cloudProviders: [cloudName] });
    const r = await agenda();
    expect(cloudSeen).toHaveLength(0);
    expect(r.plan.items.length).toBeGreaterThan(0);
  });

  it('consent on but the provider not allowed: still nothing', async () => {
    await settle({ cloudShare: true, cloudProviders: [] });
    await agenda();
    expect(cloudSeen).toHaveLength(0);
  });

  it('consent on and the provider allowed: one request, redacted and pseudonymized; the member can see exactly what was sent', async () => {
    await settle({ cloudShare: true, cloudProviders: [cloudName], temperature: 0.4, responseStyle: 'CONCISE' });
    const r = await agenda();
    expect(cloudSeen).toHaveLength(1);
    const req = cloudSeen[0];
    const sent = JSON.stringify(req);
    for (const secret of ['Rileyquist', email, email.split('@')[0], '7391', 'Contoso Gold (', 'Hilton: Spend', '@']) expect(sent).not.toContain(secret);
    if (userName) expect(sent).not.toContain(userName);
    expect(sent).toMatch(/Member [A-Z]/);
    expect(sent).toContain('about $');
    expect(req.tools).toEqual([]); // a model never calls tools
    expect(req.temperature).toBe(0.4);
    expect(req.system).toMatch(/three short sentences/);
    expect(r.narration).toMatchObject({ provider: cloudName, local: false });
    expect(r.narration.text).toMatch(/Start with item 1/);

    const log = (await get('/copilot/disclosures').expect(200)).body;
    const row = log.find((d: any) => d.id === r.narration.disclosureId);
    expect(row).toMatchObject({ provider: cloudName, local: false, purpose: 'narration', runId: r.runId });
    expect(row.payload).toEqual({ promptVersion: row.payload.promptVersion, system: req.system, view: JSON.parse((req.messages[0] as any).text) });
    // another member sees only their own (local sends are logged too), never this one
    const theirs = (await get('/copilot/disclosures', other).expect(200)).body;
    expect(theirs.map((d: any) => d.id)).not.toContain(r.narration.disclosureId);
    expect(theirs.every((d: any) => d.userId !== userId && d.provider !== cloudName)).toBe(true);
  });

  it('member labels in the model’s text are turned back into real names for the reader', async () => {
    await settle({ cloudShare: true, cloudProviders: [cloudName] });
    cloudReply = (v) => `${v.members[0].label} should start with item 1.`;
    const r = await agenda();
    expect(r.narration.text).not.toMatch(/Member [A-Z]/);
    expect(r.narration.text).toMatch(/^[A-Za-z0-9 ]+ should start with item 1\.$/);
  });

  it('a model that invents a figure is not used', async () => {
    await settle({ cloudShare: true, cloudProviders: [cloudName] });
    cloudReply = () => 'You could save $999999 today.';
    const r = await agenda();
    expect(r.narration).toBeNull();
    expect(r.narrationSkipped).toMatch(/figures that are not in your plan/);
    expect(cloudSeen).toHaveLength(1); // it was sent, and that is logged
    expect((await get('/copilot/disclosures').expect(200)).body.length).toBeGreaterThan(0);
  });

  it('a provider that fails falls back to the built-in wording', async () => {
    await settle({ cloudShare: true, cloudProviders: [cloudName] });
    cloudReply = () => {
      throw new Error('boom');
    };
    const r = await agenda();
    expect(r.narration).toBeNull();
    expect(r.narrationSkipped).toMatch(/could not be reached/);
    expect(r.plan.items.length).toBeGreaterThan(0);
  });

  it('specific questions are answered by the engines only; nothing about them goes to a cloud model', async () => {
    await settle({ cloudShare: true, cloudProviders: [cloudName] });
    await post('/copilot/ask', { q: 'How many points do I have?' }).expect(201);
    expect(cloudSeen).toHaveLength(0);
  });

  it('turning consent off stops sharing at once', async () => {
    await settle({ cloudShare: true, cloudProviders: [cloudName] });
    await settle({ cloudShare: false });
    await agenda();
    expect(cloudSeen).toHaveLength(0);
  });

  it('what was sent can be cleared, and nothing is kept past 90 days', async () => {
    const svc = app.get(CopilotService);
    await prisma.aiDisclosure.create({ data: { userId, provider: 'Old', model: 'old', purpose: 'narration', payload: {}, createdAt: new Date(Date.now() - 100 * DAY) } });
    expect(await svc.purgeDisclosures(new Date())).toBeGreaterThanOrEqual(1);
    expect(await prisma.aiDisclosure.count({ where: { userId, provider: 'Old' } })).toBe(0);
    const removed = (await api(app).delete(V + '/copilot/disclosures').set(bearer(token)).expect(200)).body.removed;
    expect(removed).toBeGreaterThan(0);
    expect((await get('/copilot/disclosures').expect(200)).body).toEqual([]);
  });

  it('is part of the member export, but the cloud-sharing consent is not carried over', async () => {
    await settle({ cloudShare: true, cloudProviders: [cloudName] });
    await agenda();
    const exp = JSON.parse((await get('/me/data-export').expect(200)).text);
    expect(Object.keys(exp.models)).toContain('AiDisclosure');
    expect(JSON.stringify(exp.models.AiSettings)).not.toContain('cloudShareConsentAt');
  });
});

describe('TC-COPILOT: safety', () => {
  it('no tool can apply, transfer, book, cancel or change an account; the only write needs confirmation', () => {
    const tools = app.get(ToolRegistry);
    const writes = tools.names().map((n) => tools.get(n)!).filter((t) => !t.readOnly);
    expect(writes.map((t) => t.name)).toEqual(['log_benefit_usage']);
    expect(writes.every((t) => t.requiresConfirmation)).toBe(true);
    expect(tools.names().filter((n) => /^(apply|book|cancel|close|delete|execute|submit)/.test(n))).toEqual([]);
  });

  it('actions in a plan are only reminders; nothing runs until the person chooses it', async () => {
    const r = (await post('/copilot/ask', { q: 'What should I do this month?', mode: 'RESEARCH' }).expect(201)).body;
    const calls = r.plan.items.flatMap((i: any) => i.calls);
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) expect(c).toMatchObject({ kind: 'REMINDER', path: '/reminders', method: 'POST' });
    expect(await prisma.reminder.count({ where: { userId } })).toBe(0);
  });
});

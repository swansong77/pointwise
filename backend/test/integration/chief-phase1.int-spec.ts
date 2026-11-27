import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register } from './helpers';
import { defaultProviderFactory } from '../../src/ai/providers';
import { ModelRouter } from '../../src/ai/router';
import { ChatRequest, ChatResponse } from '../../src/ai/types';
import { BriefingService } from '../../src/copilot/briefing.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { MailService } from '../../src/jobs/mail.service';
import { NotificationsService } from '../../src/notifications/notifications.service';

/** Chief of Staff, phase 1: scoring, the Action Center, the executive briefing, value recovery, Quiet Mode and critical alerts (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let otherId: string;
let cloudName: string;
let cloudProviderId: string;
let cloudModelId: string;
let cloudSeen: ChatRequest[] = [];
const DAY = 86_400_000;
const NAME = 'Hyunjoo';
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
  await post('/offers/intel/import', { walletCardId: w, text: 'Hilton: Spend $500, get $100 back, expires ' + us(1) }, t).expect(201);
  const primary = await prisma.profile.findFirstOrThrow({ where: { userId: id, isPrimary: true } });
  await prisma.loyaltyCertificate.create({ data: { userId: id, profileId: primary.id, category: 'FREE_NIGHT', name: 'Hyatt free night', expiresAt: new Date(Date.now() + 5 * DAY), potentialValueCents: 25_000, eligible: ['Hyatt'] } });
}

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  const b = await register(app);
  token = a.token;
  other = b.token;
  userId = a.userId;
  otherId = b.userId;
  await prisma.user.update({ where: { id: userId }, data: { name: NAME + ' Parkson' } });
  await household(token, userId);

  process.env.TEST_COPILOT_KEY = 'sk-test-not-real';
  cloudName = 'Test Cloud ' + Math.random().toString(36).slice(2, 8);
  const provider = await prisma.aiProvider.create({ data: { name: cloudName, kind: 'ANTHROPIC', status: 'ACTIVE', apiKeyEnv: 'TEST_COPILOT_KEY' } });
  cloudProviderId = provider.id;
  cloudModelId = (await prisma.aiModel.create({ data: { providerId: provider.id, modelId: 'fake-4', displayName: 'Fake Cloud ' + cloudName, status: 'ACTIVE', capabilities: [] } })).id;
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

describe('TC-COS: overview and Action Center', () => {
  it('ranks everything, explains each item, and keeps the top ten', async () => {
    const o = (await get('/chief/overview').expect(200)).body;
    expect(o.greeting).toBe(`Good morning ${NAME}.`);
    expect(o.top.length).toBeGreaterThan(0);
    expect(o.top.length).toBeLessThanOrEqual(10);
    const scores = o.top.map((i: any) => i.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    const hilton = o.top.find((i: any) => /Hilton/.test(i.title));
    expect(hilton).toBeTruthy();
    expect(hilton).toMatchObject({ band: expect.stringMatching(/CRITICAL|HIGH/), timeMinutes: expect.any(Number), center: expect.stringMatching(/TODAY|WEEK/) });
    for (const i of o.top) {
      expect(i.score).toBeGreaterThanOrEqual(0);
      expect(i.score).toBeLessThanOrEqual(100);
      expect(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']).toContain(i.band);
      expect(['LOW', 'MEDIUM', 'HIGH']).toContain(i.risk.level);
      expect(i.reason).toBeTruthy();
      expect(i.sources.length).toBeGreaterThan(0);
      expect(i.agents.map((a: any) => a.key)).toContain('chief-of-staff');
      expect(i.confidence).toBeGreaterThan(0);
      expect(i.impact).toHaveProperty('atRiskCents');
    }
    expect(o.summary).toMatchObject({ certificatesExpiring: 1 });
    expect(o.summary.valueAtRiskCents).toBeGreaterThan(0);
    expect(o.center.map((c: any) => c.key)).toEqual(['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'ANNUAL']);
    expect(o.recovery.version).toBe('cos-recovery/1');
  });

  it('arranges the same items by when they matter', async () => {
    const c = (await get('/chief/actions').expect(200)).body;
    expect(c.map((h: any) => h.key)).toEqual(['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'ANNUAL']);
    const all = c.flatMap((h: any) => h.items);
    for (const h of c) for (const i of h.items) expect(i.center).toBe(h.key);
    expect(new Set(all.map((i: any) => i.id)).size).toBe(all.length);
    expect(c.find((h: any) => h.key === 'WEEK').items.some((i: any) => /Hyatt free night/.test(i.title))).toBe(true);
    expect(c.every((h: any) => h.count === h.items.length)).toBe(true);
  });

  it('shows what has been lost and what can still be saved', async () => {
    await prisma.offerSnapshotItem.deleteMany({ where: { userId } });
    const acct = await prisma.offerAccount.findFirst({ where: { userId } });
    if (acct) await prisma.offerSnapshotItem.create({ data: { userId, accountId: acct.id, cardKey: 'k', externalId: 'x1', merchantText: 'Marriott', title: 'Marriott $80', valueCents: 8000, endsAt: new Date(Date.now() - 3 * DAY), status: 'EXPIRED', decision: 'RECOMMENDED', contentHash: 'h' } });
    const r = (await get('/chief/recovery').expect(200)).body;
    expect(r.atRiskCents).toBeGreaterThan(0);
    expect(r.recoverable.length).toBeGreaterThan(0);
    expect(r.recoverable[0]).toMatchObject({ band: expect.any(String), href: expect.any(String) });
    expect(r.headline).toMatch(/can still be saved|No value/);
  });

  it('is private and needs a login', async () => {
    const o = (await get('/chief/overview', other).expect(200)).body;
    expect(JSON.stringify(o)).not.toMatch(/Hilton|Hyatt free night/);
    expect(o.greeting).toBe('Good morning Test.');
    await api(app).get(V + '/chief/overview').expect(401);
    await api(app).get(V + '/chief/actions').expect(401);
  });

  it('reads only: it changes no data and offers no automatic action', async () => {
    const before = await prisma.walletCard.count({ where: { wallet: { userId } } });
    const o = (await get('/chief/overview').expect(200)).body;
    for (const i of o.top) for (const c of i.calls) expect(c.kind).toBe('REMINDER');
    expect(await prisma.walletCard.count({ where: { wallet: { userId } } })).toBe(before);
    expect(JSON.stringify(o)).not.toMatch(/automatically (apply|cancel|transfer|book)/i);
  });
});

describe('TC-COS: the executive daily briefing', () => {
  it('is off until the member turns Chief of Staff on, then greets by name and leads with the numbers', async () => {
    await put('/copilot/settings', { aiModeEnabled: true }).expect(200);
    expect((await get('/copilot/settings').expect(200)).body.chief).toEqual({ enabled: false, quietMode: false });
    const plain = (await post('/copilot/briefings/daily?fresh=true', {}).expect(201)).body.briefing.content;
    expect(plain.greeting).toBeUndefined();

    expect((await put('/copilot/settings', { chiefOfStaff: true }).expect(200)).body.chief.enabled).toBe(true);
    const b = (await post('/copilot/briefings/daily?fresh=true', {}).expect(201)).body.briefing.content;
    expect(b.greeting).toBe(`Good morning ${NAME}.`);
    expect(b.headline).toMatch(new RegExp(`^Good morning ${NAME}\\. (You have \\d+ high-priority actions?\\.|Nothing urgent today\\.)$`));
    expect(b.summary).toMatch(/Potential value at risk: \$[\d,]+ · Points at risk: [\d,]+ · Certificates expiring: 1 · New high-value offers: \d+/);
    const actions = b.sections.find((s: any) => s.key === 'actions').lines;
    expect(actions[0].text).toMatch(/^1\. /);
    expect(actions[0].detail).toMatch(/Time ~\d+ min · Risk \w+ · Priority \w+ \(\d+\)/);
    expect(b.sections.map((s: any) => s.key)).toEqual(['actions', 'recovery']);
    const live = (await get('/chief/briefing').expect(200)).body;
    expect(live.greeting).toBe(`Good morning ${NAME}.`);
  });

  it('a cloud model sees only the redacted view: no name, no card digits, rounded amounts', async () => {
    await put('/copilot/settings', { cloudShare: true, cloudProviders: [cloudName] }).expect(200);
    await prisma.aiSettings.update({ where: { userId }, data: { preferredModelId: cloudModelId } });
    const r = (await post('/copilot/briefings/daily?fresh=true', {}).expect(201)).body.briefing;
    expect(cloudSeen.length).toBeGreaterThan(0);
    const sent = JSON.stringify(cloudSeen[cloudSeen.length - 1]);
    expect(sent).not.toMatch(new RegExp(`${NAME}|Parkson|Good morning|Rileyquist|7391|@`));
    expect(sent).toMatch(/about \$/);
    expect(r.narration).toMatchObject({ provider: cloudName });
    await put('/copilot/settings', { cloudShare: false }).expect(200);
    await prisma.aiSettings.update({ where: { userId }, data: { preferredModelId: null } });
  });
});

describe('TC-COS: critical alerts', () => {
  it('announce each new Critical item once, never more than three, and only with Chief of Staff on', async () => {
    const svc = app.get(BriefingService);
    await prisma.notification.deleteMany({ where: { userId, type: 'COPILOT' } });
    await put('/copilot/settings', { chiefOfStaff: false }).expect(200);
    await svc.runAlerts(new Date());
    expect((await prisma.notification.findMany({ where: { userId, type: 'COPILOT' } })).filter((n) => n.title.startsWith('Critical:'))).toHaveLength(0);

    await put('/copilot/settings', { chiefOfStaff: true }).expect(200);
    await svc.runAlerts(new Date());
    const first = (await prisma.notification.findMany({ where: { userId, type: 'COPILOT' } })).filter((n) => n.title.startsWith('Critical:'));
    expect(first.length).toBeGreaterThan(0);
    expect(first.length).toBeLessThanOrEqual(3);
    expect(first[0].body).toMatch(/Time ~\d+ min/);
    expect(first[0].dedupeKey).toMatch(/^cos:crit:/);
    await svc.runAlerts(new Date());
    expect((await prisma.notification.findMany({ where: { userId, type: 'COPILOT' } })).filter((n) => n.title.startsWith('Critical:'))).toHaveLength(first.length);
    expect(await prisma.notification.count({ where: { userId: otherId, type: 'COPILOT' } })).toBe(0);
  });
});

describe('TC-QUIET: Quiet Mode holds what the briefing carries', () => {
  const svc = () => app.get(NotificationsService);

  it('is off by default: every notification arrives as before', async () => {
    const t = (await register(app)).token;
    const id = (await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).id;
    await svc().notify(id, 'OFFER_ALERT', 'An offer', 'body');
    const n = await prisma.notification.findFirstOrThrow({ where: { userId: id } });
    expect(n.deferredAt).toBeNull();
    expect((await get('/notifications/unread-count', t).expect(200)).body.count).toBe(1);
    expect((await get('/copilot/settings', t).expect(200)).body.chief.quietMode).toBe(false);
  });

  it('holds normal notifications and lets critical ones through', async () => {
    const u = await register(app);
    expect((await put('/notifications/preferences', { quietMode: true }, u.token).expect(200)).body.quietMode).toBe(true);
    for (const [type, title] of [['OFFER_ALERT', 'a'], ['OFFER_EXPIRING', 'b'], ['TRANSFER_BONUS', 'c'], ['LOYALTY_STALE', 'd']] as const) await svc().notify(u.userId, type, title, 'x');
    for (const [type, title] of [['BENEFIT_EXPIRING', 'e'], ['CARD_RENEWAL', 'f'], ['REMINDER', 'g'], ['COPILOT', 'h'], ['OFFER_SYNC_FAILED', 'i']] as const) await svc().notify(u.userId, type, title, 'x');
    const rows = await prisma.notification.findMany({ where: { userId: u.userId } });
    expect(rows.filter((r) => r.deferredAt).map((r) => r.title).sort()).toEqual(['a', 'b', 'c', 'd']);
    expect(rows.filter((r) => !r.deferredAt).map((r) => r.title).sort()).toEqual(['e', 'f', 'g', 'h', 'i']);
    expect((await get('/notifications/unread-count', u.token).expect(200)).body.count).toBe(5);
    expect((await get('/notifications', u.token).expect(200)).body.map((n: any) => n.title).sort()).toEqual(['e', 'f', 'g', 'h', 'i']);
    expect((await get('/notifications?includeDeferred=true', u.token).expect(200)).body).toHaveLength(9);
    // a repeated key stays one row and stays held
    await svc().notify(u.userId, 'OFFER_ALERT', 'a', 'again', undefined, 'k1');
    await svc().notify(u.userId, 'OFFER_ALERT', 'a', 'again', undefined, 'k1');
    expect(await prisma.notification.count({ where: { userId: u.userId, dedupeKey: 'k1' } })).toBe(1);
    // turning it off sends later ones as usual; earlier held ones stay held
    await put('/notifications/preferences', { quietMode: false }, u.token).expect(200);
    await svc().notify(u.userId, 'OFFER_ALERT', 'later', 'x');
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: u.userId, title: 'later' } })).deferredAt).toBeNull();
  });

  it('held notifications are not e-mailed, and the briefing reports them', async () => {
    const u = await register(app);
    await put('/notifications/preferences', { quietMode: true, emailDigest: true }, u.token).expect(200);
    await svc().notify(u.userId, 'OFFER_ALERT', 'held one', 'x');
    await svc().notify(u.userId, 'TRANSFER_BONUS', 'held two', 'x');
    await svc().notify(u.userId, 'BENEFIT_EXPIRING', 'critical one', 'x');
    const mail = app.get(MailService);
    const sent: string[] = [];
    const spy = jest.spyOn(mail, 'send').mockImplementation(async (to: string, _s: string, body: string) => (sent.push(body), true));
    await app.get(JobsService).run('email-digest');
    spy.mockRestore();
    const mine = sent.filter((b) => b.includes('critical one'));
    expect(mine).toHaveLength(1);
    expect(mine[0]).not.toMatch(/held one|held two/);
    const held = await svc().held(u.userId, new Date(Date.now() - DAY));
    expect(held.total).toBe(2);
    expect(held.byType.map((t) => t.type).sort()).toEqual(['OFFER_ALERT', 'TRANSFER_BONUS']);
    await prisma.aiSettings.upsert({ where: { userId: u.userId }, update: { aiModeEnabled: true, chiefOfStaff: true }, create: { userId: u.userId, aiModeEnabled: true, chiefOfStaff: true } });
    const brief = (await post('/copilot/briefings/daily?fresh=true', {}, u.token).expect(201)).body.briefing.content;
    const heldLine = brief.sections.find((s: any) => s.key === 'held').lines[0];
    expect(heldLine.text).toBe('2 updates held for this briefing');
    expect(heldLine.detail).toMatch(/offer alerts/);
  });

  it('each member’s setting is their own', async () => {
    const o = (await get('/notifications/preferences', other).expect(200)).body;
    expect(o.quietMode).toBe(false);
  });
});

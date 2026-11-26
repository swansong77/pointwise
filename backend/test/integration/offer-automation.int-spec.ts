import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ToolRegistry } from '../../src/ai/tools';
import { CaptureService } from '../../src/capture/capture.service';
import { OfferAutomationJobs } from '../../src/offer-automation/offer-automation.jobs';
import { OfferSyncService } from '../../src/offer-automation/offer-sync.service';
import { defaultMockOffers, expireMockSessions, getMockOffers, MOCK_MFA_CODE, resetMock, setMockOffers } from '../../src/offer-automation/mock-connector';
import { api, bearer, createApp, register } from './helpers';

/**
 * Merchant offer automation against the mock issuer: accounts and the encrypted vault, sync (discover, diff, score,
 * decide), enrollment modes and rules, verification outcomes, MFA, failures, retries, household separation, the
 * extension intake, notifications and the audit trail. All data is synthetic; no real issuer is contacted.
 */
const V = '/api/v1/offer-automation';
const prisma = new PrismaClient();
let app: INestApplication;
let sync: OfferSyncService;
let jobs: OfferAutomationJobs;
let token: string;
let other: string;
let userId: string;
let issuerId: string;
let cardA: string;
let cardB: string;
let spouseId: string;
const PASSWORD = 'hunter2-not-a-real-password';

const get = (path: string, t = token) => api(app).get(`${V}${path}`).set(bearer(t));
const post = (path: string, body: object = {}, t = token) => api(app).post(`${V}${path}`).set(bearer(t)).send(body);
const put = (path: string, body: object, t = token) => api(app).put(`${V}${path}`).set(bearer(t)).send(body);
const del = (path: string, t = token) => api(app).delete(`${V}${path}`).set(bearer(t));

let n = 0;
const unique = (p: string) => `${p}${++n}${Date.now() % 100000}`;

async function makeAccount(opts: { username?: string; walletCardId?: string; profileId?: string; holder?: string; optIn?: boolean; kind?: string; issuer?: string } = {}) {
  const username = opts.username ?? unique('user');
  const kind = opts.kind ?? 'MOCK';
  const body: Record<string, unknown> = { issuerId: opts.issuer ?? issuerId, holderLabel: opts.holder ?? `Holder ${username}`, connectorKind: kind, walletCardIds: [opts.walletCardId ?? cardA], automationOptIn: opts.optIn ?? true, ackTermsRisk: opts.optIn ?? true, profileId: opts.profileId };
  if (kind === 'MOCK' || kind === 'ISSUER_LOGIN') Object.assign(body, { username, password: PASSWORD });
  const r = await post('/accounts', body);
  return { res: r, username, id: r.body.id as string };
}
const seed = (username: string, cardKey = cardA) => setMockOffers(username, defaultMockOffers(cardKey), [{ cardKey, label: 'Card', lastFour: null }]);
const syncNow = async (accountId?: string) => (await post('/sync', { accountId, wait: true }).expect(201)).body as { runs: string[]; batchId: string; skipped: Array<{ reason: string }> };
const inbox = async (tab: string, accountId?: string, t = token) => (await get(`/inbox?tab=${tab}${accountId ? `&accountId=${accountId}` : ''}`, t).expect(200)).body as Array<Record<string, any>>;
const item = (accountId: string, externalId: string) => prisma.offerSnapshotItem.findFirstOrThrow({ where: { accountId, externalId } });

beforeAll(async () => {
  app = await createApp();
  sync = app.get(OfferSyncService);
  jobs = app.get(OfferAutomationJobs);
  const a = await register(app);
  token = a.token;
  other = (await register(app)).token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  issuerId = card.issuerId;
  cardA = (await api(app).post('/api/v1/wallet/cards').set(bearer(token)).send({ cardId: card.id }).expect(201)).body.id;
  cardB = (await api(app).post('/api/v1/wallet/cards').set(bearer(token)).send({ cardId: card.id }).expect(201)).body.id;
  spouseId = (await prisma.profile.create({ data: { userId, nickname: 'Spouse', relationship: 'SPOUSE' } })).id;
  await prisma.walletCard.update({ where: { id: cardB }, data: { profileId: spouseId } });
});
beforeEach(() => resetMock());
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('accounts and the credential vault', () => {
  it('stores the login encrypted and never returns it', async () => {
    const { res, username } = await makeAccount({ holder: 'Alex Platinum' });
    expect(res.status).toBe(201);
    const text = JSON.stringify((await get('/accounts').expect(200)).body);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(username);
    expect(text).not.toMatch(/credentialEnc|sessionEnc|deviceTrustEnc/);
    expect(res.body.hasCredential).toBe(true);
    expect(res.body.credentialRef).toMatch(/•/);
    const row = await prisma.offerAccount.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.credentialEnc).toMatch(/^v1\./);
    expect(row.credentialEnc).not.toContain(PASSWORD);
    expect(row.credentialEnc).not.toContain(username);
  });

  it('refuses server-side login without the terms-risk acknowledgement', async () => {
    const r = await post('/accounts', { issuerId, holderLabel: 'No ack', connectorKind: 'MOCK', username: 'a1', password: 'b2', automationOptIn: true });
    expect(r.status).toBe(400);
    expect(r.body.message).toMatch(/terms-risk/);
    const noLogin = await post('/accounts', { issuerId, holderLabel: 'No pw', connectorKind: 'MOCK', username: 'only' });
    expect(noLogin.status).toBe(400);
  });

  it('real issuer logins stay off unless the server switch is on, and need a connector for the issuer', async () => {
    const chase = await prisma.issuer.upsert({ where: { name: 'Chase' }, update: {}, create: { name: 'Chase' } });
    const { res, id } = await makeAccount({ kind: 'ISSUER_LOGIN', issuer: chase.id, holder: 'Chase login' });
    expect(res.status).toBe(201);
    expect(res.body.canSync).toBe(false);
    expect(res.body.cannotSyncBecause).toMatch(/switched off/);
    expect(res.body.connector.unverifiedFlow).toBe(true);
    expect(res.body.connector.termsNote).toMatch(/robots, spiders, scripts/);
    const r = await post('/sync', { accountId: id, wait: true });
    expect(r.status).toBe(400);
    const none = await post('/accounts', { issuerId, holderLabel: 'x', connectorKind: 'ISSUER_LOGIN', username: 'u', password: 'p' });
    expect(none.status).toBe(400);
    expect(none.body.message).toMatch(/no connector/i);
  });

  it('replaces, disconnects and deletes; rejects other members', async () => {
    const { id, username } = await makeAccount();
    const upd = await put(`/accounts/${id}`, { holderLabel: 'Renamed', username: 'new-user', password: 'new-pass-1' }).expect(200);
    expect(upd.body.holderLabel).toBe('Renamed');
    expect(JSON.stringify(upd.body)).not.toContain('new-pass-1');
    expect((await put(`/accounts/${id}`, { username: 'half' })).status).toBe(400);
    expect((await put(`/accounts/${id}`, { holderLabel: 'x' }, other)).status).toBe(404);
    expect((await post(`/accounts/${id}/disconnect`, {}, other)).status).toBe(404);
    await post(`/accounts/${id}/disconnect`).expect(201);
    const row = await prisma.offerAccount.findUniqueOrThrow({ where: { id } });
    expect(row.credentialEnc).toBeNull();
    expect(row.automationOptIn).toBe(false);
    expect(row.syncHealth).toBe('DISABLED');
    await del(`/accounts/${id}`).expect(204);
    expect(await prisma.offerAccount.count({ where: { id } })).toBe(0);
    void username;
  });

  it('validates the time zone and a card that is not yours', async () => {
    expect((await post('/accounts', { issuerId, holderLabel: 'tz', connectorKind: 'MANUAL', timezone: 'Mars/Base' })).status).toBe(400);
    const theirCard = await prisma.walletCard.findFirstOrThrow({ where: { wallet: { userId: { not: userId } } } });
    expect((await post('/accounts', { issuerId, holderLabel: 'x', connectorKind: 'MANUAL', walletCardIds: [theirCard.id] })).status).toBe(403);
  });
});

describe('sync: discover, diff, score, decide', () => {
  it('finds offers, scores them and recommends the valuable one; idempotent on a rerun', async () => {
    const { id, username } = await makeAccount({ walletCardId: cardA });
    seed(username);
    const r = await syncNow(id);
    expect(r.runs).toHaveLength(1);
    const run = await prisma.offerSyncRun.findUniqueOrThrow({ where: { id: r.runs[0] } });
    expect(run.status).toBe('SUCCESS');
    expect([run.found, run.added]).toEqual([3, 3]);
    expect(run.finishedAt).not.toBeNull();
    const hilton = await item(id, 'hilton-250');
    expect(hilton.score).toBeGreaterThanOrEqual(60);
    expect(hilton.decision).toBe('RECOMMENDED');
    expect(hilton.walletCardId).toBe(cardA);
    const coffee = await item(id, 'coffee-2');
    expect(coffee.score).toBeLessThan(35);
    expect(coffee.decision).toBe('IGNORED');
    const again = await syncNow(id);
    const run2 = await prisma.offerSyncRun.findUniqueOrThrow({ where: { id: again.runs[0] } });
    expect([run2.added, run2.updated, run2.removed]).toEqual([0, 0, 0]);
    expect(await prisma.offerSnapshot.count({ where: { accountId: id } })).toBe(1);
    expect(await prisma.offerSnapshotItem.count({ where: { accountId: id } })).toBe(3);
    const tabs = await inbox('new', id);
    expect(tabs.map((t) => t.merchant)).toContain('Hilton');
    expect(tabs.find((t) => t.merchant === 'Hilton')!.scoreDetail.reasons.length).toBeGreaterThan(0);
    const events = await prisma.offerEvent.findMany({ where: { userId } });
    expect(events.filter((e) => e.type === 'DISCOVERED').length).toBeGreaterThanOrEqual(3);
    expect(events.some((e) => e.type === 'DECISION')).toBe(true);
  });

  it('detects new, updated, removed and expired offers between syncs', async () => {
    const { id, username } = await makeAccount();
    seed(username);
    await syncNow(id);
    const offers = getMockOffers(username);
    setMockOffers(username, [
      { ...offers[0], valueCents: 30_000 },
      { ...offers[2], endsAt: new Date(Date.now() - 86_400_000) },
      { ...offers[0], externalId: 'marriott-100', merchantText: 'Marriott', title: 'Spend $300, get $100', valueCents: 10_000 },
    ], [{ cardKey: cardA, label: 'Card', lastFour: null }]);
    // the coffee offer disappears; the DraftKings offer is now past its end date and still listed
    await syncNow(id);
    const run = await prisma.offerSyncRun.findFirstOrThrow({ where: { accountId: id }, orderBy: { createdAt: 'desc' } });
    expect(run.added).toBe(1);
    expect(run.updated).toBe(1);
    expect(run.expired).toBe(1);
    expect((await item(id, 'dk-50')).status).toBe('EXPIRED');
    expect((await item(id, 'coffee-2')).status).toBe('REMOVED');
    expect((await item(id, 'hilton-250')).valueCents).toBe(30_000);
    const types = new Set((await prisma.offerEvent.findMany({ where: { userId } })).map((e) => e.type));
    for (const t of ['DISCOVERED', 'UPDATED', 'REMOVED']) expect(types.has(t as never)).toBe(true);
    expect((await get('/history?type=REMOVED').expect(200)).body.length).toBeGreaterThan(0);
  });

  it('does not treat a collapsed inventory as mass removal', async () => {
    const { id, username } = await makeAccount();
    const many = Array.from({ length: 8 }, (_, i) => ({ ...defaultMockOffers(cardA)[0], externalId: `bulk-${i}`, merchantText: `Shop ${i}`, valueCents: 1_000 + i }));
    setMockOffers(username, many, [{ cardKey: cardA, label: 'Card', lastFour: null }]);
    await syncNow(id);
    setMockOffers(username, many.slice(0, 1), [{ cardKey: cardA, label: 'Card', lastFour: null }]);
    await syncNow(id);
    const run = await prisma.offerSyncRun.findFirstOrThrow({ where: { accountId: id }, orderBy: { createdAt: 'desc' } });
    expect(run.removed).toBe(0);
    expect(run.warnings).toBeGreaterThan(0);
    expect(await prisma.offerSnapshotItem.count({ where: { accountId: id, status: 'REMOVED' } })).toBe(0);
  });

  it('marks an enrolled offer that disappears as redeemed and one past its end as expired', async () => {
    const { id, username } = await makeAccount();
    const base = Array.from({ length: 8 }, (_, i) => ({ ...defaultMockOffers(cardA)[0], externalId: `k-${i}`, merchantText: `Shop ${i}`, valueCents: 2_000 + i, enrolled: i === 0 }));
    setMockOffers(username, base, [{ cardKey: cardA, label: 'Card', lastFour: null }]);
    await syncNow(id);
    expect((await item(id, 'k-0')).status).toBe('ENROLLED');
    expect(await prisma.userOffer.count({ where: { walletCardId: cardA, activationVerifiedBy: 'CONNECTOR' } })).toBeGreaterThan(0);
    await prisma.offerSnapshotItem.update({ where: { id: (await item(id, 'k-1')).id }, data: { endsAt: new Date(Date.now() - 86_400_000) } });
    setMockOffers(username, base.slice(2, 7), [{ cardKey: cardA, label: 'Card', lastFour: null }]);
    await syncNow(id);
    expect((await item(id, 'k-0')).status).toBe('REDEEMED');
    expect((await item(id, 'k-1')).status).toBe('EXPIRED');
    expect((await item(id, 'k-7')).status).toBe('REMOVED');
    expect((await get('/history?type=EXPIRED').expect(200)).body.length).toBeGreaterThan(0);
    expect((await inbox('redeemed', id)).map((r) => r.id)).toContain((await item(id, 'k-0')).id);
  });

  it('household sync covers every account and reports the ones it cannot sync', async () => {
    const a = await makeAccount();
    const b = await makeAccount({ walletCardId: cardB, profileId: spouseId, holder: 'Spouse login' });
    const c = await makeAccount({ kind: 'EXTENSION' });
    seed(a.username, cardA);
    seed(b.username, cardB);
    const r = await syncNow();
    expect(r.runs.length).toBeGreaterThanOrEqual(2);
    expect(r.skipped.some((s) => /extension/i.test(s.reason))).toBe(true);
    const dash = (await get(`/sync?batchId=${r.batchId}`).expect(200)).body;
    expect(dash.done).toBe(true);
    expect(dash.totals.processed).toBe(r.runs.length);
    expect(dash.totals.found).toBeGreaterThanOrEqual(6);
    void c;
  });
});

describe('household: enrollments stay on their own card', () => {
  it('the same offer on two members\' cards is two items and two enrollments', async () => {
    const a = await makeAccount({ walletCardId: cardA, holder: 'Alex' });
    const b = await makeAccount({ walletCardId: cardB, profileId: spouseId, holder: 'Sam' });
    seed(a.username, cardA);
    seed(b.username, cardB);
    await syncNow(a.id);
    await syncNow(b.id);
    const mine = await inbox('all');
    const hiltons = mine.filter((i) => i.merchant === 'Hilton' && [a.id, b.id].includes(i.accountId));
    expect(hiltons).toHaveLength(2);
    expect(hiltons.every((h) => h.sameOfferOnCards >= 2)).toBe(true);
    const onA = hiltons.find((h) => h.accountId === a.id)!;
    const r = await post('/approve', { itemIds: [onA.id] }).expect(201);
    expect(r.body[0].result).toBe('SUCCESS');
    expect((await item(b.id, 'hilton-250')).status).toBe('AVAILABLE');
    expect((await item(a.id, 'hilton-250')).status).toBe('ENROLLED');
    expect(getMockOffers(a.username).find((o) => o.externalId === 'hilton-250')!.enrolled).toBe(true);
    expect(getMockOffers(b.username).find((o) => o.externalId === 'hilton-250')!.enrolled).toBe(false);
    const uo = await prisma.userOffer.findMany({ where: { walletCardId: { in: [cardA, cardB] }, offer: { sourceRef: { contains: 'hilton-250' } } } });
    expect(uo.map((u) => u.walletCardId)).toEqual([cardA]);
    expect((await inbox('all', undefined, other)).length).toBe(0);
  });
});

describe('enrollment modes and rules', () => {
  afterEach(async () => {
    await prisma.enrollmentRule.deleteMany({ where: { userId } });
    await put('/policy', { mode: 'RECOMMEND', autoFilter: {} }).expect(200);
  });

  it('recommend only never enrolls anything', async () => {
    await put('/policy', { mode: 'RECOMMEND', autoFilter: { allOffers: true } }).expect(200);
    const { id, username } = await makeAccount();
    seed(username);
    await syncNow(id);
    expect(await prisma.offerSnapshotItem.count({ where: { accountId: id, status: 'ENROLLED' } })).toBe(0);
    expect(getMockOffers(username).some((o) => o.enrolled)).toBe(false);
  });

  it('bulk approval enrolls what the member approves and records verified attempts', async () => {
    await put('/policy', { mode: 'BULK_APPROVAL', autoFilter: {} }).expect(200);
    const { id, username } = await makeAccount();
    seed(username);
    await syncNow(id);
    const rec = await inbox('new', id);
    const r = await post('/approve', { itemIds: rec.map((x) => x.id) }).expect(201);
    expect(r.body.every((x: { result: string }) => x.result === 'SUCCESS')).toBe(true);
    const attempts = (await get('/attempts').expect(200)).body as Array<{ result: string; verifiedBy: string | null; actor: string }>;
    const ids = new Set(rec.map((x) => x.id));
    expect(attempts.filter((a: { itemId?: string; result: string; verifiedBy: string | null; actor: string }) => ids.has(a.itemId!) && a.result === 'SUCCESS' && a.verifiedBy === 'CONNECTOR' && a.actor === 'USER').length).toBe(rec.length);
    const again = await post('/approve', { itemIds: [rec[0].id] }).expect(201);
    expect(again.body[0].result).toBe('ALREADY_ADDED');
  });

  it('automatic mode enrolls travel offers only, with a filter; the rest wait', async () => {
    await put('/policy', { mode: 'AUTO', autoFilter: { categories: ['travel'] } }).expect(200);
    const { id, username } = await makeAccount();
    seed(username);
    await syncNow(id);
    const hilton = await item(id, 'hilton-250');
    expect(hilton.status).toBe('ENROLLED');
    expect(hilton.autoEnrolled).toBe(true);
    expect(hilton.decision).toBe('AUTO_ENROLLED');
    expect((await item(id, 'coffee-2')).status).toBe('AVAILABLE');
    const a = await prisma.enrollmentAttempt.findFirstOrThrow({ where: { itemId: hilton.id } });
    expect([a.result, a.actor, a.verifiedBy]).toEqual(['SUCCESS', 'SYSTEM', 'CONNECTOR']);
    expect((await inbox('auto', id)).map((i) => i.merchant)).toEqual(['Hilton']);
    expect(await prisma.notification.count({ where: { userId, type: 'OFFER_AUTO_ENROLLED' } })).toBeGreaterThan(0);
    expect(await prisma.offerEvent.count({ where: { userId, type: 'AUTO_ENROLLED' } })).toBeGreaterThan(0);
  });

  it('a never rule beats automatic enrollment and an always rule; always rules enroll only in automatic mode', async () => {
    const never = await post('/rules', { label: 'No gambling', kind: 'NEVER', matcher: 'CATEGORY', matcherValue: 'Gambling' }).expect(201);
    expect(never.body.matcherValue).toBe('gambling');
    await post('/rules', { label: 'Always coffee', kind: 'ALWAYS', matcher: 'MERCHANT', matcherValue: 'corner coffee' }).expect(201);
    await put('/policy', { mode: 'AUTO', autoFilter: { allOffers: true } }).expect(200);
    const { id, username } = await makeAccount();
    seed(username);
    await syncNow(id);
    expect((await item(id, 'dk-50')).status).toBe('AVAILABLE');
    expect((await item(id, 'dk-50')).decision).toBe('IGNORED');
    expect((await item(id, 'dk-50')).ruleId).toBe(never.body.id);
    expect((await item(id, 'coffee-2')).status).toBe('ENROLLED');
    await put('/policy', { mode: 'RECOMMEND', autoFilter: {} }).expect(200);
    const b = await makeAccount();
    seed(b.username);
    await syncNow(b.id);
    expect((await item(b.id, 'coffee-2')).status).toBe('AVAILABLE');
    expect((await item(b.id, 'coffee-2')).decision).toBe('RECOMMENDED');
  });

  it('rules are validated, audited and owner-scoped', async () => {
    expect((await post('/rules', { label: 'bad', kind: 'ALWAYS', matcher: 'MIN_VALUE', matcherValue: '$25' })).status).toBe(400);
    expect((await post('/rules', { label: 'bad', kind: 'ALWAYS', matcher: 'OFFER_TYPE', matcherValue: 'nonsense' })).status).toBe(400);
    expect((await post('/rules', { label: 'empty', kind: 'ALWAYS', matcher: 'KEYWORD', matcherValue: ' ' })).status).toBe(400);
    const r = await post('/rules', { label: 'Over $25', kind: 'ALWAYS', matcher: 'MIN_VALUE', matcherValue: '2500', priority: 5 }).expect(201);
    expect((await put(`/rules/${r.body.id}`, { label: 'Over $50', kind: 'ALWAYS', matcher: 'MIN_VALUE', matcherValue: '5000' }).expect(200)).body.matcherValue).toBe('5000');
    expect((await put(`/rules/${r.body.id}`, { label: 'x', kind: 'ALWAYS', matcher: 'KEYWORD', matcherValue: 'x' }, other)).status).toBe(404);
    expect((await get('/rules', other).expect(200)).body).toHaveLength(0);
    await del(`/rules/${r.body.id}`).expect(204);
    expect((await del(`/rules/${r.body.id}`)).status).toBe(404);
    const audits = await prisma.auditLog.findMany({ where: { actorId: userId, entity: 'EnrollmentRule' } });
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['enrollment-rule.create', 'enrollment-rule.update', 'enrollment-rule.delete']));
  });
});

describe('verification outcomes, MFA and failures', () => {
  it('reports a click that the issuer does not show as added as partial', async () => {
    const { id } = await makeAccount({ username: 'partial' });
    seed('partial');
    await syncNow(id);
    const h = await item(id, 'hilton-250');
    const r = await post('/approve', { itemIds: [h.id] }).expect(201);
    expect(r.body[0].result).toBe('PARTIAL');
    expect((await item(id, 'hilton-250')).status).toBe('AVAILABLE');
  });

  it('records a failure, notifies, and keeps the offer available', async () => {
    const { id } = await makeAccount({ username: 'enrollfail' });
    seed('enrollfail');
    await syncNow(id);
    const h = await item(id, 'hilton-250');
    const r = await post('/approve', { itemIds: [h.id] }).expect(201);
    expect(r.body[0].result).toBe('FAILURE');
    expect((await item(id, 'hilton-250')).decision).toBe('FAILED');
    expect(await prisma.notification.count({ where: { userId, type: 'OFFER_ENROLL_FAILED' } })).toBeGreaterThan(0);
  });

  it('logs in again when the issuer has ended the session behind our back', async () => {
    const { id, username } = await makeAccount();
    seed(username);
    await syncNow(id);
    const h = await item(id, 'hilton-250');
    expireMockSessions();
    const acct = await prisma.offerAccount.findUniqueOrThrow({ where: { id } });
    expect(acct.sessionEnc).not.toBeNull();
    const r = await post('/approve', { itemIds: [h.id] }).expect(201);
    expect(r.body[0].result).toBe('SUCCESS');
    expect((await item(id, 'hilton-250')).status).toBe('ENROLLED');
  });

  it('pauses for a verification code, rejects a wrong one, resumes with the right one and remembers the device', async () => {
    const { id } = await makeAccount({ username: 'mfa' });
    seed('mfa');
    const first = await syncNow(id);
    const run = await prisma.offerSyncRun.findUniqueOrThrow({ where: { id: first.runs[0] } });
    expect(run.status).toBe('NEEDS_MFA');
    expect((await prisma.offerAccount.findUniqueOrThrow({ where: { id } })).syncHealth).toBe('NEEDS_MFA');
    const bad = await sync.submitMfa(userId, id, '000000');
    expect(bad.ok).toBe(false);
    const ok = await sync.submitMfa(userId, id, MOCK_MFA_CODE);
    expect(ok.ok).toBe(true);
    const done = await prisma.offerSyncRun.findFirstOrThrow({ where: { accountId: id }, orderBy: { createdAt: 'desc' } });
    expect(done.status).toBe('SUCCESS');
    expect(done.found).toBe(3);
    expect((await prisma.offerAccount.findUniqueOrThrow({ where: { id } })).deviceTrustEnc).toMatch(/^v1\./);
    expireMockSessions();
    await prisma.offerAccount.update({ where: { id }, data: { sessionEnc: null } });
    const trusted = await syncNow(id);
    expect((await prisma.offerSyncRun.findUniqueOrThrow({ where: { id: trusted.runs[0] } })).status).toBe('SUCCESS');
    expect((await post(`/accounts/${id}/mfa`, { code: '123456' })).status).toBe(400);
  });

  it('locks an account after repeated bad logins and unlocks on request', async () => {
    const { id } = await makeAccount({ username: 'badpass' });
    for (let i = 0; i < 3; i++) await syncNow(id).catch(() => undefined);
    const a = await prisma.offerAccount.findUniqueOrThrow({ where: { id } });
    expect(a.failedLogins).toBe(3);
    expect(a.syncHealth).toBe('LOCKED');
    expect(a.lockedAt).not.toBeNull();
    const blocked = await syncNow(id);
    expect((await prisma.offerSyncRun.findUniqueOrThrow({ where: { id: blocked.runs[0] } })).error).toMatch(/locked/i);
    expect(await prisma.notification.count({ where: { userId, type: 'OFFER_SYNC_FAILED' } })).toBeGreaterThan(0);
    const un = await put(`/accounts/${id}`, { unlock: true }).expect(200);
    expect(un.body.locked).toBe(false);
  });

  it('retries a transient failure with backoff and closes stuck runs', async () => {
    const { id } = await makeAccount({ username: 'flaky' });
    seed('flaky');
    const first = await syncNow(id);
    const failed = await prisma.offerSyncRun.findUniqueOrThrow({ where: { id: first.runs[0] } });
    expect(failed.status).toBe('FAILED');
    expect(await sync.retryFailed(new Date(failed.finishedAt!.getTime() + 60_000), userId)).toBe(0);
    expect(await sync.retryFailed(new Date(failed.finishedAt!.getTime() + 6 * 60_000), userId)).toBe(1);
    const retry = await prisma.offerSyncRun.findFirstOrThrow({ where: { accountId: id, trigger: 'RETRY' } });
    expect([retry.status, retry.attempt]).toEqual(['SUCCESS', 2]);
    const stuck = await prisma.offerSyncRun.create({ data: { userId, accountId: id, trigger: 'MANUAL', status: 'RUNNING', startedAt: new Date(Date.now() - 2 * 3_600_000) } });
    expect(await sync.recoverStale(new Date())).toBeGreaterThanOrEqual(1);
    expect((await prisma.offerSyncRun.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe('FAILED');
  });
});

describe('scheduling and jobs', () => {
  it('runs a due account once per scheduled time (2 AM local by default)', async () => {
    const { id, username } = await makeAccount({ holder: 'Scheduled' });
    seed(username);
    await prisma.offerAccount.updateMany({ where: { userId, id: { not: id } }, data: { cadence: 'MANUAL' } });
    const now = new Date();
    expect(await jobs.syncDue(now, userId)).toBe(1);
    expect(await prisma.offerSyncRun.count({ where: { accountId: id, trigger: 'SCHEDULED' } })).toBe(1);
    expect(await jobs.syncDue(now, userId)).toBe(0);
    const acct = (await get('/accounts').expect(200)).body.find((a: { id: string }) => a.id === id);
    expect(acct.syncHour).toBe(2);
    expect(acct.nextRunAt).not.toBeNull();
    expect(new Date(acct.nextRunAt).getTime()).toBeGreaterThan(now.getTime());
  });

  it('the monthly audit and the expiring digest notify and write to the audit trail', async () => {
    const { id, username } = await makeAccount({ holder: 'Digest' });
    seed(username);
    await syncNow(id);
    await prisma.offerSnapshotItem.updateMany({ where: { accountId: id, externalId: 'hilton-250' }, data: { endsAt: new Date(Date.now() + 3 * 86_400_000) } });
    expect(await jobs.digest(new Date())).toBeGreaterThanOrEqual(1);
    expect(await jobs.monthlyAudit(new Date())).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { userId, type: 'OFFER_SAVINGS_DIGEST' } })).toBeGreaterThan(0);
    expect(await prisma.offerEvent.count({ where: { userId, type: 'SYNC' } })).toBeGreaterThan(0);
    expect((await inbox('expiring', id)).length).toBeGreaterThan(0);
  });

  it('respects the notification preference', async () => {
    await prisma.notificationPreference.upsert({ where: { userId }, update: { offerAutomation: false }, create: { userId, offerAutomation: false } });
    const before = await prisma.notification.count({ where: { userId, type: 'OFFER_NEW_HIGH_VALUE' } });
    await put('/policy', { mode: 'RECOMMEND', autoFilter: {} }).expect(200);
    const { id, username } = await makeAccount({ username: 'badpass' });
    seed(username);
    await syncNow(id).catch(() => undefined);
    expect(await prisma.notification.count({ where: { userId, type: 'OFFER_NEW_HIGH_VALUE' } })).toBe(before);
    await prisma.notificationPreference.update({ where: { userId }, data: { offerAutomation: true } });
  });
});

describe('extension intake', () => {
  const PAGE = (days: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    const us = `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
    return `Hilton: Spend $500, get $100 back, expires ${us}\nUber Eats - 10% back up to $20 - ends ${us}\nsome navigation text`;
  };
  const ingest = (body: object, t: string) => api(app).post(`${V}/extension/snapshot`).set(bearer(t)).send(body);

  it('accepts a page with an offers token, parses and discards the text, and is idempotent', async () => {
    const acct = await makeAccount({ kind: 'EXTENSION', optIn: false });
    const tok = (await post('/tokens').expect(201)).body.token as string;
    const r = await ingest({ accountId: acct.id, text: PAGE(20), pageHash: 'abc' }, tok).expect(201);
    expect(r.body.accepted).toBe(true);
    expect(r.body.found).toBe(2);
    expect(r.body.added).toBe(2);
    const again = await ingest({ accountId: acct.id, text: PAGE(20) }, tok).expect(201);
    expect(again.body.idempotent).toBe(true);
    expect(again.body.added).toBe(0);
    expect(JSON.stringify(await prisma.offerSnapshotItem.findMany({ where: { accountId: acct.id } }))).not.toContain('some navigation text');
    const none = await ingest({ accountId: acct.id, text: 'nothing that looks like an offer here' }, tok).expect(201);
    expect(none.body.accepted).toBe(false);
  });

  it('queues approved offers for the browser and records what the browser did', async () => {
    const acct = await makeAccount({ kind: 'EXTENSION', optIn: false });
    const tok = (await post('/tokens').expect(201)).body.token as string;
    await ingest({ accountId: acct.id, text: PAGE(25) }, tok).expect(201);
    const items = await prisma.offerSnapshotItem.findMany({ where: { accountId: acct.id } });
    const approved = await post('/approve', { itemIds: items.map((i) => i.id) }).expect(201);
    expect(approved.body.every((x: { result: string }) => x.result === 'QUEUED')).toBe(true);
    const q = await api(app).get(`${V}/extension/queue?accountId=${acct.id}`).set(bearer(tok)).expect(200);
    expect(q.body.toAdd).toHaveLength(items.length);
    const res = await api(app).post(`${V}/extension/enroll-results`).set(bearer(tok)).send({ accountId: acct.id, results: [{ externalId: items[0].externalId, cardKey: items[0].cardKey, outcome: 'SUCCESS' }, { externalId: items[1].externalId, cardKey: items[1].cardKey, outcome: 'FAILURE', message: 'button missing' }, { externalId: 'nope', cardKey: '', outcome: 'SUCCESS' }] }).expect(201);
    expect(res.body.results.map((r: { result: string }) => r.result)).toEqual(['SUCCESS', 'FAILURE', 'UNKNOWN']);
    expect((await prisma.offerSnapshotItem.findUniqueOrThrow({ where: { id: items[0].id } })).status).toBe('ENROLLED');
    expect((await prisma.offerSnapshotItem.findUniqueOrThrow({ where: { id: items[1].id } })).decision).toBe('FAILED');
  });

  it('a manual account can be marked done and a paste works like a capture', async () => {
    const acct = await makeAccount({ kind: 'MANUAL', optIn: false });
    const r = await post(`/accounts/${acct.id}/paste`, { text: PAGE(15) }).expect(201);
    expect(r.body.accepted).toBe(true);
    const it = await prisma.offerSnapshotItem.findFirstOrThrow({ where: { accountId: acct.id } });
    const m = await post(`/items/${it.id}/mark-enrolled`).expect(201);
    expect(m.body.result).toBe('SUCCESS');
    expect((await post(`/items/${it.id}/mark-enrolled`).expect(201)).body.result).toBe('ALREADY_ADDED');
    expect((await post(`/items/${it.id}/mark-enrolled`, {}, other)).status).toBe(404);
  });

  it('rejects missing, wrong-scope, revoked and oversized requests', async () => {
    const acct = await makeAccount({ kind: 'EXTENSION', optIn: false });
    expect((await api(app).post(`${V}/extension/snapshot`).send({ accountId: acct.id, text: PAGE(5) })).status).toBe(401);
    const mcp = (await api(app).post('/api/v1/me/tokens').set(bearer(token)).send({ name: 'mcp' }).expect(201)).body.token as string;
    expect((await ingest({ accountId: acct.id, text: PAGE(5) }, mcp)).status).toBe(401);
    const created = (await post('/tokens').expect(201)).body;
    await del(`/tokens/${created.id}`).expect(204);
    expect((await ingest({ accountId: acct.id, text: PAGE(5) }, created.token)).status).toBe(401);
    const live = (await post('/tokens').expect(201)).body.token as string;
    expect((await ingest({ accountId: acct.id, text: 'x'.repeat(61_000) }, live)).status).toBe(400);
    const list = (await get('/tokens').expect(200)).body as Array<Record<string, unknown>>;
    expect(JSON.stringify(list)).not.toContain(live);
    const otherAcct = (await api(app).post(`${V}/extension/snapshot`).set(bearer(live)).send({ accountId: (await makeAccount({ kind: 'EXTENSION', optIn: false })).id, text: PAGE(5) }));
    expect(otherAcct.status).toBe(201);
    const foreign = await register(app);
    const foreignTok = (await api(app).post(`${V}/tokens`).set(bearer(foreign.token)).expect(201)).body.token as string;
    expect((await ingest({ accountId: acct.id, text: PAGE(5) }, foreignTok)).status).toBe(404);
  });
});

describe('savings, history and the audit trail', () => {
  it('reports savings figures and a complete history without any secret', async () => {
    const s = (await get('/savings').expect(200)).body;
    expect(typeof s.realizedCents).toBe('number');
    expect(s.enrolledCount).toBeGreaterThan(0);
    const counts = (await get('/counts').expect(200)).body;
    expect(Object.keys(counts)).toEqual(expect.arrayContaining(['all', 'new', 'review', 'enrolled', 'auto', 'expiring', 'redeemed']));
    const events = await prisma.offerEvent.findMany({ where: { userId } });
    const types = new Set(events.map((e) => e.type));
    for (const t of ['DISCOVERED', 'DECISION', 'ACTIVATED', 'AUTO_ENROLLED', 'ENROLL_ATTEMPT', 'SYNC', 'RULE_CHANGED', 'REMOVED', 'UPDATED', 'EXPIRED']) expect(types.has(t as never)).toBe(true);
    const everything = JSON.stringify(events.map((e) => e.detail)) + JSON.stringify(await prisma.auditLog.findMany({ where: { actorId: userId } })) + JSON.stringify(await prisma.notification.findMany({ where: { userId } })) + JSON.stringify(await prisma.offerSyncRun.findMany({ where: { userId } }));
    expect(everything).not.toContain(PASSWORD);
    expect(everything).not.toContain('new-pass-1');
    expect((await prisma.auditLog.findMany({ where: { actorId: userId, entity: 'OfferAccount' } })).map((a) => a.action)).toEqual(expect.arrayContaining(['offer-account.create', 'offer-account.update', 'offer-account.disconnect', 'offer-account.delete']));
    expect((await get('/attempts').expect(200)).body.length).toBeGreaterThan(0);
  });

  it('requires a login and scopes every route to the member', async () => {
    expect((await api(app).get(`${V}/accounts`)).status).toBe(401);
    expect((await api(app).post(`${V}/sync`).send({})).status).toBe(401);
    expect((await get('/accounts', other).expect(200)).body).toHaveLength(0);
    expect((await get('/sync', other).expect(200)).body.runs).toHaveLength(0);
    const mine = (await get('/accounts').expect(200)).body[0].id;
    expect((await post('/sync', { accountId: mine, wait: true }, other)).status).toBe(404);
    const someone = await prisma.offerSnapshotItem.findFirstOrThrow({ where: { userId } });
    expect((await post('/approve', { itemIds: [someone.id] }, other)).status).toBe(404);
    expect((await get('/connectors').expect(200)).body.flows).toHaveLength(6);
  });
});

describe('the merchant offer agent tools', () => {
  it('read the inbox, the sync status and explain a decision, without any login', async () => {
    const reg = app.get(ToolRegistry);
    const ctx = { userId, now: new Date() } as never;
    const { id, username } = await makeAccount({ holder: 'Agent view' });
    seed(username);
    await syncNow(id);
    const inboxTool = await reg.get('get_offer_inbox')!.handler(ctx, { tab: 'all' });
    expect(inboxTool.summary).toMatch(/Hilton/);
    expect(reg.get('get_offer_inbox')!.readOnly).toBe(true);
    const status = await reg.get('get_offer_sync_status')!.handler(ctx, {});
    expect(status.summary).toMatch(/Agent view/);
    const why = await reg.get('explain_offer_decision')!.handler(ctx, { merchant: 'Hilton' });
    expect(why.summary).toMatch(/score \d+\/100/);
    await expect(reg.get('explain_offer_decision')!.handler(ctx, { merchant: 'Nonexistent Shop' })).rejects.toThrow(/No discovered offer/);
    const all = JSON.stringify([inboxTool, status, why]);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toMatch(/credentialEnc|sessionEnc/);
  });
});

describe('offer-alert emails', () => {
  const day = (n: number) => {
    const d = new Date(Date.now() + n * 86_400_000);
    return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}/${d.getUTCFullYear()}`;
  };
  const mime = (from: string, subject: string, body: string) => Buffer.from(`From: Offers <${from}>\r\nTo: me@example.test\r\nSubject: ${subject}\r\nMessage-ID: <${Date.now()}.${Math.random()}@mail.test>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`);

  it('adds the offers an issuer emails about and never removes the ones it does not mention', async () => {
    const amex = await prisma.issuer.upsert({ where: { name: 'American Express' }, update: {}, create: { name: 'American Express' } });
    const acct = await makeAccount({ kind: 'EMAIL', optIn: false, issuer: amex.id, holder: 'Amex by email' });
    const capture = app.get(CaptureService);
    const first = await capture.receiveFromMailbox(userId, mime('offers@welcome.aexp.com', 'New offers added to your account', `Hilton: Spend $500, get $100 back, expires ${day(20)}\nUber Eats - 10% back up to $20 - ends ${day(20)}`), undefined);
    expect(first.accepted).toBe(true);
    expect(await prisma.offerSnapshotItem.count({ where: { accountId: acct.id } })).toBe(2);
    expect((await prisma.inboundEmail.findFirstOrThrow({ where: { userId, note: { contains: 'offer email read' } }, orderBy: { receivedAt: 'desc' } })).note).toMatch(/2 offer\(s\), 2 new/);
    await capture.receiveFromMailbox(userId, mime('offers@welcome.aexp.com', 'Another offer for you', `Marriott: Spend $300, get $75 back, expires ${day(25)}`), undefined);
    const items = await prisma.offerSnapshotItem.findMany({ where: { accountId: acct.id } });
    expect(items).toHaveLength(3);
    expect(items.every((i) => i.status === 'AVAILABLE')).toBe(true);
    expect((await prisma.offerAccount.findUniqueOrThrow({ where: { id: acct.id } })).lastSyncAt).not.toBeNull();
    // an issuer without an email account, or mail that is not about offers, is left to the other parsers
    const other = await capture.receiveFromMailbox(userId, mime('offers@chase.com', 'New offers', `Hilton: Spend $500, get $100 back, expires ${day(20)}`), undefined);
    expect(other.accepted).toBe(true);
    expect(await prisma.offerSnapshotItem.count({ where: { userId, merchantText: 'Hilton', account: { issuer: { name: 'Chase' } } } })).toBe(0);
  });
});

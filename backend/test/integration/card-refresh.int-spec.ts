import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { join } from 'path';
import { api, bearer, createApp, login, register } from './helpers';

/** Phase C: card knowledge base — sources, refresh, proposals, approval, offer history, public APIs. */
const V = '/api/v1';
const DAY = 86_400_000;
let app: INestApplication;
let site: Server;
let siteUrl: string;
const prisma = new PrismaClient();
const pages: Record<string, { body: string; etag: string; robotsBlocked?: boolean }> = {};
const hits: string[] = [];
let admin: string;
let cardId: string;
const tag = `${Date.now() % 1_000_000}`;
const cardName = `Testgold${tag} Card`;

beforeAll(async () => {
  app = await createApp();
  admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
  const fixture = (n: string) => readFileSync(join(__dirname, '../fixtures/pages', n), 'utf8');
  pages['/gold'] = { body: fixture('contoso-gold-v1.html'), etag: '"g1"' };
  pages['/cash'] = { body: fixture('cash-card.html'), etag: '"c1"' };
  site = createServer((req, res) => {
    hits.push(`${req.method} ${req.url} ${req.headers['user-agent'] ?? ''}`);
    if (req.url === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nDisallow: /blocked\n');
      return;
    }
    if (req.url === '/moved') {
      res.writeHead(301, { location: 'https://not-an-issuer.example/x' }).end();
      return;
    }
    const p = pages[req.url ?? ''];
    if (!p) return void res.writeHead(404).end();
    if (req.headers['if-none-match'] === p.etag) return void res.writeHead(304).end();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', etag: p.etag }).end(p.body);
  });
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  // an isolated catalog card with a fictional history 40K → 50K → 60K (open)
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  const card = await prisma.creditCard.create({
    data: {
      slug: `testgold-${tag}`,
      name: cardName,
      issuerId: gold.issuerId,
      network: gold.network,
      currencyId: gold.currencyId, // 1.25 ¢/pt
      annualFeeCents: 25000,
      bonusType: 'POINTS',
      bonusPoints: 60000,
      bonusSpendCents: 600000,
      bonusMonths: 6,
      foreignTxFee: true,
    },
  });
  cardId = card.id;
  const base = { cardId, kind: 'WELCOME' as const, bonusType: 'POINTS' as const, minSpendCents: 600000, spendMonths: 6, annualFeeCents: 25000, source: 'test' };
  await prisma.cardOffer.create({ data: { ...base, bonusAmount: 40000, valuationCents: 50000, validFrom: new Date(Date.now() - 400 * DAY), validTo: new Date(Date.now() - 200 * DAY) } });
  await prisma.cardOffer.create({ data: { ...base, bonusAmount: 50000, valuationCents: 62500, validFrom: new Date(Date.now() - 200 * DAY), validTo: new Date(Date.now() - 60 * DAY) } });
  await prisma.cardOffer.create({ data: { ...base, bonusAmount: 60000, valuationCents: 75000, validFrom: new Date(Date.now() - 60 * DAY) } });
});
afterAll(async () => {
  site.closeAllConnections();
  await new Promise((r) => site.close(r));
  await app.close();
  await prisma.$disconnect();
});

describe('public card knowledge APIs', () => {
  it('offer history, welcome bonuses and annual fees are public', async () => {
    const h = await api(app).get(`${V}/cards/testgold-${tag}/offer-history`).expect(200);
    expect(h.body.timeline).toBe('40K → 50K → 60K');
    expect(h.body.versions.filter((v: { validTo: string | null }) => !v.validTo)).toHaveLength(1);
    const seeded = await api(app).get(`${V}/cards/contoso-gold/offer-history`).expect(200);
    expect(seeded.body.timeline).toMatch(/^40K → 50K → /);
    const wb = await api(app).get(`${V}/welcome-bonuses`).expect(200);
    expect(wb.body.find((w: { slug: string }) => w.slug === `testgold-${tag}`)).toMatchObject({ bonusAmount: 60000, valuationCents: 75000, median24mCents: 62500 });
    const fees = await api(app).get(`${V}/annual-fees`).expect(200);
    expect(fees.body.find((f: { slug: string }) => f.slug === `testgold-${tag}`)).toMatchObject({ annualFeeCents: 25000, previousFeeCents: null });
    await api(app).get(`${V}/cards/no-such-card/offer-history`).expect(404);
  });
});

describe('refresh engine (admin)', () => {
  let sourceId: string;

  it('only admins; only allow-listed issuer URLs', async () => {
    const u = await register(app);
    await api(app).post(`${V}/admin/card-sources`).set(bearer(u.token)).send({ cardId, url: `${siteUrl}/gold` }).expect(403);
    await api(app).post(`${V}/admin/card-sources`).set(bearer(admin)).send({ cardId, url: 'https://cardpointers.com/cards/gold' }).expect(400);
    await api(app).post(`${V}/admin/card-sources`).set(bearer(admin)).send({ cardId, url: 'http://example.com/gold' }).expect(400);
    const s = await api(app).post(`${V}/admin/card-sources`).set(bearer(admin)).send({ cardId, url: `${siteUrl}/gold` }).expect(201);
    sourceId = s.body.id;
    await api(app).post(`${V}/admin/card-sources`).set(bearer(admin)).send({ cardId, url: `${siteUrl}/gold` }).expect(409);
  });

  it('refresh fetches politely and proposes only changed fields with evidence', async () => {
    const r = await api(app).post(`${V}/admin/card-sources/${sourceId}/refresh`).set(bearer(admin)).expect(200);
    expect(r.body).toMatchObject({ status: 'PROPOSED', method: 'HEURISTIC' }); // no paid model in tests
    expect(hits.some((h) => h.startsWith('GET /robots.txt') && h.includes('PointwiseBot'))).toBe(true);
    const props = await api(app).get(`${V}/admin/card-proposals?status=PENDING&cardId=${cardId}`).set(bearer(admin)).expect(200);
    const byField = Object.fromEntries(props.body.map((p: { field: string; newValue: unknown }) => [p.field, p.newValue]));
    expect(byField).toEqual({ bonusAmount: 90000, foreignTxFee: false, authorizedUserFeeCents: 3500, offerExpiresAt: '2027-01-15' });
    const bonus = props.body.find((p: { field: string }) => p.field === 'bonusAmount');
    expect(bonus).toMatchObject({ oldValue: 60000, evidence: expect.stringContaining('Earn 90,000'), method: 'HEURISTIC' });
    expect(JSON.stringify(props.body)).not.toContain('999,999'); // script text ignored
    // the injected instruction on the page did not produce a $0 fee proposal
    expect(byField.annualFeeCents).toBeUndefined();
  });

  it('approving the bonus closes the old version, opens a new elevated one and alerts watchers', async () => {
    const watcher = await register(app);
    await prisma.offerAlert.create({ data: { userId: watcher.userId, keywords: [`testgold${tag}`] } });
    const p = (await api(app).get(`${V}/admin/card-proposals?status=PENDING&cardId=${cardId}`).set(bearer(admin))).body.find((x: { field: string }) => x.field === 'bonusAmount');
    const a = await api(app).post(`${V}/admin/card-proposals/${p.id}/approve`).set(bearer(admin)).send({}).expect(200);
    expect(a.body.offerVersion).toMatchObject({ bonusAmount: 90000, valuationCents: 112500, elevated: true });
    await api(app).post(`${V}/admin/card-proposals/${p.id}/approve`).set(bearer(admin)).send({}).expect(409);
    const card = await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } });
    expect(card).toMatchObject({ bonusPoints: 90000, bonusValuationCents: 112500 });
    const h = await api(app).get(`${V}/cards/${cardId}/offer-history`).expect(200);
    expect(h.body.timeline).toBe('40K → 50K → 60K → 90K');
    expect(h.body.versions.filter((v: { validTo: string | null }) => !v.validTo)).toHaveLength(1);
    const elevated = await api(app).get(`${V}/welcome-bonuses?elevated=true`).expect(200);
    expect(elevated.body.map((w: { slug: string }) => w.slug)).toContain(`testgold-${tag}`);
    const notes = await api(app).get(`${V}/notifications`).set(bearer(watcher.token)).expect(200);
    expect(notes.body.map((n: { title: string }) => n.title)).toContain(`Elevated welcome offer: ${cardName}`);
    const audit = await prisma.auditLog.findFirst({ where: { entity: 'CardChangeProposal', entityId: p.id } });
    expect(audit?.action).toBe('approve');
  });

  it('edited values are validated; rejection does not change the card', async () => {
    const pending = (await api(app).get(`${V}/admin/card-proposals?status=PENDING&cardId=${cardId}`).set(bearer(admin))).body;
    const exp = pending.find((x: { field: string }) => x.field === 'offerExpiresAt');
    await api(app).post(`${V}/admin/card-proposals/${exp.id}/approve`).set(bearer(admin)).send({ value: 'soon' }).expect(400);
    await api(app).post(`${V}/admin/card-proposals/${exp.id}/approve`).set(bearer(admin)).send({ value: '2027-02-01' }).expect(200);
    expect((await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).offerExpiresAt?.toISOString()).toBe('2027-02-01T00:00:00.000Z');
    const fx = pending.find((x: { field: string }) => x.field === 'foreignTxFee');
    await api(app).post(`${V}/admin/card-proposals/${fx.id}/reject`).set(bearer(admin)).expect(200);
    expect((await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } })).foreignTxFee).toBe(true);
    await api(app).post(`${V}/admin/card-proposals/${fx.id}/reject`).set(bearer(admin)).expect(409);
  });

  it('unchanged pages are not re-extracted (conditional GET / content hash); page changes supersede old proposals', async () => {
    const again = await api(app).post(`${V}/admin/card-sources/${sourceId}/refresh`).set(bearer(admin)).expect(200);
    expect(again.body.status).toBe('UNCHANGED');
    expect(hits.some((h) => h.startsWith('GET /gold'))).toBe(true);
    pages['/gold'] = { body: pages['/gold'].body.replace('$250 annual fee', '$325 annual fee'), etag: '"g2"' };
    const changed = await api(app).post(`${V}/admin/cards/${cardId}/refresh`).set(bearer(admin)).expect(200);
    expect(changed.body[0]).toMatchObject({ status: 'PROPOSED' });
    const pending = (await api(app).get(`${V}/admin/card-proposals?status=PENDING&cardId=${cardId}`).set(bearer(admin))).body;
    expect(pending.find((x: { field: string }) => x.field === 'annualFeeCents')).toMatchObject({ oldValue: 25000, newValue: 32500 });
    const superseded = (await api(app).get(`${V}/admin/card-proposals?status=SUPERSEDED&cardId=${cardId}`).set(bearer(admin))).body;
    expect(superseded.map((x: { field: string }) => x.field)).toContain('authorizedUserFeeCents');
    const fee = pending.find((x: { field: string }) => x.field === 'annualFeeCents');
    await api(app).post(`${V}/admin/card-proposals/${fee.id}/approve`).set(bearer(admin)).send({}).expect(200);
    const fees = await api(app).get(`${V}/annual-fees`).expect(200);
    expect(fees.body.find((f: { slug: string }) => f.slug === `testgold-${tag}`)).toMatchObject({ annualFeeCents: 32500, previousFeeCents: 25000 });
  });

  it('robots.txt, off-domain redirects, missing pages and disabled sources', async () => {
    const blocked = await api(app).post(`${V}/admin/card-sources`).set(bearer(admin)).send({ cardId, url: `${siteUrl}/blocked` }).expect(201);
    expect((await api(app).post(`${V}/admin/card-sources/${blocked.body.id}/refresh`).set(bearer(admin)).expect(200)).body.status).toBe('BLOCKED');
    const moved = await api(app).post(`${V}/admin/card-sources`).set(bearer(admin)).send({ cardId, url: `${siteUrl}/moved` }).expect(201);
    const m = await api(app).post(`${V}/admin/card-sources/${moved.body.id}/refresh`).set(bearer(admin)).expect(200);
    expect(m.body).toMatchObject({ status: 'ERROR', error: expect.stringMatching(/not an allow-listed issuer domain/) });
    const missing = await api(app).post(`${V}/admin/card-sources`).set(bearer(admin)).send({ cardId, url: `${siteUrl}/gone` }).expect(201);
    expect((await api(app).post(`${V}/admin/card-sources/${missing.body.id}/refresh`).set(bearer(admin)).expect(200)).body).toMatchObject({ status: 'ERROR', error: 'HTTP 404' });
    await api(app).patch(`${V}/admin/card-sources/${missing.body.id}`).set(bearer(admin)).send({ active: false }).expect(200);
    const list = (await api(app).get(`${V}/admin/card-sources?cardId=${cardId}`).set(bearer(admin)).expect(200)).body;
    expect(list.find((s: { id: string }) => s.id === missing.body.id)).toMatchObject({ active: false, failureCount: 1 });
    for (const id of [blocked.body.id, moved.body.id, missing.body.id]) await api(app).delete(`${V}/admin/card-sources/${id}`).set(bearer(admin)).expect(204);
    await api(app).delete(`${V}/admin/card-sources/${missing.body.id}`).set(bearer(admin)).expect(404);
    const job = await api(app).post(`${V}/admin/jobs/refresh-card-sources/run`).set(bearer(admin)).expect(201);
    expect(job.body.job).toBe('refresh-card-sources');
  });

  it('pasted page text (when a site blocks automation) and private cards', async () => {
    const cash = readFileSync(join(__dirname, '../fixtures/pages/cash-card.html'), 'utf8');
    const r = await api(app).post(`${V}/admin/cards/${cardId}/extract`).set(bearer(admin)).send({ text: cash }).expect(200);
    expect(r.body).toMatchObject({ method: 'HEURISTIC+PASTED' });
    expect(r.body.proposals).toBeGreaterThan(0);
    await api(app).post(`${V}/admin/cards/${cardId}/extract`).set(bearer(admin)).send({ text: 'short' }).expect(400);
    const priv = await prisma.creditCard.findFirst({ where: { ownerId: { not: null } } });
    if (priv) await api(app).post(`${V}/admin/card-sources`).set(bearer(admin)).send({ cardId: priv.id, url: `${siteUrl}/gold` }).expect(404);
  });
});

describe('retention offers and the assistant', () => {
  it('users report retention offers; summaries never reveal who reported', async () => {
    const u = await register(app);
    await api(app).post(`${V}/me/retention-offers`).set(bearer(u.token)).send({ cardId, offer: '20,000 points after $2,000 in 3 months', accepted: true }).expect(201);
    await api(app).post(`${V}/me/retention-offers`).set(bearer(u.token)).send({ cardId, offer: 'No offer', accepted: false }).expect(201);
    await api(app).post(`${V}/me/retention-offers`).set(bearer(u.token)).send({ cardId, offer: 'x', accepted: true }).expect(400);
    const s = await api(app).get(`${V}/cards/testgold-${tag}/retention-offers`).set(bearer(u.token)).expect(200);
    expect(s.body).toMatchObject({ reports12m: 2, acceptedRate: 0.5 });
    expect(JSON.stringify(s.body)).not.toContain(u.userId);
    expect(JSON.stringify(s.body)).not.toContain(u.email);
  });

  it('assistant answers offer-history questions with public data (allowed to reach the model)', async () => {
    const token = await login(app, 'family@pointwise.local', 'Family12345!');
    await api(app).put(`${V}/ai/settings`).set(bearer(token)).send({ consent: true }).expect(200);
    const r = await api(app).post(`${V}/ai/chat`).set(bearer(token)).send({ message: `Is the ${cardName} offer a good offer?`, agent: 'card-comparison' }).expect(200);
    expect(r.body.trace[0]).toMatchObject({ tool: 'get_card_offer_history', ok: true });
    expect(r.body.private).toBe(false);
    expect(r.body.answer).toMatch(/40K → 50K → 60K → 90K.*elevated/);
  });
});

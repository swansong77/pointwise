import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { join } from "path";
import { CardRefreshService } from "../../src/catalog-refresh/card-refresh.service";
import { api, bearer, createApp, login, register } from "./helpers";

/**
 * Offer intelligence: the dashboard endpoint, history position (best-ever, verdict, advice), and the
 * scheduled refresh that publishes issuer-verified changes automatically while an admin-triggered refresh
 * still only proposes. All data is fictional.
 */
const V = "/api/v1";
const DAY = 86_400_000;
const prisma = new PrismaClient();
let app: INestApplication;
let site: Server;
let siteUrl: string;
let admin: string;
let cardId: string;
const tag = `${Date.now() % 1_000_000}`;
let body = "";

beforeAll(async () => {
  app = await createApp();
  admin = await login(app, "admin@pointwise.local", "Admin12345!");
  body = readFileSync(join(__dirname, "../fixtures/pages", "contoso-gold-v1.html"), "utf8");
  site = createServer((req, res) => {
    if (req.url === "/robots.txt") return void res.writeHead(200, { "content-type": "text/plain" }).end("User-agent: *\nAllow: /\n");
    if (req.url === "/gold") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;

  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "contoso-gold" } });
  const card = await prisma.creditCard.create({
    data: {
      slug: `mkt-${tag}`,
      name: `Market${tag} Card`,
      issuerId: gold.issuerId,
      network: gold.network,
      currencyId: gold.currencyId,
      annualFeeCents: 25000,
      bonusType: "POINTS",
      bonusPoints: 60000,
      bonusSpendCents: 600000,
      bonusMonths: 6,
      foreignTxFee: true,
      offerExpiresAt: new Date(Date.now() + 9 * DAY),
    },
  });
  cardId = card.id;
  const base = { cardId, kind: "WELCOME" as const, bonusType: "POINTS" as const, minSpendCents: 600000, spendMonths: 6, annualFeeCents: 25000, source: "test" };
  // 60K → 75K → 90K → 100K (current), then expressed as valuation
  await prisma.cardOffer.create({ data: { ...base, bonusAmount: 60000, valuationCents: 75000, validFrom: new Date(Date.now() - 400 * DAY), validTo: new Date(Date.now() - 300 * DAY) } });
  await prisma.cardOffer.create({ data: { ...base, bonusAmount: 75000, valuationCents: 93750, validFrom: new Date(Date.now() - 300 * DAY), validTo: new Date(Date.now() - 150 * DAY) } });
  await prisma.cardOffer.create({ data: { ...base, bonusAmount: 90000, valuationCents: 112500, validFrom: new Date(Date.now() - 150 * DAY), validTo: new Date(Date.now() - 30 * DAY) } });
  await prisma.cardOffer.create({ data: { ...base, bonusAmount: 100000, valuationCents: 125000, validFrom: new Date(Date.now() - 30 * DAY) } });
});
afterAll(async () => {
  site.closeAllConnections();
  await new Promise((r) => site.close(r));
  await app.close();
  await prisma.$disconnect();
});

describe("offer history position (public)", () => {
  it("welcome bonuses carry best-ever, verdict, expiry days and advice", async () => {
    const wb = await api(app).get(`${V}/welcome-bonuses`).expect(200);
    const o = wb.body.find((w: { slug: string }) => w.slug === `mkt-${tag}`);
    expect(o).toMatchObject({ bestEverCents: 125000, verdict: "BEST_EVER", versions: 4, daysToExpiry: expect.any(Number) });
    expect(o.daysToExpiry).toBeGreaterThanOrEqual(8);
    expect(o.daysToExpiry).toBeLessThanOrEqual(10);
    const codes = o.advice.map((a: { code: string }) => a.code);
    expect(codes).toEqual(expect.arrayContaining(["APPLY_BEFORE_EXPIRY", "BEST_EVER"]));
    expect(o.advice[0].text).toMatch(/^Apply within \d+ days before this elevated offer expires\.$/);
  });
});

describe("GET /offers/market", () => {
  it("requires sign-in", async () => {
    await api(app).get(`${V}/offers/market`).expect(401);
  });
  it("returns the dashboard with your values, difficulty and sections", async () => {
    const u = await register(app);
    const m = (await api(app).get(`${V}/offers/market`).set(bearer(u.token)).expect(200)).body;
    expect(m.engine).toMatch(/^offer-intel\//);
    const o = m.offers.find((x: { slug: string }) => x.slug === `mkt-${tag}`);
    expect(o).toMatchObject({ verdict: "BEST_EVER", difficulty: { level: expect.any(String) } });
    expect(o.you).toMatchObject({ eligible: expect.any(Boolean), firstYearValueCents: expect.any(Number), longTermValueCents: expect.any(Number) });
    expect(o.you.five24).toBeDefined();
    expect(m.expiringSoon).toContain(`mkt-${tag}`);
    expect(m.historicalHighs).toContain(`mkt-${tag}`);
    expect(m.disclaimer).toMatch(/not financial advice/);
  });
  it("one user's data never appears in another's market view", async () => {
    const a = await register(app);
    const b = await register(app);
    const ma = (await api(app).get(`${V}/offers/market`).set(bearer(a.token)).expect(200)).body;
    const mb = (await api(app).get(`${V}/offers/market`).set(bearer(b.token)).expect(200)).body;
    expect(ma.member.profileId).not.toBe(mb.member.profileId);
  });
});

describe("scheduled refresh publishes issuer-verified changes; admin refresh only proposes", () => {
  let sourceId: string;
  it("an admin-triggered refresh leaves proposals pending", async () => {
    const s = await api(app).post(`${V}/admin/card-sources`).set(bearer(admin)).send({ cardId, url: `${siteUrl}/gold` }).expect(201);
    sourceId = s.body.id;
    const r = await api(app).post(`${V}/admin/card-sources/${sourceId}/refresh`).set(bearer(admin)).expect(200);
    expect(r.body.status).toBe("PROPOSED");
    expect(r.body.autoPublished ?? 0).toBe(0);
    const card = await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.bonusPoints).toBe(60000);
  });
  it("the scheduled job auto-publishes plausible changes from the issuer domain, with an audit entry", async () => {
    const svc = app.get(CardRefreshService);
    await prisma.cardDataSource.update({ where: { id: sourceId }, data: { contentHash: null, etag: null } });
    const pendingBefore = await prisma.cardChangeProposal.count({ where: { cardId, status: "PENDING" } });
    expect(pendingBefore).toBeGreaterThan(0);
    await svc.refreshSource(sourceId, { force: true, autoPublish: true });
    const card = await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } });
    expect(card.bonusPoints).toBe(90000);
    const versions = await prisma.cardOffer.findMany({ where: { cardId, kind: "WELCOME" }, orderBy: { validFrom: "asc" } });
    expect(versions.filter((v) => !v.validTo)).toHaveLength(1);
    expect(versions[versions.length - 1].bonusAmount).toBe(90000);
    const audits = await prisma.auditLog.findMany({ where: { entity: "CardChangeProposal" }, orderBy: { createdAt: "desc" }, take: 10 });
    expect(audits.some((a) => (a.diff as { auto?: boolean } | null)?.auto === true)).toBe(true);
  });
  it("can be switched off with OFFER_AUTO_PUBLISH=false", async () => {
    process.env.OFFER_AUTO_PUBLISH = "false";
    try {
      body = body.replace("90,000", "95,000");
      await prisma.cardDataSource.update({ where: { id: sourceId }, data: { contentHash: null, etag: null } });
      await app.get(CardRefreshService).refreshSource(sourceId, { force: true, autoPublish: true });
      const card = await prisma.creditCard.findUniqueOrThrow({ where: { id: cardId } });
      expect(card.bonusPoints).toBe(90000);
    } finally {
      delete process.env.OFFER_AUTO_PUBLISH;
    }
  });
});

import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { OfferJobsService } from "../../src/offers/offer-jobs.service";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Merchant offer intelligence: import → inventory (source, reliability, confidence cap) → assisted activation →
 * missed-offer root causes → opportunity scores → purchase plans with evidence → verification from a statement
 * credit → audit trail and workflows. All data is synthetic.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let walletCardId: string;
let hiltonId: string;

const DAY = 86_400_000;
const future = new Date(Date.now() + 20 * DAY);
const us = `${String(future.getUTCMonth() + 1).padStart(2, "0")}/${String(future.getUTCDate()).padStart(2, "0")}/${future.getUTCFullYear()}`;
const OFFERS = `# comment line\nHilton: Spend $500, get $100 back, expires ${us}\nUber Eats - 10% back up to $20 - ends ${us}\nwhat is this line`;

const get = (path: string, t = token) => api(app).get(`${V}${path}`).set(bearer(t));
const post = (path: string, body: object, t = token) => api(app).post(`${V}${path}`).set(bearer(t)).send(body);
const inventory = async () => (await get("/offers/intel/inventory").expect(200)).body as Array<Record<string, any>>;
const purchase = (daysAgo: number, cents: number, merchantId = hiltonId) =>
  prisma.transaction.create({ data: { userId, walletCardId, merchantId, amountCents: cents, kind: "PURCHASE", source: "MANUAL", occurredAt: new Date(Date.now() - daysAgo * DAY), description: "test purchase" } });

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  token = a.token;
  other = (await register(app)).token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "contoso-gold" } });
  walletCardId = (await post("/wallet/cards", { cardId: card.id }).expect(201)).body.id;
  hiltonId = (await prisma.merchant.findUniqueOrThrow({ where: { slug: "hilton" } })).id;
});
afterAll(async () => {
  await prisma.portalRate.deleteMany({ where: { portal: "TestPortal" } });
  await app.close();
  await prisma.$disconnect();
});

describe("TC-OFFI: merchant identity seed", () => {
  it("merchants carry aliases, MCC codes and a parent company", async () => {
    const m = await prisma.merchant.findUniqueOrThrow({ where: { slug: "amazon" } });
    expect(m.aliases).toContain("AMZN MKTPLACE");
    expect(m.mcc.length).toBeGreaterThan(0);
    expect(m.parentCompany).toBe("Amazon.com, Inc.");
    expect(await prisma.merchant.count({ where: { aliases: { isEmpty: false } } })).toBeGreaterThanOrEqual(50);
  });
});

describe("TC-OFFI: import and inventory", () => {
  it("imports pasted offers, resolves merchants, reports what it could not read", async () => {
    const r = await post("/offers/intel/import", { walletCardId, text: OFFERS }).expect(201);
    expect(r.body.created).toHaveLength(2);
    expect(r.body.created.map((c: any) => c.merchant).sort()).toEqual(["Hilton", "Uber Eats"]);
    expect(r.body.created.every((c: any) => c.merchantConfidence >= 0.8)).toBe(true);
    expect(r.body.rejected).toEqual([{ line: 4, text: "what is this line", reason: expect.stringMatching(/merchant not found|reward not found/) }]);
  });
  it("importing the same text again creates nothing", async () => {
    const r = await post("/offers/intel/import", { walletCardId, text: OFFERS }).expect(201);
    expect(r.body.created).toHaveLength(0);
    expect(r.body.skipped).toHaveLength(2);
    expect(r.body.skipped[0].reason).toBe("already on this card");
  });
  it("inventory shows source, reliability, verification and the confidence ceiling", async () => {
    const rows = await inventory();
    const h = rows.find((x) => x.merchant?.name === "Hilton")!;
    expect(h).toMatchObject({ source: "USER_ENTERED", reliability: 25, verification: "UNVERIFIED", confidenceCap: 25, activationStatus: "PENDING", minSpendCents: 50_000, valueCents: 10_000, offerType: "SPEND_GET" });
    expect(h.merchant.parentCompany).toBe("Hilton Worldwide Holdings Inc.");
    const filtered = (await get("/offers/intel/inventory?source=EMAIL").expect(200)).body;
    expect(filtered).toEqual([]);
  });
  it("is private to the owner", async () => {
    expect(await get("/offers/intel/inventory", other).then((r) => r.body)).toEqual([]);
    await post("/offers/intel/import", { walletCardId, text: OFFERS }, other).expect(403);
    await get(`/offers/intel/inventory?walletCardId=${walletCardId}`, other).expect(403);
  });
  it("validates input", async () => {
    await post("/offers/intel/import", { walletCardId: "nope", text: OFFERS }).expect(400);
    await post("/offers/intel/import", { walletCardId, text: "x" }).expect(400);
  });
});

describe("TC-ACT: assisted activation and the audit trail", () => {
  let hiltonUo: string;
  it("the queue lists offers to activate, soonest first", async () => {
    const q = (await get("/offers/intel/activation-queue").expect(200)).body as any[];
    expect(q.map((x) => x.merchant).sort()).toEqual(["Hilton", "Uber Eats"]);
    expect(q[0].daysLeft).toBeLessThanOrEqual(21);
    hiltonUo = q.find((x) => x.merchant === "Hilton").userOfferId;
  });
  it("marking activated removes it from the queue and writes an event", async () => {
    await post(`/offers/intel/activation/${hiltonUo}`, { status: "ACTIVATED", note: "added in the app" }).expect(201);
    expect(((await get("/offers/intel/activation-queue").expect(200)).body as any[]).map((x) => x.merchant)).toEqual(["Uber Eats"]);
    const h = (await inventory()).find((x) => x.merchant?.name === "Hilton")!;
    expect(h).toMatchObject({ activationStatus: "ACTIVATED", activationVerifiedBy: "MANUAL" });
    const ev = (await get("/offers/intel/events").expect(200)).body as any[];
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(["IMPORTED", "ACTIVATED"]));
    const imported = ev.find((e) => e.type === "IMPORTED" && e.offerId === h.offerId);
    expect(imported.detail).toMatchObject({ source: "USER_ENTERED", reliability: 25, merchantMatch: { name: "Hilton", trusted: true } });
  });
  it("another user cannot change it; unknown id is 404", async () => {
    await post(`/offers/intel/activation/${hiltonUo}`, { status: "FAILED" }, other).expect(403);
    await post(`/offers/intel/activation/00000000-0000-4000-8000-000000000000`, { status: "FAILED" }).expect(404);
    await post(`/offers/intel/activation/${hiltonUo}`, { status: "BOGUS" }).expect(400);
  });
});

describe("TC-MISS: missed offers and opportunities", () => {
  it("purchases on a card whose offer was never activated are a miss with the cause and evidence", async () => {
    const t = await purchase(5, 80_000, (await prisma.merchant.findUniqueOrThrow({ where: { slug: "uber-eats" } })).id);
    await purchase(3, 30_000, (await prisma.merchant.findUniqueOrThrow({ where: { slug: "uber-eats" } })).id);
    const r = (await get("/offers/intel/missed").expect(200)).body;
    const m = r.items.find((x: any) => x.offer.merchant === "Uber Eats");
    expect(m).toMatchObject({ cause: "NOT_ACTIVATED", spendCents: 110_000, confidence: 25 });
    expect(m.lostCents).toBe(2_000); // 10% of $1,100 is capped at $20
    expect(m.transactionIds).toContain(t.id);
    expect(m.evidence.join(" ")).toMatch(/not activated/);
    expect(r.totalLostCents).toBeGreaterThanOrEqual(2_000);
  });
  it("an activated offer whose minimum is not yet met is reported with the shortfall", async () => {
    await purchase(2, 20_000);
    const r = (await get("/offers/intel/missed").expect(200)).body;
    const m = r.items.find((x: any) => x.offer.merchant === "Hilton");
    expect(m).toMatchObject({ cause: "BELOW_MIN_SPEND", spendCents: 20_000 });
    expect(m.action).toMatch(/\$300\.00 more/);
  });
  it("opportunities carry a score, nine reasoned factors and a confidence", async () => {
    const r = (await get("/offers/intel/opportunities").expect(200)).body;
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    for (const o of r.items) {
      expect(o.score).toBeGreaterThanOrEqual(0);
      expect(o.score).toBeLessThanOrEqual(100);
      expect(o.factors).toHaveLength(9);
      expect(o.confidence).toBeLessThanOrEqual(75); // curated catalog offers are capped at 75
      if (o.source === "USER_ENTERED") expect(o.confidence).toBeLessThanOrEqual(25);
      expect(o.version).toBe("opportunity/1");
    }
    expect(r.items[0].score).toBeGreaterThanOrEqual(r.items[1].score);
    expect(r.items.find((o: any) => o.merchant === "Uber Eats").activated).toBe(false);
    expect(r.items.find((o: any) => o.merchant === "Hilton").activated).toBe(true);
  });
  it("merchant timeline: known merchant 200, unknown 404", async () => {
    const t = (await get("/offers/intel/merchants/hilton/timeline").expect(200)).body;
    expect(t.merchant.slug).toBe("hilton");
    expect(t).toHaveProperty("seasonality");
    await get("/offers/intel/merchants/no-such-merchant/timeline").expect(404);
  });
});

describe("TC-PLAN: purchase plans", () => {
  it("returns ranked plans, every one with evidence, and records a RECOMMENDED event", async () => {
    const r = (await post("/offers/intel/plan", { merchantText: "Hilton Hotels", amountCents: 60_000 }).expect(201)).body;
    expect(r.merchant.name).toBe("Hilton");
    expect(r.merchantConfidence).toBeGreaterThanOrEqual(0.8);
    expect(r.plans.length).toBeGreaterThan(0);
    for (const p of r.plans) expect(p.evidence.length).toBeGreaterThan(0);
    const best = r.plans[0];
    expect(best.legs[0].offerCents).toBe(10_000); // the activated $100 offer applies at $600
    expect(best.confidence).toBeLessThanOrEqual(90);
    expect(best.stack.version).toBe("stack-rules/1");
    const ev = (await get("/offers/intel/events").expect(200)).body as any[];
    const rec = ev.find((e) => e.type === "RECOMMENDED");
    expect(rec.detail).toMatchObject({ merchant: "Hilton", amountCents: 60_000, engine: "purchase-plan/2" });
    expect(rec.detail.evidence.length).toBeGreaterThan(0);
  });
  it("a purchase below the offer minimum does not count the offer", async () => {
    const r = (await post("/offers/intel/plan", { merchantText: "Hilton", amountCents: 20_000 }).expect(201)).body;
    expect(r.plans[0].legs[0].offerCents).toBe(0);
    expect(r.plans[0].warnings.join(" ")).toMatch(/needs \$500\.00/);
  });
  it("unknown merchants still get a card-earn plan, flagged by confidence", async () => {
    const r = (await post("/offers/intel/plan", { merchantText: "Joes Corner Diner", amountCents: 5_000 }).expect(201)).body;
    expect(r.merchant.id).toBeNull();
    expect(r.plans[0].legs[0].offerCents).toBe(0);
  });
  it("planned purchases can be saved, listed and deleted by the owner only", async () => {
    const r = (await post("/offers/intel/plan", { merchantText: "Hilton", amountCents: 60_000, save: true, plannedFor: new Date(Date.now() + 5 * DAY).toISOString() }).expect(201)).body;
    expect(r.plannedPurchaseId).toBeTruthy();
    expect(((await get("/offers/intel/planned").expect(200)).body as any[]).map((p) => p.id)).toContain(r.plannedPurchaseId);
    await api(app).delete(`${V}/offers/intel/planned/${r.plannedPurchaseId}`).set(bearer(other)).expect(404);
    await api(app).delete(`${V}/offers/intel/planned/${r.plannedPurchaseId}`).set(bearer(token)).expect(204);
    await api(app).delete(`${V}/offers/intel/planned/${r.plannedPurchaseId}`).set(bearer(token)).expect(404);
  });
  it("validates", async () => {
    await post("/offers/intel/plan", { amountCents: 5_000 }).expect(400);
    await post("/offers/intel/plan", { merchantText: "Hilton", amountCents: 0 }).expect(400);
  });
  it("portal rates entered by hand are stacked and cited", async () => {
    await prisma.portalRate.upsert({ where: { portal_merchantId: { portal: "TestPortal", merchantId: hiltonId } }, create: { portal: "TestPortal", merchantId: hiltonId, ratePercent: 3, source: "entered by hand" }, update: { ratePercent: 3 } });
    const r = (await post("/offers/intel/plan", { merchantText: "Hilton", amountCents: 60_000 }).expect(201)).body;
    expect(r.plans[0].portal).toEqual({ portal: "TestPortal", cents: 1_800 });
    expect(r.plans[0].evidence.join(" ")).toMatch(/portal TestPortal: 3%/);
    expect(r.plans[0].actions.join(" ")).toMatch(/Start from the TestPortal link/);
  });
});

describe("TC-VERIFY: closing the activation loop", () => {
  const jobs = () => app.get(OfferJobsService, { strict: false });
  it("a matching statement credit verifies the activation and lifts the confidence cap", async () => {
    const hilton = (await inventory()).find((x) => x.merchant?.name === "Hilton")!;
    await prisma.transaction.create({ data: { userId, walletCardId, merchantId: hiltonId, amountCents: 10_000, kind: "CREDIT", source: "MANUAL", description: "Hilton statement credit", occurredAt: new Date() } });
    expect(await jobs().verifyActivations(new Date())).toBe(1);
    const after = (await inventory()).find((x) => x.offerId === hilton.offerId)!;
    expect(after).toMatchObject({ activationVerifiedBy: "STATEMENT", verification: "VERIFIED", confidenceCap: 90 });
    const ev = ((await get(`/offers/intel/events?offerId=${hilton.offerId}`).expect(200)).body as any[]).find((e) => e.type === "ACTIVATION_VERIFIED");
    expect(ev.detail).toMatchObject({ creditCents: 10_000, basis: "statement credit matched merchant and amount" });
    expect(await jobs().verifyActivations(new Date())).toBe(0); // idempotent
  });
  it("terms met but no credit after 14 days is flagged as a failed activation", async () => {
    const uber = (await inventory()).find((x) => x.merchant?.name === "Uber Eats")!;
    await post(`/offers/intel/activation/${(await get("/offers/intel/activation-queue").then((r) => r.body))[0].userOfferId}`, { status: "ACTIVATED" }).expect(201);
    await prisma.userOffer.updateMany({ where: { offerId: uber.offerId }, data: { activatedAt: new Date(Date.now() - 40 * DAY) } });
    const eats = (await prisma.merchant.findUniqueOrThrow({ where: { slug: "uber-eats" } })).id;
    // every qualifying purchase is older than the 14-day wait
    await prisma.transaction.updateMany({ where: { userId, merchantId: eats }, data: { occurredAt: new Date(Date.now() - 25 * DAY) } });
    await purchase(30, 50_000, eats);
    expect(await jobs().verifyActivations(new Date())).toBe(1);
    expect((await inventory()).find((x) => x.offerId === uber.offerId)!.activationStatus).toBe("FAILED");
    const ev = ((await get(`/offers/intel/events?offerId=${uber.offerId}`).expect(200)).body as any[]).find((e) => e.type === "ACTIVATION_FAILED" && e.actor === "SYSTEM");
    expect(ev.detail.reason).toMatch(/no statement credit after 14 days/);
    expect(ev.detail.transactionIds.length).toBeGreaterThan(0);
  });
  it("the daily scan records missed offers once and notifies", async () => {
    const first = await jobs().scanOpportunities(new Date());
    expect(first).toBeGreaterThanOrEqual(0);
    const again = await jobs().scanOpportunities(new Date());
    expect(again).toBe(0); // missed offers are only recorded once per 30 days
  });
});

describe("TC-WF: offer workflows and tools", () => {
  it("purchase-plan workflow answers with a plan and audits one step", async () => {
    const r = (await post("/ai/workflows/purchase-plan", { merchantText: "Hilton", amountDollars: 600 }).expect(200)).body;
    expect(r).toMatchObject({ status: "COMPLETED", privacy: "USER" });
    expect(r.answer).toMatch(/^Best: /);
    expect(r.steps).toHaveLength(1);
    const detail = (await get(`/ai/runs/${r.runId}`).expect(200)).body;
    expect(detail.steps[0]).toMatchObject({ agent: "reward-optimization", engine: "purchase-plan/2", privacy: "USER" });
  });
  it("purchase-plan without inputs fails and is recorded as failed", async () => {
    const r = (await post("/ai/workflows/purchase-plan", {}).expect(200)).body;
    expect(r.status).toBe("FAILED");
  });
  it("offer-review workflow runs three steps", async () => {
    const r = (await post("/ai/workflows/offer-review", {}).expect(200)).body;
    expect(r.status).toBe("COMPLETED");
    expect(r.steps.map((s: any) => s.agent)).toEqual(["offer-discovery", "merchant-intelligence", "offer-audit"]);
  });
  it("the offer agents are seeded", async () => {
    const keys = (await prisma.agentProfile.findMany({ select: { key: true } })).map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["offer-discovery", "merchant-intelligence", "reward-optimization", "travel-offer", "shopping-offer", "family-optimization", "offer-audit"]));
  });
});

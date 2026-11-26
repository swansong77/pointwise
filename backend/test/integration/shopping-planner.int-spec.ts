import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Shopping planner: item-level plans, credits, certificates, strategies, what expires and when to buy, which household member
 * pays, and planned purchases with their outcome. All data is synthetic.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let aCard: string; // primary member's card
let bCard: string; // spouse's card
let spouseId: string;

const DAY = 86_400_000;
const us = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
const get = (path: string, t = token) => api(app).get(`${V}${path}`).set(bearer(t));
const post = (path: string, body: object, t = token) => api(app).post(`${V}${path}`).set(bearer(t)).send(body);
const patch = (path: string, body: object, t = token) => api(app).patch(`${V}${path}`).set(bearer(t)).send(body);
const plan = (body: object, t = token) => post("/offers/intel/plan", body, t);

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  token = a.token;
  other = (await register(app)).token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  await post("/subscription/checkout", { interval: "month" }).expect(201); // household members need Pro
  spouseId = (await post("/household/members", { nickname: "Riley", relationship: "SPOUSE" }).expect(201)).body.id;
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "contoso-gold" } });
  const voyager = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "northwind-voyager" } });
  aCard = (await post("/wallet/cards", { cardId: gold.id }).expect(201)).body.id;
  bCard = (await post("/wallet/cards", { cardId: voyager.id, profileId: spouseId }).expect(201)).body.id;
  // the primary member's card holds a Hilton offer (activated); the spouse's card has none
  await post("/offers/intel/import", { walletCardId: aCard, text: `Hilton: Spend $500, get $100 back, expires ${us(20)}` }).expect(201);
  const inv = (await get("/offers/intel/inventory").expect(200)).body as Array<{ id: string }>;
  await post(`/offers/intel/activation/${inv[0].id}`, { status: "ACTIVATED" }).expect(201);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("TC-SHOP: item-level plans", () => {
  it("plans from an item alone, reading it as a category and saying so", async () => {
    const r = (await plan({ item: "MacBook Pro", amountCents: 220_000 }).expect(201)).body;
    expect(r.itemHint).toMatchObject({ categorySlug: "online-shopping", merchantHint: "Apple" });
    expect(r.plans.length).toBeGreaterThan(0);
    expect(r.plans[0].evidence.length).toBeGreaterThan(0);
    expect(r.plans[0].breakdown).toHaveProperty("cashbackCents");
    expect(r.plans[0].netCostCents).toBe(220_000 - r.plans[0].totalValueReturnedCents);
    expect(r.plans[0].warnings.join(" ")).toMatch(/No merchant was named|guessed from the item/);
  });
  it("needs a merchant, an item or a category", async () => {
    await plan({ amountCents: 10_000 }).expect(400);
    await plan({ category: "dining", amountCents: 10_000 }).expect(201);
  });
});

describe("TC-SHOP: offers, strategies, household", () => {
  it("the member who holds the Hilton offer should pay, and the strategies are named", async () => {
    const r = (await plan({ merchantText: "Hilton", item: "Hilton stay", amountCents: 120_000 }).expect(201)).body;
    expect(r.plans[0].legs[0]).toMatchObject({ walletCardId: aCard, offerCents: 10_000 });
    expect(r.household.best.member).not.toBe("Riley");
    expect(r.household.options.map((o: any) => o.member)).toContain("Riley");
    expect(r.household.reason).toMatch(/holds "Hilton offer: \$100 back on \$500"|returns|about the same/);
    expect(r.strategies.map((s: any) => s.key)).toEqual(expect.arrayContaining(["BEST", "CONSERVATIVE", "MAX_REWARDS"]));
    expect(r.strategies[0].opportunityCostCents).toBe(0);
    expect(r.plans[0].member).toBeTruthy();
  });
  it("says what the preferred member would cost, and honours excluded cards", async () => {
    const r = (await plan({ merchantText: "Hilton", amountCents: 120_000, preferMember: spouseId }).expect(201)).body;
    expect(r.household.preferred).toMatchObject({ member: "Riley", available: true });
    expect(r.household.preferred.vsBestCents).toBeGreaterThanOrEqual(0);
    const ex = (await plan({ merchantText: "Hilton", amountCents: 120_000, excludeCardIds: [aCard] }).expect(201)).body;
    expect(ex.plans.flatMap((p: any) => p.legs.map((l: any) => l.walletCardId))).not.toContain(aCard);
  });
  it("a member with no cards gets no plans, and never sees another household's cards", async () => {
    const r = (await plan({ merchantText: "Hilton", amountCents: 120_000 }, other).expect(201)).body;
    expect(r.plans).toEqual([]);
  });
});

describe("TC-SHOP: credits, certificates, expiry and timing", () => {
  it("an unused credit that fits the purchase adds to the return, and what expires is reported", async () => {
    await prisma.userBenefit.create({
      data: { walletCardId: aCard, name: "Test hotel credit", kind: "CREDIT", period: "ANNUAL", periodMonths: 12, amountPerPeriodCents: 15_000, autoRules: { keywords: ["hilton"], categories: [], creditKeywords: [] } },
    });
    const r = (await plan({ merchantText: "Hilton", amountCents: 120_000 }).expect(201)).body;
    const top = r.plans.find((p: any) => p.kind === "SINGLE" && p.legs[0].walletCardId === aCard);
    expect(top.breakdown.creditsCents).toBe(15_000);
    expect(top.evidence.join(" ")).toMatch(/benefit credit: .*Test hotel credit/);
    const offerImpact = r.expiryImpact.find((e: any) => e.kind === "OFFER");
    expect(offerImpact).toMatchObject({ potentialLossCents: 10_000, lapsesBeforePlanned: false });
    expect(offerImpact.message).toMatch(/Purchase before .*: Hilton offer: \$100 back on \$500 expires/);
  });
  it("a planned date after the offer ends flags it, and the best day is before it", async () => {
    const r = (await plan({ merchantText: "Hilton", amountCents: 120_000, plannedFor: iso(40) }).expect(201)).body;
    expect(r.expiryImpact.find((e: any) => e.kind === "OFFER")).toMatchObject({ lapsesBeforePlanned: true });
    expect(r.bestTimeToBuy.gainCents).toBeGreaterThan(0);
    expect(new Date(r.bestTimeToBuy.date).getTime()).toBeLessThan(new Date(iso(40)).getTime());
    expect(r.bestTimeToBuy.reason).toMatch(/Buying on/);
  });
  it("a certificate held by the paying member for the merchant's brand is counted", async () => {
    const program = await prisma.loyaltyProgram.findFirst({ where: { name: { contains: "Hilton", mode: "insensitive" } } });
    const primary = await prisma.profile.findFirstOrThrow({ where: { userId, isPrimary: true } });
    await prisma.loyaltyCertificate.create({
      data: { userId, profileId: primary.id, programId: program?.id ?? null, category: "FREE_NIGHT", name: "Hilton free night", expiresAt: new Date(Date.now() + 60 * DAY), potentialValueCents: 30_000, eligible: ["Hilton"] },
    });
    const r = (await plan({ merchantText: "Hilton", amountCents: 120_000 }).expect(201)).body;
    const top = r.plans.find((p: any) => p.kind === "SINGLE" && p.legs[0].walletCardId === aCard);
    expect(top.breakdown.certificateCents).toBe(30_000);
    expect(top.actions.join(" ")).toMatch(/Redeem "Hilton free night"/);
    const spouse = r.plans.find((p: any) => p.kind === "SINGLE" && p.legs[0].walletCardId === bCard);
    expect(spouse.breakdown.certificateCents).toBe(0);
  });
});

describe("TC-SHOP: planned purchases", () => {
  let id: string;
  it("saves a plan with its item, priority, expected return and insights", async () => {
    const r = (await plan({ merchantText: "Hilton", item: "Hilton stay", priority: "HIGH", amountCents: 120_000, plannedFor: iso(10), save: true }).expect(201)).body;
    id = r.plannedPurchaseId;
    const list = (await get("/offers/intel/planned").expect(200)).body as any[];
    const row = list.find((x) => x.id === id);
    expect(row).toMatchObject({ item: "Hilton stay", priority: "HIGH", status: "PLANNED", category: "hotels" });
    expect(row.expectedCents).toBeGreaterThan(0);
    expect(row.result.insights).toHaveProperty("expiryImpact");
    expect(row.result.insights.strategies.length).toBeGreaterThan(0);
  });
  it("records what was bought and what it really returned, for the owner only", async () => {
    const u = (await patch(`/offers/intel/planned/${id}`, { status: "DONE", actualCents: 21_500, chosenWalletCardId: aCard }).expect(200)).body;
    expect(u).toMatchObject({ status: "DONE", actualCents: 21_500, chosenWalletCardId: aCard });
    await patch(`/offers/intel/planned/${id}`, { status: "CANCELLED" }, other).expect(404);
    await patch(`/offers/intel/planned/${id}`, { chosenWalletCardId: bCard }, token).expect(200);
    await patch(`/offers/intel/planned/${id}`, { status: "NOPE" }).expect(400);
  });
});

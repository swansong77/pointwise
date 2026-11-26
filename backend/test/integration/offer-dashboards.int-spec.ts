import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Savings-and-planning dashboards: expirations (offers, credits, certificates), savings by card/member/merchant/month, household
 * optimization, and the merchant dashboard. All data is synthetic.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let aCard: string;
let bCard: string;

const DAY = 86_400_000;
const us = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
};
const get = (path: string, t = token) => api(app).get(`${V}${path}`).set(bearer(t));
const post = (path: string, body: object, t = token) => api(app).post(`${V}${path}`).set(bearer(t)).send(body);

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  token = a.token;
  other = (await register(app)).token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  await post("/subscription/checkout", { interval: "month" }).expect(201);
  const spouse = (await post("/household/members", { nickname: "Riley", relationship: "SPOUSE" }).expect(201)).body.id;
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "contoso-gold" } });
  const voyager = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "northwind-voyager" } });
  aCard = (await post("/wallet/cards", { cardId: gold.id }).expect(201)).body.id;
  bCard = (await post("/wallet/cards", { cardId: voyager.id, profileId: spouse }).expect(201)).body.id;
  // the same Hilton offer on both members' cards, ending in 5 days on one and 40 on the other; an Uber Eats offer on the first
  await post("/offers/intel/import", { walletCardId: aCard, text: `Hilton: Spend $500, get $100 back, expires ${us(5)}\nUber Eats - 10% back up to $20 - ends ${us(50)}` }).expect(201);
  await post("/offers/intel/import", { walletCardId: bCard, text: `Hilton: Spend $500, get $100 back, expires ${us(40)}` }).expect(201);
  const inv = (await get("/offers/intel/inventory").expect(200)).body as Array<{ id: string; walletCardId: string; merchant: { name: string } | null }>;
  const hiltonA = inv.find((r) => r.walletCardId === aCard && r.merchant?.name === "Hilton")!;
  await post(`/offers/intel/activation/${hiltonA.id}`, { status: "ACTIVATED" }).expect(201);
  await prisma.userOffer.update({ where: { id: hiltonA.id }, data: { amountUsedCents: 4000, timesUsed: 1, redeemedAt: null } });
  await prisma.userBenefit.create({ data: { walletCardId: aCard, name: "Test travel credit", kind: "CREDIT", period: "ANNUAL", periodMonths: 12, amountPerPeriodCents: 15_000 } });
  const primary = await prisma.profile.findFirstOrThrow({ where: { userId, isPrimary: true } });
  await prisma.loyaltyCertificate.create({ data: { userId, profileId: primary.id, category: "FREE_NIGHT", name: "Free night", expiresAt: new Date(Date.now() + 12 * DAY), potentialValueCents: 25_000, eligible: ["Hilton"] } });
  await prisma.plannedPurchase.create({ data: { userId, merchantText: "Hilton", amountCents: 100_000, status: "DONE", expectedCents: 20_000, actualCents: 25_000 } });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("TC-DASH: expirations", () => {
  it("puts offers, credits and certificates in buckets with what is lost", async () => {
    const r = (await get("/offers/intel/expirations").expect(200)).body;
    const kinds = r.buckets.flatMap((b: any) => b.items.map((i: any) => i.kind));
    expect(kinds).toEqual(expect.arrayContaining(["OFFER", "CERTIFICATE"]));
    const week = r.buckets.find((b: any) => b.key === "WEEK");
    expect(week.items.map((i: any) => i.merchant)).toContain("Hilton");
    // the Hilton offer on the first card is part-used ($40 of $100), so $60 is at stake
    expect(week.items.find((i: any) => i.merchant === "Hilton").valueCents).toBe(6_000);
    const nextWeek = r.buckets.find((b: any) => b.key === "TWO_WEEKS");
    expect(nextWeek.items.map((i: any) => i.kind)).toContain("CERTIFICATE"); // 12 days out
    expect(r.buckets.find((b: any) => b.key === "MONTH").items.map((i: any) => i.merchant)).not.toContain("Hilton"); // the second Hilton offer is 40 days out, so it is in the 60-day bucket

    expect(r.totalCents).toBeGreaterThan(0);
    expect(r.urgentCents).toBe(week.totalCents);
    expect(r.nextDeadline.daysLeft).toBeLessThanOrEqual(5); // the soonest item of any kind (a catalog credit can end sooner than the offer)
    expect(week.items.every((i: any) => typeof i.action === "string" && i.action.length > 0)).toBe(true);
  });
  it("is private to the caller", async () => {
    expect((await get("/offers/intel/expirations", other).expect(200)).body.count).toBe(0);
  });
});

describe("TC-DASH: savings", () => {
  it("totals received and expected savings, by card, member, merchant and month, and compares finished plans", async () => {
    const r = (await get("/offers/intel/savings").expect(200)).body;
    expect(r.totals.actualCents).toBe(4_000);
    expect(r.totals.expectedCents).toBeGreaterThan(0);
    expect(r.byCard.find((c: any) => c.key === aCard)).toMatchObject({ actualCents: 4_000 });
    expect(r.byMember.length).toBeGreaterThanOrEqual(2);
    expect(r.byMerchant[0]).toHaveProperty("label");
    expect(r.byMonth).toHaveLength(12);
    expect(r.byMonth[11].actualCents).toBe(4_000);
    expect(r.plans).toMatchObject({ done: 1, expectedCents: 20_000, actualCents: 25_000, metCount: 1, hitRate: 100 });
    expect(r.totals.savedCents).toBe(r.totals.actualCents + r.totals.creditsThisYearCents);
  });
});

describe("TC-DASH: household optimization", () => {
  it("shows each member's offers, the same offer on both cards, and who should pay at each merchant", async () => {
    const r = (await get("/offers/intel/household").expect(200)).body;
    expect(r.members.map((m: any) => m.member)).toEqual(expect.arrayContaining(["Riley"]));
    expect(r.members.find((m: any) => m.member === "Riley")).toMatchObject({ liveOffers: 1, cards: 1 });
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps[0]).toMatchObject({ merchant: "Hilton" });
    expect(r.overlaps[0].holders).toHaveLength(2);
    const hilton = r.routing.find((x: any) => x.merchant === "Hilton");
    expect(hilton.advice).toMatch(/should pay at Hilton/);
    const uber = r.routing.find((x: any) => x.merchant === "Uber Eats");
    expect(uber.membersWithout).toEqual(["Riley"]);
  });
});

describe("TC-DASH: merchant dashboard", () => {
  it("brings together offers, multipliers, certificates, history and the best way to pay, without writing audit events", async () => {
    const before = await prisma.offerEvent.count({ where: { userId, type: "RECOMMENDED" } });
    const r = (await get("/offers/intel/merchants/hilton/dashboard").expect(200)).body;
    expect(r.merchant).toMatchObject({ slug: "hilton", name: "Hilton" });
    expect(r.offers.active).toHaveLength(2);
    expect(r.expectedCents).toBeGreaterThan(0);
    expect(r.receivedCents).toBe(4_000);
    expect(r.multipliers.length).toBeGreaterThan(0);
    expect(r.certificates.map((c: any) => c.name)).toContain("Free night");
    expect(r.history).toHaveProperty("merchant");
    expect(r.bestWayToPay).toMatchObject({ basedOn: "a $500 reference purchase" });
    expect(r.bestWayToPay.legs[0]).toHaveProperty("card");
    expect(r.bestWayToPay.memberReason).toBeTruthy();
    expect(await prisma.offerEvent.count({ where: { userId, type: "RECOMMENDED" } })).toBe(before);
    await get("/offers/intel/merchants/no-such-merchant/dashboard").expect(404);
  });
  it("shows another household nothing of this one", async () => {
    const r = (await get("/offers/intel/merchants/hilton/dashboard", other).expect(200)).body;
    expect(r.offers.active).toEqual([]);
    expect(r.certificates).toEqual([]);
    expect(r.bestWayToPay).toBeNull();
  });
});

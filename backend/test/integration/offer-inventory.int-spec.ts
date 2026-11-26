import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Unified offer inventory and per-card detail: offers on cards (and found by syncs) with one derived lifecycle, free-text and
 * structured filters, summary totals, and the card detail view. All data is synthetic.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let walletCardId: string;
let userId: string;

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
  const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "contoso-gold" } });
  walletCardId = (await post("/wallet/cards", { cardId: card.id }).expect(201)).body.id;
  await post("/offers/intel/import", { walletCardId, text: `Hilton: Spend $500, get $100 back, expires ${us(20)}\nUber Eats - 10% back up to $20 - ends ${us(60)}` }).expect(201);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("TC-INV: unified inventory", () => {
  it("lists every offer with cardholder, card, value, expiry, lifecycle and expected savings", async () => {
    const r = await get("/offers/intel/inventory/unified").expect(200);
    expect(r.body.total).toBe(2);
    const hilton = r.body.items.find((i: any) => i.merchant?.name === "Hilton");
    expect(hilton).toMatchObject({ origin: "USER_OFFER", state: "ADDED", valueCents: 10000, minSpendCents: 50000, actualSavingsCents: 0 });
    expect(hilton.card).toBeTruthy();
    expect(hilton.cardholder).toBeTruthy();
    expect(hilton.issuer).toBeTruthy();
    expect(hilton.expectedSavingsCents).toBeGreaterThan(0);
    expect(hilton.daysLeft).toBeGreaterThanOrEqual(19);
    expect(r.body.summary).toMatchObject({ total: 2, live: 2, expiringSoon: 1 });
  });
  it("searches by merchant text and filters by expiry window, value and state", async () => {
    expect((await get("/offers/intel/inventory/unified?q=hilton").expect(200)).body.items.map((i: any) => i.merchant.name)).toEqual(["Hilton"]);
    expect((await get("/offers/intel/inventory/unified?q=nothing-matches").expect(200)).body.total).toBe(0);
    expect((await get("/offers/intel/inventory/unified?expiresWithinDays=30").expect(200)).body.items.map((i: any) => i.merchant.name)).toEqual(["Hilton"]);
    expect((await get("/offers/intel/inventory/unified?minValueCents=5000").expect(200)).body.items.map((i: any) => i.merchant.name)).toEqual(["Hilton"]);
    expect((await get("/offers/intel/inventory/unified?states=ACTIVATED,REDEEMED").expect(200)).body.total).toBe(0);
    expect((await get("/offers/intel/inventory/unified?states=ADDED&sort=VALUE").expect(200)).body.items[0].merchant.name).toBe("Hilton");
  });
  it("follows an offer from added to activated to partly used to redeemed", async () => {
    const hilton = (await get("/offers/intel/inventory/unified?q=hilton").expect(200)).body.items[0];
    await post(`/offers/intel/activation/${hilton.id}`, { status: "ACTIVATED" }).expect(201);
    const state = async () => (await get("/offers/intel/inventory/unified?q=hilton").expect(200)).body.items[0];
    expect((await state()).state).toBe("ACTIVATED");
    await prisma.userOffer.update({ where: { id: hilton.id }, data: { amountUsedCents: 4000, timesUsed: 1 } });
    expect(await state()).toMatchObject({ state: "PARTIALLY_USED", actualSavingsCents: 4000 });
    await prisma.userOffer.update({ where: { id: hilton.id }, data: { status: "REDEEMED", redeemedAt: new Date(), amountUsedCents: 10000 } });
    expect(await state()).toMatchObject({ state: "REDEEMED", expectedSavingsCents: 0, actualSavingsCents: 10000 });
  });
  it("includes offers a sync found that are not on a card yet, and never another user's offers", async () => {
    const account = await prisma.offerAccount.create({ data: { userId, issuerId: (await prisma.issuer.findFirstOrThrow()).id, holderLabel: "test" } });
    await prisma.offerSnapshotItem.create({
      data: { userId, accountId: account.id, cardKey: "", externalId: "x1", merchantText: "Disney", title: "Disney 10% back", valueCents: 3000, contentHash: "h1", status: "AVAILABLE", decision: "RECOMMENDED" },
    });
    const r = (await get("/offers/intel/inventory/unified?q=disney").expect(200)).body;
    expect(r.items[0]).toMatchObject({ origin: "SYNC", state: "AVAILABLE", valueCents: 3000, offerId: null });
    expect((await get("/offers/intel/inventory/unified", other).expect(200)).body.total).toBe(0);
  });
  it("pages and rejects a card the caller does not own", async () => {
    const r = (await get("/offers/intel/inventory/unified?pageSize=1&page=2").expect(200)).body;
    expect(r.items).toHaveLength(1);
    expect(r.total).toBeGreaterThanOrEqual(3);
    await get(`/offers/intel/inventory/unified?walletCardId=${walletCardId}`, other).expect(403);
  });
});

describe("TC-INV: card detail", () => {
  it("returns details, benefits, certificates, offers by lifecycle, missed offers and savings", async () => {
    const r = (await get(`/offers/intel/cards/${walletCardId}`).expect(200)).body;
    expect(r.card).toMatchObject({ walletCardId, status: "APPROVED" });
    expect(r.card.name).toBeTruthy();
    expect(r.card.cardholder).toBeTruthy();
    expect(r.card).toHaveProperty("annualFeeCents");
    expect(Array.isArray(r.benefits)).toBe(true);
    expect(Array.isArray(r.certificates)).toBe(true);
    expect(r.offers.redeemed.map((o: any) => o.merchant.name)).toEqual(["Hilton"]);
    expect(r.offers.pending.map((o: any) => o.merchant.name)).toEqual(["Uber Eats"]);
    expect(r.offers.missed).toHaveProperty("items");
    expect(r.savings).toMatchObject({ offersCents: 10000 });
    expect(r.upcomingExpirations.map((o: any) => o.merchant.name)).toEqual(["Uber Eats"]);
  });
  it("is private to the card's owner", async () => {
    await get(`/offers/intel/cards/${walletCardId}`, other).expect(403);
    await get("/offers/intel/cards/not-a-uuid").expect(400);
  });
});

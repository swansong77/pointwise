import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Account-level benefit tracking: three cards of the SAME product (two held by the user, one by the
 * spouse) each keep their own usage, credits and detections; statements are validated; detections
 * can be accepted or rejected; reconciliation lists per-account gaps. All data is synthetic.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let me: string;
let spouse: string;
let c1: string; // user, ...1001
let c2: string; // user, ...1002
let c3: string; // spouse, ...1003
const now = new Date();
const us = `${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}/${now.getUTCFullYear()}`;
const csv = (rows: Array<[string, string]>) =>
  Buffer.from(
    [
      "Transaction Date,Description,Amount",
      ...rows.map(([d, a]) => `${us},${d},${a}`),
    ].join("\n"),
  );
const bulk = (name: string, buf: Buffer, t = token) =>
  api(app)
    .post(`${V}/spending/statements/bulk`)
    .set(bearer(t))
    .attach("files", buf, name);

const addCard = async (t: string, profileId: string, lastFour: string) => {
  const card = await prisma.creditCard.findUniqueOrThrow({
    where: { slug: "contoso-gold" },
  });
  const id = (
    await api(app)
      .post(`${V}/wallet/cards`)
      .set(bearer(t))
      .send({ cardId: card.id, profileId, lastFour })
      .expect(201)
  ).body.id as string;
  await api(app)
    .post(`${V}/benefits/apply-templates/${id}`)
    .set(bearer(t))
    .expect((r) => r.status < 300);
  return id;
};
const rollup = async (level: string, t = token) =>
  (
    await api(app)
      .get(`${V}/benefit-audit/rollup?level=${level}`)
      .set(bearer(t))
      .expect(200)
  ).body;
const rideshare = (b: { records: Array<{ cardAccountId: string; benefitName: string; usedCents: number; verificationStatus: string }> }, card: string) =>
  b.records.find((r) => r.cardAccountId === card && /rideshare/i.test(r.benefitName))!;

beforeAll(async () => {
  app = await createApp();
  token = (await register(app)).token;
  other = (await register(app)).token;
  // household members and several cards need the paid plan
  await api(app).post(`${V}/subscription/checkout`).set(bearer(token)).send({ interval: "month" }).expect(201);
  const mk = async (nickname: string, relationship: string) =>
    (
      await api(app)
        .post(`${V}/household/members`)
        .set(bearer(token))
        .send({ nickname, relationship })
        .expect(201)
    ).body.id as string;
  // the registered user already has a primary (SELF) member
  const members = (await api(app).get(`${V}/household/members`).set(bearer(token)).expect(200)).body as Array<{ id: string; relationship: string }>;
  me = members.find((m) => m.relationship === "SELF")!.id;
  await api(app).patch(`${V}/household/members/${me}`).set(bearer(token)).send({ nickname: "Me" }).expect(200);
  spouse = await mk("Spouse", "SPOUSE");
  c1 = await addCard(token, me, "1001");
  c2 = await addCard(token, me, "1002");
  c3 = await addCard(token, spouse, "1003");
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("same product, separate accounts", () => {
  it("each card account has its own benefits before any usage", async () => {
    const r = await rollup("account");
    expect(r.groups).toHaveLength(3);
    expect(new Set(r.records.map((x: { cardAccountId: string }) => x.cardAccountId))).toEqual(new Set([c1, c2, c3]));
  });

  it("a statement for ...1001 updates only that account, validates, and records its evidence", async () => {
    const res = await bulk(
      "Gold1001_Activity.csv",
      csv([
        ["UBER *TRIP HELP.UBER.COM", "-10.00"],
        ["FIXTURE HARDWARE", "-25.00"],
      ]),
    ).expect(200);
    expect(res.body.files[0]).toMatchObject({
      status: "IMPORTED",
      walletCardId: c1,
      imported: 2,
      validation: { status: "PASS", confidence: 100, differenceCount: 0, missingCents: 0 },
    });
    const r = await rollup("account");
    expect(rideshare(r, c1).usedCents).toBe(1000);
    expect(rideshare(r, c2).usedCents).toBe(0);
    expect(rideshare(r, c3).usedCents).toBe(0);
  });

  it("the same merchant on the spouse's card only counts for the spouse", async () => {
    await bulk("Gold1003.csv", csv([["UBER EATS", "-10.00"]])).expect(200);
    const r = await rollup("account");
    expect(rideshare(r, c3).usedCents).toBe(1000);
    expect(rideshare(r, c2).usedCents).toBe(0);
    expect(rideshare(r, c1).usedCents).toBe(1000);
  });

  it("rolls up to product, cardholder and household without merging accounts", async () => {
    const holder = await rollup("cardholder");
    const meG = holder.groups.find((g: { label: string }) => g.label === "Me");
    const spG = holder.groups.find((g: { label: string }) => g.label === "Spouse");
    expect(meG.accounts).toBe(2);
    expect(spG.accounts).toBe(1);
    expect(meG.usedCents).toBe(1000);
    expect(spG.usedCents).toBe(1000);
    const product = await rollup("product");
    expect(product.groups).toHaveLength(1);
    expect(product.groups[0]).toMatchObject({ accounts: 3, usedCents: 2000 });
    const hh = await rollup("household");
    expect(hh.groups[0]).toMatchObject({ accounts: 3, usedCents: 2000 });
  });

  it("other users never see these accounts", async () => {
    const r = await rollup("account", other);
    expect(r.records).toEqual([]);
  });
});

describe("audit trail and manual override", () => {
  let detectionId: string;
  it("lists detections with method, confidence and the statement they came from", async () => {
    const a = (await api(app).get(`${V}/benefit-audit`).set(bearer(token)).expect(200)).body;
    const item = a.items.find(
      (i: { cardAccountId: string; benefitName: string }) =>
        i.cardAccountId === c1 && /rideshare/i.test(i.benefitName),
    );
    expect(item).toMatchObject({ detected: 1, matched: 1, manualOverrides: 0 });
    const d = item.detections[0];
    expect(d).toMatchObject({ method: "EXACT", status: "DETECTED" });
    expect(d.confidence).toBeGreaterThanOrEqual(85);
    expect(d.transaction.description).toMatch(/UBER/);
    expect(d.statement).toMatchObject({ format: "csv", channel: "BULK" });
    detectionId = d.id;
    // the card's other transaction matched nothing: it is not a detection
    expect(a.summary.benefits).toBeGreaterThanOrEqual(6);
  });

  it("another user cannot decide it", async () => {
    await api(app)
      .patch(`${V}/benefit-audit/detections/${detectionId}`)
      .set(bearer(other))
      .send({ decision: "REJECT" })
      .expect(404);
  });

  it("rejecting removes the usage from the totals and cannot be decided twice", async () => {
    await api(app)
      .patch(`${V}/benefit-audit/detections/${detectionId}`)
      .set(bearer(token))
      .send({ decision: "REJECT" })
      .expect(200);
    const r = await rollup("account");
    expect(rideshare(r, c1).usedCents).toBe(0);
    expect(rideshare(r, c3).usedCents).toBe(1000); // untouched
    await api(app)
      .patch(`${V}/benefit-audit/detections/${detectionId}`)
      .set(bearer(token))
      .send({ decision: "ACCEPT" })
      .expect(400);
    const a = (await api(app).get(`${V}/benefit-audit`).set(bearer(token))).body;
    expect(a.summary.overrides).toBe(1);
  });

  it("a rejected match is not re-created by a rescan", async () => {
    await api(app).post(`${V}/spending/rescan`).set(bearer(token)).send({ walletCardId: c1 });
    const r = await rollup("account");
    expect(rideshare(r, c1).usedCents).toBe(0);
  });

  it("accepting marks the usage verified", async () => {
    const a = (await api(app).get(`${V}/benefit-audit`).set(bearer(token))).body;
    const d = a.items
      .find((i: { cardAccountId: string; benefitName: string }) => i.cardAccountId === c3 && /rideshare/i.test(i.benefitName))
      .detections[0];
    await api(app)
      .patch(`${V}/benefit-audit/detections/${d.id}`)
      .set(bearer(token))
      .send({ decision: "ACCEPT" })
      .expect(200);
    const r = await rollup("account");
    expect(rideshare(r, c3).verificationStatus).toBe("VERIFIED");
  });
});

describe("reconciliation and statement validation", () => {
  it("expected / detected / missing per account, with suggestions", async () => {
    const r = (await api(app).get(`${V}/benefit-audit/reconciliation`).set(bearer(token)).expect(200)).body;
    expect(r.totals.expectedCents).toBeGreaterThan(0);
    const mine = r.rows.filter((x: { benefitName: string }) => /rideshare/i.test(x.benefitName));
    expect(mine).toHaveLength(3);
    const byCard = Object.fromEntries(mine.map((x: { cardAccountId: string }) => [x.cardAccountId, x]));
    expect(byCard[c3].detectedCents + byCard[c3].pendingCents).toBeGreaterThan(0);
    expect(byCard[c2].detectedCents + byCard[c2].pendingCents).toBe(0);
    expect(Array.isArray(r.actions)).toBe(true);
    expect(r.actions.every((a: { suggestion: string }) => a.suggestion !== "On track.")).toBe(true);
  });

  it("imported statements keep their validation report", async () => {
    const list = (await api(app).get(`${V}/benefit-audit/statements`).set(bearer(token)).expect(200)).body;
    expect(list.length).toBe(2);
    expect(list.every((s: { validation: { status: string } }) => s.validation.status === "PASS")).toBe(true);
  });

  it("a statement with unreadable lines is flagged, not silently accepted", async () => {
    const bad = Buffer.from(
      ["Transaction Date,Description,Amount", `${us},FIXTURE SHOP,-5.00`, "not-a-date,BROKEN LINE,-9.00"].join("\n"),
    );
    const res = await bulk("Gold1002.csv", bad).expect(200);
    expect(res.body.files[0].validation.status).not.toBe("PASS");
    expect(res.body.files[0].validation.differenceCount + res.body.files[0].validation.statementCount).toBeGreaterThan(0);
  });
});

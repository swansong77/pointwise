import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { api, bearer, createApp, register } from "./helpers";
import { makePdf } from "../fixtures/make-pdf";

/**
 * Spend tracking → automatic benefit tracking, end to end: a statement CSV for a Contoso Gold card
 * (Dining credit $10/month by category, Rideshare credit $10/month by Uber/Lyft) updates the benefit
 * tracker; the statement credit confirms the expected usage; duplicates, dismissals, rules, manual
 * transactions and deletion behave; other users can't touch any of it.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let walletCardId: string;
const DAY = 86_400_000;
const now = new Date();
// three dates in the current calendar month (monthly benefits) — day 1..3, never in the future
const d = (day: number) => {
  const x = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      Math.min(day, now.getUTCDate()),
    ),
  );
  return `${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCDate()).padStart(2, "0")}/${x.getUTCFullYear()}`;
};
const STATEMENT = [
  "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
  `${d(1)},${d(1)},UBER   *TRIP HELP.UBER.COM CA,Travel,Sale,-23.45,`,
  `${d(2)},${d(2)},SQ *BEAN STREET COFFEE,Food & Drink,Sale,-6.50,`,
  `${d(2)},${d(2)},SQ *BEAN STREET COFFEE,Food & Drink,Sale,-6.50,`,
  `${d(3)},${d(3)},UBER CASH CREDIT,,Adjustment,10.00,`,
  `${d(3)},${d(3)},Payment Thank You-Mobile,,Payment,500.00,`,
].join("\n");

const upload = (path: string, csv: string, t = token, card = walletCardId) =>
  api(app)
    .post(`${V}/spending/${path}`)
    .set(bearer(t))
    .field("walletCardId", card)
    .attach("file", Buffer.from(csv), "statement.csv");
const benefits = async () =>
  (
    await api(app)
      .get(`${V}/benefits?walletCardId=${walletCardId}`)
      .set(bearer(token))
      .expect(200)
  ).body as Array<Record<string, any>>;
const byName = async (name: string) =>
  (await benefits()).find((b) => b.name === name)!;

beforeAll(async () => {
  app = await createApp();
  token = (await register(app)).token;
  other = (await register(app)).token;
  const gold = await prisma.creditCard.findUniqueOrThrow({
    where: { slug: "contoso-gold" },
  });
  const wc = await api(app)
    .post(`${V}/wallet/cards`)
    .set(bearer(token))
    .send({
      cardId: gold.id,
      approvedAt: new Date(now.getTime() - 40 * DAY).toISOString(),
    })
    .expect(201);
  walletCardId = wc.body.id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("spend tracking and automatic benefit tracking", () => {
  it("suggested rules are shown on tracked benefits", async () => {
    const dining = await byName("Dining credit");
    const ride = await byName("Rideshare credit");
    expect(dining).toMatchObject({
      autoTrack: true,
      autoRules: { keywords: [], categories: ["dining"], suggested: true },
    });
    expect(ride.autoRules).toMatchObject({
      keywords: ["uber", "lyft"],
      suggested: true,
    });
  });

  it("preview parses the statement and shows matches without saving anything", async () => {
    const p = await upload("statements/preview", STATEMENT).expect(200);
    expect(p.body).toMatchObject({
      purchasesAre: "negative",
      totals: { rows: 5, new: 5, duplicates: 0, purchasesCents: 3645 },
    });
    expect(
      p.body.rows.map(
        (r: { kind: string; benefit: { name: string } | null }) =>
          `${r.kind}:${r.benefit?.name ?? "-"}`,
      ),
    ).toEqual([
      "PURCHASE:Rideshare credit",
      "PURCHASE:Dining credit",
      "PURCHASE:Dining credit",
      "CREDIT:Rideshare credit",
      "PAYMENT:-",
    ]);
    expect(p.body.rows[1]).toMatchObject({
      merchant: "Bean Street Coffee",
      category: "dining",
    });
    expect(await prisma.transaction.count({ where: { walletCardId } })).toBe(0);
  });

  it("import updates the tracker: purchases → expected, the statement credit → confirmed; bonus spend counts purchases", async () => {
    const before = await prisma.walletCard.findUniqueOrThrow({
      where: { id: walletCardId },
    });
    const r = await upload("statements", STATEMENT).expect(201);
    expect(r.body).toMatchObject({ imported: 5, duplicates: 0, errors: 0 });
    expect(
      r.body.benefitUpdates.map(
        (u: { benefit: string; amountCents: number; status: string }) =>
          `${u.benefit}:${u.amountCents}:${u.status}`,
      ),
    ).toEqual([
      "Rideshare credit:1000:EXPECTED", // $23.45 ride, capped at the $10 monthly credit
      "Dining credit:650:EXPECTED",
      "Dining credit:350:EXPECTED", // only $3.50 left this month
      "Rideshare credit:1000:CONFIRMED", // the issuer's credit confirms the ride
    ]);
    const ride = await byName("Rideshare credit");
    expect(ride.currentPeriod).toMatchObject({
      usedCents: 1000,
      remainingCents: 0,
    });
    expect(ride.usages[0]).toMatchObject({
      amountCents: 1000,
      status: "CONFIRMED",
      source: "AUTO_PURCHASE",
      transaction: { description: "UBER   *TRIP HELP.UBER.COM CA" },
    });
    const dining = await byName("Dining credit");
    expect(dining.currentPeriod.usedCents).toBe(1000);
    const after = await prisma.walletCard.findUniqueOrThrow({
      where: { id: walletCardId },
    });
    expect(after.bonusSpendCents - before.bonusSpendCents).toBe(3645);
  });

  it("re-importing the same statement adds nothing", async () => {
    const r = await upload("statements", STATEMENT).expect(201);
    expect(r.body).toMatchObject({
      imported: 0,
      duplicates: 5,
      benefitUpdates: [],
    });
  });

  it("transactions list shows kinds and the benefits each one updated; summary counts purchases only", async () => {
    const list = (
      await api(app)
        .get(`${V}/spending/transactions?walletCardId=${walletCardId}`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(list).toHaveLength(5);
    const credit = list.find((t: { kind: string }) => t.kind === "CREDIT");
    expect(credit.benefits).toEqual([
      expect.objectContaining({
        name: "Rideshare credit",
        status: "CONFIRMED",
      }),
    ]);
    const matched = (
      await api(app)
        .get(`${V}/spending/transactions?matched=true`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(matched).toHaveLength(4);
    const unmatched = (
      await api(app)
        .get(`${V}/spending/transactions?matched=false`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(unmatched.map((t: { kind: string }) => t.kind)).toEqual(["PAYMENT"]);
    const s = (
      await api(app)
        .get(`${V}/spending/summary?days=40`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(s.totalCents).toBe(3645);
    expect(s.byCategory[0]).toMatchObject({
      category: { slug: "travel" },
      amountCents: 2345,
    }); // the bank labels Uber "Travel"
    expect(s.autoTracked).toMatchObject({
      expectedCents: 1000,
      confirmedCents: 1000,
      matches: 3,
    });
  });

  it("a wrong match can be dismissed and is never re-created; manual entries cannot be dismissed", async () => {
    const dining = await byName("Dining credit");
    const second = dining.usages.find(
      (u: { amountCents: number }) => u.amountCents === 350,
    );
    await api(app)
      .post(`${V}/benefits/usages/${second.id}/dismiss`)
      .set(bearer(other))
      .expect(404);
    await api(app)
      .post(`${V}/benefits/usages/${second.id}/dismiss`)
      .set(bearer(token))
      .expect(200);
    expect((await byName("Dining credit")).currentPeriod.usedCents).toBe(650);
    const rescan = await api(app)
      .post(`${V}/spending/rescan`)
      .set(bearer(token))
      .send({ walletCardId })
      .expect(200);
    expect(rescan.body.benefitUpdates).toEqual([]);
    const manual = await api(app)
      .post(`${V}/benefits/${dining.id}/usage`)
      .set(bearer(token))
      .send({ amountCents: 100 })
      .expect(201);
    const manualUsage = manual.body.usages.find(
      (u: { source: string }) => u.source === "MANUAL",
    );
    await api(app)
      .post(`${V}/benefits/usages/${manualUsage.id}/dismiss`)
      .set(bearer(token))
      .expect(400);
    await api(app)
      .delete(`${V}/benefits/${dining.id}/usage/${manualUsage.id}`)
      .set(bearer(token))
      .expect(204);
  });

  it("a manual statement credit confirms expected usage and records the rest", async () => {
    const r = await api(app)
      .post(`${V}/transactions`)
      .set(bearer(token))
      .send({
        walletCardId,
        amountCents: 1000,
        kind: "CREDIT",
        description: "DINING CREDIT",
      })
      .expect(201);
    expect(
      r.body.benefitUpdates.map(
        (u: { amountCents: number; status: string }) =>
          `${u.amountCents}:${u.status}`,
      ),
    ).toEqual(["650:CONFIRMED", "350:CONFIRMED"]);
    const dining = await byName("Dining credit");
    expect(dining.currentPeriod.usedCents).toBe(1000);
    expect(
      dining.usages
        .map(
          (u: { source: string; status: string }) => `${u.source}:${u.status}`,
        )
        .sort(),
    ).toEqual(["AUTO_CREDIT:CONFIRMED", "AUTO_PURCHASE:CONFIRMED"]);
  });

  it("custom rules: validated, applied by a rescan, and resettable to the suggestion; tracking can be switched off", async () => {
    const ride = await byName("Rideshare credit");
    await api(app)
      .put(`${V}/benefits/${ride.id}/auto-tracking`)
      .set(bearer(token))
      .send({ rules: { keywords: [], categories: [], creditKeywords: [] } })
      .expect(400);
    await api(app)
      .put(`${V}/benefits/${ride.id}/auto-tracking`)
      .set(bearer(token))
      .send({ rules: { categories: ["not-a-category"] } })
      .expect(400);
    await api(app)
      .put(`${V}/benefits/${ride.id}/auto-tracking`)
      .set(bearer(other))
      .send({ autoTrack: false })
      .expect(404);
    const set = await api(app)
      .put(`${V}/benefits/${ride.id}/auto-tracking`)
      .set(bearer(token))
      .send({ rules: { keywords: ["Lyft"], creditKeywords: ["lyft credit"] } })
      .expect(200);
    expect(set.body).toMatchObject({
      autoTrack: true,
      rules: {
        keywords: ["lyft"],
        creditKeywords: ["lyft credit"],
        suggested: false,
      },
      rescan: { benefitUpdates: [] },
    });
    const reset = await api(app)
      .put(`${V}/benefits/${ride.id}/auto-tracking`)
      .set(bearer(token))
      .send({ rules: null })
      .expect(200);
    expect(reset.body.rules).toMatchObject({
      keywords: ["uber", "lyft"],
      suggested: true,
    });
    const off = await api(app)
      .put(`${V}/benefits/${ride.id}/auto-tracking`)
      .set(bearer(token))
      .send({ autoTrack: false })
      .expect(200);
    expect(off.body).toMatchObject({
      autoTrack: false,
      rescan: { scanned: 0 },
    });
    const lyft = await api(app)
      .post(`${V}/transactions`)
      .set(bearer(token))
      .send({ walletCardId, amountCents: 1500, description: "LYFT RIDE" })
      .expect(201);
    expect(lyft.body.benefitUpdates).toEqual([]);
  });

  it("deleting a purchase removes the usage it created", async () => {
    const ride = await byName("Rideshare credit");
    expect(ride.currentPeriod.usedCents).toBe(1000);
    const uber = (
      await api(app)
        .get(`${V}/spending/transactions?walletCardId=${walletCardId}`)
        .set(bearer(token))
    ).body.find((t: { description: string }) =>
      /UBER   \*TRIP/.test(t.description),
    );
    await api(app)
      .delete(`${V}/transactions/${uber.id}`)
      .set(bearer(token))
      .expect(204);
    expect((await byName("Rideshare credit")).currentPeriod.usedCents).toBe(0);
  });

  it("statement upload validation and ownership", async () => {
    await upload("statements", STATEMENT, other).expect(404);
    await upload("statements", "Foo,Bar\n1,2").expect(400);
    await api(app)
      .post(`${V}/spending/statements`)
      .set(bearer(token))
      .field("walletCardId", walletCardId)
      .attach("file", Buffer.from("x"), "statement.pdf")
      .expect(400);
    await api(app)
      .post(`${V}/spending/statements`)
      .set(bearer(token))
      .field("walletCardId", walletCardId)
      .expect(400);
    await api(app).get(`${V}/spending/transactions`).expect(401);
    expect(
      (
        await api(app)
          .get(`${V}/spending/transactions`)
          .set(bearer(other))
          .expect(200)
      ).body,
    ).toEqual([]);
    await api(app)
      .post(`${V}/transactions`)
      .set(bearer(token))
      .send({
        walletCardId,
        amountCents: 100,
        categoryId: "00000000-0000-4000-8000-000000000000",
      })
      .expect(400);
  });
});

describe("PDF statements", () => {
  let pdfToken: string;
  let pdfCard: string;
  const mmdd = (day: number) => d(day).slice(0, 5);
  const closing = (() => {
    const t = new Date();
    return `${String(t.getUTCMonth() + 1).padStart(2, "0")}/${String(t.getUTCDate()).padStart(2, "0")}/${String(t.getUTCFullYear()).slice(2)}`;
  })();
  const statement = () =>
    makePdf([
      [
        "Fixture Bank Rewards Visa",
        "Account Number: XXXX XXXX XXXX 4321",
        `Opening/Closing Date ${closing} - ${closing}`,
        "PAYMENTS AND OTHER CREDITS",
        `${mmdd(3)} Payment Thank You-Mobile -500.00`,
        `${mmdd(3)} UBER CASH CREDIT 10.00`,
      ],
      [
        "PURCHASE",
        `${mmdd(1)} UBER *TRIP HELP.UBER.COM CA 23.45`,
        `${mmdd(2)} SQ *BEAN STREET COFFEE 6.50`,
        "Total fees charged $0.00",
      ],
    ]);
  const send = (path: string, buf: Buffer, name = "statement.pdf") =>
    api(app)
      .post(`${V}/spending/${path}`)
      .set(bearer(pdfToken))
      .field("walletCardId", pdfCard)
      .attach("file", buf, name);

  beforeAll(async () => {
    pdfToken = (await register(app)).token;
    const gold = await prisma.creditCard.findUniqueOrThrow({
      where: { slug: "contoso-gold" },
    });
    pdfCard = (
      await api(app)
        .post(`${V}/wallet/cards`)
        .set(bearer(pdfToken))
        .send({
          cardId: gold.id,
          approvedAt: new Date(now.getTime() - 40 * DAY).toISOString(),
        })
        .expect(201)
    ).body.id;
  });

  it("preview reads the PDF (sandboxed extractor) and matches benefits; nothing saved", async () => {
    const p = await send("statements/preview", statement()).expect(200);
    expect(p.body).toMatchObject({
      format: "pdf",
      totals: { rows: 4, new: 4, purchasesCents: 2995 },
    });
    expect(
      p.body.rows.map(
        (r: { kind: string; benefit: { name: string } | null }) =>
          `${r.kind}:${r.benefit?.name ?? "-"}`,
      ),
    ).toEqual([
      "PAYMENT:-",
      "CREDIT:Rideshare credit",
      "PURCHASE:Rideshare credit",
      "PURCHASE:Dining credit",
    ]);
    expect(JSON.stringify(p.body)).not.toMatch(/4321/); // account line is not a transaction
    expect(
      await prisma.transaction.count({ where: { walletCardId: pdfCard } }),
    ).toBe(0);
  });

  it("import stores PDF transactions and updates benefits; the same PDF again adds nothing", async () => {
    const r = await send("statements", statement()).expect(201);
    expect(r.body).toMatchObject({ imported: 4, duplicates: 0, format: "pdf" });
    expect(
      r.body.benefitUpdates.map(
        (u: { benefit: string; status: string }) => `${u.benefit}:${u.status}`,
      ),
    ).toEqual([
      "Rideshare credit:EXPECTED",
      "Dining credit:EXPECTED",
      "Rideshare credit:CONFIRMED",
    ]);
    const list = (
      await api(app)
        .get(`${V}/spending/transactions?walletCardId=${pdfCard}`)
        .set(bearer(pdfToken))
        .expect(200)
    ).body;
    expect(list.every((t: { source: string }) => t.source === "PDF")).toBe(
      true,
    );
    expect(
      (await send("statements", statement()).expect(201)).body,
    ).toMatchObject({ imported: 0, duplicates: 4 });
  });

  it("scanned, broken and oversized PDFs get clear errors", async () => {
    const scan = await send("statements/preview", makePdf([[""]])).expect(400);
    expect(scan.body.message).toMatch(/no text layer/);
    const letter = await send(
      "statements/preview",
      makePdf([
        [
          "Dear cardmember, your statement is ready online and contains more text here.",
        ],
      ]),
    ).expect(400);
    expect(letter.body.message).toMatch(/No transactions were found/);
    const broken = await send(
      "statements/preview",
      Buffer.from("%PDF-1.4 broken"),
    ).expect(400);
    expect(broken.body.message).toMatch(/not a readable PDF|could not be read/);
  });
});

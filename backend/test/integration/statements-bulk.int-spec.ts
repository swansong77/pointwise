import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { api, bearer, createApp, register } from "./helpers";
import { makePdf } from "../fixtures/make-pdf";

/**
 * Bulk statement drop: every file is matched to its card by the account digits it shows (PDF text or
 * CSV file name), unmatched files come back for a card choice, the same file is never imported twice,
 * statement rows that a bank sync already recorded are not counted again, and each card shows which
 * statements are covered. All files are synthetic.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let cardA: string; // ends 4321 (PDF)
let cardB: string; // ends 9876 (CSV file name)
let cardC: string; // no digits stored
let otherCard: string;
const now = new Date();
const DAY = 86_400_000;
const ymd = (offset: number) => {
  const x = new Date(now.getTime() - offset * DAY);
  return {
    us: `${String(x.getUTCMonth() + 1).padStart(2, "0")}/${String(x.getUTCDate()).padStart(2, "0")}/${x.getUTCFullYear()}`,
    date: new Date(
      Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()),
    ),
  };
};
const closing = `${ymd(0).us.slice(0, 6)}${ymd(0).us.slice(8)}`;
const pdf = () =>
  makePdf([
    [
      "Fixture Bank Rewards Visa",
      "Account Number: XXXX XXXX XXXX 4321",
      `Opening/Closing Date ${closing} - ${closing}`,
      "PURCHASE",
      `${ymd(2).us.slice(0, 5)} SQ *BEAN STREET COFFEE 6.50`,
      `${ymd(3).us.slice(0, 5)} FIXTURE HARDWARE STORE 41.20`,
    ],
  ]);
const csv = (rows: Array<[number, string, string]>) =>
  Buffer.from(
    [
      "Transaction Date,Description,Amount",
      ...rows.map(([off, desc, amt]) => `${ymd(off).us},${desc},${amt}`),
    ].join("\n"),
  );
const CSV_B = csv([
  [4, "FIXTURE GROCER #12", "-54.10"],
  [5, "FIXTURE FUEL 88", "-30.00"],
]);
const CSV_C = csv([[6, "FIXTURE BOOKSHOP", "-12.00"]]);

type FileSpec = [Buffer, string];
const bulk = (
  files: FileSpec[],
  assignments?: Record<string, string>,
  t = token,
) => {
  let req = api(app).post(`${V}/spending/statements/bulk`).set(bearer(t));
  for (const [buf, name] of files) req = req.attach("files", buf, name);
  if (assignments) req = req.field("assignments", JSON.stringify(assignments));
  return req;
};
const addCard = async (t: string, slug: string, lastFour?: string) => {
  const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug } });
  return (
    await api(app)
      .post(`${V}/wallet/cards`)
      .set(bearer(t))
      .send({ cardId: card.id, ...(lastFour && { lastFour }) })
      .expect(201)
  ).body.id as string;
};

beforeAll(async () => {
  app = await createApp();
  token = (await register(app)).token;
  other = (await register(app)).token;
  cardA = await addCard(token, "contoso-gold", "4321");
  cardB = await addCard(token, "northwind-voyager", "9876");
  cardC = await addCard(token, "fabrikam-double");
  otherCard = await addCard(other, "contoso-gold", "5555");
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("bulk statement import", () => {
  it("matches each file to its card by the digits it shows; unknown and unreadable files are reported", async () => {
    const r = await bulk([
      [pdf(), "October.pdf"],
      [CSV_B, "Chase9876_Activity20261101.CSV"],
      [CSV_C, "activity.csv"],
      [Buffer.from("not a statement"), "notes.txt"],
    ]).expect(200);
    const by = Object.fromEntries(
      r.body.files.map((f: { file: string }) => [f.file, f]),
    );
    expect(by["October.pdf"]).toMatchObject({
      status: "IMPORTED",
      walletCardId: cardA,
      matchedBy: "digits",
      imported: 2,
    });
    expect(by["Chase9876_Activity20261101.CSV"]).toMatchObject({
      status: "IMPORTED",
      walletCardId: cardB,
      imported: 2,
    });
    expect(by["activity.csv"]).toMatchObject({ status: "NEEDS_CARD" });
    expect(by["notes.txt"]).toMatchObject({ status: "NEEDS_CARD" });
    expect(r.body.totals).toMatchObject({
      imported: 2,
      needsCard: 2,
      transactions: 4,
    });
    expect(
      await prisma.statementImport.count({
        where: { walletCardId: { in: [cardA, cardB] } },
      }),
    ).toBe(2);
  });

  it("files sent again with a chosen card are imported; another user's card is refused", async () => {
    const r = await bulk([[CSV_C, "activity.csv"]], {
      "activity.csv": cardC,
    }).expect(200);
    expect(r.body.files[0]).toMatchObject({
      status: "IMPORTED",
      walletCardId: cardC,
      matchedBy: "choice",
      imported: 1,
    });
    const x = await bulk([[CSV_C, "activity.csv"]], {
      "activity.csv": otherCard,
    }).expect(200);
    expect(x.body.files[0]).toMatchObject({ status: "ERROR" });
    expect(
      await prisma.transaction.count({ where: { walletCardId: otherCard } }),
    ).toBe(0);
    const bad = await bulk([[CSV_C, "activity.csv"]]).field(
      "assignments",
      "[1,2]",
    );
    expect([200, 400]).toContain(bad.status);
  });

  it("the same statement file is never imported twice", async () => {
    const before = await prisma.transaction.count({
      where: { walletCardId: { in: [cardA, cardB] } },
    });
    const r = await bulk([
      [pdf(), "October (1).pdf"],
      [CSV_B, "Chase9876_Activity20261101.CSV"],
    ]).expect(200);
    expect(r.body.files.map((f: { status: string }) => f.status)).toEqual([
      "ALREADY_IMPORTED",
      "ALREADY_IMPORTED",
    ]);
    expect(
      await prisma.transaction.count({
        where: { walletCardId: { in: [cardA, cardB] } },
      }),
    ).toBe(before);
  });

  it("the same file again re-checks completeness, so a stale FAILED result is replaced and nothing is stored twice", async () => {
    const imp = await prisma.statementImport.findFirstOrThrow({ where: { walletCardId: cardA }, include: { validation: true } });
    const wasStatus = imp.validation!.status;
    await prisma.statementValidation.update({
      where: { statementImportId: imp.id },
      data: { status: "FAILED", confidence: 10, details: { notes: ["stale result from an older parser"] } },
    });
    const before = await prisma.transaction.count({ where: { walletCardId: cardA } });
    const r = await bulk([[pdf(), "October (2).pdf"]]).expect(200);
    expect(r.body.files[0].status).toBe("ALREADY_IMPORTED");
    const now = await prisma.statementValidation.findUniqueOrThrow({ where: { statementImportId: imp.id } });
    expect(now.status).toBe(wasStatus);
    expect(JSON.stringify(now.details)).not.toContain("stale result");
    expect(await prisma.transaction.count({ where: { walletCardId: cardA } })).toBe(before);
  });

  it("a statement row the bank sync already recorded is not counted again", async () => {
    const me = await prisma.walletCard.findUniqueOrThrow({
      where: { id: cardC },
      select: { wallet: { select: { userId: true } } },
    });
    await prisma.transaction.create({
      data: {
        userId: me.wallet.userId,
        walletCardId: cardC,
        amountCents: 2599,
        description: "FIXTURE PHARMACY",
        occurredAt: ymd(8).date,
        kind: "PURCHASE",
        source: "BANK",
        externalId: "plaid:fixture-1",
      },
    });
    const statement = csv([
      [7, "FIXTURE PHARMACY #4", "-25.99"], // posted a day later on the statement
      [9, "FIXTURE BAKERY", "-8.25"],
    ]);
    const r = await bulk([[statement, "november.csv"]], {
      "november.csv": cardC,
    }).expect(200);
    expect(r.body.files[0]).toMatchObject({
      status: "IMPORTED",
      imported: 1,
      duplicates: 1,
    });
    expect(
      await prisma.transaction.count({
        where: { walletCardId: cardC, amountCents: 2599 },
      }),
    ).toBe(1);
  });

  it("each card shows its statement coverage, and cards without a feed or a recent statement are flagged", async () => {
    const s = (
      await api(app).get(`${V}/capture/status`).set(bearer(token)).expect(200)
    ).body;
    const card = (id: string) =>
      s.cards.find((c: { walletCardId: string }) => c.walletCardId === id);
    expect(card(cardA).statements).toMatchObject({ statements: 1 });
    expect(card(cardA).statementDue).toBe(false);
    const fresh = await addCard(token, "fabrikam-flex", "1111");
    const s2 = (
      await api(app).get(`${V}/capture/status`).set(bearer(token)).expect(200)
    ).body;
    expect(
      s2.cards.find((c: { walletCardId: string }) => c.walletCardId === fresh),
    ).toMatchObject({ statements: null, statementDue: true });
  });

  it("limits and validation", async () => {
    await bulk([]).expect(400);
    const many: FileSpec[] = Array.from({ length: 25 }, (_, i) => [
      CSV_C,
      `f${i}.csv`,
    ]);
    const r = await bulk(many);
    expect([400, 413]).toContain(r.status);
    await api(app)
      .post(`${V}/spending/statements/bulk`)
      .attach("files", CSV_C, "a.csv")
      .expect(401);
  });
});

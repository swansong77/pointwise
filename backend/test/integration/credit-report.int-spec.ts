import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { makePdf } from "../fixtures/make-pdf";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Credit Karma credit report import: open dates onto matching wallet cards, recent cards not in the
 * wallet added for 5/24, loans skipped, existing day-level dates kept. Synthetic report text only.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let chaseCard: string;
const tag = `${Date.now() % 1_000_000}`;
const now = new Date();
const monthsAgo = (m: number) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 2));
const us = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
const recent = monthsAgo(8);
const REPORT = [
  "Credit Karma",
  "TransUnion credit report",
  "Open accounts",
  "JPMCB CARD",
  "Account type",
  "Credit card",
  "Date opened",
  "03/15/2019",
  "Account status",
  "Open",
  "Account number",
  "XXXXXXXXXXXX4321",
  "Credit limit",
  "$12,000",
  "AMEX",
  "Account type: Charge card",
  "Date opened: Jun 2021",
  "Account status: Closed",
  "Responsibility: Authorized user",
  "CAPITAL ONE",
  "Account type: Credit card",
  `Date opened: ${us(recent)}`,
  "Account status: Open",
  "Account number: ****9876",
  "Credit limit: $3,500",
  "CAPITAL ONE AUTO",
  "Account type: Auto loan",
  "Date opened: 05/01/2022",
].join("\n");

/** a preview row → an import row (only the fields the import accepts) */
const toRow = (
  a: Record<string, any>,
  action: string,
  walletCardId?: string,
  extra: Record<string, unknown> = {},
) => ({
  creditorName: a.creditorName,
  issuer: a.issuer,
  accountType: a.accountType,
  openedOn: a.openedOn,
  precision: a.precision,
  status: a.status,
  closedOn: a.closedOn,
  lastDigits: a.lastDigits,
  creditLimitCents: a.creditLimitCents,
  isAuthorizedUser: a.isAuthorizedUser,
  action,
  ...(walletCardId && { walletCardId }),
  ...extra,
});

beforeAll(async () => {
  app = await createApp();
  token = (await register(app)).token;
  other = (await register(app)).token;
  const chase = await prisma.issuer.upsert({
    where: { name: "Chase" },
    update: {},
    create: { name: "Chase", aliases: ["JPMorgan Chase"] },
  });
  const cash = await prisma.rewardCurrency.findUniqueOrThrow({
    where: { code: "CASH" },
  });
  const card = await prisma.creditCard.create({
    data: {
      slug: `test-chase-${tag}`,
      name: `Test Chase Card ${tag}`,
      issuerId: chase.id,
      network: "VISA",
      currencyId: cash.id,
    },
  });
  chaseCard = (
    await api(app)
      .post(`${V}/wallet/cards`)
      .set(bearer(token))
      .send({ cardId: card.id, lastFour: "4321" })
      .expect(201)
  ).body.id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("credit report import (Credit Karma and the three bureaus)", () => {
  let preview: {
    accounts: Array<Record<string, any>>;
    skipped: unknown[];
    bureau: string;
    source: string;
  };

  it("preview (pasted text): links by last digits, proposes adding recent cards, skips loans and old unmatched cards; nothing saved", async () => {
    const r = await api(app)
      .post(`${V}/credit-reports/import/preview`)
      .set(bearer(token))
      .send({ text: REPORT })
      .expect(200);
    preview = r.body;
    expect(preview).toMatchObject({
      bureau: "TRANSUNION",
      source: "CREDIT_KARMA_TEXT",
      skipped: [
        {
          creditorName: "CAPITAL ONE AUTO",
          reason: "not a credit card (Auto loan)",
        },
      ],
    });
    expect(
      preview.accounts.map((a) => `${a.creditorName}:${a.suggested}`),
    ).toEqual(["JPMCB CARD:LINK", "AMEX:SKIP", "CAPITAL ONE:ADD"]);
    expect(preview.accounts[0]).toMatchObject({
      openedOn: "2019-03-15",
      precision: "DAY",
      match: {
        walletCardId: chaseCard,
        by: "last digits",
        dateCheck: "MISSING",
      },
    });
    expect(preview.accounts[1]).toMatchObject({
      isAuthorizedUser: true,
      status: "CLOSED",
      precision: "MONTH",
      match: null,
    });
    expect(
      await prisma.creditReportAccount.count({
        where: { walletCard: { id: chaseCard } },
      }),
    ).toBe(0);
  });

  it("import: open date onto the linked card, a new card for 5/24, report accounts saved", async () => {
    const before = (
      await api(app).get(`${V}/five24`).set(bearer(token)).expect(200)
    ).body.members[0].status.count;
    const accounts = preview.accounts.map((a) =>
      toRow(a, a.suggested, a.match?.walletCardId),
    );
    const r = await api(app)
      .post(`${V}/credit-reports/import`)
      .set(bearer(token))
      .send({ bureau: "TRANSUNION", source: "CREDIT_KARMA_TEXT", accounts })
      .expect(200);
    expect(r.body).toEqual({
      linked: 1,
      added: 1,
      skipped: 1,
      keptExistingDate: 0,
      limitReached: 0,
      accounts: 2,
    });
    const wc = await prisma.walletCard.findUniqueOrThrow({
      where: { id: chaseCard },
    });
    expect(wc).toMatchObject({
      openDatePrecision: "DAY",
      creditLimitCents: 1200000,
    });
    expect(wc.approvedAt?.toISOString().slice(0, 10)).toBe("2019-03-15");
    const list = (
      await api(app)
        .get(`${V}/credit-reports/accounts`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(
      list
        .map(
          (a: { creditorName: string; source: string }) =>
            `${a.creditorName}:${a.source}`,
        )
        .sort(),
    ).toEqual([
      "CAPITAL ONE:CREDIT_KARMA_TEXT",
      "JPMCB CARD:CREDIT_KARMA_TEXT",
    ]);
    const cap = list.find(
      (a: { creditorName: string }) => a.creditorName === "CAPITAL ONE",
    );
    const capCard = await prisma.walletCard.findUniqueOrThrow({
      where: { id: cap.walletCardId },
      include: { card: true },
    });
    expect(capCard).toMatchObject({
      source: "CREDIT_REPORT",
      lastFour: "9876",
      status: "APPROVED",
      creditLimitCents: 350000,
    });
    expect(capCard.card).toMatchObject({
      name: "Capital One card ··9876",
      ownerId: expect.any(String),
      isActive: false,
    });
    const after = (
      await api(app).get(`${V}/five24`).set(bearer(token)).expect(200)
    ).body.members[0].status.count;
    expect(after).toBe(before + 1); // the Capital One card opened 8 months ago now counts
  });

  it("importing again updates instead of duplicating; a month-level date never replaces a day-level one", async () => {
    const again = (
      await api(app)
        .post(`${V}/credit-reports/import/preview`)
        .set(bearer(token))
        .send({ text: REPORT })
        .expect(200)
    ).body;
    expect(again.accounts[0]).toMatchObject({
      alreadyImported: true,
      match: { dateCheck: "SAME" },
    });
    const monthOnly = toRow(again.accounts[0], "LINK", chaseCard, {
      openedOn: "2019-03-01",
      precision: "MONTH",
    });
    const r = await api(app)
      .post(`${V}/credit-reports/import`)
      .set(bearer(token))
      .send({ accounts: [monthOnly] })
      .expect(200);
    expect(r.body).toMatchObject({ linked: 1, keptExistingDate: 1 });
    expect(
      (
        await prisma.walletCard.findUniqueOrThrow({ where: { id: chaseCard } })
      ).approvedAt
        ?.toISOString()
        .slice(0, 10),
    ).toBe("2019-03-15");
    const r2 = await api(app)
      .post(`${V}/credit-reports/import`)
      .set(bearer(token))
      .send({ accounts: [{ ...monthOnly, overwrite: true }] })
      .expect(200);
    expect(r2.body.keptExistingDate).toBe(0);
    expect(
      (await prisma.walletCard.findUniqueOrThrow({ where: { id: chaseCard } }))
        .openDatePrecision,
    ).toBe("MONTH");
  });

  it("a printed PDF of the report works the same (single-space label/value lines)", async () => {
    const pdf = makePdf([
      [
        "TransUnion",
        "CAPITAL ONE",
        "Account type Credit card",
        `Date opened ${us(recent)}`,
        "Account status Open",
        "Account number ****9876",
      ],
    ]);
    const r = await api(app)
      .post(`${V}/credit-reports/import/preview`)
      .set(bearer(token))
      .attach("file", pdf, "credit-karma.pdf")
      .expect(200);
    expect(r.body).toMatchObject({
      source: "BUREAU_PDF", // a bureau-style PDF (no Credit Karma branding)
      accounts: [
        expect.objectContaining({
          creditorName: "CAPITAL ONE",
          lastDigits: "9876",
          suggested: "LINK",
          match: expect.objectContaining({ by: "last digits" }),
        }),
      ],
    });
  });

  it("reports from all three bureaus at once are merged per account and remember which bureaus reported them", async () => {
    const tu = makePdf([
      [
        "TransUnion Credit Report",
        "Satisfactory Accounts",
        "JPMCB CARD #426684******",
        "Date Opened 03/15/2019",
        "Account Type Revolving Account",
        "Loan Type CREDIT CARD",
        "Pay Status Current; Paid or Paying as Agreed",
        "TOYOTA MOTOR CREDIT #7001****",
        "Date Opened 01/10/2023",
        "Loan Type AUTOMOBILE",
      ],
    ]);
    const eq = Buffer.from(
      [
        "Equifax Credit Report",
        "JPMCB CARD",
        "Account Number xxxxxxxxxxxx4321",
        "Owner Individual Account",
        "Loan Type Credit Card",
        "Date Opened 03/2019",
        "Payment History",
      ].join("\n"),
    );
    const ex = makePdf([
      [
        "Experian credit report",
        "Account name JPMCB CARD",
        "Account number 426684XXXXXX",
        "Date opened Mar 17, 2019",
        "Account type Credit card",
        "Status Open/Never late.",
      ],
    ]);
    const r = await api(app)
      .post(`${V}/credit-reports/import/preview`)
      .set(bearer(token))
      .attach("files", tu, "transunion.pdf")
      .attach("files", eq, "equifax.txt")
      .attach("files", ex, "experian.pdf")
      .expect(200);
    expect(r.body).toMatchObject({
      bureau: "MULTIPLE",
      bureaus: ["TRANSUNION", "EQUIFAX", "EXPERIAN"],
      source: "MULTIPLE",
    });
    expect(
      r.body.reports.map(
        (x: { name: string; bureau: string; accounts: number }) =>
          `${x.name}:${x.bureau}:${x.accounts}`,
      ),
    ).toEqual([
      "transunion.pdf:TRANSUNION:1",
      "equifax.txt:EQUIFAX:1",
      "experian.pdf:EXPERIAN:1",
    ]);
    expect(r.body.accounts).toHaveLength(1);
    const chase = r.body.accounts[0];
    expect(chase).toMatchObject({
      bureaus: ["TRANSUNION", "EQUIFAX", "EXPERIAN"],
      openedOn: "2019-03-15",
      precision: "DAY",
      lastDigits: "4321",
      dateConflict: null,
      match: { walletCardId: chaseCard, by: "last digits" },
    });
    expect(r.body.skipped).toEqual([
      {
        creditorName: "TOYOTA MOTOR CREDIT",
        reason: "not a credit card (AUTOMOBILE)",
      },
    ]);
    const imp = await api(app)
      .post(`${V}/credit-reports/import`)
      .set(bearer(token))
      .send({
        source: "MULTIPLE",
        accounts: [
          toRow(chase, "LINK", chaseCard, {
            bureaus: chase.bureaus,
            overwrite: true,
          }),
        ],
      })
      .expect(200);
    expect(imp.body).toMatchObject({ linked: 1, accounts: 1 });
    const saved = await prisma.creditReportAccount.findMany({
      where: { walletCardId: chaseCard },
    });
    expect(saved).toHaveLength(1); // the earlier import of this account was updated, not duplicated
    expect(saved[0].reportedBy.sort()).toEqual([
      "EQUIFAX",
      "EXPERIAN",
      "TRANSUNION",
    ]);
    expect(saved[0].source).toBe("MULTIPLE");
    await api(app)
      .post(`${V}/credit-reports/import/preview`)
      .set(bearer(token))
      .attach("files", tu, "a.pdf")
      .attach("files", tu, "b.pdf")
      .attach("files", tu, "c.pdf")
      .attach("files", tu, "d.pdf")
      .expect(400);
  });

  it("validation and ownership", async () => {
    await api(app)
      .post(`${V}/credit-reports/import/preview`)
      .set(bearer(token))
      .send({})
      .expect(400);
    const scan = await api(app)
      .post(`${V}/credit-reports/import/preview`)
      .set(bearer(token))
      .attach("file", makePdf([[""]]), "scan.pdf")
      .expect(400);
    expect(scan.body.message).toMatch(/no text layer/);
    await api(app)
      .post(`${V}/credit-reports/import/preview`)
      .set(bearer(token))
      .attach("file", Buffer.from("x"), "report.docx")
      .expect(400);
    const letter = await api(app)
      .post(`${V}/credit-reports/import/preview`)
      .set(bearer(token))
      .send({
        text: "Your credit score went up 5 points this week. Keep it up!",
      })
      .expect(400);
    expect(letter.body.message).toMatch(/No accounts were found/);
    const row = toRow(preview.accounts[0], "LINK", chaseCard);
    await api(app)
      .post(`${V}/credit-reports/import`)
      .set(bearer(other))
      .send({ accounts: [row] })
      .expect(404);
    await api(app)
      .post(`${V}/credit-reports/import`)
      .set(bearer(token))
      .send({ accounts: [{ ...row, openedOn: "2099-01-01" }] })
      .expect(400);
    await api(app)
      .post(`${V}/credit-reports/import`)
      .set(bearer(token))
      .send({ accounts: [{ ...row, action: "MAYBE" }] })
      .expect(400);
    await api(app).post(`${V}/credit-reports/import/preview`).expect(401);
  });
});

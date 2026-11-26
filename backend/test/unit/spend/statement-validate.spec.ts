import {
  joinSplitLines,
  showsNoActivity,
  looksLikeNotice,
  printedTotals,
  parseStatementPdf,
  scanStatementPdf,
} from "../../../src/domain/spend-pdf";
import { statementDigits } from "../../../src/domain/email-alerts";
import { validateStatement } from "../../../src/domain/statement-validate";

const NOW = new Date("2026-12-10T00:00:00Z");

/** Synthetic statements only — no real account data. */
const AMEX_PAGE_1 = [
  "American Express Gold Card",
  "Closing Date 12/05/26",
  "Payments and Credits",
  "11/10/26 PAYMENT RECEIVED - THANK YOU -$500.00",
  "11/12/26 DIGITAL ENTERTAINMENT CREDIT -$25.00",
  "11/14/26 UBER ONE CREDIT -$10.00",
  "New Charges",
  "11/02/26 SHAKE SHACK NEW YORK NY $18.45",
];
const AMEX_PAGE_2 = [
  "Page 2 of 3",
  "11/20/26 SAKS FIFTH AVENUE CR 50.00 CR",
  "11/21/26 GRUBHUB*ORDER 99 $27.10",
  "Total New Charges $45.55",
];
const CHASE = [
  "Statement Date: 12/05/26",
  "PURCHASE",
  "11/03 UBER *EATS HELP.UBER.COM CA 23.45",
  "11/04 AMAZON.COM*AB12C WA 41.99",
  "PAYMENTS AND OTHER CREDITS",
  "11/15 AUTOMATIC PAYMENT - THANK YOU -200.00",
  "11/25 STATEMENT CREDIT -15.00",
];

describe("TC-STM: validation engine", () => {
  it("PASS when everything on the statement was imported", () => {
    const pages = [AMEX_PAGE_1, AMEX_PAGE_2];
    const parsed = parseStatementPdf(pages, "w1", NOW);
    const scan = scanStatementPdf(pages);
    expect(parsed.rows).toHaveLength(scan.count);
    const v = validateStatement({
      statement: scan,
      imported: { count: parsed.rows.length, cents: parsed.rows.reduce((n, r) => n + r.amountCents, 0) },
    });
    expect(v).toMatchObject({ status: "PASS", confidence: 100, differenceCount: 0, missingCents: 0 });
    expect(v.notes).toEqual([]);
  });
  it("multi-page: credits keep their section across the page break", () => {
    const parsed = parseStatementPdf([AMEX_PAGE_1, AMEX_PAGE_2], "w1", NOW);
    const saks = parsed.rows.find((r) => r.description.startsWith("SAKS"))!;
    expect(saks).toMatchObject({ kind: "CREDIT", signedCents: -5000 });
    const types = Object.fromEntries(parsed.rows.map((r) => [r.description.split(" ")[0], r.kind]));
    expect(types.DIGITAL).toBe("CREDIT");
    expect(types.UBER).toBe("CREDIT");
    expect(types.SHAKE).toBe("PURCHASE");
  });
  it("Chase layout (MM/DD, no year, credits section) imports completely", () => {
    const parsed = parseStatementPdf([CHASE], "w1", NOW);
    expect(parsed.rows.map((r) => r.signedCents)).toEqual([2345, 4199, -20000, -1500]);
    expect(parsed.rows.map((r) => r.kind)).toEqual(["PURCHASE", "PURCHASE", "PAYMENT", "CREDIT"]);
    expect(scanStatementPdf([CHASE]).count).toBe(4);
  });
  it("split lines (date + merchant, city, amount) are joined and not lost", () => {
    const lines = ["11/05/26 RESY NEW YORK", "NY", "$25.00", "11/06/26 SAKS CR", "-$50.00"];
    expect(joinSplitLines(lines)).toEqual(["11/05/26 RESY NEW YORK NY $25.00", "11/06/26 SAKS CR -$50.00"]);
    expect(parseStatementPdf([lines], "w1", NOW).rows).toHaveLength(2);
  });
  it("a dated line that never gets an amount is left alone", () => {
    expect(joinSplitLines(["11/05/26 STUFF", "a very long line ".repeat(8)])).toHaveLength(2);
    expect(joinSplitLines(["11/05/26 STUFF", "11/06/26 OTHER $1.00"])).toHaveLength(2);
    expect(joinSplitLines(["11/05/26 STUFF"])).toEqual(["11/05/26 STUFF"]);
  });
  it("WARNING when one line is missed, with the amount reported", () => {
    const v = validateStatement({
      statement: { count: 40, cents: 400_000 },
      imported: { count: 39, cents: 398_000 },
    });
    expect(v.status).toBe("WARNING");
    expect(v.missingCents).toBe(2000);
    expect(v.differenceCount).toBe(1);
    expect(v.confidence).toBeLessThan(100);
    expect(v.notes.join(" ")).toMatch(/1 transaction on the statement/);
  });
  it("FAILED when many transactions are missing, none were found or lines are unreadable", () => {
    const v = validateStatement({ statement: { count: 20, cents: 200_000 }, imported: { count: 10, cents: 90_000 } });
    expect(v.status).toBe("FAILED");
    expect(v.confidence).toBeLessThanOrEqual(60);
    expect(validateStatement({ statement: { count: 0, cents: 0 }, imported: { count: 0, cents: 0 } }).status).toBe("FAILED");
    const u = validateStatement({ statement: { count: 5, cents: 5000 }, imported: { count: 5, cents: 5000 }, unreadLines: 2 });
    expect(u.status).toBe("FAILED");
    expect(u.notes.join(" ")).toMatch(/2 lines could not be read/);
  });
  it("more rows than the scan found is reported", () => {
    const v = validateStatement({ statement: { count: 3, cents: 3000 }, imported: { count: 4, cents: 3000 } });
    expect(v.differenceCount).toBe(-1);
    expect(v.notes.join(" ")).toMatch(/1 more rows were imported/);
  });
  it("a line with short trailing text after a $ amount is still read", () => {
    const pages = [["Closing Date 12/05/26", "11/05 AMAZON.COM $41.99 Rewards 41"]];
    const parsed = parseStatementPdf(pages, "w1", NOW);
    expect(parsed.rows.map((r) => r.signedCents)).toEqual([4199]);
    expect(validateStatement({ statement: scanStatementPdf(pages), imported: { count: 1, cents: 4199 } }).status).toBe("PASS");
  });
  it("an unparseable amount layout is caught by the loose scan, not silently accepted", () => {
    const pages = [["Closing Date 12/05/26", "11/05 AMAZON.COM 41.99 Rewards 41", "11/06 SHOP $3.00 note $9.00 more"]];
    const parsed = parseStatementPdf(pages, "w1", NOW);
    const v = validateStatement({
      statement: scanStatementPdf(pages),
      imported: { count: parsed.rows.length, cents: parsed.rows.reduce((n, r) => n + r.amountCents, 0) },
    });
    expect(parsed.rows).toHaveLength(0);
    expect(v.status).not.toBe("PASS");
  });

  it("Amex Pay Over Time layout: trailing diamond, detail lines under each row, Payments / Credits / New Charges sections", () => {
    const page = [
      "Platinum Card® p. 3/8",
      "A CARDMEMBER",
      "Closing Date 10/28/26 Account Ending 9-12345",
      "Payments and Credits",
      "Summary",
      "Total Payments and Credits $0.00 -$226.95 -$226.95",
      "Detail *Indicates posting date ⧫ - Pay Over Time and/or Cash Advance activity",
      "Payments Amount",
      "10/22/26* AUTOPAY PAYMENT RECEIVED - THANK YOU -$100.00",
      "Example Bank, NA",
      "Credits Amount",
      "10/16/26 Platinum Digital Entertainment Credit -$25.00 ⧫",
      "EXAMPLE *STREAMPREMIUM",
      "10/20/26 Platinum Walmart+ Credit -$13.99 ⧫",
      "Walmart+ Member 10/26 027",
      "New Charges",
      "Summary",
      "Total New Charges $0.00 $39.98 $39.98",
      "Detail ⧫ - Pay Over Time and/or Cash Advance activity",
      "Card Ending 9-12345",
      "Amount",
      "10/16/26 EXAMPLE *STREAMPREMIUM G.CO/HELPPAY# CA $25.99 ⧫",
      "CABLE & PAY TV",
      "10/20/26 Walmart+ Member 10/26 02737 8009666546 AR $13.99 ⧫",
      "8009256278",
      "Continued on reverse",
    ];
    const parsed = parseStatementPdf([page], "w1", NOW);
    expect(parsed.rows.map((r) => [r.kind, r.signedCents])).toEqual([
      ["PAYMENT", -10000],
      ["CREDIT", -2500],
      ["CREDIT", -1399],
      ["PURCHASE", 2599],
      ["PURCHASE", 1399],
    ]);
    const scan = scanStatementPdf([page]);
    expect(scan.count).toBe(5);
    const v = validateStatement({
      statement: scan,
      imported: { count: parsed.rows.length, cents: parsed.rows.reduce((n, r) => n + r.amountCents, 0) },
    });
    expect(v.status).toBe("PASS");
  });

  it("finds the account digits Amex prints with a prefix digit (Account Ending 9-12345)", () => {
    expect(statementDigits(["Platinum Card", "Closing Date 10/28/26 Account Ending 9-12345"])).toBe("12345");
    expect(statementDigits(["Card Ending 9-12345"])).toBe("12345");
    expect(statementDigits(["Account Number: XXXX XXXX XXXX 4321"])).toBe("4321");
  });

  it("two-column layout: sidebar text after the amount does not hide the transaction (Citi)", () => {
    const page = [
      "Closing Date 01/23/26",
      "Payments, Credits and Adjustments",
      "01/21 AUTOPAY 251211121044142RAUTOPAY AUTO-PMT -$500.00",
      "01/03 Example Airlines Rebate MO -$10.00 SM",
      "01/18 EXAMPLE CREDIT ==== AA Rebate MO -$200.00 6X, otherwise 3X) +672",
      "Standard Purchases",
      "12/22 12/24 EXAMPLE PARKING 51 CAMPBELL CA $6.58 » Visit example.com",
      "12/30 12/30 EXAMPLE KABOB & GRILL CLEVELAND OH $124.00 full rewards details",
      "01/15 01/15 EXAMPLEAIR0012306728318 PHOENIX AZ $871.03",
    ];
    const parsed = parseStatementPdf([page], "w1", new Date("2026-02-01T00:00:00Z"));
    expect(parsed.rows.map((r) => r.signedCents)).toEqual([-50000, -1000, -20000, 658, 12400, 87103]);
    expect(parsed.rows.map((r) => r.kind)).toEqual(["PAYMENT", "CREDIT", "CREDIT", "PURCHASE", "PURCHASE", "PURCHASE"]);
    expect(scanStatementPdf([page]).count).toBe(6);
  });

  it("a description's own numbers are not mistaken for the amount when text follows", () => {
    // two dollar amounts after the description: not read by the fallback (the scan still counts it, so validation flags it)
    const page = ["Closing Date 01/23/26", "01/15 SOME SHOP $10.00 balance $99.00 note"];
    expect(parseStatementPdf([page], "w1", NOW).rows).toHaveLength(0);
    expect(scanStatementPdf([page]).count).toBe(1);
  });

  it("a statement with no activity passes instead of failing, a zero-dollar fee line is not a transaction", () => {
    const page = [
      "New balance as of 07/09/26: $0.00",
      "Previous balance $0.00",
      "07/09 MEMBERSHIP FEE JUL 26-JUN 27 $0.00",
      "Total fees charged in this billing period $0.00",
    ];
    const parsed = parseStatementPdf([page], "w1", NOW);
    expect(parsed.rows).toHaveLength(0);
    expect(parsed.errors).toEqual([]);
    expect(showsNoActivity([page])).toBe(true);
    const v = validateStatement({ statement: scanStatementPdf([page]), imported: { count: 0, cents: 0 }, noActivity: showsNoActivity([page]) });
    expect(v.status).toBe("PASS");
    expect(v.notes[0]).toMatch(/no activity/);
    expect(showsNoActivity([["Statement Balance as of 12/04/25 = $0.00", "No Transaction Activity at This Time $0.00"]])).toBe(true);
    // a balance carried in means the statement is not empty even with no rows parsed
    expect(showsNoActivity([["New balance $0.00", "Previous balance $177.97"]])).toBe(false);
    expect(validateStatement({ statement: { count: 0, cents: 0 }, imported: { count: 0, cents: 0 } }).status).toBe("FAILED");
  });

  const check = (pages: string[][]) => {
    const parsed = parseStatementPdf(pages, "w1", new Date("2026-02-01T00:00:00Z"));
    return {
      parsed,
      v: validateStatement({
        statement: scanStatementPdf(pages),
        imported: { count: parsed.rows.length, cents: parsed.rows.reduce((n, r) => n + r.amountCents, 0) },
        unreadLines: parsed.errors.length,
        printed: (() => {
          const t = printedTotals(pages);
          return (
            t && {
              ...t,
              rowCredits: Math.abs(parsed.rows.filter((r) => r.signedCents < 0).reduce((n, r) => n + r.signedCents, 0)),
              rowCharges: parsed.rows.filter((r) => r.signedCents > 0).reduce((n, r) => n + r.signedCents, 0),
            }
          );
        })(),
      }),
    };
  };

  it("sidebar digits before or glued to the date do not hide a transaction (two-column layouts)", () => {
    const { parsed, v } = check([
      [
        "Previous balance $0.00",
        "Purchases +$63.21",
        "Standard Purchases",
        "963700 12/22 12/24 EXAMPLE FAIR #3 ERIE PA $44.76 to redeem points",
        "96370010/10 10/10 EXAMPLE CHARGER US example.com CA $18.45",
      ],
    ]);
    expect(parsed.rows.map((r) => r.signedCents)).toEqual([4476, 1845]);
    expect(parsed.rows.map((r) => r.occurredAt.toISOString().slice(5, 10))).toEqual(["12-22", "10-10"]);
    expect(v.status).toBe("PASS");
  });

  it("a fee row whose amount sits below interleaved sidebar lines is joined; summary lines are never joined in", () => {
    const { parsed, v } = check([
      [
        "Previous balance $0.00",
        "Purchases +$159.28",
        "Fees +$95.00",
        "Standard Purchases",
        "06/01 06/01 EXAMPLE STORE #9 NC $159.28 Points Earned",
        "Fees charged",
        "06/03 MEMBERSHIP FEE JUN 25-MAY 26",
        "3X Air Travel & Hotels + 0",
        "SEE REVERSE FOR MORE RENEWAL INFORMATION $95.00 Citi Travel",
        "Total fees charged in this billing period $95.00",
      ],
    ]);
    expect(parsed.rows.map((r) => [r.kind, r.signedCents])).toEqual([["PURCHASE", 15928], ["FEE", 9500]]);
    expect(v.status).toBe("PASS");
    // a foreign-currency note with a date but no amount must not swallow the year-to-date totals line
    const fx = parseStatementPdf([["06/17 EXAMPLE RESORT CANCUN 19.90", "06/18 MEXICAN PESO", "341.60 X 0.058 (EXCHG RATE)", "2026 Totals Year-to-Date", "Total fees charged in 2026 $95.00"]], "w1", new Date("2026-07-01T00:00:00Z"));
    expect(fx.rows.map((r) => r.signedCents)).toEqual([1990]);
  });

  it("headings: legal text starting with Payments is not a section, but a real heading with sidebar text is", () => {
    const { parsed } = check([
      [
        "Payments Other Than By Mail",
        "Payments: Your payment must be sent to the address shown on your statement",
        "Standard Purchases changes may affect your ability to use points",
        "11/23 11/23 EXAMPLE SHOP OH $3.09",
        "Payments, Credits and Adjustments",
        "12/10 AUTOPAY AUTO-PMT -$63.17 much more",
        "Standard Purchases changes may affect your ability",
        "12/11 12/11 EXAMPLE CAFE OH $5.00",
      ],
    ]);
    expect(parsed.rows.map((r) => r.signedCents)).toEqual([309, -6317, 500]);
  });

  it("a statement that prints totals its rows cannot explain is flagged", () => {
    const { v } = check([["Previous balance $0.00", "Payments -$10.00", "Purchases +$100.00", "Fees +$0.00", "11/05 EXAMPLE SHOP $60.00", "11/06 EXAMPLE PAYMENT THANK YOU -$10.00"]]);
    expect(v.status).not.toBe("PASS");
    expect(v.notes.join(" ")).toMatch(/prints charges of 100\.00 but the imported rows total 60\.00/);
  });

  it("amounts under a dollar without a leading zero (.79) are read", () => {
    const { parsed, v } = check([["Purchases +$10.79", "04/03 EXAMPLE BOOKSHOP OH .79", "04/04 EXAMPLE SHOP OH 10.00"]]);
    expect(parsed.rows.map((r) => r.signedCents)).toEqual([79, 1000]);
    expect(v.status).toBe("PASS");
  });

  it("no activity with a credit balance carried in passes; an account notice is recognised", () => {
    const quiet = [["New Balance CR$100.00", "Previous Balance CR$100.00", "Payments/Credits -$0.00", "New Charges +$0.00"]];
    expect(showsNoActivity(quiet)).toBe(true);
    expect(looksLikeNotice([["We are writing to provide you with an important notice regarding the account referenced above."]])).toBe(true);
    expect(looksLikeNotice([["IMPORTANT NOTICES", "New Balance $12.13"]])).toBe(false);
  });
});

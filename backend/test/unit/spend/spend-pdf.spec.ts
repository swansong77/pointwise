import {
  cleanDescription,
  findPeriod,
  isProse,
  printedTotals,
  scanStatementPdf,
  parseAmountToken,
  parseFullDate,
  parseStatementPdf,
  resolveDate,
} from "../../../src/domain/spend-pdf";
import { extractPdfLines } from "../../../src/spend/pdf-extract";
import { makePdf } from "../../fixtures/make-pdf";

/** PDF card statements: period / year handling, amount signs, sections, layouts, and the sandboxed extractor. Synthetic data only. */
const NOW = new Date("2026-11-29T12:00:00Z");
const iso = (d: Date | null) => d?.toISOString().slice(0, 10);

describe("statement period, dates and amounts", () => {
  it("finds the period or closing date in common wordings", () => {
    const p = findPeriod(["Opening/Closing Date 10/15/26 - 11/14/26"]);
    expect([iso(p.start), iso(p.end)]).toEqual(["2026-10-15", "2026-11-14"]);
    expect(
      iso(findPeriod(["Billing Period: Nov 15, 2026 - Dec 14, 2026"]).end),
    ).toBe("2026-12-14");
    expect(
      iso(findPeriod(["Statement Period 12/15/2026 to 01/14/2027"]).end),
    ).toBe("2027-01-14");
    expect(iso(findPeriod(["Closing Date 11/14/26"]).end)).toBe("2026-11-14");
    expect(findPeriod(["nothing here"])).toEqual({ start: null, end: null });
    expect(parseFullDate("February 30, 2026")).toBeNull();
  });
  it("gives MM/DD dates the statement year (previous year for December on a January statement)", () => {
    const jan = { start: null, end: new Date("2027-01-14T00:00:00Z") };
    expect(iso(resolveDate("12/20", jan, NOW))).toBe("2026-12-20");
    expect(iso(resolveDate("01/03", jan, NOW))).toBe("2027-01-03");
    expect(iso(resolveDate("Dec 2", jan, NOW))).toBe("2026-12-02");
    expect(iso(resolveDate("11/02/26*", jan, NOW))).toBe("2026-11-02");
    expect(iso(resolveDate("11/20", { start: null, end: null }, NOW))).toBe(
      "2026-11-20",
    );
    expect(iso(resolveDate("12/20", { start: null, end: null }, NOW))).toBe(
      "2025-12-20",
    );
    expect(resolveDate("13/40", jan, NOW)).toBeNull();
  });
  it("reads amounts and credit markers", () => {
    expect(parseAmountToken("23.45")).toBe(2345);
    expect(parseAmountToken("$1,234.56")).toBe(123456);
    expect(parseAmountToken("-$10.00")).toBe(-1000);
    expect(parseAmountToken("($10.00)")).toBe(-1000);
    expect(parseAmountToken("10.00 CR")).toBe(-1000);
    expect(parseAmountToken("10.00-")).toBe(-1000);
    expect(parseAmountToken("abc")).toBeNull();
  });
  it("cleans reference / account columns and never keeps long numbers", () => {
    expect(cleanDescription("UBER *TRIP 24692163X5JZ7 1234")).toBe(
      "UBER *TRIP",
    );
    expect(cleanDescription("TRANSFER FROM 4111111111111111")).toBe(
      "TRANSFER FROM",
    );
    expect(cleanDescription("REF 4111111111111111 ONLINE")).toBe(
      "REF … ONLINE",
    );
    expect(cleanDescription("  SQ *BEAN  STREET ")).toBe("SQ *BEAN STREET");
  });
});

describe("parseStatementPdf", () => {
  it("Chase-style: sections set the sign; summary lines are skipped; dedupe keys are stable", () => {
    const pages = [
      [
        "Fixture Bank Visa",
        "Account Number: XXXX XXXX XXXX 1234",
        "Opening/Closing Date 10/15/26 - 11/14/26",
        "New Balance $1,234.56",
        "ACCOUNT ACTIVITY",
        "Date of Transaction Merchant Name or Transaction Description $ Amount",
        "PAYMENTS AND OTHER CREDITS",
        "11/06 Payment Thank You-Mobile -500.00",
        "11/05 UBER CASH CREDIT 10.00",
      ],
      [
        "PURCHASE",
        "11/02 UBER *TRIP HELP.UBER.COM CA 23.45",
        "10/28 SQ *BEAN STREET COFFEE 6.50",
        "10/28 SQ *BEAN STREET COFFEE 6.50",
        "11/14/26 New Balance $1,234.56",
        "Total fees charged in 2026 $0.00",
        "INTEREST CHARGES",
        "Purchases 21.49%(v)(d) $0.00",
      ],
    ];
    const p = parseStatementPdf(pages, "wc1", NOW);
    expect(
      p.rows.map(
        (r) =>
          `${iso(r.occurredAt)} ${r.kind} ${r.amountCents} ${r.description}`,
      ),
    ).toEqual([
      "2026-11-06 PAYMENT 50000 Payment Thank You-Mobile",
      "2026-11-05 CREDIT 1000 UBER CASH CREDIT", // printed positive, but in the credits section
      "2026-11-02 PURCHASE 2345 UBER *TRIP HELP.UBER.COM CA",
      "2026-10-28 PURCHASE 650 SQ *BEAN STREET COFFEE",
      "2026-10-28 PURCHASE 650 SQ *BEAN STREET COFFEE",
    ]);
    const keys = p.rows.map((r) => r.externalId);
    expect(new Set(keys).size).toBe(5);
    expect(
      parseStatementPdf(pages, "wc1", NOW).rows.map((r) => r.externalId),
    ).toEqual(keys);
    expect(keys[0]).toMatch(/^pdf:/);
  });
  it("Amex-style: full dates with * marker, $ amounts, minus credits", () => {
    const p = parseStatementPdf(
      [
        [
          "Closing Date 11/14/26",
          "Credits",
          "11/05/26 Platinum Uber Cash Credit -$15.00",
          "New Charges",
          "11/02/26* UBER TRIP HELP.UBER.COM CA $23.45",
          "11/03/26 DOORDASH*PASTA PALACE SAN FRANCISCO CA $32.10",
        ],
      ],
      "wc",
      NOW,
    );
    expect(p.rows.map((r) => `${r.kind}:${r.amountCents}`)).toEqual([
      "CREDIT:1500",
      "PURCHASE:2345",
      "PURCHASE:3210",
    ]);
  });
  it("Capital One-style month names with two dates; CR suffix", () => {
    const p = parseStatementPdf(
      [
        [
          "Billing Period: Nov 15, 2026 - Dec 14, 2026",
          "Transactions",
          "Dec 2 Dec 3 LYFT *RIDE SAN FRANCISCO CA $18.00",
          "Nov 20 Nov 21 LYFT RIDE CREDIT $10.00 CR",
        ],
      ],
      "wc",
      NOW,
    );
    expect(
      p.rows.map((r) => `${iso(r.occurredAt)} ${r.kind} ${r.amountCents}`),
    ).toEqual(["2026-12-02 PURCHASE 1800", "2026-11-20 CREDIT 1000"]);
  });
  it("Bank of America-style: reference and account columns; December rows on a January statement", () => {
    const p = parseStatementPdf(
      [
        [
          "Statement Period 12/15/2026 - 01/14/2027",
          "Purchases and Adjustments",
          "12/20 12/21 UBER *TRIP 24692163X5JZ7 1234 23.45",
          "01/03 01/04 WHOLE FOODS MARKET 10234 88123456ABCD 5678 54.20",
        ],
      ],
      "wc",
      NOW,
    );
    expect(p.rows.map((r) => `${iso(r.occurredAt)} ${r.description}`)).toEqual([
      "2026-12-20 UBER *TRIP",
      "2027-01-03 WHOLE FOODS MARKET 10234",
    ]);
    expect(p.period.end?.toISOString().slice(0, 10)).toBe("2027-01-14");
  });
  it("text without transactions gives no rows", () => {
    expect(
      parseStatementPdf(
        [["Dear cardmember,", "Your statement is ready."]],
        "wc",
        NOW,
      ).rows,
    ).toEqual([]);
  });
});

describe("sandboxed PDF extractor", () => {
  it("rebuilds lines from a real PDF, page by page", async () => {
    const pdf = makePdf([
      [
        "Opening/Closing Date 10/15/26 - 11/14/26",
        "11/02 UBER *TRIP HELP.UBER.COM CA 23.45",
      ],
      ["PAYMENTS AND OTHER CREDITS (page 2)"],
    ]);
    const pages = await extractPdfLines(pdf);
    expect(pages).toEqual([
      [
        "Opening/Closing Date 10/15/26 - 11/14/26",
        "11/02 UBER *TRIP HELP.UBER.COM CA 23.45",
      ],
      ["PAYMENTS AND OTHER CREDITS (page 2)"],
    ]);
  }, 30_000);
  it("rejects non-PDFs, too many pages and slow files with clear messages", async () => {
    await expect(extractPdfLines(Buffer.from("not a pdf"))).rejects.toThrow(
      /not a readable PDF/,
    );
    await expect(
      extractPdfLines(makePdf([["a"], ["b"], ["c"]]), { maxPages: 2 }),
    ).rejects.toThrow(/too many pages/);
    await expect(
      extractPdfLines(makePdf([["a"]]), { timeoutMs: 1 }),
    ).rejects.toThrow(/too long/);
  }, 30_000);
});

describe("two-column summary pages (Capital One layout, synthetic)", () => {
  // the left column's sentence starts with a date and shares its line with the right column's "Payments" figure
  const PAGES = [
    [
      "Payment Information Account Summary",
      "Previous Balance $100.00",
      "Sep 12, 2026 or later you will pay the late fee and the interest owed on the account Payments - $50.00",
      "Transactions + $20.00",
      "Fees Charged + $0.00",
      "Interest Charged + $0.00",
      "New Balance = $70.00",
    ],
    [
      "Transactions",
      "Trans Date Post Date Description Amount",
      "Aug 10 Aug 11 PAYMENT THANK YOU - $50.00",
      "Trans Date Post Date Description Amount",
      "Aug 14 Aug 15 EXAMPLE STORE 800-555-0100 CA $20.00",
    ],
  ];
  it("does not read a date-led sentence as a transaction, so the payment is counted once", () => {
    const p = parseStatementPdf(PAGES, "w", NOW);
    expect(p.rows.map((r) => r.signedCents)).toEqual([-5000, 2000]);
    expect(scanStatementPdf(PAGES).count).toBe(2);
  });
  it("knows the summary's \"Transactions\" line as the printed charges", () => {
    const t = printedTotals(PAGES)!;
    expect(t.charges).toContain(2000);
    expect(t.credits).toContain(5000);
  });
  it("tells prose from merchant descriptors", () => {
    expect(isProse("or later you will pay the late fee and the interest owed")).toBe(true);
    expect(isProse("UBER *TRIP HELP.UBER.COM CA")).toBe(false);
    expect(isProse("Amazon Prime Video Digital Purchase")).toBe(false);
    expect(isProse("amazon.com/bill wa")).toBe(false);
  });

  it("does not read a date joined to a bare summary label as a transaction (a one-word variant of the same page)", () => {
    const pages = [
      ["Account Summary", "Jan 22, 2025 Payments - $50.00", "Transactions + $20.00", "New Balance = $70.00"],
      PAGES[1],
    ];
    const p = parseStatementPdf(pages, "w", NOW);
    expect(p.rows.map((r) => r.signedCents)).toEqual([-5000, 2000]);
    expect(scanStatementPdf(pages).count).toBe(2);
    expect(isProse("Payments")).toBe(true);
    expect(isProse("Other Credits")).toBe(true);
    // real descriptions that merely contain such a word are not labels
    expect(isProse("PAYMENT THANK YOU")).toBe(false);
    expect(isProse("Payments to Contractor LLC")).toBe(false);
  });
});

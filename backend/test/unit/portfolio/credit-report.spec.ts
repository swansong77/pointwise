import {
  issuerFor,
  mergeReports,
  parseCreditReport,
} from "../../../src/domain/credit-report";

/** Credit Karma credit report text → card tradelines (synthetic report text only). */
const NOW = new Date("2026-11-30T12:00:00Z");
const iso = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

describe("parseCreditReport", () => {
  it("label / value on separate lines (copied text), on one line (printed PDF), and with colons", () => {
    const lines = [
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
      "Responsibility",
      "Individual",
      "Credit limit",
      "$12,000",
      "AMEX",
      "Account type: Charge card",
      "Date opened: Jun 2023",
      "Account status: Closed",
      "Date closed: Jan 15, 2025",
      "Responsibility: Authorized user",
      "Closed accounts",
      "CAPITAL ONE",
      "Account type Credit card",
      "Date opened Mar 2, 2025",
      "Account status Paid, closed",
      "Account number ****9876",
      "Credit limit $3,500",
    ];
    const r = parseCreditReport(lines, NOW);
    expect(r.bureau).toBe("TRANSUNION");
    expect(r.skipped).toEqual([]);
    expect(
      r.accounts.map((a) => [
        a.creditorName,
        a.issuer,
        iso(a.openedOn),
        a.precision,
        a.status,
        iso(a.closedOn),
        a.lastDigits,
        a.creditLimitCents,
        a.isAuthorizedUser,
      ]),
    ).toEqual([
      [
        "JPMCB CARD",
        "Chase",
        "2019-03-15",
        "DAY",
        "OPEN",
        null,
        "4321",
        1200000,
        false,
      ],
      [
        "AMEX",
        "American Express",
        "2023-06-01",
        "MONTH",
        "CLOSED",
        "2025-01-15",
        null,
        null,
        true,
      ],
      [
        "CAPITAL ONE",
        "Capital One",
        "2025-03-02",
        "DAY",
        "CLOSED",
        null,
        "9876",
        350000,
        false,
      ],
    ]);
  });

  it("summary rows; loans and accounts without dates are skipped with a reason; duplicates collapse", () => {
    const r = parseCreditReport(
      [
        "Equifax",
        "CITI 02/10/2024 Open $7,500",
        "SYNCB/AMAZON 11/2023 Closed",
        "CITI 02/10/2024 Open $7,500",
        "CAPITAL ONE AUTO",
        "Account type Auto loan",
        "Date opened 05/01/2022",
        "NAVIENT",
        "Account type Student loan",
        "Date opened 09/01/2015",
        "MYSTERY LENDER",
        "Account status Open",
        "DISCOVER BANK",
        "Account type Revolving",
        "Date opened 2027-01-01",
      ],
      NOW,
    );
    expect(r.bureau).toBe("EQUIFAX");
    expect(
      r.accounts.map(
        (a) =>
          `${a.creditorName} ${iso(a.openedOn)} ${a.precision} ${a.status}`,
      ),
    ).toEqual([
      "CITI 2024-02-10 DAY OPEN",
      "SYNCB/AMAZON 2023-11-01 MONTH CLOSED",
    ]);
    expect(r.skipped).toEqual([
      {
        creditorName: "CAPITAL ONE AUTO",
        reason: "not a credit card (Auto loan)",
      },
      { creditorName: "NAVIENT", reason: "not a credit card (Student loan)" },
      { creditorName: "MYSTERY LENDER", reason: "no open date" },
      {
        creditorName: "DISCOVER BANK",
        reason: 'unreadable open date "2027-01-01"',
      },
    ]);
  });

  it("maps bureau creditor names to issuers", () => {
    expect(issuerFor("JPMCB CARD SERVICES")).toBe("Chase");
    expect(issuerFor("CBNA")).toBe("Citi");
    expect(issuerFor("BK OF AMER")).toBe("Bank of America");
    expect(issuerFor("WF CRD SVC")).toBe("Wells Fargo");
    expect(issuerFor("US BANK")).toBe("U.S. Bank");
    expect(issuerFor("BRCLYSBANKDE")).toBe("Barclays");
    expect(issuerFor("GS BANK USA")).toBe("Goldman Sachs");
    expect(issuerFor("LOCAL CREDIT UNION")).toBeNull();
  });
});

// synthetic layouts in the style of each bureau's own report (annualcreditreport.com / bureau sites)
const TU = [
  "TransUnion Credit Report",
  "Satisfactory Accounts",
  "JPMCB CARD #426684******",
  "Date Opened 03/15/2019",
  "Responsibility Individual Account",
  "Account Type Revolving Account",
  "Loan Type CREDIT CARD",
  "Balance $1,234",
  "Date Updated 10/31/2026",
  "Pay Status Current; Paid or Paying as Agreed",
  "Credit Limit $12,000",
  "CAPITAL ONE #517805******",
  "Date Opened 04/02/2025",
  "Responsibility Individual Account",
  "Account Type Revolving Account",
  "Loan Type CREDIT CARD",
  "Date Closed 09/30/2026",
  "Remarks CLOSED BY CONSUMER",
  "TOYOTA MOTOR CREDIT #7001****",
  "Date Opened 01/10/2023",
  "Account Type Installment Account",
  "Loan Type AUTOMOBILE",
];
const EQ = [
  "Equifax Credit Report",
  "Revolving Accounts",
  "JPMCB CARD",
  "Account Number xxxxxxxxxxxx4321",
  "Owner Individual Account",
  "Loan Type Credit Card",
  "Date Opened 03/2019",
  "Account Status PAYS_AS_AGREED",
  "High Credit $12,000",
  "Payment History",
  "CITI CARDS CBNA",
  "Account Number *5555",
  "Owner Authorized User",
  "Loan Type Credit Card",
  "Date Opened 06/10/2024",
  "Account Status CLOSED",
];
const EX = [
  "Experian credit report",
  "Account name JPMCB CARD",
  "Account number 426684XXXXXX",
  "Date opened Mar 17, 2019",
  "Account type Credit card",
  "Status Open/Never late.",
  "Responsibility Individual",
  "Account name CAPITAL ONE BANK USA NA",
  "Account number 517805XXXXXX",
  "Date opened May 2, 2025",
  "Account type Credit card",
  "Status Closed.",
];

describe("bureau layouts", () => {
  it("TransUnion: masked number in the heading, account + loan type, pay status, remarks; auto loan skipped", () => {
    const r = parseCreditReport(TU, NOW);
    expect([r.bureau, r.provider]).toEqual(["TRANSUNION", "BUREAU"]);
    expect(
      r.accounts.map((a) => [
        a.creditorName,
        a.lastDigits,
        a.status,
        a.creditLimitCents,
      ]),
    ).toEqual([
      ["JPMCB CARD", null, "OPEN", 1200000], // "426684******" shows the first digits, not the last
      ["CAPITAL ONE", null, "CLOSED", null],
    ]);
    expect(r.accounts[0].accountType).toBe("CREDIT CARD / Revolving Account");
    expect(r.skipped).toEqual([
      {
        creditorName: "TOYOTA MOTOR CREDIT",
        reason: "not a credit card (AUTOMOBILE / Installment Account)",
      },
    ]);
  });
  it("Equifax: owner, loan type, month-only dates, last digits", () => {
    const r = parseCreditReport(EQ, NOW);
    expect(r.bureau).toBe("EQUIFAX");
    expect(
      r.accounts.map((a) => [
        a.creditorName,
        a.issuer,
        iso(a.openedOn),
        a.precision,
        a.lastDigits,
        a.isAuthorizedUser,
        a.status,
      ]),
    ).toEqual([
      ["JPMCB CARD", "Chase", "2019-03-01", "MONTH", "4321", false, "OPEN"],
      ["CITI CARDS CBNA", "Citi", "2024-06-10", "DAY", "5555", true, "CLOSED"],
    ]);
  });
  it("Experian: account-name blocks; first-digit masks ignored", () => {
    const r = parseCreditReport(EX, NOW);
    expect(r.bureau).toBe("EXPERIAN");
    expect(
      r.accounts.map(
        (a) =>
          `${a.creditorName} ${iso(a.openedOn)} ${a.lastDigits} ${a.status}`,
      ),
    ).toEqual([
      "JPMCB CARD 2019-03-17 null OPEN",
      "CAPITAL ONE BANK USA NA 2025-05-02 null CLOSED",
    ]);
  });
  it("Credit Karma is recognised as the provider", () => {
    expect(
      parseCreditReport(
        [
          "Credit Karma",
          "TransUnion",
          "AMEX",
          "Date opened 01/02/2024",
          "Account type Credit card",
        ],
        NOW,
      ).provider,
    ).toBe("CREDIT_KARMA");
  });
});

describe("mergeReports (three bureaus)", () => {
  const m = mergeReports([
    parseCreditReport(TU, NOW),
    parseCreditReport(EQ, NOW),
    parseCreditReport(EX, NOW),
  ]);
  it("one entry per account with the bureaus that report it; most precise, earliest date; digits from any bureau", () => {
    expect(m.bureaus).toEqual(["TRANSUNION", "EQUIFAX", "EXPERIAN"]);
    expect(
      m.accounts.map((a) => [
        a.issuer,
        a.bureaus,
        iso(a.openedOn),
        a.precision,
        a.lastDigits,
        a.status,
      ]),
    ).toEqual([
      [
        "Chase",
        ["TRANSUNION", "EQUIFAX", "EXPERIAN"],
        "2019-03-15",
        "DAY",
        "4321",
        "OPEN",
      ],
      [
        "Capital One",
        ["TRANSUNION", "EXPERIAN"],
        "2025-04-02",
        "DAY",
        null,
        "CLOSED",
      ],
      ["Citi", ["EQUIFAX"], "2024-06-10", "DAY", "5555", "CLOSED"],
    ]);
  });
  it("bureaus disagreeing on the open month are flagged; same month is not a conflict", () => {
    expect(m.accounts[0].dateConflict).toBeNull();
    expect(m.accounts[1].dateConflict).toEqual({
      TRANSUNION: "2025-04-02",
      EXPERIAN: "2025-05-02",
    });
    expect(m.skipped).toEqual([
      {
        creditorName: "TOYOTA MOTOR CREDIT",
        reason: "not a credit card (AUTOMOBILE / Installment Account)",
      },
    ]);
  });
  it("different last digits are different accounts, and one bureau never merges two of its own accounts", () => {
    const a = parseCreditReport(
      [
        "Equifax",
        "JPMCB CARD",
        "Account Number *1111",
        "Loan Type Credit Card",
        "Date Opened 03/15/2019",
        "JPMCB CARD",
        "Account Number *2222",
        "Loan Type Credit Card",
        "Date Opened 03/20/2019",
      ],
      NOW,
    );
    expect(mergeReports([a]).accounts.map((x) => x.lastDigits)).toEqual([
      "1111",
      "2222",
    ]);
  });
});

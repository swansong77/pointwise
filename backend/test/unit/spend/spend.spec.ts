import {
  classify,
  effectiveRules,
  mapBankCategory,
  matchBenefit,
  matchMerchant,
  normalizeDescriptor,
  parseStatement,
  sanitizeRules,
  StatementError,
  suggestRules,
} from "../../../src/domain/spend";

/** Spend tracking: descriptors, classification, statement parsing, rule suggestion and benefit matching. */
describe("descriptors and classification", () => {
  it("normalises processor prefixes, store numbers and punctuation", () => {
    expect(normalizeDescriptor("UBER   *TRIP HELP.UBER.COM CA 1234567")).toBe(
      "uber trip help uber com ca",
    );
    expect(normalizeDescriptor("SQ *BEAN STREET COFFEE #0042")).toBe(
      "bean street coffee",
    );
    expect(normalizeDescriptor("TST* PASTA PALACE 88123")).toBe("pasta palace");
    expect(normalizeDescriptor(null)).toBe("");
  });
  it("classifies by sign and descriptor", () => {
    expect(classify("UBER TRIP", 2345)).toBe("PURCHASE");
    expect(classify("ANNUAL MEMBERSHIP FEE", 32500)).toBe("FEE");
    expect(classify("INTEREST CHARGE ON PURCHASES", 1200)).toBe("FEE");
    expect(classify("AUTOPAY PAYMENT - THANK YOU", -50000)).toBe("PAYMENT");
    expect(classify("UBER CASH CREDIT", -1000)).toBe("CREDIT");
    expect(classify("Dining Credit", -1000)).toBe("CREDIT");
    expect(classify("AMAZON.COM RETURN", -2599)).toBe("REFUND");
  });
  it("maps bank and Plaid categories", () => {
    expect(mapBankCategory("Food & Drink")).toBe("dining");
    expect(mapBankCategory("Restaurant-Restaurant")).toBe("dining");
    expect(mapBankCategory("FOOD_AND_DRINK_GROCERIES")).toBe("groceries");
    expect(mapBankCategory("TRANSPORTATION_TAXIS_AND_RIDE_SHARES")).toBe(
      "transit",
    );
    expect(mapBankCategory("TRAVEL_FLIGHTS")).toBe("airlines");
    expect(mapBankCategory("Travel-Lodging")).toBe("hotels");
    expect(mapBankCategory("Gas")).toBe("gas");
    expect(mapBankCategory("Merchandise")).toBeNull();
    expect(mapBankCategory(null)).toBeNull();
  });
});

describe("parseStatement", () => {
  const chase = [
    "Transaction Date,Post Date,Description,Category,Type,Amount,Memo",
    "11/02/2026,11/03/2026,UBER   *TRIP HELP.UBER.COM CA,Travel,Sale,-23.45,",
    "11/05/2026,11/05/2026,UBER CASH CREDIT,,Adjustment,10.00,",
    "11/06/2026,11/06/2026,Payment Thank You-Mobile,,Payment,500.00,",
    "11/07/2026,11/08/2026,SQ *BEAN STREET COFFEE,Food & Drink,Sale,-6.50,",
    "11/07/2026,11/08/2026,SQ *BEAN STREET COFFEE,Food & Drink,Sale,-6.50,",
    "bad date,,X,,Sale,-1.00,",
    "11/09/2026,,,,Sale,,",
  ].join("\n");

  it("Chase-style: purchases negative → detected from payments; kinds, categories, errors", () => {
    const p = parseStatement(chase, "wc1");
    expect(p.purchasesAre).toBe("negative");
    expect(p.columns).toEqual({
      date: "Transaction Date",
      description: "Description",
      amount: "Amount",
      category: "Category",
    });
    expect(p.rows.map((r) => `${r.kind}:${r.amountCents}`)).toEqual([
      "PURCHASE:2345",
      "CREDIT:1000",
      "PAYMENT:50000",
      "PURCHASE:650",
      "PURCHASE:650",
    ]);
    expect(p.rows[0].occurredAt.toISOString().slice(0, 10)).toBe("2026-11-02");
    expect(p.errors.map((e) => e.line)).toEqual([7, 8]);
  });
  it("dedupe keys are stable across imports, distinct for identical rows, and per card", () => {
    const a = parseStatement(chase, "wc1").rows.map((r) => r.externalId);
    const b = parseStatement(chase, "wc1").rows.map((r) => r.externalId);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(a.length);
    expect(parseStatement(chase, "wc2").rows[0].externalId).not.toBe(a[0]);
  });
  it("Amex-style: purchases positive, preamble lines before the header", () => {
    const amex = [
      "Account summary",
      "Card ending 31077",
      "",
      "Date,Description,Amount",
      "2026-11-01,DOORDASH*PASTA PALACE,32.10",
      "2026-11-03,ONLINE PAYMENT - THANK YOU,-400.00",
      "2026-11-04,Dining Credit,-10.00",
    ].join("\n");
    const p = parseStatement(amex, "wc1");
    expect(p.purchasesAre).toBe("positive");
    expect(p.rows.map((r) => r.kind)).toEqual([
      "PURCHASE",
      "PAYMENT",
      "CREDIT",
    ]);
    expect(p.columns.category).toBeNull();
  });
  it("debit / credit columns; majority sign without payments; explicit override", () => {
    const cap = [
      "Transaction Date,Posted Date,Card No.,Description,Category,Debit,Credit",
      "2026-11-01,2026-11-02,1234,LYFT RIDE,Other Travel,18.00,",
      "2026-11-02,2026-11-03,1234,STATEMENT CREDIT,Payment/Credit,,15.00",
    ].join("\n");
    expect(
      parseStatement(cap, "wc").rows.map((r) => `${r.kind}:${r.amountCents}`),
    ).toEqual(["PURCHASE:1800", "CREDIT:1500"]);
    const noPay =
      "Date,Description,Amount\n2026-11-01,A SHOP,-5.00\n2026-11-02,B SHOP,-7.00\n2026-11-03,C REFUND,3.00";
    expect(parseStatement(noPay, "wc").purchasesAre).toBe("negative");
    expect(
      parseStatement(noPay, "wc", { purchasesAre: "positive" }).rows[0].kind,
    ).toBe("REFUND");
  });
  it("rejects files without the needed columns", () => {
    expect(() => parseStatement("Foo,Bar\n1,2", "wc")).toThrow(StatementError);
    expect(() =>
      parseStatement("Date,Description,Note\n2026-11-01,X,y", "wc"),
    ).toThrow(/amount/);
  });
});

describe("benefit rules", () => {
  it("suggests rules from category, brand names and the benefit name", () => {
    expect(
      suggestRules({ name: "Rideshare credit", categorySlug: "rideshare" }),
    ).toEqual({
      keywords: ["uber", "lyft"],
      categories: [],
      creditKeywords: ["uber", "lyft", "rideshare"],
    });
    expect(
      suggestRules({ name: "Dining credit", categorySlug: "dining" }),
    ).toEqual({
      keywords: [],
      categories: ["dining"],
      creditKeywords: ["dining"],
    });
    expect(
      suggestRules({ name: "Uber Cash", howIssued: "$15 a month in Uber Cash" })
        .keywords,
    ).toEqual(["uber"]);
    expect(
      suggestRules({
        name: "Global Entry / TSA PreCheck credit",
        categorySlug: "trusted-traveler",
      }).keywords,
    ).toEqual(expect.arrayContaining(["global entry", "tsa", "cbp"]));
    expect(
      suggestRules({ name: "CLEAR Plus credit", categorySlug: "clear" })
        .keywords,
    ).toEqual(["clear"]);
    expect(
      suggestRules({ name: "Streaming credit", categorySlug: "entertainment" }),
    ).toMatchObject({
      categories: ["streaming"],
      creditKeywords: ["streaming"],
    });
    expect(
      suggestRules({ name: "Walmart+ membership", categorySlug: "membership" })
        .keywords,
    ).toEqual(["walmart"]);
    expect(suggestRules({ name: "Mystery perk" })).toEqual({
      keywords: [],
      categories: [],
      creditKeywords: ["mystery", "perk"],
    });
  });
  it("stored rules are sanitised; null means suggested", () => {
    expect(
      sanitizeRules({
        keywords: ["  Bean Street!! ", 7, "x"],
        categories: ["Home Improvement"],
        creditKeywords: [],
      }),
    ).toEqual({
      keywords: ["bean street"],
      categories: ["home-improvement"],
      creditKeywords: [],
    });
    expect(sanitizeRules(null)).toBeNull();
    expect(
      effectiveRules(null, {
        name: "Rideshare credit",
        categorySlug: "rideshare",
      }).suggested,
    ).toBe(true);
    expect(effectiveRules({ keywords: ["lyft"] }, { name: "x" })).toEqual({
      keywords: ["lyft"],
      categories: [],
      creditKeywords: [],
      suggested: false,
    });
  });
});

describe("matchBenefit", () => {
  const benefits = [
    {
      id: "dining",
      rules: suggestRules({ name: "Dining credit", categorySlug: "dining" }),
    },
    {
      id: "ride",
      rules: suggestRules({
        name: "Rideshare credit",
        categorySlug: "rideshare",
      }),
    },
    {
      id: "uber-eats",
      rules: {
        keywords: ["uber eats"],
        categories: [],
        creditKeywords: ["uber eats"],
      },
    },
  ];
  it("purchases: merchant keyword first, category only for keyword-less benefits", () => {
    expect(
      matchBenefit(
        {
          kind: "PURCHASE",
          description: "UBER *TRIP",
          categorySlug: "transit",
        },
        benefits,
      ),
    ).toEqual({ benefitId: "ride", by: "keyword", term: "uber" });
    expect(
      matchBenefit(
        {
          kind: "PURCHASE",
          description: "BEAN STREET COFFEE",
          categorySlug: "dining",
        },
        benefits,
      ),
    ).toEqual({ benefitId: "dining", by: "category", term: "dining" });
    expect(
      matchBenefit(
        {
          kind: "PURCHASE",
          description: "HARDWARE",
          categorySlug: "home-improvement",
        },
        benefits,
      ),
    ).toBeNull();
    expect(
      matchBenefit(
        {
          kind: "PURCHASE",
          description: "X",
          categorySlug: null,
          merchantName: "Lyft",
        },
        benefits,
      )?.benefitId,
    ).toBe("ride");
  });
  it("credits: the longest credit keyword wins; payments, refunds and fees never match", () => {
    expect(
      matchBenefit(
        { kind: "CREDIT", description: "UBER EATS CREDIT", categorySlug: null },
        benefits,
      ),
    ).toEqual({ benefitId: "uber-eats", by: "credit", term: "uber eats" });
    expect(
      matchBenefit(
        { kind: "CREDIT", description: "Dining Credit", categorySlug: null },
        benefits,
      )?.benefitId,
    ).toBe("dining");
    expect(
      matchBenefit(
        { kind: "CREDIT", description: "CASH BACK REWARD", categorySlug: null },
        benefits,
      ),
    ).toBeNull();
    for (const kind of ["PAYMENT", "REFUND", "FEE"] as const)
      expect(
        matchBenefit(
          { kind, description: "UBER", categorySlug: "dining" },
          benefits,
        ),
      ).toBeNull();
  });
  it('word boundaries: "clear" does not match "nuclear"', () => {
    const clear = [
      {
        id: "c",
        rules: suggestRules({ name: "CLEAR credit", categorySlug: "clear" }),
      },
    ];
    expect(
      matchBenefit(
        { kind: "PURCHASE", description: "NUCLEAR GYM", categorySlug: null },
        clear,
      ),
    ).toBeNull();
    expect(
      matchBenefit(
        {
          kind: "PURCHASE",
          description: "CLEAR *CLEARME.COM",
          categorySlug: null,
        },
        clear,
      )?.benefitId,
    ).toBe("c");
  });
  it("merchants by name or host, longest wins", () => {
    const merchants = [
      { name: "Amazon", hosts: ["amazon.com"] },
      { name: "Whole Foods Market", hosts: ["wholefoodsmarket.com"] },
      { name: "Bean Street Coffee", hosts: ["beanstreet.example"] },
    ];
    expect(matchMerchant("AMZN Mktp US*2K4 AMAZON.COM", merchants)?.name).toBe(
      "Amazon",
    );
    expect(matchMerchant("WHOLE FOODS MARKET #10234", merchants)?.name).toBe(
      "Whole Foods Market",
    );
    expect(matchMerchant("SQ *BEANSTREET", merchants)?.name).toBe(
      "Bean Street Coffee",
    );
    expect(matchMerchant("UNKNOWN", merchants)).toBeNull();
  });
});

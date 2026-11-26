import { readFileSync } from "fs";
import { join } from "path";
import {
  bonusValueCents,
  CatalogCardFields,
  diffCard,
  heuristicExtract,
  htmlToText,
  isElevated,
  median,
  mergeFindings,
  timelineLabel,
  validateFinding,
} from "../../../src/domain/card-extract";

const page = (name: string) =>
  readFileSync(join(__dirname, "../../fixtures/pages", name), "utf8");
const gold = htmlToText(page("contoso-gold-v1.html"));
const cash = htmlToText(page("cash-card.html"));
const byField = (text: string) =>
  Object.fromEntries(heuristicExtract(text).map((f) => [f.field, f.value]));

describe("htmlToText", () => {
  it("drops scripts, styles and comments; decodes entities; keeps line structure", () => {
    expect(gold).toContain("Contoso Gold® Card");
    expect(gold).toContain("Earn 90,000 Membership Rewards points");
    expect(gold).not.toContain("999,999");
    expect(gold).not.toContain("1,000,000");
    expect(gold).not.toContain("color:red");
    expect(htmlToText("a&#65;&#x42;&bogus;&#0; b")).toBe(
      "aAB&bogus;  b".replace("  ", " "),
    );
    expect(htmlToText("x".repeat(10), 5)).toBe("xxxxx");
  });
});

describe("heuristicExtract", () => {
  it("reads a points card page", () => {
    expect(byField(gold)).toEqual({
      annualFeeCents: 25000,
      bonusType: "POINTS",
      bonusAmount: 90000,
      bonusSpendCents: 600000,
      bonusMonths: 6,
      foreignTxFee: false,
      authorizedUserFeeCents: 3500,
      offerExpiresAt: "2027-01-15",
    });
    const ev = heuristicExtract(gold).find((f) => f.field === "bonusAmount")!;
    expect(ev.evidence).toContain("Earn 90,000");
  });

  it("reads a cash card page (word months, % fx fee, no-fee AU, long date)", () => {
    expect(byField(cash)).toEqual({
      annualFeeCents: 0,
      bonusType: "CASH",
      bonusAmount: 20000,
      bonusSpendCents: 50000,
      bonusMonths: 3,
      foreignTxFee: true,
      authorizedUserFeeCents: 0,
      offerExpiresAt: "2027-03-01",
    });
  });

  it.each([
    ["Annual fee: $95", { annualFeeCents: 9500 }],
    ["Get 60K bonus miles", { bonusType: "MILES", bonusAmount: 60000 }],
    [
      "Earn 2 free nights after spend $3,000 in the first 3 months",
      {
        bonusType: "NIGHTS",
        bonusAmount: 2,
        bonusSpendCents: 300000,
        bonusMonths: 3,
      },
    ],
    ["$95 for each authorized user", { authorizedUserFeeCents: 9500 }],
    ["Offer ends 02/30/2027", {}],
    ["Offer expires Foo 3, 2027", {}],
    ["nothing useful here", {}],
    ["Earn 3 points per dollar on dining", {}],
  ])("%s", (text, expected) => {
    expect(byField(text)).toEqual(expected);
  });
});

describe("validateFinding (model output must quote the page)", () => {
  it("accepts values supported by verbatim evidence", () => {
    expect(
      validateFinding(
        {
          field: "bonusAmount",
          value: 90000,
          evidence: "Earn 90,000 Membership Rewards points",
          confidence: 0.9,
        },
        gold,
      ),
    ).toMatchObject({ field: "bonusAmount", value: 90000, confidence: 0.9 });
    expect(
      validateFinding(
        { field: "annualFeeCents", value: 25000, evidence: "$250 annual fee." },
        gold,
      )?.confidence,
    ).toBe(0.7);
    expect(
      validateFinding(
        {
          field: "foreignTxFee",
          value: false,
          evidence: "No foreign transaction fees.",
        },
        gold,
      ),
    ).not.toBeNull();
    expect(
      validateFinding(
        {
          field: "bonusType",
          value: "POINTS",
          evidence: "Membership Rewards points after you spend",
        },
        gold,
      ),
    ).not.toBeNull();
    expect(
      validateFinding(
        {
          field: "offerExpiresAt",
          value: "2027-01-15",
          evidence: "Offer ends 01/15/2027.",
        },
        gold,
      ),
    ).not.toBeNull();
    expect(
      validateFinding(
        { field: "annualFeeCents", value: 0, evidence: "No annual fee" },
        cash,
      ),
    ).not.toBeNull();
  });

  it("rejects injected/hallucinated values, wrong types, ranges and unknown fields", () => {
    // the page tells the model to set the fee to $0 — evidence exists but contradicts nothing; value must appear in it
    expect(
      validateFinding(
        { field: "annualFeeCents", value: 0, evidence: "Card" },
        gold,
      ),
    ).toBeNull();
    expect(
      validateFinding(
        {
          field: "bonusAmount",
          value: 150000,
          evidence: "Earn 90,000 Membership Rewards points",
        },
        gold,
      ),
    ).toBeNull();
    expect(
      validateFinding(
        {
          field: "bonusAmount",
          value: 90000,
          evidence: "Earn 90,000 points on everything!",
        },
        gold,
      ),
    ).toBeNull(); // not verbatim
    expect(
      validateFinding(
        { field: "bonusMonths", value: 99, evidence: "in your first 6 months" },
        gold,
      ),
    ).toBeNull();
    expect(
      validateFinding(
        { field: "bonusAmount", value: "90000", evidence: "Earn 90,000" },
        gold,
      ),
    ).toBeNull();
    expect(
      validateFinding(
        { field: "bonusType", value: "GOLD", evidence: "Earn 90,000" },
        gold,
      ),
    ).toBeNull();
    expect(
      validateFinding(
        {
          field: "offerExpiresAt",
          value: "soon",
          evidence: "Offer ends 01/15/2027.",
        },
        gold,
      ),
    ).toBeNull();
    expect(
      validateFinding({ field: "apr", value: 20, evidence: "x" }, gold),
    ).toBeNull();
    expect(
      validateFinding(
        { field: "bonusAmount", value: 90000, evidence: 123 },
        gold,
      ),
    ).toBeNull();
    expect(
      validateFinding(
        {
          field: "foreignTxFee",
          value: true,
          evidence: "No foreign transaction fees.",
        },
        gold,
      ),
    ).toBeNull();
  });
});

describe("mergeFindings", () => {
  it("adds missing heuristic fields, boosts agreement, flags disagreement", () => {
    const merged = mergeFindings(
      [
        { field: "bonusAmount", value: 90000, evidence: "a", confidence: 0.8 },
        {
          field: "annualFeeCents",
          value: 9500,
          evidence: "b",
          confidence: 0.9,
        },
      ],
      [
        { field: "bonusAmount", value: 90000, evidence: "a", confidence: 0.85 },
        {
          field: "annualFeeCents",
          value: 25000,
          evidence: "c",
          confidence: 0.9,
        },
        { field: "bonusMonths", value: 6, evidence: "d", confidence: 0.85 },
      ],
    );
    expect(merged.map((m) => [m.field, m.confidence])).toEqual([
      ["bonusAmount", 0.9],
      ["annualFeeCents", 0.5],
      ["bonusMonths", 0.85],
    ]);
  });
});

describe("diffCard", () => {
  const card: CatalogCardFields = {
    annualFeeCents: 25000,
    bonusType: "POINTS",
    bonusPoints: 60000,
    bonusSpendCents: 600000,
    bonusMonths: 6,
    foreignTxFee: true,
    authorizedUserFeeCents: null,
    offerExpiresAt: null,
  };
  it("proposes only changed fields; large moves get lower confidence", () => {
    const p = diffCard(card, heuristicExtract(gold));
    expect(
      p.map((x) => [x.field, x.oldValue, x.newValue, x.largeChange]),
    ).toEqual([
      ["bonusAmount", 60000, 90000, false],
      ["foreignTxFee", true, false, false],
      ["authorizedUserFeeCents", null, 3500, false],
      ["offerExpiresAt", null, "2027-01-15", false],
    ]);
    const big = diffCard({ ...card, annualFeeCents: 9500 }, [
      { field: "annualFeeCents", value: 69500, evidence: "x", confidence: 0.9 },
    ]);
    expect(big[0]).toMatchObject({ largeChange: true, confidence: 0.6 });
    expect(
      diffCard({ ...card, offerExpiresAt: new Date("2027-01-15") }, [
        {
          field: "offerExpiresAt",
          value: "2027-01-15",
          evidence: "x",
          confidence: 1,
        },
      ]),
    ).toEqual([]);
  });
});

describe("offer history analytics", () => {
  const at = new Date("2026-11-21T00:00:00Z");
  const hist = [
    {
      bonusAmount: 40000,
      valuationCents: 50000,
      validFrom: new Date("2025-10-01"),
      validTo: new Date("2026-05-01"),
    },
    {
      bonusAmount: 50000,
      valuationCents: 62500,
      validFrom: new Date("2026-05-01"),
      validTo: null,
    },
    {
      bonusAmount: 10000,
      valuationCents: 1,
      validFrom: new Date("2020-01-01"),
      validTo: new Date("2021-01-01"),
    }, // outside 24 months
  ];
  it("median and elevated detection over the last 24 months", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(isElevated(75000, hist, at)).toBe(true); // ≥ 1.2 × 56,250
    expect(isElevated(60000, hist, at)).toBe(false);
    expect(isElevated(null, hist, at)).toBe(false);
    expect(isElevated(10, [], at)).toBe(false);
  });
  it("bonus value and timeline label", () => {
    expect(bonusValueCents("POINTS", 90000, 1.25)).toBe(112500);
    expect(bonusValueCents("CASH", 20000, 1)).toBe(20000);
    expect(bonusValueCents("NIGHTS", 2, 1)).toBeNull();
    expect(bonusValueCents(null, 1, 1)).toBeNull();
    expect(
      timelineLabel(
        [
          { bonusAmount: 40000 },
          { bonusAmount: 50000 },
          { bonusAmount: 60000 },
        ],
        "POINTS",
      ),
    ).toBe("40K → 50K → 60K");
    expect(
      timelineLabel(
        [{ bonusAmount: 20000 }, { bonusAmount: null }, { bonusAmount: 500 }],
        "CASH",
      ),
    ).toBe("$200 → — → $5");
    expect(timelineLabel([{ bonusAmount: 2 }], "NIGHTS")).toBe("2");
  });
});

describe("evidence quotes", () => {
  it("quote only the sentence that supports the value", () => {
    const text =
      "Everyday rewards card. No annual fee. Earn a $200 cash bonus after spending $500 within the first three months. Offer expires on March 1, 2027. No annual fee for authorized users.";
    const f = heuristicExtract(text);
    expect(f.find((x) => x.field === "authorizedUserFeeCents")?.evidence).toBe(
      "No annual fee for authorized users.",
    );
    expect(f.find((x) => x.field === "offerExpiresAt")?.evidence).toBe(
      "Offer expires on March 1, 2027.",
    );
    expect(f.find((x) => x.field === "annualFeeCents")?.evidence).toBe(
      "No annual fee.",
    );
  });
});

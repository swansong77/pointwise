import {
  aiDetection,
  AI_CONFIDENCE_CAP,
  detectBenefits,
  DetectBenefit,
  editDistance,
  initialVerification,
  merchantForAi,
  pickDetection,
  similarity,
} from "../../../src/domain/benefit-detect";
import { classify, suggestRules } from "../../../src/domain/spend";

const benefit = (id: string, name: string, how?: string): DetectBenefit => ({
  id,
  name,
  rules: suggestRules({ name, howIssued: how }),
});

const dining: DetectBenefit = {
  id: "dining",
  name: "Dining credit",
  rules: suggestRules({ name: "Dining credit", categorySlug: "dining" }),
};
const gold = [dining, benefit("uber", "Uber Cash")];
const platinum = [
  benefit("resy", "Resy credit"),
  benefit("saks", "Saks credit"),
  benefit("equinox", "Equinox credit"),
  benefit("clear", "CLEAR+ credit"),
  benefit("walmart", "Walmart+ credit"),
  benefit("digital", "Digital entertainment credit"),
  benefit("airline", "Airline incidental fee credit"),
  benefit("hotel", "Hotel credit (Fine Hotels + Resorts)"),
  benefit("global", "Global Entry / TSA PreCheck credit"),
  benefit("lulu", "lululemon credit"),
];

const purchase = (description: string, categorySlug: string | null = null) => ({
  kind: "PURCHASE" as const,
  description,
  categorySlug,
});
const credit = (description: string) => ({
  kind: "CREDIT" as const,
  description,
  categorySlug: null,
});

describe("string helpers", () => {
  it("edit distance and similarity", () => {
    expect(editDistance("", "abc")).toBe(3);
    expect(editDistance("abc", "")).toBe(3);
    expect(editDistance("walmart", "walmart")).toBe(0);
    expect(editDistance("walmrt", "walmart")).toBe(1);
    expect(similarity("walmrt", "walmart")).toBeCloseTo(0.857, 2);
  });
});

describe("TC-DET: exact match", () => {
  it("a purchase with the benefit's own keyword is an exact, auto-assigned match", () => {
    const [d] = detectBenefits(purchase("UBER *TRIP HELP.UBER.COM"), gold);
    expect(d).toMatchObject({
      benefitId: "uber",
      method: "EXACT",
      tier: "ASSIGN",
    });
    expect(d.confidence).toBeGreaterThanOrEqual(85);
  });
  it("a statement credit with the benefit's credit word is exact", () => {
    const [d] = detectBenefits(credit("UBER CASH CREDIT"), gold);
    expect(d).toMatchObject({ benefitId: "uber", method: "EXACT" });
    expect(initialVerification(d, "CREDIT")).toBe("VERIFIED");
  });
  it("only purchases and credits are detected", () => {
    expect(
      detectBenefits(
        { kind: "PAYMENT", description: "UBER", categorySlug: null },
        gold,
      ),
    ).toEqual([]);
    expect(detectBenefits(purchase(""), gold)).toEqual([]);
  });
});

describe("TC-DET: alias match", () => {
  it.each(["UBER", "UBER TRIP", "UBER EATS", "UBER*EATS", "UBER* ONE"])(
    "%s resolves to the Uber benefit",
    (desc) => {
      const [d] = detectBenefits(purchase(desc), gold);
      expect(d.benefitId).toBe("uber");
    },
  );
  it.each(["SHAKE SHACK 1234 NEW YORK", "FIVE GUYS #442", "GRUBHUB*ORDER 99"])(
    "%s resolves to the Gold dining credit",
    (desc) => {
      const [d] = detectBenefits(purchase(desc), gold);
      expect(d).toMatchObject({ benefitId: "dining", method: "ALIAS" });
      expect(d.confidence).toBeGreaterThanOrEqual(85);
    },
  );
  it("a dining-category purchase with no brand match is a review-tier alias", () => {
    const [d] = detectBenefits(purchase("JOES DINER", "dining"), gold);
    expect(d).toMatchObject({ benefitId: "dining", tier: "REVIEW" });
    expect(initialVerification(d, "PURCHASE")).toBe("UNVERIFIED");
  });
});

describe("TC-DET: Amex Platinum statement credits (regex)", () => {
  it.each([
    ["DIGITAL ENTERTAINMENT CREDIT", "digital"],
    ["RESY CREDIT", "resy"],
    ["SAKS FIFTH AVENUE CR", "saks"],
    ["EQUINOX CREDIT", "equinox"],
    ["CLEAR PLUS STATEMENT CREDIT", "clear"],
    ["WALMART+ MEMBERSHIP CREDIT", "walmart"],
    ["AIRLINE FEE CREDIT", "airline"],
    ["HOTEL CREDIT", "hotel"],
    ["GLOBAL ENTRY FEE REIMBURSEMENT", "global"],
    ["LULULEMON CREDIT", "lulu"],
  ])("%s → %s", (desc, id) => {
    const [d] = detectBenefits(credit(desc), platinum);
    expect(d.benefitId).toBe(id);
    expect(d.confidence).toBeGreaterThanOrEqual(85);
  });
});

describe("TC-DET: fuzzy match", () => {
  it("a misspelled brand lands in the review tier, never auto-assigned", () => {
    const [d] = detectBenefits(purchase("WALMRT SUPERCENTER"), platinum);
    expect(d).toMatchObject({ benefitId: "walmart", method: "FUZZY", tier: "REVIEW" });
    expect(d.confidence).toBeLessThan(85);
  });
  it("short or distant words do not match", () => {
    expect(detectBenefits(purchase("ACME HARDWARE"), platinum)).toEqual([]);
  });
});

describe("TC-DET: AI classification", () => {
  it("is capped below the auto-assign threshold and never verified", () => {
    const d = aiDetection("uber", 99, "uber trip")!;
    expect(d.confidence).toBe(AI_CONFIDENCE_CAP);
    expect(d.method).toBe("AI");
    expect(d.tier).toBe("REVIEW");
    expect(initialVerification(d, "CREDIT")).toBe("UNVERIFIED");
  });
  it("a very low AI confidence yields nothing", () => {
    expect(aiDetection("uber", 20, "x")).toBeNull();
  });
  it("only a cleaned merchant string is prepared for a model", () => {
    const s = merchantForAi("UBER *TRIP 8005928996 JOHN SMITH 4111 1111 $23.45");
    expect(s).not.toMatch(/\d/);
    expect(s.length).toBeLessThanOrEqual(60);
  });
});

describe("TC-DET: selection", () => {
  it("picks the strongest detection", () => {
    const list = detectBenefits(purchase("UBER EATS"), gold);
    expect(pickDetection(list)?.benefitId).toBe("uber");
    expect(pickDetection([])).toBeNull();
  });
  it("ambiguous equal-confidence matches go to manual review", () => {
    const a = { benefitId: "a", method: "ALIAS" as const, confidence: 85, rule: "x", merchant: "m", tier: "ASSIGN" as const };
    expect(pickDetection([a, { ...a, benefitId: "b", rule: "y" }])).toBeNull();
    expect(pickDetection([a, { ...a, benefitId: "b" }])?.benefitId).toBe("a");
  });
});

describe("TC-CLS: issuer credits without the word credit", () => {
  it("a negative issuer credit line becomes a CREDIT, a plain refund stays a REFUND", () => {
    expect(classify("AIRLINE FEE REIMB", -1500)).toBe("CREDIT");
    expect(classify("SAKS FIFTH AVENUE CR", -5000)).toBe("CREDIT");
    expect(classify("SAKS FIFTH AVENUE", -5000)).toBe("REFUND");
  });
});

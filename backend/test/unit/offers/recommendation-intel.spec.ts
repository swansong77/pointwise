import { cardKindOf, enrich, RecInput, recentApplications, REC_WEIGHTS, selectRecommendation } from "../../../src/domain/recommendation-intel";

const score = (over: Partial<RecInput["score"]> = {}): RecInput["score"] => ({
  cardId: "c1",
  slug: "gold",
  name: "Example Gold",
  issuer: "Chase",
  eligible: true,
  blockers: [],
  warnings: [],
  firstYearValueCents: 120_000,
  longTermValueCents: 40_000,
  score: 150_000,
  components: { bonusCents: 100_000, earnCents: 30_000, benefitsCents: 40_000, firstYearFeeCents: 0, annualFeeCents: 25_000 },
  approvalOdds: "LIKELY",
  spendFeasible: true,
  confidence: 0.8,
  confidenceNotes: [],
  ...over,
});
const base = (over: Partial<RecInput> = {}): RecInput => ({
  score: score(),
  card: { kind: "TRAVEL", isBusiness: false, currencyCode: "UR", annualFeeCents: 25_000 },
  user: { goals: ["TRAVEL"], hasBusiness: false, creditBandKnown: true, appsLast6m: 1, appsLast12m: 2, balanceValueByCurrencyCents: {}, benefitUtilizationPct: 50 },
  offer: { verdict: "NEAR_HIGH", daysToExpiry: 10, bestEverCents: 150_000, currentValueCents: 140_000 },
  ...over,
});
const act = (any: number, at = 0) => ({ newAccountsAny: () => any, newAccountsAt: () => at });

describe("TC-REC2: factors", () => {
  it("goal match adds, mismatch subtracts, no goals adds nothing", () => {
    expect(enrich(base()).factors.find((f) => f.key === "GOAL_FIT")?.deltaCents).toBe(REC_WEIGHTS.goalMatchCents);
    const cash = enrich(base({ card: { kind: "CASHBACK", isBusiness: false, currencyCode: null, annualFeeCents: 0 } }));
    expect(cash.factors.find((f) => f.key === "GOAL_MISMATCH")?.deltaCents).toBe(REC_WEIGHTS.goalMismatchCents);
    expect(enrich(base({ user: { ...base().user, goals: [] } })).factors.some((f) => f.key.startsWith("GOAL"))).toBe(false);
    expect(enrich(base({ user: { ...base().user, goals: ["NOT_A_GOAL"] } })).factors.some((f) => f.key.startsWith("GOAL"))).toBe(false);
  });
  it("LOW_FEE matches no-fee cards only", () => {
    const u = { ...base().user, goals: ["LOW_FEE"] };
    expect(enrich(base({ user: u, card: { kind: "OTHER", isBusiness: false, currencyCode: null, annualFeeCents: 0 } })).factors[0].key).toBe("GOAL_FIT");
    expect(enrich(base({ user: u })).factors[0].key).toBe("GOAL_MISMATCH");
  });
  it("balances in the card's currency add a capped synergy", () => {
    const o = enrich(base({ user: { ...base().user, balanceValueByCurrencyCents: { UR: 1_000_00 } } }));
    expect(o.factors.find((f) => f.key === "BALANCE_SYNERGY")?.deltaCents).toBe(50_00);
    const big = enrich(base({ user: { ...base().user, balanceValueByCurrencyCents: { UR: 100_000_00 } } }));
    expect(big.factors.find((f) => f.key === "BALANCE_SYNERGY")?.deltaCents).toBe(REC_WEIGHTS.balanceSynergyCapCents);
    expect(enrich(base({ user: { ...base().user, balanceValueByCurrencyCents: { OTHER: 5_000_00 } } })).factors.some((f) => f.key === "BALANCE_SYNERGY")).toBe(false);
  });
  it("benefit utilization rescales the credits value around the assumed 50 %", () => {
    expect(enrich(base({ user: { ...base().user, benefitUtilizationPct: 100 } })).factors.find((f) => f.key === "BENEFIT_UTILIZATION")?.deltaCents).toBe(20_000);
    expect(enrich(base({ user: { ...base().user, benefitUtilizationPct: 0 } })).factors.find((f) => f.key === "BENEFIT_UTILIZATION")?.deltaCents).toBe(-20_000);
    expect(enrich(base()).factors.some((f) => f.key === "BENEFIT_UTILIZATION")).toBe(false); // exactly the assumed rate
    expect(enrich(base({ user: { ...base().user, benefitUtilizationPct: null } })).factors.some((f) => f.key === "BENEFIT_UTILIZATION")).toBe(false);
  });
  it("many recent applications cost points and lower probability", () => {
    const o = enrich(base({ user: { ...base().user, appsLast6m: 5 } }));
    expect(o.factors.find((f) => f.key === "VELOCITY")?.deltaCents).toBe(-3 * REC_WEIGHTS.velocityPenaltyCents);
    expect(o.probability).toBeLessThan(enrich(base()).probability);
    expect(o.risks.join(" ")).toMatch(/5 new accounts in 6 months/);
  });
  it("the adjusted score is the scorer's score plus the factors, and every factor is listed", () => {
    const o = enrich(base({ user: { ...base().user, benefitUtilizationPct: 100 } }));
    expect(o.adjustedScoreCents).toBe(150_000 + o.factors.reduce((n, f) => n + f.deltaCents, 0));
    expect(o.factors.map((f) => f.key)).toEqual(["GOAL_FIT", "BENEFIT_UTILIZATION"]);
  });
});

describe("TC-REC2: application probability (an estimate)", () => {
  it("bands by approval odds and is flagged as an estimate", () => {
    expect(enrich(base()).probability).toBe(0.85);
    expect(enrich(base({ score: score({ approvalOdds: "UNLIKELY" }) })).probability).toBe(0.25);
    expect(enrich(base()).probabilityIsEstimate).toBe(true);
  });
  it("ineligible is 0; business card without a business is sharply lower and carries a risk", () => {
    expect(enrich(base({ score: score({ eligible: false, blockers: ["Over 5/24"] }) })).probability).toBe(0);
    const b = enrich(base({ card: { kind: "TRAVEL", isBusiness: true, currencyCode: null, annualFeeCents: 0 } }));
    expect(b.probability).toBeCloseTo(0.13, 2);
    expect(b.risks.join(" ")).toMatch(/business card/);
    expect(enrich(base({ card: { kind: "TRAVEL", isBusiness: true, currencyCode: null, annualFeeCents: 0 }, user: { ...base().user, hasBusiness: true } })).probability).toBe(0.85);
  });
  it("issuer difficulty scales it, unverified rules never to zero", () => {
    const hard = enrich(base({ activity: act(5) }));
    expect(hard.difficulty?.level).toBe("HARD");
    expect(hard.probability).toBe(0.43);
    expect(hard.risks.join(" ")).toMatch(/5\/24/);
    expect(enrich(base({ activity: act(0) })).probability).toBe(0.85);
  });
  it("unreachable spend and scorer warnings become risks", () => {
    const o = enrich(base({ score: score({ spendFeasible: false, warnings: ["Fee rises after year one"] }) }));
    expect(o.risks).toEqual(expect.arrayContaining([expect.stringMatching(/minimum spend/), "Fee rises after year one"]));
  });
});

describe("TC-REC2: confidence and advice", () => {
  it("missing inputs reduce confidence with named reasons", () => {
    const full = enrich(base());
    const sparse = enrich(base({ user: { ...base().user, goals: [], creditBandKnown: false, benefitUtilizationPct: null }, offer: null }));
    expect(sparse.confidence).toBeLessThan(full.confidence);
    expect(sparse.confidenceReasons.join(" ")).toMatch(/goals.*credit score band.*benefit usage.*offer history/is);
  });
  it("confidence stays inside its bounds", () => {
    const o = enrich(base({ score: score({ confidence: 0.12 }), user: { ...base().user, goals: [], creditBandKnown: false, benefitUtilizationPct: null }, offer: null }));
    expect(o.confidence).toBe(REC_WEIGHTS.minConfidence);
    expect(enrich(base({ score: score({ confidence: 2 }) })).confidence).toBe(REC_WEIGHTS.maxConfidence);
  });
  it("offer expiry advice flows through, including 'move to spouse' when blocked", () => {
    expect(enrich(base()).advice.map((a) => a.code)).toEqual(expect.arrayContaining(["APPLY_BEFORE_EXPIRY", "NEAR_HIGH"]));
    const blocked = enrich(base({ score: score({ eligible: false, blockers: ["x"] }), alternateMember: "Spouse" }));
    expect(blocked.advice[0].text).toBe("Move the application to Spouse.");
    expect(enrich(base({ offer: null })).advice).toEqual([]);
  });
});

describe("TC-REC2: selection and recent applications", () => {
  it("recommends the best eligible card by probability-weighted adjusted score and lists alternatives", () => {
    const mk = (id: string, s: number, p: number, eligible = true) => ({ ...enrich(base({ score: score({ cardId: id, slug: id, name: id, eligible }) })), adjustedScoreCents: s, probability: p, eligible });
    const r = selectRecommendation([mk("a", 100_000, 0.9), mk("b", 150_000, 0.3), mk("c", 90_000, 0.9), mk("x", 999_999, 0.9, false), mk("d", 80_000, 0.9), mk("e", 70_000, 0.9)]);
    expect(r.recommended?.cardId).toBe("a");
    expect(r.alternatives.map((o) => o.cardId)).toEqual(["c", "d", "e"]);
    expect(selectRecommendation([]).recommended).toBeNull();
  });
  it("counts accounts opened in the last 6 and 12 months", () => {
    const now = new Date("2026-11-25T00:00:00Z");
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(recentApplications([d("2026-10-01"), d("2026-06-01"), d("2026-01-01"), d("2024-01-01"), null], now)).toEqual({ last6m: 2, last12m: 3 });
  });
});

describe("TC-REC2: card kind from currency", () => {
  it("cash, hotel, airline, transferable points and unknown", () => {
    expect(cardKindOf({ code: "CASH", name: "Cash back", isCash: true })).toBe("CASHBACK");
    expect(cardKindOf({ code: "BONVOY", name: "Marriott Bonvoy Points", isCash: false })).toBe("HOTEL");
    expect(cardKindOf({ code: "AA", name: "American Airlines AAdvantage Miles", isCash: false })).toBe("AIRLINE");
    expect(cardKindOf({ code: "UR", name: "Chase Ultimate Rewards", isCash: false })).toBe("TRAVEL");
    expect(cardKindOf(null)).toBe("OTHER");
  });
});

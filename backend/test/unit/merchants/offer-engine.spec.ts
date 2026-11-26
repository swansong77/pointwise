import { detectMissed, eligibilityState, offerValueCents, OfferHolding, OfferTerms, Txn } from "../../../src/domain/offer-engine";
import { analyzeBehavior, looksLikeSubscription } from "../../../src/domain/spend-behavior";
import { OPP_WEIGHTS, scoreOpportunity, OppInput } from "../../../src/domain/opportunity-score";
import { buildTimeline } from "../../../src/domain/merchant-timeline";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const NOW = d("2026-11-25");

const offer = (o: Partial<OfferTerms> = {}): OfferTerms => ({
  id: "o1", merchantId: "hilton", startsAt: d("2026-10-01"), endsAt: d("2026-12-31"), minSpendCents: 50_000, valueCents: 10_000, percent: null,
  enrollmentRequired: true, source: "EMAIL", verification: "UNVERIFIED", ...o,
});
const tx = (id: string, card: string, date: string, amt: number, merchantId = "hilton"): Txn => ({ id, merchantId, walletCardId: card, date: d(date), amountCents: amt });
const holding = (o: OfferTerms, eligible: string[], uos: OfferHolding["userOffers"] = []): OfferHolding => ({ offer: o, eligibleWalletCardIds: eligible, userOffers: uos });

describe("TC-ELIG: eligibility states", () => {
  const act = { status: "ACTIVE", activationStatus: "ACTIVATED" } as const;
  it("covers every state", () => {
    expect(eligibilityState(offer(), null, 0, NOW)).toBe("ELIGIBLE");
    expect(eligibilityState(offer(), { status: "ACTIVE", activationStatus: "PENDING" }, 0, NOW)).toBe("ELIGIBLE");
    expect(eligibilityState(offer(), act, 0, NOW)).toBe("ACTIVATED");
    expect(eligibilityState(offer(), act, 20_000, NOW)).toBe("PARTIAL");
    expect(eligibilityState(offer(), act, 50_000, NOW)).toBe("PENDING_CREDIT");
    expect(eligibilityState(offer(), { status: "REDEEMED", activationStatus: "ACTIVATED" }, 60_000, NOW)).toBe("COMPLETED");
    expect(eligibilityState(offer({ endsAt: d("2026-11-01") }), act, 0, NOW)).toBe("EXPIRED");
    expect(eligibilityState(offer(), { status: "EXPIRED", activationStatus: "ACTIVATED" }, 0, NOW)).toBe("EXPIRED");
  });
  it("an offer without enrollment is active once added", () => {
    expect(eligibilityState(offer({ enrollmentRequired: false }), { status: "ACTIVE", activationStatus: "NOT_REQUIRED" }, 0, NOW)).toBe("ACTIVATED");
  });
  it("no minimum spend: spending alone does not mean a credit is pending", () => {
    expect(eligibilityState(offer({ minSpendCents: null }), act, 10_000, NOW)).toBe("ACTIVATED");
  });
});

describe("TC-ELIG: offer value", () => {
  it("flat, below minimum, percent, capped percent", () => {
    expect(offerValueCents(offer(), 60_000)).toBe(10_000);
    expect(offerValueCents(offer(), 10_000)).toBe(0);
    expect(offerValueCents({ valueCents: 2_000, percent: 10, minSpendCents: null }, 10_000)).toBe(1_000);
    expect(offerValueCents({ valueCents: 2_000, percent: 10, minSpendCents: null }, 100_000)).toBe(2_000);
    expect(offerValueCents({ valueCents: 0, percent: 10, minSpendCents: null }, 100_000)).toBe(10_000);
    expect(offerValueCents({ valueCents: 9_999, percent: 10, maxRewardCents: 500, minSpendCents: null }, 100_000)).toBe(500);
  });
});

describe("TC-MISS: missed-offer root causes", () => {
  const txns = [tx("t1", "wcA", "2026-11-05", 40_000), tx("t2", "wcA", "2026-11-15", 30_000)];
  it("NOT_ADDED: purchases on a card that could hold the offer but never did", () => {
    const [m] = detectMissed([holding(offer(), ["wcA"])], txns, NOW);
    expect(m).toMatchObject({ cause: "NOT_ADDED", lostCents: 10_000, spendCents: 70_000, walletCardId: "wcA", transactionIds: ["t1", "t2"], confidence: 75 });
    expect(m.evidence.join(" ")).toMatch(/not added/);
  });
  it("NOT_ACTIVATED: added but never activated", () => {
    const [m] = detectMissed([holding(offer(), ["wcA"], [{ walletCardId: "wcA", status: "ACTIVE", activationStatus: "PENDING" }])], txns, NOW);
    expect(m).toMatchObject({ cause: "NOT_ACTIVATED", lostCents: 10_000, confidence: 75 });
  });
  it("WRONG_CARD: spent on cards that do not hold the offer", () => {
    const [m] = detectMissed([holding(offer(), ["wcB"])], txns, NOW);
    expect(m).toMatchObject({ cause: "WRONG_CARD", walletCardId: null, confidence: 75 });
  });
  it("BELOW_MIN_SPEND: activated, live, short of the minimum — reported with the shortfall", () => {
    const [m] = detectMissed([holding(offer({ minSpendCents: 100_000 }), ["wcA"], [{ walletCardId: "wcA", status: "ACTIVE", activationStatus: "ACTIVATED" }])], txns, NOW);
    expect(m.cause).toBe("BELOW_MIN_SPEND");
    expect(m.action).toMatch(/\$300\.00 more/);
    expect(m.lostCents).toBe(10_000);
    expect(m.confidence).toBe(75); // EMAIL source caps confidence
  });
  it("an activated offer whose minimum was met is not a miss; neither is a minimum short on an already-ended offer", () => {
    expect(detectMissed([holding(offer(), ["wcA"], [{ walletCardId: "wcA", status: "ACTIVE", activationStatus: "ACTIVATED" }])], txns, NOW)).toEqual([]);
    expect(detectMissed([holding(offer({ minSpendCents: 100_000, endsAt: d("2026-11-20") }), ["wcA"], [{ walletCardId: "wcA", status: "ACTIVE", activationStatus: "ACTIVATED" }])], txns, NOW)).toEqual([]);
  });
  it("EXPIRED_BEFORE_PURCHASE: bought within 30 days after the offer ended, not later", () => {
    const o = offer({ startsAt: d("2026-09-01"), endsAt: d("2026-10-31") });
    const [m] = detectMissed([holding(o, ["wcA"])], [tx("t9", "wcA", "2026-11-10", 80_000)], NOW);
    expect(m).toMatchObject({ cause: "EXPIRED_BEFORE_PURCHASE", transactionIds: ["t9"], confidence: 60 });
    expect(detectMissed([holding(o, ["wcA"])], [tx("t9", "wcA", "2026-12-15", 80_000)], d("2026-12-20"))).toEqual([]);
  });
  it("the cause comes from the card with the most spend", () => {
    const t = [tx("a", "wcA", "2026-11-05", 10_000), tx("b", "wcB", "2026-11-06", 90_000)];
    const [m] = detectMissed([holding(offer(), ["wcA", "wcB"], [{ walletCardId: "wcB", status: "ACTIVE", activationStatus: "ACTIVATED" }, { walletCardId: "wcA", status: "ACTIVE", activationStatus: "PENDING" }])], t, NOW);
    expect(m).toBeUndefined(); // wcB is activated and met the minimum
  });
  it("never invents findings: no transactions, other merchant, refunds, no eligible card, disputed offers", () => {
    expect(detectMissed([holding(offer(), ["wcA"])], [], NOW)).toEqual([]);
    expect(detectMissed([holding(offer(), ["wcA"])], [tx("x", "wcA", "2026-11-05", 90_000, "marriott")], NOW)).toEqual([]);
    expect(detectMissed([holding(offer(), ["wcA"])], [tx("x", "wcA", "2026-11-05", -90_000)], NOW)).toEqual([]);
    expect(detectMissed([holding(offer(), [])], txns, NOW)).toEqual([]);
    expect(detectMissed([holding(offer({ verification: "DISPUTED" }), ["wcA"])], txns, NOW)).toEqual([]);
    expect(detectMissed([holding(offer({ merchantId: null }), ["wcA"])], txns, NOW)).toEqual([]);
  });
  it("confidence is capped by source: official verified 85, user-entered 25", () => {
    expect(detectMissed([holding(offer({ source: "ISSUER_OFFICIAL", verification: "VERIFIED" }), ["wcA"])], txns, NOW)[0].confidence).toBe(80);
    expect(detectMissed([holding(offer({ source: "USER_ENTERED" }), ["wcA"])], txns, NOW)[0].confidence).toBe(25);
  });
  it("sorts by lost value", () => {
    const small = offer({ id: "s", valueCents: 1_000, minSpendCents: null });
    const big = offer({ id: "b", valueCents: 9_000, minSpendCents: null });
    expect(detectMissed([holding(small, ["wcA"]), holding(big, ["wcA"])], txns, NOW).map((m) => m.offerId)).toEqual(["b", "s"]);
  });
  it("an offer that has not started does not count purchases before its start", () => {
    expect(detectMissed([holding(offer({ startsAt: d("2026-11-20") }), ["wcA"])], txns, NOW)).toEqual([]);
    expect(detectMissed([holding(offer({ startsAt: null, endsAt: null }), ["wcA"])], txns, NOW)).toHaveLength(1);
  });
});

describe("TC-BEH: spending behavior", () => {
  const months = ["2026-06-10", "2026-07-11", "2026-08-12", "2026-09-11", "2026-10-12", "2026-11-11"];
  it("detects a subscription: monthly cadence and steady amounts", () => {
    expect(looksLikeSubscription(months.map(d), months.map(() => 1599))).toBe(true);
    expect(looksLikeSubscription(months.map(d), [1599, 1599, 9000, 1599, 1599, 1599])).toBe(false);
    expect(looksLikeSubscription(["2026-06-10", "2026-06-20", "2026-07-01"].map(d), [1000, 1000, 1000])).toBe(false);
    expect(looksLikeSubscription(months.slice(0, 2).map(d), [1000, 1000])).toBe(false);
  });
  it("per-merchant frequency, seasonality, members and category share", () => {
    const t = [...months.map((m) => ({ merchantId: "netflix", categoryId: "stream", profileId: "p1", date: d(m), amountCents: 1599 })), { merchantId: "hilton", categoryId: "hotels", profileId: "p2", date: d("2026-11-02"), amountCents: 40_000 }, { merchantId: "hilton", categoryId: "hotels", profileId: "p1", date: d("2026-05-02"), amountCents: 20_000 }, { merchantId: null, categoryId: "x", date: d("2026-11-02"), amountCents: 5_000 }, { merchantId: "old", date: d("2024-01-01"), amountCents: 99_999 }, { merchantId: "refund", date: d("2026-11-01"), amountCents: -500 }];
    const b = analyzeBehavior(t, NOW);
    const n = b.merchants.get("netflix")!;
    expect(n).toMatchObject({ count: 6, totalCents: 9594, avgCents: 1599, perMonth: 0.5, isSubscription: true, members: 1 });
    expect(n.seasonality[10]).toBe(1);
    expect(b.merchants.get("hilton")).toMatchObject({ count: 2, members: 2, avgCents: 30_000, isSubscription: false });
    expect(b.merchants.has("old")).toBe(false);
    expect(b.merchants.has("refund")).toBe(false);
    expect(b.totalCents).toBe(9594 + 60_000 + 5_000);
    expect(b.categoryShare.get("hotels")).toBeCloseTo(60_000 / 74_594, 5);
  });
  it("members default to one when profile is unknown; empty input is safe", () => {
    expect(analyzeBehavior([{ merchantId: "a", date: d("2026-11-01"), amountCents: 100 }], NOW).merchants.get("a")!.members).toBe(1);
    expect(analyzeBehavior([], NOW)).toMatchObject({ totalCents: 0 });
  });
});

describe("TC-SCORE: opportunity score", () => {
  const behavior = analyzeBehavior(["2026-06-10", "2026-07-11", "2026-08-12", "2026-09-11", "2026-10-12", "2026-11-11"].map((m) => ({ merchantId: "hilton", profileId: "p1", date: d(m), amountCents: 40_000 })), NOW).merchants.get("hilton")!;
  const base = (o: Partial<OppInput> = {}): OppInput => ({ daysLeft: 5, valueCents: 10_000, percent: null, maxRewardCents: null, minSpendCents: 30_000, enrollmentRequired: true, alreadyActivated: false, source: "EMAIL", verification: "UNVERIFIED", behavior, categoryShare: 0.3, utilization: 0.8, householdMembers: 2, ...o });
  it("weights sum to 100; score and every factor stay in range", () => {
    expect(Object.values(OPP_WEIGHTS).reduce((s, w) => s + w, 0)).toBe(100);
    const r = scoreOpportunity(base());
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.factors).toHaveLength(9);
    for (const f of r.factors) {
      expect(f.value).toBeGreaterThanOrEqual(0);
      expect(f.value).toBeLessThanOrEqual(1);
      expect(f.reason.length).toBeGreaterThan(3);
    }
    expect(r.version).toBe("opportunity/1");
    expect(r.weights).toBe(OPP_WEIGHTS);
  });
  it("a frequent merchant with an expiring, valuable offer outscores one the user never visits", () => {
    expect(scoreOpportunity(base()).score).toBeGreaterThan(scoreOpportunity(base({ behavior: null, categoryShare: 0, utilization: null })).score + 15);
  });
  it("urgency rises as the deadline nears", () => {
    const s = (days: number | null) => scoreOpportunity(base({ daysLeft: days })).factors.find((f) => f.factor === "urgency")!.value;
    expect([s(2), s(6), s(10), s(20), s(60), s(null)]).toEqual([1, 0.85, 0.65, 0.4, 0.15, 0.1]);
  });
  it("simplicity: activation and minimum spend add steps; an activated no-minimum offer needs none", () => {
    const sm = (o: Partial<OppInput>) => scoreOpportunity(base(o)).factors.find((f) => f.factor === "simplicity")!;
    expect(sm({}).value).toBe(0.2);
    expect(sm({ alreadyActivated: true, minSpendCents: null }).value).toBe(1);
    expect(sm({ alreadyActivated: true, minSpendCents: null }).reason).toBe("no steps needed");
    expect(sm({ alreadyActivated: true, minSpendCents: null, percent: 10, maxRewardCents: 2_000 }).value).toBe(0.8);
  });
  it("percent offers are valued from expected spend, capped", () => {
    const r = scoreOpportunity(base({ percent: 10, valueCents: 0, maxRewardCents: 1_500, minSpendCents: null, daysLeft: 60 }));
    expect(r.expectedValueCents).toBeGreaterThan(0);
    expect(r.expectedValueCents).toBeLessThanOrEqual(1_500);
  });
  it("a minimum spend the user will not reach lowers redemption probability", () => {
    const easy = scoreOpportunity(base({ minSpendCents: 30_000, daysLeft: 30 })).factors.find((f) => f.factor === "redemptionProbability")!.value;
    const hard = scoreOpportunity(base({ minSpendCents: 900_000, daysLeft: 30 })).factors.find((f) => f.factor === "redemptionProbability")!.value;
    expect(hard).toBeLessThan(easy);
  });
  it("confidence: capped by source, higher with more data, zero when disputed", () => {
    expect(scoreOpportunity(base()).confidence).toBe(75);
    expect(scoreOpportunity(base({ source: "USER_ENTERED" })).confidence).toBe(25);
    expect(scoreOpportunity(base({ behavior: null })).confidence).toBe(55);
    expect(scoreOpportunity(base({ source: "ISSUER_OFFICIAL", verification: "VERIFIED" })).confidence).toBe(100);
    expect(scoreOpportunity(base({ verification: "DISPUTED" })).confidence).toBe(0);
  });
  it("is deterministic", () => {
    expect(scoreOpportunity(base())).toEqual(scoreOpportunity(base()));
  });
});

describe("TC-TIME: merchant offer timeline", () => {
  const o = (id: string, start: string, end: string | null, v: number) => ({ id, issuer: "Amex", startsAt: d(start), endsAt: end ? d(end) : null, createdAt: d(start), valueCents: v, percent: null });
  it("summarises history, finds the best and ranks today's offer", () => {
    const t = buildTimeline([o("a", "2025-03-01", "2025-04-30", 2_000), o("b", "2025-11-01", "2025-12-31", 5_000), o("c", "2026-03-01", "2026-04-30", 3_000), o("d", "2026-11-01", "2026-12-31", 4_000)], NOW);
    expect(t).toMatchObject({ count: 4, active: 1, averageValueCents: 3_500, best: { id: "b", valueCents: 5_000 }, currentRank: 75 });
    expect(t.perYear).toBeCloseTo(2.3, 1);
    expect(t.seasonality[2]).toBe(2);
    expect(t.seasonality[10]).toBe(2);
    expect(t.entries.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });
  it("no active offer → no rank; empty history is safe; undated offers fall back to creation date", () => {
    expect(buildTimeline([o("a", "2025-03-01", "2025-04-30", 2_000)], NOW).currentRank).toBeNull();
    expect(buildTimeline([], NOW)).toMatchObject({ count: 0, best: null, perYear: 0, averageValueCents: 0 });
    const undated = { id: "u", issuer: null, startsAt: null, endsAt: null, createdAt: d("2026-06-01"), valueCents: 100, percent: 5 };
    expect(buildTimeline([undated], NOW).entries[0]).toMatchObject({ start: d("2026-06-01"), active: true, percent: 5 });
  });
});

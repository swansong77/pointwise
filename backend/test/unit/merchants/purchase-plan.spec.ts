import { buildStack, RISK_WEIGHT, STACK_RULES, StackComponent } from "../../../src/domain/offer-stack";
import { MIN_SPLIT_GAIN_CENTS, planPurchase, PlanCard, PlanInput, PlanOffer } from "../../../src/domain/purchase-plan";
import { OfferTerms } from "../../../src/domain/offer-engine";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const NOW = d("2026-11-25");
const comp = (kind: StackComponent["kind"], cents: number, confidence = 75): StackComponent => ({ kind, label: kind, cents, confidence, evidence: "e" });

describe("TC-STACK: stacking rules", () => {
  it("every rule is data and unverified until confirmed", () => {
    expect(STACK_RULES.length).toBeGreaterThanOrEqual(8);
    expect(STACK_RULES.every((r) => r.verified === false && r.note.length > 10)).toBe(true);
  });
  it("compatible sources add up; applied rules unverified → allRulesVerified false", () => {
    const s = buildStack([comp("CARD_EARN", 300), comp("ISSUER_OFFER", 1000), comp("PORTAL", 500)]);
    expect(s).toMatchObject({ maxCents: 1800, expectedCents: 1800, allRulesVerified: false, confidence: 75 });
    expect(s.included.map((c) => c.kind)).toEqual(["PORTAL", "CARD_EARN", "ISSUER_OFFER"]);
    expect(s.warnings).toEqual([]);
  });
  it("a risky pair (portal + coupon) is risk-weighted and warned about", () => {
    const s = buildStack([comp("PORTAL", 400), comp("COUPON", 1000)]);
    expect(s.maxCents).toBe(1400);
    expect(s.expectedCents).toBe(1000 + Math.round(400 * RISK_WEIGHT));
    expect(s.warnings[0]).toMatchObject({ compat: "RISK", verified: false });
  });
  it("a conflict (gift card + issuer offer) drops the smaller side and says why", () => {
    const s = buildStack([comp("GIFT_CARD", 200), comp("ISSUER_OFFER", 1500)]);
    expect(s.included.map((c) => c.kind)).toEqual(["ISSUER_OFFER"]);
    expect(s.excluded[0].component.kind).toBe("GIFT_CARD");
    expect(s.excluded[0].because).toMatch(/excluded from card-linked offers/);
    const t = buildStack([comp("GIFT_CARD", 2000), comp("ISSUER_OFFER", 1500)]);
    expect(t.included.map((c) => c.kind)).toEqual(["GIFT_CARD"]);
  });
  it("ignores zero-value and zero-confidence components; empty stack is safe; confidence is the weakest link", () => {
    expect(buildStack([comp("PORTAL", 0), comp("COUPON", 100, 0)])).toMatchObject({ maxCents: 0, confidence: 0, included: [] });
    expect(buildStack([comp("CARD_EARN", 100, 90), comp("ISSUER_OFFER", 500, 25)]).confidence).toBe(25);
  });
  it("kinds with no rule between them simply add", () => {
    expect(buildStack([comp("STORE_SALE", 100), comp("GIFT_CARD", 50)]).expectedCents).toBe(150);
  });
  it("verified rules make allRulesVerified true", () => {
    const rules = STACK_RULES.map((r) => ({ ...r, verified: true }));
    expect(buildStack([comp("CARD_EARN", 100), comp("ISSUER_OFFER", 500)], rules).allRulesVerified).toBe(true);
  });
});

const card = (id: string, cents: number, extra: Partial<PlanCard> = {}): PlanCard => ({ walletCardId: id, cardName: `Card ${id}`, member: null, isAuthorizedUser: false, centsPerDollar: cents, earnReason: `${cents}¢/$ at this merchant`, ...extra });
const terms = (o: Partial<OfferTerms> = {}): OfferTerms => ({ id: "o1", merchantId: "hilton", startsAt: null, endsAt: d("2026-12-31"), minSpendCents: 50_000, valueCents: 10_000, percent: null, enrollmentRequired: true, source: "EMAIL", verification: "UNVERIFIED", ...o });
const offer = (cardIds: string[], t: Partial<OfferTerms> = {}, uos: PlanOffer["userOffers"] = []): PlanOffer => ({ terms: terms(t), title: "Hilton $100 back", eligibleWalletCardIds: cardIds, userOffers: uos, offersUrl: "https://example.test/offers" });
const input = (o: Partial<PlanInput> = {}): PlanInput => ({ merchant: { id: "hilton", name: "Hilton" }, amountCents: 120_000, now: NOW, cards: [card("A", 2), card("B", 3)], offers: [], portalRates: [], ...o });

describe("TC-PLAN: purchase planner", () => {
  it("no cards or non-positive amount → no plans", () => {
    expect(planPurchase(input({ cards: [] }))).toEqual([]);
    expect(planPurchase(input({ amountCents: 0 }))).toEqual([]);
  });
  it("ranks by earn when there are no offers, and explains with evidence", () => {
    const [best, second] = planPurchase(input());
    expect(best.legs[0]).toMatchObject({ walletCardId: "B", earnCents: 3_600 });
    expect(second.legs[0].walletCardId).toBe("A");
    expect(best.evidence[0]).toMatch(/card earn: Card B/);
    expect(best.justification[0]).toMatch(/\$36\.00 on \$1200\.00/);
    expect(best.confidence).toBe(90);
  });
  it("an activated offer on the lower-earning card can win; needing activation yields an action with the link", () => {
    const plans = planPurchase(input({ offers: [offer(["A"], {}, [{ walletCardId: "A", status: "ACTIVE", activationStatus: "ACTIVATED" }])] }));
    const single = plans.find((p) => p.kind === "SINGLE" && p.legs[0].walletCardId === "A")!;
    expect(single.legs[0]).toMatchObject({ offerCents: 10_000, needsActivation: false });
    expect(single.expectedCents).toBe(2_400 + 10_000);
    expect(single.confidence).toBe(75);
    expect(plans[0].kind).toBe("SPLIT"); // putting just the minimum on A and the rest on B beats A alone
    const needs = planPurchase(input({ cards: [card("A", 2)], offers: [offer(["A"])] }));
    expect(needs[0].legs[0]).toMatchObject({ walletCardId: "A", needsActivation: true });
    expect(needs[0].actions[0]).toMatch(/Activate "Hilton \$100 back" on Card A.*https:\/\/example\.test\/offers/);
    expect(needs[0].evidence.join(" ")).toMatch(/offer o1.*EMAIL.*unverified/);
  });
  it("a purchase below the offer minimum earns nothing from it and says so", () => {
    const plans = planPurchase(input({ amountCents: 30_000, offers: [offer(["A"])] }));
    const a = plans.find((p) => p.legs[0].walletCardId === "A")!;
    expect(a.legs[0].offerCents).toBe(0);
    expect(a.warnings.join(" ")).toMatch(/needs \$500\.00; this purchase is \$300\.00/);
  });
  it("expired, not-yet-started, redeemed and disputed offers are ignored", () => {
    for (const t of [{ endsAt: d("2026-11-01") }, { startsAt: d("2026-12-01") }, { verification: "DISPUTED" as const }]) {
      expect(planPurchase(input({ offers: [offer(["A"], t)] }))[0].legs[0].offerCents).toBe(0);
    }
    const redeemed = planPurchase(input({ offers: [offer(["A"], {}, [{ walletCardId: "A", status: "REDEEMED", activationStatus: "ACTIVATED" }])] }));
    expect(redeemed.every((p) => p.legs.every((l) => l.offerCents === 0))).toBe(true);
  });
  it("splitting spend: offer minimum on the offer card, the rest on the best earner, only when it clearly wins", () => {
    const o = offer(["A"], { minSpendCents: 50_000 }, [{ walletCardId: "A", status: "ACTIVE", activationStatus: "ACTIVATED" }]);
    const plans = planPurchase(input({ amountCents: 120_000, cards: [card("A", 1), card("B", 3)], offers: [o] }));
    expect(plans[0].kind).toBe("SPLIT");
    expect(plans[0].legs.map((l) => [l.walletCardId, l.amountCents])).toEqual([["A", 50_000], ["B", 70_000]]);
    expect(plans[0].warnings.join(" ")).toMatch(/separate transaction/);
    expect(plans[0].justification[0]).toMatch(/Splitting beats/);
    // a tiny offer is not worth splitting for
    const tiny = offer(["A"], { minSpendCents: 50_000, valueCents: MIN_SPLIT_GAIN_CENTS - 1 }, [{ walletCardId: "A", status: "ACTIVE", activationStatus: "ACTIVATED" }]);
    expect(planPurchase(input({ cards: [card("A", 1), card("B", 3)], offers: [tiny] })).some((p) => p.kind === "SPLIT")).toBe(false);
    // an offer minimum equal to the whole purchase cannot be split
    expect(planPurchase(input({ amountCents: 50_000, cards: [card("A", 1), card("B", 3)], offers: [o] })).some((p) => p.kind === "SPLIT")).toBe(false);
  });
  it("portal rates stack with the card and become an action; a coupon-risky pair would be risk-weighted elsewhere", () => {
    const [p] = planPurchase(input({ portalRates: [{ portal: "Rakuten", ratePercent: 4, source: "entered by user", reliability: 25 }, { portal: "Other", ratePercent: 2, source: "x", reliability: 50 }] }));
    expect(p.portal).toEqual({ portal: "Rakuten", cents: 4_800 });
    expect(p.actions[0]).toMatch(/Start from the Rakuten link/);
    expect(p.expectedCents).toBe(3_600 + 4_800);
    expect(p.confidence).toBe(25); // weakest source decides
  });
  it("authorized-user cards and household members are labelled", () => {
    const [p] = planPurchase(input({ cards: [card("B", 3, { member: "Sam", isAuthorizedUser: true })] }));
    expect(p.legs[0]).toMatchObject({ member: "Sam", isAuthorizedUser: true });
    expect(p.warnings.join(" ")).toMatch(/authorized-user card/);
    expect(p.justification[0]).toMatch(/Card B \(Sam\)/);
  });
  it("low merchant confidence is flagged", () => {
    expect(planPurchase(input({ merchantConfidence: 0.6 }))[0].warnings.join(" ")).toMatch(/low confidence/);
    expect(planPurchase(input({ merchantConfidence: 0.95 }))[0].warnings).toEqual([]);
  });
  it("deterministic and tie-stable", () => {
    const i = input({ cards: [card("B", 2), card("A", 2)] });
    expect(planPurchase(i).map((p) => p.legs[0].cardName)).toEqual(["Card A", "Card B"]);
    expect(planPurchase(i)).toEqual(planPurchase(i));
  });
});

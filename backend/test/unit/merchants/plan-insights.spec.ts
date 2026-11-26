import { hintForItem } from "../../../src/domain/item-category";
import { bestTimeToBuy, certificateMatches, creditMatches, DatedValue, expiryImpact, memberAdvice, offerLabel, strategiesFor } from "../../../src/domain/plan-insights";
import { OfferTerms } from "../../../src/domain/offer-engine";
import { planPurchase, PlanCard, PlanInput, PlanOffer, PLAN_VERSION } from "../../../src/domain/purchase-plan";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const NOW = d("2026-11-25");

const card = (id: string, cents: number, extra: Partial<PlanCard> = {}): PlanCard => ({ walletCardId: id, cardName: `Card ${id}`, member: null, isAuthorizedUser: false, centsPerDollar: cents, earnReason: `${cents}¢/$`, ...extra });
const terms = (o: Partial<OfferTerms> = {}): OfferTerms => ({ id: "o1", merchantId: "hilton", startsAt: null, endsAt: d("2026-12-31"), minSpendCents: 50_000, valueCents: 10_000, percent: null, enrollmentRequired: true, source: "ACCOUNT_DATA", verification: "VERIFIED", ...o });
const offer = (cardIds: string[], t: Partial<OfferTerms> = {}): PlanOffer => ({
  terms: terms(t),
  title: "Hilton $100 back",
  eligibleWalletCardIds: cardIds,
  userOffers: cardIds.map((id) => ({ walletCardId: id, status: "ACTIVE" as const, activationStatus: "ACTIVATED" as const })),
  offersUrl: null,
});
const input = (o: Partial<PlanInput> = {}): PlanInput => ({ merchant: { id: "hilton", name: "Hilton" }, amountCents: 120_000, now: NOW, cards: [card("A", 2), card("B", 3)], offers: [], portalRates: [], ...o });

describe("TC-ITEM: what an item probably is", () => {
  it.each([
    ["MacBook Pro", "online-shopping", "Apple"],
    ["iPhone 17", "online-shopping", "Apple"],
    ["Disney tickets", "entertainment", "Disney"],
    ["International flight", "airlines", null],
    ["Hilton stay", "hotels", null],
    ["Cruise booking", "travel", null],
    ["dinner out", "dining", null],
    ["refrigerator", "home-improvement", null],
    ["gas", "gas", null],
    ["weekly groceries", "groceries", null],
  ])("%s → %s", (item, cat, merchant) => {
    expect(hintForItem(item)).toMatchObject({ categorySlug: cat, merchantHint: merchant });
  });
  it("gives nothing for text it cannot read, and never a certainty", () => {
    expect(hintForItem("")).toBeNull();
    expect(hintForItem("quarterly widget")).toBeNull();
    expect(hintForItem("MacBook")!.confidence).toBeLessThan(1);
  });
});

describe("TC-PLAN2: value the household already holds", () => {
  const ids = (x: Array<{ kind: string }>) => x.map((c) => c.kind);

  it("an unused credit on the paying card adds to the return, with evidence and a reason", () => {
    const base = planPurchase(input())[0];
    const withCredit = planPurchase(input({ credits: [{ walletCardId: "B", title: "$200 hotel credit", remainingCents: 20_000, expiresOn: d("2026-12-31"), confidence: 85 }] }))[0];
    expect(withCredit.legs[0].walletCardId).toBe("B");
    expect(withCredit.expectedCents - base.expectedCents).toBe(20_000);
    expect(withCredit.breakdown.creditsCents).toBe(20_000);
    expect(ids(withCredit.stack.included)).toContain("BENEFIT_CREDIT");
    expect(withCredit.evidence.join(" ")).toMatch(/benefit credit: Card B/);
    expect(withCredit.reasoning).toMatch(/covers \$200\.00/);
  });
  it("a credit never counts for more than the purchase, nor on a card that is not paying", () => {
    const small = planPurchase(input({ amountCents: 5_000, credits: [{ walletCardId: "B", title: "credit", remainingCents: 20_000, expiresOn: null, confidence: 85 }] }))[0];
    expect(small.breakdown.creditsCents).toBe(5_000);
    const other = planPurchase(input({ credits: [{ walletCardId: "A", title: "credit", remainingCents: 20_000, expiresOn: null, confidence: 85 }] })).find((p) => p.legs[0].walletCardId === "B")!;
    expect(other.breakdown.creditsCents).toBe(0);
  });
  it("a certificate held by the member who pays adds value; another member's does not", () => {
    const cards = [card("A", 2, { member: "Alex" }), card("B", 3, { member: "Riley" })];
    const plans = planPurchase(input({ cards, certificates: [{ id: "c1", name: "Free night", member: "Alex", valueCents: 30_000, expiresAt: d("2027-01-31"), confidence: 60 }] }));
    const alex = plans.find((p) => p.kind === "SINGLE" && p.member === "Alex")!;
    const riley = plans.find((p) => p.kind === "SINGLE" && p.member === "Riley")!;
    expect(alex.breakdown.certificateCents).toBe(30_000);
    expect(riley.breakdown.certificateCents).toBe(0);
    expect(alex.actions.join(" ")).toMatch(/Redeem "Free night"/);
  });
  it("spend on a card with a welcome bonus to earn counts toward it, in proportion", () => {
    const [p] = planPurchase(input({ cards: [card("A", 2)], amountCents: 100_000, bonuses: [{ walletCardId: "A", requiredCents: 400_000, remainingCents: 400_000, bonusValueCents: 80_000, deadline: d("2026-12-10") }] }));
    expect(p.breakdown.bonusProgressCents).toBe(20_000); // a quarter of the required spend, a quarter of the bonus
    expect(p.warnings.join(" ")).toMatch(/spend window ends 2026-12-10/);
    expect(p.confidence).toBeLessThanOrEqual(70);
  });
  it("a points transfer is reported apart and never lifts the expected return", () => {
    const pts = card("A", 4, { pointsPerDollar: 4, centsPerPoint: 1, isCash: false });
    const base = planPurchase(input({ cards: [pts], amountCents: 100_000 }))[0];
    const t = planPurchase(input({ cards: [pts], amountCents: 100_000, transfers: [{ walletCardId: "A", upliftCentsPerPoint: 0.8, partner: "Hyatt", note: "Hyatt at 1.8¢" }] }))[0];
    expect(t.expectedCents).toBe(base.expectedCents);
    expect(t.breakdown.transferUpliftCents).toBe(Math.round(1000 * 4 * 0.8));
    expect(t.maxRewardsCents).toBe(t.maxCents + t.breakdown.transferUpliftCents);
    expect(t.transfer).toEqual({ partner: "Hyatt", note: "Hyatt at 1.8¢" });
    expect(t.breakdown.estimatedPoints).toBe(4000);
    expect(t.breakdown.cashbackCents).toBe(0);
  });
  it("cash-back cards report cashback, and the net cost is what is left after the return", () => {
    const [p] = planPurchase(input({ cards: [card("A", 2)], amountCents: 100_000 }));
    expect(p.breakdown).toMatchObject({ cashbackCents: 2_000, estimatedPoints: 0 });
    expect(p.totalValueReturnedCents).toBe(2_000);
    expect(p.netCostCents).toBe(98_000);
    expect(PLAN_VERSION).toBe("purchase-plan/2");
  });
  it("context notes appear as warnings on the plan that uses the card, and do not change the ranking", () => {
    const plain = planPurchase(input());
    const noted = planPurchase(input({ notes: [{ walletCardId: "B", message: "Card B's annual fee posts on 2026-12-03." }] }));
    expect(noted.map((p) => p.legs[0].walletCardId)).toEqual(plain.map((p) => p.legs[0].walletCardId));
    expect(noted.find((p) => p.legs[0].walletCardId === "B")!.warnings).toContain("Card B's annual fee posts on 2026-12-03.");
  });
});

describe("TC-STRAT: named strategies", () => {
  it("best, alternative on a different card, conservative from dependable value, and maximum rewards", () => {
    const plans = planPurchase(input({ cards: [card("A", 2), card("B", 3), card("C", 1)], offers: [offer(["C"], { source: "USER_ENTERED", verification: "UNVERIFIED", valueCents: 5_000 })] }));
    const s = strategiesFor(plans);
    expect(s.map((x) => x.key)).toEqual(["BEST", "ALTERNATIVE", "CONSERVATIVE", "MAX_REWARDS"]);
    expect(s[0].opportunityCostCents).toBe(0);
    expect(plans[s[1].planIndex].legs.map((l) => l.walletCardId)).not.toEqual(plans[0].legs.map((l) => l.walletCardId));
    expect(s[1].opportunityCostCents).toBeGreaterThanOrEqual(0);
    // a user-entered offer is not dependable, so the conservative plan relies on card earn
    expect(plans[s[2].planIndex].sureCents).toBeGreaterThanOrEqual(plans.reduce((m, p) => Math.min(m, p.sureCents), Infinity));
  });
  it("a single card gives best, conservative and maximum only", () => {
    expect(strategiesFor(planPurchase(input({ cards: [card("A", 2)] }))).map((x) => x.key)).toEqual(["BEST", "CONSERVATIVE", "MAX_REWARDS"]);
    expect(strategiesFor([])).toEqual([]);
  });
  it("maximum rewards can pick the card that earns points worth transferring", () => {
    const cash = card("A", 3);
    const pts = card("B", 2.5, { pointsPerDollar: 2.5, centsPerPoint: 1, isCash: false });
    const plans = planPurchase(input({ cards: [cash, pts], amountCents: 100_000, transfers: [{ walletCardId: "B", upliftCentsPerPoint: 1, partner: "Hyatt", note: "n" }] }));
    const s = strategiesFor(plans);
    expect(plans[0].legs[0].walletCardId).toBe("A");
    expect(plans[s.find((x) => x.key === "MAX_REWARDS")!.planIndex].legs[0].walletCardId).toBe("B");
  });
});

describe("TC-EXPIRY: what lapses and the best day to buy", () => {
  const items: DatedValue[] = [
    { kind: "OFFER", label: "Hilton offer", startsAt: null, endsAt: d("2026-12-15"), valueCents: 10_000 },
    { kind: "CREDIT", label: "Travel credit", startsAt: null, endsAt: d("2027-01-05"), valueCents: 30_000 },
    { kind: "OFFER", label: "Marriott offer", startsAt: d("2026-12-20"), endsAt: d("2027-02-28"), valueCents: 15_000 },
    { kind: "OFFER", label: "Old offer", startsAt: null, endsAt: d("2026-11-01"), valueCents: 9_999 },
  ];
  it("says what to buy before, with the loss, and flags what lapses before the planned date", () => {
    const out = expiryImpact(items, null, NOW);
    expect(out.map((x) => x.label)).toEqual(["Hilton offer", "Travel credit"]);
    expect(out[0]).toMatchObject({ potentialLossCents: 10_000, lapsesBeforePlanned: false, daysLeft: 20 });
    expect(out[0].message).toBe("Purchase before 2026-12-15: Hilton offer expires. Potential loss $100.00.");
    const later = expiryImpact(items, d("2027-01-10"), NOW);
    expect(later.find((x) => x.label === "Hilton offer")).toMatchObject({ lapsesBeforePlanned: true });
    expect(later.find((x) => x.label === "Hilton offer")!.message).toMatch(/before your planned date/);
  });
  it("ignores anything already lapsed or worth nothing, and things far beyond the horizon", () => {
    expect(expiryImpact([...items, { kind: "OFFER", label: "Free", startsAt: null, endsAt: d("2026-12-01"), valueCents: 0 }], null, NOW).map((x) => x.label)).not.toContain("Old offer");
    expect(expiryImpact([{ kind: "OFFER", label: "Far", startsAt: null, endsAt: d("2028-01-01"), valueCents: 5_000 }], null, NOW)).toEqual([]);
  });
  it("picks the earliest day with the most value, comparing against the planned day", () => {
    const t = bestTimeToBuy(items, d("2026-12-01"), NOW)!;
    // Dec 1 gets the Hilton offer and the credit (40,000); Dec 20 adds Marriott but the Hilton offer is gone (45,000)
    expect(t.date.toISOString().slice(0, 10)).toBe("2026-12-20");
    expect(t.valueCents).toBe(45_000);
    expect(t.plannedValueCents).toBe(40_000);
    expect(t.gainCents).toBe(5_000);
    expect(bestTimeToBuy(items, d("2026-12-16"), NOW)!.reason).toMatch(/Buying on 2026-12-20/);
  });
  it("keeps the planned day when it is already the best, and returns nothing without dated value", () => {
    const t = bestTimeToBuy([{ kind: "OFFER", label: "Hilton offer", startsAt: null, endsAt: d("2026-12-15"), valueCents: 10_000 }], null, NOW)!;
    expect(t.gainCents).toBe(0);
    expect(t.reason).toMatch(/already gets the most/);
    expect(bestTimeToBuy([], null, NOW)).toBeNull();
  });
});

describe("TC-HOUSE: which member should pay", () => {
  const cards = [card("A", 2, { member: "Alex" }), card("B", 3, { member: "Riley" })];
  it("the member who holds the offer wins, and the reason says the others have none", () => {
    const plans = planPurchase(input({ cards, offers: [offer(["A"])] }));
    const a = memberAdvice(plans);
    expect(a.best).toMatchObject({ member: "Alex", offerTitle: "Hilton $100 back" });
    expect(a.reason).toMatch(/Alex holds "Hilton \$100 back"; Riley has no matching offer/);
    expect(a.options.map((o) => o.member)).toEqual(["Alex", "Riley"]);
    expect(a.marginCents).toBeGreaterThan(0);
  });
  it("the other member wins when their card has the better offer", () => {
    expect(memberAdvice(planPurchase(input({ cards, offers: [offer(["B"])] }))).best!.member).toBe("Riley");
  });
  it("members within a dollar are called a tie; one member; no cards", () => {
    expect(memberAdvice(planPurchase(input({ cards: [card("A", 2, { member: "Alex" }), card("B", 2, { member: "Riley" })] }))).reason).toMatch(/about the same/);
    expect(memberAdvice(planPurchase(input({ cards: [card("A", 2, { member: "Alex" })] }))).reason).toMatch(/Only Alex/);
    expect(memberAdvice([]).best).toBeNull();
  });
});

describe("TC-MATCH: which held value applies to a purchase", () => {
  it("a credit applies by keyword in the merchant or item, or by category and its parent", () => {
    const rules = { keywords: ["uber"], categories: ["hotels"] };
    expect(creditMatches(rules, { merchantName: "Uber Eats", item: null, categorySlug: "dining", parentSlug: null })).toBe(true);
    expect(creditMatches(rules, { merchantName: "Hilton", item: null, categorySlug: "hotels", parentSlug: "travel" })).toBe(true);
    expect(creditMatches({ keywords: [], categories: ["travel"] }, { merchantName: "Hilton", item: null, categorySlug: "hotels", parentSlug: "travel" })).toBe(true);
    expect(creditMatches(rules, { merchantName: "Costco", item: "MacBook", categorySlug: "wholesale-clubs", parentSlug: null })).toBe(false);
  });
  it("a certificate applies when its program's brand is the merchant, or the merchant is an eligible brand", () => {
    expect(certificateMatches({ programName: "Hilton Honors", eligible: [] }, { name: "Hilton" })).toBe(true);
    expect(certificateMatches({ programName: "Marriott Bonvoy", eligible: [] }, { name: "Hilton" })).toBe(false);
    expect(certificateMatches({ programName: null, eligible: ["Hampton Inn", "Hilton Garden Inn"] }, { name: "Hilton Garden Inn" })).toBe(true);
    expect(certificateMatches({ programName: "World of Hyatt", eligible: [] }, { name: "Hyatt Regency", parentCompany: "Hyatt Hotels" })).toBe(true);
    expect(certificateMatches({ programName: "Rewards Club", eligible: [] }, { name: "Club Med" })).toBe(false); // a generic word is not a brand
  });
});

describe("TC-LABEL: offer labels", () => {
  it("reads the same however the offer was entered", () => {
    expect(offerLabel("Hilton", { valueCents: 10_000, percent: null, minSpendCents: 50_000 })).toBe("Hilton offer: $100 back on $500");
    expect(offerLabel("Uber Eats", { valueCents: 2_000, percent: 10, minSpendCents: null })).toBe("Uber Eats offer: 10% back up to $20");
    expect(offerLabel("Delta", { valueCents: 0, percent: null, points: 5000, minSpendCents: null })).toBe("Delta offer: 5,000 points");
    expect(offerLabel("Gap", { valueCents: 1_250, percent: null, minSpendCents: null })).toBe("Gap offer: $12.50 back");
  });
});

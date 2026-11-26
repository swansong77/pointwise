import { Cert, certificateOpportunities, certState, checkFreeNight, Elite, eliteView, Member, membershipView, parseBlackout, renewalCreditSuggestion, Stay } from "../../../src/domain/loyalty-assets";
import { predictExpiration } from "../../../src/domain/loyalty-expiration";
import { buildForecast, ForecastItem, ValuationInput, valueAssets, ValuedAccount, ValuedCert } from "../../../src/domain/loyalty-valuation";
import { AwardOption, estimateAwardPoints, matchCertificates, rankAwardOptions, TripInput } from "../../../src/domain/award-trip";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const NOW = d("2026-11-25");

const cert = (o: Partial<Cert> = {}): Cert => ({ id: "c1", category: "FREE_NIGHT", name: "IHG Free Night", program: "IHG One Rewards", member: "Me", status: "AVAILABLE", quantity: 1, issuedAt: d("2025-12-01"), expiresAt: d("2027-01-09"), pointCap: 40_000, eligible: [], blackout: null, restrictions: null, transferable: false, potentialValueCents: 30_000, ...o });
const stay = (o: Partial<Stay> = {}): Stay => ({ hotel: "InterContinental Chicago", brand: "InterContinental", pointsPerNight: 35_000, cashRateCents: 48_000, checkIn: d("2026-12-20"), ...o });

describe("TC-CERT: certificate state and redemption rules", () => {
  it("states: available, expiring, expired (even if not marked), used, cancelled", () => {
    expect(certState(cert({ expiresAt: d("2027-06-01") }), NOW)).toMatchObject({ state: "AVAILABLE", effectiveStatus: "AVAILABLE" });
    expect(certState(cert(), NOW)).toMatchObject({ state: "EXPIRING", daysLeft: 45 });
    expect(certState(cert({ expiresAt: d("2026-11-01") }), NOW)).toMatchObject({ state: "EXPIRED", effectiveStatus: "EXPIRED" });
    expect(certState(cert({ status: "EXPIRED" }), NOW).state).toBe("EXPIRED");
    expect(certState(cert({ status: "USED" }), NOW).state).toBe("USED");
    expect(certState(cert({ status: "CANCELLED" }), NOW).effectiveStatus).toBe("CANCELLED");
    expect(certState(cert({ expiresAt: null }), NOW)).toMatchObject({ state: "AVAILABLE", daysLeft: null });
  });
  it("a valid stay is allowed and worth the cash price", () => {
    const r = checkFreeNight(cert(), stay(), NOW);
    expect(r).toMatchObject({ ok: true, valueCents: 48_000, reasons: [] });
    expect(r.warnings.join(" ")).toMatch(/Expires in 45 day/);
  });
  it("each rule can block: cap, eligibility, expiry before the stay, blackout, status, quantity, category", () => {
    expect(checkFreeNight(cert(), stay({ pointsPerNight: 60_000 }), NOW).reasons[0]).toMatch(/covers up to 40,000/);
    expect(checkFreeNight(cert({ eligible: ["Holiday Inn"] }), stay(), NOW).reasons[0]).toMatch(/not in the eligible list/);
    expect(checkFreeNight(cert({ eligible: ["intercontinental"] }), stay(), NOW).ok).toBe(true);
    expect(checkFreeNight(cert(), stay({ checkIn: d("2027-02-01") }), NOW).reasons[0]).toMatch(/after the certificate expires/);
    expect(checkFreeNight(cert({ blackout: "2026-12-18..2027-01-02" }), stay(), NOW).reasons[0]).toMatch(/blackout/);
    expect(checkFreeNight(cert({ status: "USED" }), stay(), NOW).reasons[0]).toMatch(/used/);
    expect(checkFreeNight(cert({ quantity: 0 }), stay(), NOW).reasons.join(" ")).toMatch(/No certificates left/);
    expect(checkFreeNight(cert({ category: "UPGRADE" }), stay(), NOW).reasons[0]).toMatch(/not a free night/);
    expect(checkFreeNight(cert({ pointCap: null }), stay({ pointsPerNight: 99_000 }), NOW).ok).toBe(true);
  });
  it("blackout text that cannot be parsed becomes a warning; ranges parse", () => {
    expect(parseBlackout("2026-12-18..2027-01-02; 2027-03-01 to 2027-03-10")).toHaveLength(2);
    expect(parseBlackout(null)).toEqual([]);
    const r = checkFreeNight(cert({ blackout: "major holidays", restrictions: "weekends only" }), stay(), NOW);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/could not be read.*major holidays/);
    expect(r.warnings.join(" ")).toMatch(/weekends only/);
  });
  it("opportunities: best qualifying hotel, the example wording, soonest first", () => {
    const hotels = [stay({ hotel: "Holiday Inn Express", brand: "Holiday Inn", cashRateCents: 15_000, pointsPerNight: 15_000 }), stay()];
    const [o] = certificateOpportunities([cert()], hotels, NOW);
    expect(o).toMatchObject({ valueCents: 48_000, hotel: "InterContinental Chicago", urgency: "MEDIUM", daysLeft: 45 });
    expect(o.message).toBe("You have a IHG Free Night expiring in 45 days. Redeem at InterContinental Chicago. Potential value: $480.");
    const later = cert({ id: "c2", expiresAt: d("2027-08-01"), name: "Hyatt Award" });
    const urgent = cert({ id: "c3", expiresAt: d("2026-12-10"), name: "Marriott Award", potentialValueCents: 20_000 });
    const list = certificateOpportunities([later, cert(), urgent], [], NOW);
    expect(list.map((x) => x.certId)).toEqual(["c3", "c1", "c2"]);
    expect(list[0]).toMatchObject({ urgency: "HIGH", hotel: null, valueCents: 20_000 });
    expect(list[2].urgency).toBe("LOW");
    expect(certificateOpportunities([cert({ status: "USED" }), cert({ expiresAt: d("2026-01-01") })], [], NOW)).toEqual([]);
    expect(certificateOpportunities([cert({ category: "COMPANION", potentialValueCents: 0, expiresAt: null })], [stay()], NOW)[0].message).toBe("You have a IHG Free Night.");
  });
});

const elite = (o: Partial<Elite> = {}): Elite => ({ id: "e1", program: "Marriott", level: "Platinum", member: "Me", periodStart: d("2026-01-01"), expiresAt: d("2027-02-28"), metric: "nights", progress: 38, required: 50, maintained: false, valueCents: 60_000, ...o });

describe("TC-ELITE: status progress", () => {
  it("shortfall, percent, pace, likelihood and actions", () => {
    const v = eliteView(elite(), NOW);
    expect(v).toMatchObject({ pct: 76, remaining: 12, daysLeft: 95 });
    expect(v.headline).toBe("Marriott Platinum: 76% there, needs 12 nights");
    expect(v.renewalLikelihood).toBeGreaterThanOrEqual(5);
    expect(v.actions[0]).toMatch(/Earn 12 more nights in the next 95 days/);
  });
  it("on pace is low risk; far behind is high risk with a challenge suggestion", () => {
    expect(eliteView(elite({ progress: 49 }), NOW)).toMatchObject({ risk: "LOW" });
    const slow = eliteView(elite({ progress: 4, expiresAt: d("2026-12-31") }), NOW);
    expect(slow.risk).toBe("HIGH");
    expect(slow.actions.join(" ")).toMatch(/challenge/);
  });
  it("maintained or complete means no work; expired without maintenance says so", () => {
    expect(eliteView(elite({ maintained: true, expiresAt: d("2028-03-31"), required: 0 }), NOW)).toMatchObject({ risk: "NONE", renewalLikelihood: 95, pct: 100 });
    expect(eliteView(elite({ maintained: true, expiresAt: d("2028-03-31"), required: 0 }), NOW).headline).toBe("Marriott Platinum: maintained, through 2028-03");
    expect(eliteView(elite({ progress: 50 }), NOW).headline).toMatch(/maintained/);
    const ex = eliteView(elite({ expiresAt: d("2026-10-01") }), NOW);
    expect(ex).toMatchObject({ risk: "EXPIRED", renewalLikelihood: 0 });
    expect(ex.actions[0]).toMatch(/status match/);
  });
  it("no dates: neutral 50%; no requirement: no percent", () => {
    expect(eliteView(elite({ periodStart: null, expiresAt: null }), NOW)).toMatchObject({ renewalLikelihood: 50, risk: "MEDIUM", daysLeft: null });
    expect(eliteView(elite({ required: 0, progress: 0, metric: null }), NOW).pct).toBeNull();
    expect(eliteView(elite({ required: 0, progress: 0, metric: null }), NOW).headline).toBe("Marriott Platinum: in progress");
  });
});

const member = (o: Partial<Member> = {}): Member => ({ id: "m1", kind: "GLOBAL_ENTRY", name: "Global Entry", member: "Me", expiresAt: d("2027-05-25"), renewalAt: null, renewalCostCents: 12_000, autoRenew: false, annualValueCents: 2_400, ...o });

describe("TC-MEMB: memberships", () => {
  it("expiry wording, state and renewal eligibility", () => {
    expect(membershipView(member(), NOW)).toMatchObject({ daysLeft: 181, state: "ACTIVE", renewalEligible: true });
    expect(membershipView(member(), NOW).headline).toBe("Global Entry expires in 6 months.");
    expect(membershipView(member({ expiresAt: d("2027-01-10"), autoRenew: true }), NOW)).toMatchObject({ state: "EXPIRING", headline: "Global Entry expires in 46 day(s). It renews automatically." });
    expect(membershipView(member({ expiresAt: d("2026-11-20") }), NOW)).toMatchObject({ state: "EXPIRED", headline: "Global Entry expired 5 day(s) ago." });
    expect(membershipView(member({ expiresAt: null, renewalAt: null }), NOW)).toMatchObject({ state: "NO_DATE", renewalEligible: false });
    expect(membershipView(member({ expiresAt: null, renewalAt: d("2027-03-01") }), NOW).daysLeft).toBe(96);
  });
  it("TSA PreCheck renewal opens six months out; Global Entry a year", () => {
    expect(membershipView(member({ kind: "TSA_PRECHECK", expiresAt: d("2027-09-01") }), NOW).renewalEligible).toBe(false);
    expect(membershipView(member({ kind: "TSA_PRECHECK", expiresAt: d("2027-03-01") }), NOW).renewalEligible).toBe(true);
  });
  it("suggests the card credit that can pay for the renewal", () => {
    const credits = [{ benefit: "Global Entry / TSA PreCheck credit", card: "Amex Platinum", remainingCents: 12_000 }, { benefit: "Uber credit", card: "Amex Platinum", remainingCents: 1_500 }];
    expect(renewalCreditSuggestion(member(), credits)!.text).toBe("Use the Global Entry / TSA PreCheck credit on Amex Platinum for renewal.");
    expect(renewalCreditSuggestion(member(), [{ ...credits[0], remainingCents: 5_000 }])!.text).toMatch(/covers part of the cost/);
    expect(renewalCreditSuggestion(member({ renewalCostCents: 0 }), [{ ...credits[0], remainingCents: 5_000 }])!.text).toBe("Use the Global Entry / TSA PreCheck credit on Amex Platinum for renewal.");
    expect(renewalCreditSuggestion(member(), [credits[1]])).toBeNull();
    expect(renewalCreditSuggestion(member({ kind: "OTHER" }), credits)).toBeNull();
    expect(renewalCreditSuggestion(member({ kind: "CLEAR" }), [{ benefit: "CLEAR Plus credit", card: "Amex Platinum", remainingCents: 0 }])).toBeNull();
  });
});

const acct = (o: Partial<ValuedAccount> = {}): ValuedAccount => ({ id: "a1", member: "Me", memberId: "p1", program: "Marriott", unit: "points", balance: 100_000, pending: 5_000, centsPerPoint: 0.8, prediction: predictExpiration({ balance: 100_000, policyType: "NEVER", policyMonths: null, policyVerified: true, lastActivityAt: null, expiresAtOverride: null, now: NOW }), expiredPoints: 0, redeemedPoints: 0, ...o });
const vcert = (o: Partial<ValuedCert> = {}): ValuedCert => ({ ...cert({ expiresAt: d("2027-06-01") }), memberId: "p1", usedAt: null, ...o });
const vin = (o: Partial<ValuationInput> = {}): ValuationInput => ({ now: NOW, accounts: [], certificates: [], statuses: [], memberships: [], unusedCreditsCents: 0, ...o });

describe("TC-VAL: asset valuation", () => {
  it("points are valued at ¢/pt; pending points are potential, not current", () => {
    const v = valueAssets(vin({ accounts: [acct()] }));
    expect(v).toMatchObject({ currentCents: 80_000, potentialCents: 84_000, atRiskCents: 0, totalPoints: 100_000 });
    expect(v.byCategory.points).toBe(80_000);
  });
  it("points about to expire are at risk; expired and redeemed points are tracked from history", () => {
    const risky = predictExpiration({ balance: 100_000, policyType: "ACTIVITY", policyMonths: 24, policyVerified: true, lastActivityAt: d("2024-12-20"), expiresAtOverride: null, now: NOW });
    const v = valueAssets(vin({ accounts: [acct({ prediction: risky, expiredPoints: 10_000, redeemedPoints: 50_000 })] }));
    expect(v.atRiskCents).toBe(80_000);
    expect(v.expiredCents).toBe(8_000);
    expect(v.recoveredCents).toBe(40_000);
  });
  it("certificates: available counts (quantity applied), expiring is at risk, lapsed is expired, used this year is recovered", () => {
    const v = valueAssets(vin({ certificates: [vcert({ quantity: 2 }), vcert({ id: "x", expiresAt: d("2027-01-10") }), vcert({ id: "y", expiresAt: d("2026-09-01") }), vcert({ id: "z", status: "USED", usedAt: d("2026-06-01") }), vcert({ id: "old", status: "USED", usedAt: d("2024-06-01") })] }));
    expect(v.byCategory.certificates).toBe(90_000);
    expect(v.atRiskCents).toBe(30_000);
    expect(v.expiredCents).toBe(30_000);
    expect(v.recoveredCents).toBe(30_000);
  });
  it("status: live status counts; unlikely renewal puts the unmaintained share at risk and in the potential", () => {
    const e = elite({ progress: 4, expiresAt: d("2026-12-31") });
    const view = eliteView(e, NOW);
    const v = valueAssets(vin({ statuses: [{ ...e, memberId: "p1", view }, { ...elite({ id: "e2", maintained: true, required: 0, expiresAt: d("2028-03-31") }), memberId: "p1", view: eliteView(elite({ maintained: true, required: 0, expiresAt: d("2028-03-31") }), NOW) }, { ...elite({ id: "e3", expiresAt: d("2026-01-31") }), memberId: "p1", view: eliteView(elite({ expiresAt: d("2026-01-31") }), NOW) }] }));
    expect(v.byCategory.status).toBe(120_000); // the expired one is ignored
    expect(v.atRiskCents).toBe(Math.round((60_000 * (100 - view.renewalLikelihood)) / 100));
    expect(v.potentialCents).toBe(v.currentCents + v.atRiskCents);
    expect(v.annualNetCents).toBe(120_000);
  });
  it("memberships: pro-rated to time left, renewal cost reduces annual net, expiring soon is at risk, lapsed ignored", () => {
    const m = (o: Partial<Member>) => ({ ...member(o), memberId: "p1" });
    const v = valueAssets(vin({ memberships: [m({ expiresAt: d("2027-02-23"), annualValueCents: 36_500, renewalCostCents: 12_000 }), m({ id: "n", expiresAt: null, annualValueCents: 1_000, renewalCostCents: 0 }), m({ id: "o", expiresAt: d("2026-01-01") })] }));
    expect(v.byCategory.memberships).toBe(Math.round(36_500 * (90 / 365)) + 1_000);
    expect(v.annualNetCents).toBe(36_500 - 12_000 + 1_000);
    expect(v.atRiskCents).toBe(Math.round(36_500 * (90 / 365)));
  });
  it("credits and a household of two members", () => {
    const v = valueAssets(vin({ unusedCreditsCents: 25_000, accounts: [acct(), acct({ id: "a2", member: "Sam", memberId: "p2", balance: 10_000, pending: 0 })] }));
    expect(v.currentCents).toBe(80_000 + 8_000 + 25_000);
    expect(v.members.map((x) => [x.member, x.currentCents, x.points])).toEqual([["Me", 80_000, 100_000], ["Sam", 8_000, 10_000]]);
    expect(valueAssets(vin())).toMatchObject({ currentCents: 0, members: [] });
  });
});

describe("TC-FCST: expiration forecast", () => {
  const item = (label: string, date: string, v = 1_000): ForecastItem => ({ type: "POINTS", label, member: "Me", date: d(date), valueCents: v });
  it("puts each item in the first window that contains it, with totals; past-due items first", () => {
    const f = buildForecast([item("a", "2026-12-10", 100), item("b", "2027-01-20", 200), item("c", "2027-04-01", 300), item("d", "2027-09-01", 400), item("e", "2028-06-01", 500), item("f", "2029-06-01", 600), item("late", "2026-11-01", 50), item("today", "2026-11-25", 10)], NOW);
    expect(f.overdue.map((x) => x.label)).toEqual(["late"]);
    expect(f.buckets.map((b) => [b.key, b.items.map((x) => x.label), b.totalCents])).toEqual([
      ["next30", ["today", "a"], 110],
      ["next90", ["b"], 200],
      ["next180", ["c"], 300],
      ["next365", ["d"], 400],
      ["next730", ["e"], 500],
    ]);
  });
  it("empty is safe", () => {
    expect(buildForecast([], NOW).buckets.every((b) => b.items.length === 0 && b.totalCents === 0)).toBe(true);
  });
});

const trip = (o: Partial<TripInput> = {}): TripInput => ({ destination: "Tokyo", departs: d("2027-03-10"), returns: d("2027-03-20"), cabin: "BUSINESS", airlinePrefs: [], hotelPrefs: [], now: NOW, ...o });
const opt = (o: Partial<AwardOption> = {}): AwardOption => ({ programCode: "UA", programName: "United MileagePlus", kind: "AIRLINE", pointsNeeded: 170_000, covered: 170_000, shortfall: 0, costCents: 0, maxTransferDays: 0, usesTransfer: false, activeBonusPercent: null, bonusAdvice: null, expiringPoints: 0, summary: "", ...o });

describe("TC-AWARD: award trip evaluation", () => {
  it("estimates are coarse and scale with travelers and direction", () => {
    expect(estimateAwardPoints("BUSINESS", "LONG_HAUL")).toBe(170_000);
    expect(estimateAwardPoints("ECONOMY", "DOMESTIC", 2, false)).toBe(25_000);
    expect(estimateAwardPoints("FIRST", "SHORT_INTERNATIONAL", 1, true)).toBe(160_000);
  });
  it("ranks a fully covered, cheap option above a short or costly one", () => {
    const r = rankAwardOptions([opt({ programCode: "AA", programName: "AAdvantage", shortfall: 40_000, covered: 130_000 }), opt({ programCode: "DL", programName: "SkyMiles", costCents: 20_000 }), opt()], trip());
    expect(r.map((x) => x.programCode)).toEqual(["UA", "DL", "AA"]);
    expect(r[0].reasons[0]).toMatch(/fully cover/);
    expect(r[2].warnings[0]).toMatch(/40,000 points short/);
  });
  it("expiring points, preferences and active bonuses raise the score with reasons", () => {
    const r = rankAwardOptions([opt({ programCode: "AA", programName: "AAdvantage", expiringPoints: 60_000 }), opt({ programCode: "UA", activeBonusPercent: 30, usesTransfer: true, maxTransferDays: 2 })], trip({ airlinePrefs: ["AAdvantage"] }));
    expect(r[0].programCode).toBe("AA");
    expect(r[0].reasons.join(" ")).toMatch(/60,000 points that are about to expire/);
    expect(r[0].reasons.join(" ")).toMatch(/preferred program/);
    expect(r[1].reasons.join(" ")).toMatch(/30% transfer bonus/);
  });
  it("transfers that arrive after departure are penalised; bonus advice is surfaced", () => {
    const wait = { verdict: "WAIT" as const, text: "Wait for an expected transfer bonus.", confidence: 60, expectedWithinDays: 45 };
    const go = { verdict: "TRANSFER_NOW" as const, text: "Current 30% bonus exceeds the average.", confidence: 70, expectedWithinDays: null };
    const late = rankAwardOptions([opt({ usesTransfer: true, maxTransferDays: 7 })], trip({ departs: d("2026-11-28") }))[0];
    expect(late.warnings.join(" ")).toMatch(/Transfers take up to 7 day/);
    expect(late.score).toBeLessThan(100);
    expect(rankAwardOptions([opt({ usesTransfer: true, bonusAdvice: wait })], trip())[0].warnings).toContain(wait.text);
    expect(rankAwardOptions([opt({ usesTransfer: true, bonusAdvice: go })], trip())[0].reasons).toContain(go.text);
    expect(rankAwardOptions([opt({ usesTransfer: true, bonusAdvice: wait })], trip({ departs: d("2026-12-15") }))[0].warnings).not.toContain(wait.text);
  });
  it("ties break by cost then name; nothing to rank is empty", () => {
    const r = rankAwardOptions([opt({ programCode: "B", programName: "Beta" }), opt({ programCode: "A", programName: "Alpha" })], trip());
    expect(r.map((x) => x.programName)).toEqual(["Alpha", "Beta"]);
    expect(rankAwardOptions([], trip())).toEqual([]);
  });
  it("matches free night certificates to hotel preferences and checks validity on the stay dates", () => {
    const certs = [cert({ expiresAt: d("2027-06-01") }), cert({ id: "c2", name: "Hyatt Free Night", program: "World of Hyatt", expiresAt: d("2027-01-01") }), cert({ id: "c3", category: "UPGRADE" }), cert({ id: "c4", status: "USED" })];
    const m = matchCertificates(certs, trip({ hotelPrefs: ["Hyatt", "IHG"] }));
    expect(m.map((x) => [x.certId, x.usable])).toEqual([["c1", true], ["c2", false]]);
    expect(m[0].note).toMatch(/Valid for a stay starting 2027-03-10/);
    expect(m[1].note).toMatch(/Expires 2027-01-01, before the stay/);
    expect(matchCertificates(certs, trip({ hotelPrefs: ["Marriott"] }))).toEqual([]);
    expect(matchCertificates([cert({ expiresAt: d("2027-12-01") })], trip())).toHaveLength(1);
    expect(matchCertificates([cert({ expiresAt: d("2027-03-20") })], trip({ departs: d("2026-12-01") }))[0].note).toMatch(/^Valid/);
    const soon = matchCertificates([cert()], trip({ departs: d("2026-12-20") }));
    expect(soon[0].note).toMatch(/use it soon, it expires in 45 days/);
  });
});

import { blackoutRanges, evaluateConditions, explainCondition, parseConditions } from "../../../src/domain/loyalty-conditions";
import { CADENCE_OF, freshness, isDue, nextRefreshAt, refreshConfidence, refreshPlan, refreshPriority, RefreshInput, REFRESH_INTERVAL_HOURS, summarizeRuns } from "../../../src/domain/loyalty-refresh";
import { accountHealth, AccountHealthInput, aggregateHealth, HEALTH_WEIGHTS, householdHealth, labelFor } from "../../../src/domain/loyalty-health";
import { detectProgram, parseLoyaltyStatement } from "../../../src/domain/loyalty-statement";
import { Cert, checkFreeNight, Stay } from "../../../src/domain/loyalty-assets";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const NOW = d("2026-11-25");

describe("TC-COND: certificate condition engine", () => {
  const text = "Valid up to 40,000 points. Valid only on award bookings. Valid for Category 1-4 hotels. Requires paid companion ticket. Must originate in the United States. Not transferable. Cancellations within 24 hours forfeit the certificate. Expires on March 31, 2027. Limited to one night per stay. Enjoy your stay!";
  const parsed = parseConditions(text);
  const by = (t: string) => parsed.conditions.find((c) => c.type === t)!;
  it("structures the example rules and explains them in plain words", () => {
    expect(by("POINT_CAP").params).toEqual({ cap: 40_000 });
    expect(explainCondition(by("POINT_CAP"))).toBe("Valid up to 40,000 points.");
    expect(explainCondition(by("AWARD_ONLY"))).toBe("Valid only on award bookings.");
    expect(by("CATEGORY_RANGE").params).toEqual({ min: 1, max: 4 });
    expect(explainCondition(by("CATEGORY_RANGE"))).toBe("Valid for Category 1-4 hotels.");
    expect(explainCondition(by("REQUIRES_PAID_FARE"))).toBe("Requires paid companion ticket.");
    expect(by("ORIGIN_COUNTRY").params).toEqual({ country: "US" });
    expect(explainCondition(by("ORIGIN_COUNTRY"))).toBe("Must originate in the United States.");
    expect(explainCondition(by("TRANSFER_RULE"))).toBe("Not transferable.");
    expect(by("CANCELLATION_RULE").group).toBe("CANCELLATION");
    expect(by("EXPIRATION_RULE").group).toBe("EXPIRATION");
    expect(explainCondition(by("EXPIRATION_RULE"))).toBe("Expires 2027-03-31.");
    expect(by("USAGE_RULE").group).toBe("USAGE");
    expect(parsed.unparsed).toEqual(["Enjoy your stay!"]);
    expect(parsed.version).toBe("loyalty-conditions/1");
  });
  it("every condition type has a group; other phrasings", () => {
    expect(new Set(parsed.conditions.map((c) => c.group))).toEqual(new Set(["CONDITION", "RESTRICTION", "TRANSFER", "CANCELLATION", "EXPIRATION", "USAGE"]));
    expect(parseConditions("Valid for Category 4 or lower.").conditions[0].params).toEqual({ min: 1, max: 4 });
    expect(explainCondition(parseConditions("Valid for Category 3-3 hotels.").conditions[0])).toBe("Valid for Category 3 hotels.");
    expect(parseConditions("Award travel only.").conditions[0].type).toBe("AWARD_ONLY");
    expect(parseConditions("Can be transferred to another member.").conditions[0].params).toEqual({ transferable: true });
    expect(explainCondition(parseConditions("Can be transferred to another member.").conditions[0])).toBe("Can be transferred to another member.");
    expect(parseConditions("Must depart from Canada.").conditions[0].params).toEqual({ country: "CA" });
    expect(parseConditions("Must originate in Narnia.").conditions[0].params).toEqual({ country: "Narnia" });
    expect(explainCondition(parseConditions("Must originate in Narnia.").conditions[0])).toBe("Must originate in Narnia.");
    expect(parseConditions("").conditions).toEqual([]);
    expect(parseConditions(null).unparsed).toEqual([]);
    expect(parseConditions("Weekdays only.").conditions[0].type).toBe("USAGE_RULE");
    expect(explainCondition(parseConditions("Weekdays only.").conditions[0])).toBe("Weekdays only.");
  });
  it("blackout: ranges, none, and unreadable rules", () => {
    const r = parseConditions("Blackout dates: 2026-12-18..2027-01-02; 2027-03-01 to 2027-03-10.").conditions.find((c) => c.type === "BLACKOUT")!;
    expect((r.params.ranges as unknown[]).length).toBe(2);
    expect(explainCondition(r)).toBe("Blackout: 2026-12-18 to 2027-01-02; 2027-03-01 to 2027-03-10.");
    expect(explainCondition(parseConditions("No blackout dates apply.").conditions.find((c) => c.type === "BLACKOUT")!)).toBe("No blackout dates.");
    expect(explainCondition(parseConditions("Blackout dates apply during holidays.").conditions.find((c) => c.type === "BLACKOUT")!)).toMatch(/^Blackout rule:/);
    expect(blackoutRanges("nonsense")).toEqual([]);
  });
  it("evaluates a booking: violations for what is wrong, warnings for what cannot be checked", () => {
    const c = parsed.conditions;
    expect(evaluateConditions(c, { pointsPerNight: 60_000, category: 6, bookingType: "CASH", originCountry: "GB", date: d("2027-06-01") }).violations).toEqual([
      "The room costs 60,000 points; valid up to 40,000 points.",
      "Valid only on award bookings.",
      "The hotel is Category 6. Valid for Category 1-4 hotels.",
      "The trip starts in GB. Must originate in the United States.",
      "The date is after the certificate expires (2027-03-31).",
    ]);
    const ok = evaluateConditions(c, { pointsPerNight: 30_000, category: 3, bookingType: "AWARD", originCountry: "us", date: d("2027-01-10") });
    expect(ok.violations).toEqual([]);
    expect(ok.warnings).toEqual(expect.arrayContaining(["Requires paid companion ticket.", "Not transferable."]));
    const unknown = evaluateConditions(c, {});
    expect(unknown.violations).toEqual([]);
    expect(unknown.warnings).toEqual(expect.arrayContaining(["Valid only on award bookings.", "Valid for Category 1-4 hotels. Check the hotel's category.", "Must originate in the United States."]));
    const bo = parseConditions("Blackout: 2026-12-18..2027-01-02.").conditions;
    expect(evaluateConditions(bo, { date: d("2026-12-25") }).violations).toEqual(["The date falls in a blackout period."]);
    expect(evaluateConditions(bo, { date: d("2027-02-01") }).violations).toEqual([]);
    expect(evaluateConditions(parseConditions("Blackout dates apply during holidays.").conditions, {}).warnings[0]).toMatch(/could not be read/);
    expect(evaluateConditions(parseConditions("No blackout dates apply.").conditions, { date: d("2026-12-25") })).toEqual({ violations: [], warnings: [] });
  });
  it("the redemption check uses stored conditions", () => {
    const cert: Cert = { id: "c", category: "FREE_NIGHT", name: "Night", program: "Hilton", member: "Me", status: "AVAILABLE", quantity: 1, issuedAt: null, expiresAt: d("2027-06-01"), pointCap: 40_000, eligible: [], blackout: null, restrictions: null, transferable: false, potentialValueCents: 30_000, conditions: parseConditions("Valid for Category 1-4 hotels. Valid only on award bookings.").conditions };
    const stay: Stay = { hotel: "Grand", pointsPerNight: 30_000, cashRateCents: 40_000, checkIn: d("2027-01-10"), category: 6 };
    const r = checkFreeNight(cert, stay, NOW);
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(["The hotel is Category 6. Valid for Category 1-4 hotels."]);
    const good = checkFreeNight(cert, { ...stay, category: 3 }, NOW);
    expect(good).toMatchObject({ ok: true, valueCents: 40_000 });
    expect(checkFreeNight(cert, { ...stay, category: 3, bookingType: "CASH" }, NOW).reasons).toEqual(["Valid only on award bookings."]);
    // the cap, blackout and expiry rules are not reported twice
    const dup = { ...cert, conditions: parseConditions("Valid up to 40,000 points. Expires on June 1, 2027.").conditions };
    expect(checkFreeNight(dup, { ...stay, pointsPerNight: 60_000 }, NOW).reasons).toHaveLength(1);
  });
});

const inp = (o: Partial<RefreshInput> = {}): RefreshInput => ({ balance: 50_000, lastObservedAt: d("2026-11-20"), lastSuccessAt: d("2026-11-20"), sourceType: "EMAIL", reliability: 80, daysToExpiry: null, pendingObservations: 0, transferBonusActive: false, statusAtRisk: false, certificateExpiringSoon: false, now: NOW, ...o });

describe("TC-REFRESH: priority, schedule, staleness", () => {
  it("critical for expiring points, pending decisions, active bonuses, status risk, expiring certificates", () => {
    expect(refreshPriority(inp({ daysToExpiry: 12 }))).toEqual({ priority: "CRITICAL", reasons: ["points expire in 12 day(s)"] });
    expect(refreshPriority(inp({ daysToExpiry: -3 })).reasons[0]).toBe("points may already have expired");
    expect(refreshPriority(inp({ pendingObservations: 2 })).reasons[0]).toBe("2 change(s) need your decision");
    expect(refreshPriority(inp({ transferBonusActive: true })).priority).toBe("CRITICAL");
    expect(refreshPriority(inp({ statusAtRisk: true })).priority).toBe("CRITICAL");
    expect(refreshPriority(inp({ certificateExpiringSoon: true })).priority).toBe("CRITICAL");
    expect(refreshPriority(inp({ daysToExpiry: 5, statusAtRisk: true, balance: 0 })).reasons).toEqual(["elite status is at risk"]);
  });
  it("high within 90 days, when never refreshed or a month old; normal and low otherwise", () => {
    expect(refreshPriority(inp({ daysToExpiry: 80 }))).toEqual({ priority: "HIGH", reasons: ["points expire in 80 days"] });
    expect(refreshPriority(inp({ lastObservedAt: null })).reasons).toEqual(["never refreshed"]);
    expect(refreshPriority(inp({ lastObservedAt: d("2026-09-01") })).reasons).toEqual(["data is more than a month old"]);
    expect(refreshPriority(inp())).toEqual({ priority: "NORMAL", reasons: ["no deadline in sight"] });
    expect(refreshPriority(inp({ balance: 0 }))).toEqual({ priority: "LOW", reasons: ["empty balance"] });
    expect(refreshPriority(inp({ daysToExpiry: 20, balance: 0 })).priority).toBe("LOW");
  });
  it("intervals, cadence, next time and due-ness", () => {
    expect(REFRESH_INTERVAL_HOURS).toEqual({ CRITICAL: 24, HIGH: 72, NORMAL: 168, LOW: 720 });
    expect(CADENCE_OF).toEqual({ CRITICAL: "DAILY", HIGH: "DAILY", NORMAL: "WEEKLY", LOW: "SCHEDULED" });
    expect(nextRefreshAt("CRITICAL", d("2026-11-24"), NOW)).toEqual(new Date("2026-11-25T12:00:00Z"));
    expect(nextRefreshAt("NORMAL", null, NOW)).toEqual(new Date("2026-12-02T12:00:00Z"));
    expect(isDue(null, NOW)).toBe(true);
    expect(isDue(new Date("2026-11-25T11:00:00Z"), NOW)).toBe(true);
    expect(isDue(new Date("2026-11-26T11:00:00Z"), NOW)).toBe(false);
  });
  it("freshness against the interval, and confidence decay", () => {
    expect(freshness(null, "NORMAL", NOW)).toBe("NEVER");
    expect(freshness(d("2026-11-22"), "NORMAL", NOW)).toBe("FRESH");
    expect(freshness(d("2026-11-15"), "NORMAL", NOW)).toBe("AGING");
    expect(freshness(d("2026-10-01"), "NORMAL", NOW)).toBe("STALE");
    expect(freshness(d("2026-11-22"), "CRITICAL", NOW)).toBe("STALE");
    expect(refreshConfidence(80, NOW, NOW)).toBe(80);
  });
  it("the plan names what to do, automated or not, by what the member has set up", () => {
    const a = refreshPlan("Marriott", "STALE", { mailbox: true, programHasEmailRules: true, extension: true });
    expect(a.map((x) => x.kind)).toEqual(["SYNC_MAILBOX", "CAPTURE_PAGE", "FORWARD_STATEMENT", "UPDATE_MANUALLY"]);
    expect(a[0].automated).toBe(true);
    expect(a.slice(1).every((x) => !x.automated)).toBe(true);
    expect(refreshPlan("Marriott", "FRESH", { mailbox: true, programHasEmailRules: true, extension: true }).map((x) => x.kind)).toEqual(["SYNC_MAILBOX"]);
    expect(refreshPlan("Marriott", "NEVER", { mailbox: false, programHasEmailRules: true, extension: false }).map((x) => x.kind)).toEqual(["CONNECT_MAILBOX", "FORWARD_STATEMENT", "UPDATE_MANUALLY"]);
    expect(refreshPlan("X", "AGING", { mailbox: true, programHasEmailRules: false, extension: false }).map((x) => x.kind)).toEqual(["FORWARD_STATEMENT", "UPDATE_MANUALLY"]);
  });
  it("sync run summary", () => {
    expect(summarizeRuns([{ status: "OK" }, { status: "OK" }, { status: "PARTIAL" }, { status: "FAILED" }])).toEqual({ total: 4, ok: 2, partial: 1, failed: 1, successRate: 0.63 });
    expect(summarizeRuns([])).toMatchObject({ total: 0, successRate: null });
  });
});

const h = (o: Partial<AccountHealthInput> = {}): AccountHealthInput => ({ freshness: "FRESH", syncSuccessRate: 1, expirationLevel: "NONE", refreshConfidence: 80, certificatesExpiring: 0, statusRisk: null, transferOpportunityOpen: false, expiredValueCents: 0, currentValueCents: 100_000, creditsExpiringCents: 0, creditsTotalCents: 0, ...o });

describe("TC-HEALTH: loyalty health score", () => {
  it("weights sum to 100; a clean account scores high with a reason for every factor", () => {
    expect(Object.values(HEALTH_WEIGHTS).reduce((s, w) => s + w, 0)).toBe(100);
    const r = accountHealth(h());
    expect(r.factors).toHaveLength(8);
    expect(r.score).toBe(98); // everything perfect except confidence 80% of 10 points
    expect(r.label).toBe("HEALTHY");
    expect(r.factors.every((f) => f.reason.length > 3 && f.value >= 0 && f.value <= 1)).toBe(true);
    expect(r.version).toBe("loyalty-health/1");
  });
  it("each problem lowers the score by its weight", () => {
    const base = accountHealth(h()).score;
    expect(accountHealth(h({ freshness: "STALE", syncSuccessRate: 0.5 })).score).toBeLessThan(base - 10);
    expect(accountHealth(h({ freshness: "NEVER", syncSuccessRate: null })).factors[0].value).toBe(0);
    expect(accountHealth(h({ expirationLevel: "HIGH" })).score).toBe(base - 20);
    expect(accountHealth(h({ expirationLevel: "EXPIRED" })).score).toBe(base - 25);
    expect(accountHealth(h({ certificatesExpiring: 2 })).score).toBeLessThan(base);
    expect(accountHealth(h({ certificatesExpiring: 9 })).factors[3].value).toBe(0);
    expect(accountHealth(h({ statusRisk: "HIGH" })).score).toBeLessThanOrEqual(base - 8);
    expect(accountHealth(h({ transferOpportunityOpen: true })).score).toBe(base - 2);
    expect(accountHealth(h({ expiredValueCents: 100_000 })).score).toBe(base - 5);
    expect(accountHealth(h({ creditsExpiringCents: 5_000, creditsTotalCents: 10_000 })).score).toBe(base - 5);
    expect(accountHealth(h({ expiredValueCents: 0, currentValueCents: 0 })).factors[6].reason).toBe("nothing to utilize yet");
    expect(accountHealth(h({ statusRisk: "NONE" })).factors[4].value).toBe(1);
  });
  it("labels", () => {
    expect([labelFor(95), labelFor(80), labelFor(79), labelFor(50), labelFor(49)]).toEqual(["HEALTHY", "HEALTHY", "NEEDS_ATTENTION", "NEEDS_ATTENTION", "AT_RISK"]);
    expect(accountHealth(h({ freshness: "NEVER", syncSuccessRate: null, expirationLevel: "EXPIRED", refreshConfidence: 0, statusRisk: "EXPIRED", expiredValueCents: 100_000 })).label).toBe("AT_RISK");
  });
  it("program and household scores weight by value", () => {
    const items = [{ id: "a", label: "Big", score: 40, weight: 900_000 }, { id: "b", label: "Small", score: 100, weight: 100_000 }];
    expect(aggregateHealth(items)).toEqual({ score: 46, label: "AT_RISK", count: 2 });
    expect(aggregateHealth([{ id: "a", label: "x", score: 60, weight: 0 }, { id: "b", label: "y", score: 80, weight: 0 }]).score).toBe(70);
    expect(aggregateHealth([])).toEqual({ score: 100, label: "HEALTHY", count: 0 });
    const hh = householdHealth(items, { certificatesExpiring: 1, certificatesTotal: 2, creditsExpiringCents: 5_000, creditsTotalCents: 10_000 });
    expect(hh.score).toBe(Math.round(46 * 0.8 + 50 * 0.2));
    expect(hh.reasons).toEqual(["1 of 2 certificates expire within 90 days", "$50 of travel credits expire within 30 days", "Big is the weakest account (40)"]);
    expect(householdHealth([{ id: "a", label: "x", score: 90, weight: 1 }], { certificatesExpiring: 0, certificatesTotal: 0, creditsExpiringCents: 0, creditsTotalCents: 0 })).toMatchObject({ score: 92, reasons: [] });
  });
});

const STATEMENT = [
  "Marriott Bonvoy Account Statement",
  "Statement period: 10/01/2026 - 10/31/2026",
  "Beginning balance 80,000",
  "10/05/2026  Hotel stay Courtyard Chicago  +4,500",
  "10/12/2026  Bonus promotion  +2,000",
  "10/18/2026  Points redeemed for award night  -10,000",
  "10/25/2026  Points expired  -1,500",
  "Total points earned 6,500",
  "Total points redeemed 10,000",
  "Total points expired 1,500",
  "Ending balance 75,000",
  "Your Platinum Elite status is valid through February 28, 2027.",
];

describe("TC-STMT: loyalty statement parser", () => {
  it("reads the program, period, balances, totals and activity, and reconciles", () => {
    const r = parseLoyaltyStatement(STATEMENT, NOW);
    expect(r.program?.programCode).toBe("MAR_BONVOY");
    expect(r.periodStart).toEqual(new Date("2026-10-01T00:00:00Z"));
    expect(r.periodEnd).toEqual(new Date("2026-10-31T00:00:00Z"));
    expect([r.opening, r.closing]).toEqual([80_000, 75_000]);
    expect(r.totals).toEqual({ earned: 6_500, redeemed: 10_000, expired: 1_500 });
    expect(r.activity.map((a) => [a.kind, a.points, a.balanceAfter])).toEqual([["EARN", 4_500, 84_500], ["BONUS", 2_000, 86_500], ["REDEEM", -10_000, 76_500], ["EXPIRE", -1_500, 75_000]]);
    expect(r.validation).toEqual({ status: "PASS", reasons: [] });
    expect(r.extras.find((o) => o.field === "statusLevel")?.value).toBe("Platinum Elite");
    expect(r.kind).toBe("SUMMARY");
    expect(r.parserVersion).toBe("loyalty-statement/1");
  });
  it("warns when the lines do not add up to the printed balance or totals", () => {
    const bad = STATEMENT.filter((l) => !/redeemed for award/.test(l));
    const r = parseLoyaltyStatement(bad, NOW);
    expect(r.validation.status).toBe("WARNING");
    expect(r.validation.reasons.join(" ")).toMatch(/Opening 80,000 plus activity .* not the printed closing balance 75,000/);
    expect(r.validation.reasons.join(" ")).toMatch(/Printed total redeemed 10,000 differs/);
    const e = parseLoyaltyStatement(STATEMENT.map((l) => l.replace("Total points earned 6,500", "Total points earned 9,999")), NOW);
    expect(e.validation.reasons.join(" ")).toMatch(/Printed total earned 9,999 differs/);
    const x = parseLoyaltyStatement(STATEMENT.map((l) => l.replace("Total points expired 1,500", "Total points expired 900")), NOW);
    expect(x.validation.reasons.join(" ")).toMatch(/Printed total expired 900 differs/);
  });
  it("missing balances, unknown program and empty text", () => {
    const noClose = parseLoyaltyStatement(STATEMENT.filter((l) => !/Ending/.test(l)), NOW);
    expect(noClose.validation.status).toBe("WARNING");
    expect(noClose.validation.reasons[0]).toMatch(/No closing balance/);
    const noOpen = parseLoyaltyStatement(STATEMENT.filter((l) => !/Beginning/.test(l)), NOW);
    expect(noOpen.validation.reasons.join(" ")).toMatch(/No opening balance/);
    const unknown = parseLoyaltyStatement(["Some Rewards Statement", "Beginning balance 5", "Ending balance 5"], NOW);
    expect(unknown.program).toBeNull();
    expect(unknown.validation.reasons[0]).toMatch(/could not be identified/);
    const empty = parseLoyaltyStatement(["nothing here"], NOW);
    expect(empty.validation.status).toBe("FAILED");
    expect(empty.kind).toBe("NONE");
    expect(parseLoyaltyStatement([], NOW).validation.status).toBe("FAILED");
  });
  it("classifies activity lines and ignores unreadable ones", () => {
    const r = parseLoyaltyStatement(["Hilton Honors statement", "Statement period: 2026-10-01 to 2026-10-31", "Beginning balance 1,000", "10/02/2026 Transfer from Amex +5,000", "10/03/2026 Transfer to partner -500", "10/04/2026 Purchase of points +1,000", "10/05/2026 Account adjustment -100", "10/06/2026 Dining 0", "13/45/2026 Bad date +10", "garbage line", "Ending balance 6,400"], NOW);
    expect(r.activity.map((a) => a.kind)).toEqual(["TRANSFER_IN", "TRANSFER_OUT", "PURCHASE", "ADJUST"]);
    expect(r.activity.map((a) => a.points)).toEqual([5_000, -500, 1_000, -100]);
    expect(r.validation.status).toBe("PASS");
    // no period printed: observations fall back to the given date
    expect(parseLoyaltyStatement(["Hilton Honors", "Beginning balance 1", "Ending balance 1"], NOW).periodEnd).toBeNull();
  });
  it("detects programs by name", () => {
    expect(detectProgram("Your AAdvantage statement")?.programCode).toBe("AA_AADVANTAGE");
    expect(detectProgram("Chase Ultimate Rewards")?.programCode).toBe("CHASE_UR");
    expect(detectProgram("nothing")).toBeNull();
  });
});

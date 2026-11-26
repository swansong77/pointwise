import {
  applicationDifficulty,
  autoPublishDecision,
  AUTO_PUBLISH,
  daysUntil,
  ISSUER_RULES,
  offerAdvice,
  offerStats,
  OFFER_CONFIG,
  verdictFor,
} from "../../../src/domain/offer-intel";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NOW = d("2026-11-25");
const v = (amount: number, from: string, to: string | null) => ({
  bonusAmount: amount,
  valuationCents: amount * 1.4,
  validFrom: d(from),
  validTo: to ? d(to) : null,
});

// 60K → 75K → 90K → 100K (current), mirrors the "Amex Gold" style timeline in the directive
const GOLD = [
  v(60_000, "2025-01-01", "2025-06-01"),
  v(75_000, "2025-06-01", "2026-01-01"),
  v(90_000, "2026-01-01", "2026-09-01"),
  v(100_000, "2026-09-01", null),
];

describe("TC-OFF: offer statistics and verdict", () => {
  it("finds best-ever, median, percentile and days at current", () => {
    const s = offerStats(GOLD, NOW);
    expect(s.currentValueCents).toBe(140_000);
    expect(s.bestEverCents).toBe(140_000);
    expect(s.bestEverSince).toEqual(d("2026-09-01"));
    expect(s.versions).toBe(4);
    expect(s.verdict).toBe("BEST_EVER");
    expect(s.daysAtCurrent).toBe(85);
    expect(s.percentile).toBeGreaterThan(0.8);
  });
  it("a lower current offer than the high is near-high, elevated, typical or below typical", () => {
    const hist = (cur: number) => [
      v(60_000, "2025-01-01", "2025-06-01"),
      v(75_000, "2025-06-01", "2026-01-01"),
      v(100_000, "2026-01-01", "2026-06-01"),
      v(cur, "2026-06-01", null),
    ];
    expect(offerStats(hist(95_000), NOW).verdict).toBe("NEAR_HIGH");
    expect(offerStats(hist(60_000), NOW).verdict).toBe("BELOW_TYPICAL");
    expect(offerStats(hist(80_000), NOW).verdict).toBe("TYPICAL");
    expect(verdictFor(120, 200, 100, 4)).toBe("ELEVATED");
    expect(verdictFor(100, 200, 100, 4)).toBe("TYPICAL");
  });
  it("a single version has nothing to compare against", () => {
    expect(offerStats([v(60_000, "2026-01-01", null)], NOW).verdict).toBe("TYPICAL");
    expect(verdictFor(1, null, null, 1)).toBe("UNKNOWN");
  });
  it("no valuation (e.g. nights) or no history is UNKNOWN, not a crash", () => {
    expect(offerStats([], NOW).verdict).toBe("UNKNOWN");
    const nights = [{ bonusAmount: 2, valuationCents: null, validFrom: d("2026-01-01"), validTo: null }];
    const s = offerStats(nights, NOW);
    expect(s.verdict).toBe("UNKNOWN");
    expect(s.bestEverCents).toBeNull();
  });
  it("history with no open version still reports best-ever", () => {
    const s = offerStats([v(60_000, "2025-01-01", "2025-06-01")], NOW);
    expect(s.currentValueCents).toBeNull();
    expect(s.bestEverCents).toBe(84_000);
    expect(s.verdict).toBe("UNKNOWN");
    expect(s.daysAtCurrent).toBeNull();
  });
  it("equal values share the percentile", () => {
    const s = offerStats([v(50_000, "2025-01-01", "2025-07-01"), v(50_000, "2025-07-01", null)], NOW);
    expect(s.percentile).toBeCloseTo(0.5, 1);
  });
});

describe("TC-OFF: application difficulty", () => {
  const act = (any: Record<number, number>, at: Record<string, number> = {}, holds = false) => ({
    newAccountsAny: (m: number) => any[m] ?? 0,
    newAccountsAt: (i: string) => at[i] ?? 0,
    holdsProduct: holds,
  });
  it("Chase at 5/24 is HARD while the rule is unverified, and says so", () => {
    const r = applicationDifficulty("Chase", act({ 24: 5 }));
    expect(r.level).toBe("HARD");
    expect(r.reasons[0]).toMatch(/5\/24.*community-reported/);
    expect(r.rules).toEqual([{ rule: "5/24", verified: false }]);
  });
  it("one slot left is MODERATE; a verified rule can BLOCK", () => {
    expect(applicationDifficulty("Chase", act({ 24: 4 })).level).toBe("MODERATE");
    const rules = ISSUER_RULES.map((r) => (r.issuer === "chase" ? { ...r, verified: true } : r));
    const r = applicationDifficulty("Chase", act({ 24: 5 }), rules);
    expect(r.level).toBe("BLOCKED");
    expect(r.reasons[0]).not.toMatch(/community-reported/);
  });
  it("issuer-only rules count only that issuer's accounts", () => {
    expect(applicationDifficulty("Capital One", act({ 24: 9 }, {})).level).toBe("EASY");
    expect(applicationDifficulty("Capital One", act({}, { "Capital One": 1 })).level).toBe("HARD");
  });
  it("holding the product makes it HARD; unknown issuers have no velocity rule", () => {
    expect(applicationDifficulty("Chase", act({}, {}, true)).level).toBe("HARD");
    const u = applicationDifficulty("Some Credit Union", act({ 24: 9 }));
    expect(u.level).toBe("EASY");
    expect(u.reasons[0]).toMatch(/No known velocity rule/);
    expect(applicationDifficulty("Chase", act({})).reasons[0]).toBe("No limit reached");
  });
  it("matches issuer names written differently", () => {
    expect(applicationDifficulty("American Express", act({}, { "American Express": 2 })).level).toBe("HARD");
  });
});

describe("TC-OFF: expiry intelligence", () => {
  const base = { verdict: "TYPICAL" as const, daysToExpiry: null, bestEverCents: 140_000, currentValueCents: 100_000 };
  it("urgent apply-by text for an elevated offer about to end", () => {
    const a = offerAdvice({ ...base, verdict: "ELEVATED", daysToExpiry: 9 });
    expect(a[0]).toMatchObject({ code: "APPLY_BEFORE_EXPIRY", tone: "urgent" });
    expect(a[0].text).toBe("Apply within 9 days before this elevated offer expires.");
    expect(offerAdvice({ ...base, verdict: "BEST_EVER", daysToExpiry: 1 })[0].text).toMatch(/Apply within 1 day before/);
  });
  it("near-high, best-ever, prioritise and wait messages", () => {
    expect(offerAdvice({ ...base, verdict: "NEAR_HIGH" })[0].text).toBe("Current offer is near its historic high.");
    expect(offerAdvice({ ...base, verdict: "BEST_EVER" })[0].text).toMatch(/best offer on record/);
    expect(offerAdvice({ ...base, verdict: "ELEVATED" })[0].text).toBe("Offer likely worth prioritizing.");
    expect(offerAdvice({ ...base, verdict: "BELOW_TYPICAL" })[0].text).toBe("Wait for a better offer; this card has been worth up to $1,400.");
    expect(offerAdvice({ ...base, verdict: "BELOW_TYPICAL", bestEverCents: null })[0].text).toBe("Wait for a better offer.");
  });
  it("an expired offer says only that", () => {
    expect(offerAdvice({ ...base, daysToExpiry: -3 })).toEqual([expect.objectContaining({ code: "EXPIRED" })]);
  });
  it("blocked applicant: move to another member, or just blocked", () => {
    expect(offerAdvice({ ...base, applicantBlocked: true, alternateMember: "Spouse" })[0].text).toBe("Move the application to Spouse.");
    expect(offerAdvice({ ...base, applicantBlocked: true })[0].code).toBe("BLOCKED");
  });
  it("soon-but-not-high expiry is informational; typical offers with no expiry give no advice", () => {
    expect(offerAdvice({ ...base, daysToExpiry: 30 })[0]).toMatchObject({ code: "EXPIRES_SOON", tone: "neutral" });
    expect(offerAdvice(base)).toEqual([]);
  });
  it("advice is ordered by priority and daysUntil handles null and past dates", () => {
    const a = offerAdvice({ ...base, verdict: "NEAR_HIGH", daysToExpiry: 5, applicantBlocked: true, alternateMember: "Spouse" });
    expect(a.map((x) => x.code)).toEqual(["MOVE_TO_MEMBER", "APPLY_BEFORE_EXPIRY", "NEAR_HIGH"]);
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil(d("2026-12-05"), NOW)).toBe(10);
    expect(daysUntil(d("2026-11-20"), NOW)).toBe(-5);
    expect(OFFER_CONFIG.urgentDays).toBe(14);
  });
});

describe("TC-OFF: auto-publish policy", () => {
  const ok = {
    field: "bonusAmount",
    oldValue: 80_000,
    newValue: 90_000,
    sourceHost: "www.americanexpress.com",
    issuerHosts: ["americanexpress.com"],
    confidence: 0.9,
    cardKnown: true,
  };
  it("publishes a verified, plausible, bounded change from the issuer's own page", () => {
    expect(autoPublishDecision(ok)).toEqual({ action: "PUBLISH", reasons: [expect.stringMatching(/issuer's own page/)] });
  });
  it.each([
    ["other domain", { sourceHost: "doctorofcredit.com" }, /own domain/],
    ["no host", { sourceHost: null }, /own domain/],
    ["unknown card", { cardKnown: false }, /not in the catalog/],
    ["low confidence", { confidence: 0.5 }, /confidence/],
    ["out of bounds", { newValue: AUTO_PUBLISH.bounds.bonusAmount[1] + 1 }, /plausible/],
    ["big jump", { newValue: 300_000 }, /larger than/],
    ["unknown numeric field", { field: "mystery", newValue: 5 }, /no plausibility bounds/],
    ["text field", { field: "notes", newValue: "x" }, /not auto-publishable/],
  ])("sends to review: %s", (_n, over, why) => {
    const r = autoPublishDecision({ ...ok, ...over } as never);
    expect(r.action).toBe("REVIEW");
    expect(r.reasons.join(" ")).toMatch(why);
  });
  it("lookalike hosts do not pass and subdomains do", () => {
    expect(autoPublishDecision({ ...ok, sourceHost: "americanexpress.com.evil.example" }).action).toBe("REVIEW");
    expect(autoPublishDecision({ ...ok, sourceHost: "card.americanexpress.com" }).action).toBe("PUBLISH");
  });
  it("bonus type and expiry fields publish without a ratio check", () => {
    expect(autoPublishDecision({ ...ok, field: "bonusType", oldValue: "POINTS", newValue: "MILES" }).action).toBe("PUBLISH");
    expect(autoPublishDecision({ ...ok, field: "offerExpiresAt", oldValue: null, newValue: "2027-01-15" }).action).toBe("PUBLISH");
  });
});

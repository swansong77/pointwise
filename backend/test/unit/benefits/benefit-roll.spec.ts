import {
  benefitRecord,
  frequencyLabel,
  reconcileBenefit,
  RollBenefit,
  rollup,
  RollUsage,
} from "../../../src/domain/benefit-roll";
import { parsePeriodText, periodContaining } from "../../../src/domain/benefits";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const NOW = d("2027-03-15");

const base = (over: Partial<RollBenefit>): RollBenefit => ({
  benefitId: "b",
  walletCardId: "card1",
  productId: "gold",
  productName: "Amex Gold",
  lastFour: "1001",
  profileId: "me",
  profileName: "Me",
  name: "Dining credit",
  category: "dining",
  period: "MONTHLY",
  periodMonths: 1,
  basis: "CALENDAR",
  amountPerPeriodCents: 1000,
  anchor: d("2025-01-10"),
  enabled: true,
  usages: [],
  ...over,
});
const use = (periodStart: string, amountCents: number, over: Partial<RollUsage> = {}): RollUsage => ({
  periodStart: d(periodStart),
  amountCents,
  status: "CONFIRMED",
  ...over,
});

describe("TC-BEN: frequencies", () => {
  it.each([
    [{ period: "MONTHLY", basis: "CALENDAR" }, "Monthly"],
    [{ period: "QUARTERLY", basis: "CALENDAR" }, "Quarterly"],
    [{ period: "SEMIANNUAL", basis: "CALENDAR" }, "Semi-Annual"],
    [{ period: "ANNUAL", basis: "CALENDAR" }, "Annual"],
    [{ period: "ANNUAL", basis: "CARDMEMBER_YEAR" }, "Anniversary Year"],
    [{ period: "ONE_TIME", basis: "CALENDAR" }, "One-Time"],
    [{ period: "CUSTOM", basis: "CALENDAR" }, "Custom Period"],
    [{ period: "MULTI_YEAR", basis: "CARDMEMBER_YEAR" }, "Custom Period"],
  ] as const)("%j → %s", (b, label) => {
    expect(frequencyLabel(b)).toBe(label);
  });

  it("monthly: the period is the calendar month and resets on the 1st", () => {
    const r = benefitRecord(base({ usages: [use("2027-03-01", 400)] }), NOW);
    expect(r).toMatchObject({
      frequency: "Monthly",
      allocatedCents: 1000,
      usedCents: 400,
      remainingCents: 600,
      utilizationPct: 40,
      resetSchedule: "1st of each month",
    });
    expect(r.periodStart).toEqual(d("2027-03-01"));
    expect(r.periodEnd).toEqual(d("2027-04-01"));
  });
  it("last month's usage does not count toward this month", () => {
    const r = benefitRecord(base({ usages: [use("2027-02-01", 1000)] }), NOW);
    expect(r.usedCents).toBe(0);
  });
  it("quarterly resets in Jan/Apr/Jul/Oct", () => {
    const b = base({ period: "QUARTERLY", periodMonths: 3, amountPerPeriodCents: 10000, usages: [use("2027-01-01", 10000)] });
    const r = benefitRecord(b, NOW);
    expect(r.periodStart).toEqual(d("2027-01-01"));
    expect(r.utilizationPct).toBe(100);
    expect(r.status).toBe("COMPLETED");
    expect(benefitRecord(b, d("2027-04-02")).usedCents).toBe(0);
  });
  it("semi-annual resets Jan and Jul", () => {
    const b = base({ period: "SEMIANNUAL", periodMonths: 6, amountPerPeriodCents: 15000 });
    expect(benefitRecord(b, d("2027-07-01")).periodStart).toEqual(d("2027-07-01"));
    expect(benefitRecord(b, d("2027-06-30")).periodStart).toEqual(d("2027-01-01"));
  });
  it("annual (calendar) resets Jan 1", () => {
    const b = base({ period: "ANNUAL", periodMonths: 12, amountPerPeriodCents: 20000, usages: [use("2026-01-01", 20000)] });
    const r = benefitRecord(b, NOW);
    expect(r.usedCents).toBe(0);
    expect(r.resetSchedule).toBe("Jan 1");
  });
  it("anniversary year follows the account opening date", () => {
    const b = base({ period: "ANNUAL", periodMonths: 12, basis: "CARDMEMBER_YEAR", amountPerPeriodCents: 30000, anchor: d("2025-09-10") });
    const r = benefitRecord(b, NOW);
    expect(r.frequency).toBe("Anniversary Year");
    expect(r.periodStart).toEqual(d("2026-09-10"));
    expect(r.periodEnd).toEqual(d("2027-09-10"));
  });
  it("one-time benefits do not reset and expire on their date", () => {
    const b = base({
      period: "ONE_TIME",
      periodMonths: 12,
      amountPerPeriodCents: 5000,
      anchor: d("2027-01-01"),
      expiresOn: d("2027-06-30"),
      windowEnd: d("2027-06-30"),
    });
    const r = benefitRecord(b, NOW);
    expect(r.frequency).toBe("One-Time");
    expect(r.expirationDate).toEqual(d("2027-06-30"));
    expect(r.resetSchedule).toBe("Expires 2027-06-30");
    expect(r.status).not.toBe("EXPIRED");
    expect(benefitRecord(b, d("2027-07-15")).status).toBe("EXPIRED");
    expect(benefitRecord({ ...b, expiresOn: null, windowEnd: null }, NOW).resetSchedule).toBe("Does not reset");
  });
  it("one-time without any dates gets an open-ended window", () => {
    const w = periodContaining({ period: "ONE_TIME", basis: "CALENDAR", periodMonths: 12 }, null, NOW);
    expect(w.end.getUTCFullYear()).toBeGreaterThan(2060);
  });
  it("custom period repeats every N months from opening", () => {
    const b = base({ period: "CUSTOM", periodMonths: 2, amountPerPeriodCents: 2500, anchor: d("2027-01-10") });
    const r = benefitRecord(b, NOW);
    expect(r.frequency).toBe("Custom Period");
    expect(r.periodStart).toEqual(d("2027-03-10"));
    expect(r.periodEnd).toEqual(d("2027-05-10"));
    expect(r.resetSchedule).toBe("Every 2 months from opening");
  });
  it("period text maps one-time", () => {
    expect(parsePeriodText("One-time").period).toBe("ONE_TIME");
    expect(parsePeriodText("Ends 12/31/2026").period).toBe("ONE_TIME");
    expect(parsePeriodText("Activate by 12/31/2026").period).toBe("ONE_TIME");
    expect(parsePeriodText("Anniversary").period).toBe("ANNUAL");
  });
});

describe("TC-BEN: record fields", () => {
  it("reports detection method, verification, evidence and last update", () => {
    const b = base({
      usages: [
        use("2027-03-01", 500, { detectionMethod: "ALIAS", verification: "VERIFIED", evidenceCount: 1, updatedAt: d("2027-03-05") }),
        use("2027-03-01", 100, { detectionMethod: "MANUAL", verification: "UNVERIFIED", updatedAt: d("2027-03-09") }),
        use("2027-03-01", 900, { verification: "REJECTED" }),
        use("2027-03-01", 900, { status: "DISMISSED" }),
      ],
    });
    const r = benefitRecord(b, NOW);
    expect(r.usedCents).toBe(600);
    expect(r.detectionMethod).toBe("ALIAS+MANUAL");
    expect(r.verificationStatus).toBe("UNVERIFIED");
    expect(r.statementEvidence).toBe(1);
    expect(r.lastUpdated).toEqual(d("2027-03-09"));
    expect(benefitRecord(base({}), NOW)).toMatchObject({ verificationStatus: "NONE", detectionMethod: "NONE", lastUpdated: null });
    expect(
      benefitRecord(base({ usages: [use("2027-03-01", 1000, { verification: "VERIFIED" })] }), NOW).verificationStatus,
    ).toBe("VERIFIED");
  });
});

describe("TC-HH: same product, separate accounts (no cross-contamination)", () => {
  const gold = (walletCardId: string, profileId: string, profileName: string, lastFour: string, usages: RollUsage[]) =>
    base({ benefitId: `${walletCardId}-din`, walletCardId, profileId, profileName, lastFour, usages });
  const cards = [
    gold("g1", "me", "Me", "1001", [use("2027-03-01", 1000)]),
    gold("g2", "me", "Me", "1002", []),
    gold("g3", "spouse", "Spouse", "1003", [use("2027-03-01", 300)]),
  ];
  const records = cards.map((c) => benefitRecord(c, NOW));

  it("each account keeps its own usage, credits and renewal cycle", () => {
    expect(records.map((r) => r.usedCents)).toEqual([1000, 0, 300]);
    expect(records[0].status).toBe("COMPLETED");
    expect(records[1].usedCents).toBe(0);
    const a = rollup(records, "account");
    expect(a).toHaveLength(3);
    expect(a.map((g) => g.usedCents).sort((x, y) => x - y)).toEqual([0, 300, 1000]);
  });
  it("the product level adds the three accounts, the cardholder level keeps people apart", () => {
    const [product] = rollup(records, "product");
    expect(product).toMatchObject({ accounts: 3, allocatedCents: 3000, usedCents: 1300, utilizationPct: 43 });
    const byHolder = rollup(records, "cardholder");
    expect(byHolder.find((g) => g.label === "Me")).toMatchObject({ accounts: 2, usedCents: 1000, allocatedCents: 2000 });
    expect(byHolder.find((g) => g.label === "Spouse")).toMatchObject({ accounts: 1, usedCents: 300 });
    expect(rollup(records, "household")).toEqual([
      expect.objectContaining({ label: "Household", accounts: 3, benefits: 3, usedCents: 1300, remainingCents: 1700 }),
    ]);
  });
  it("renewal cycles stay per account (different anniversaries)", () => {
    const a = benefitRecord(base({ period: "ANNUAL", periodMonths: 12, basis: "CARDMEMBER_YEAR", anchor: d("2024-05-20") }), NOW);
    const b = benefitRecord(base({ walletCardId: "g3", period: "ANNUAL", periodMonths: 12, basis: "CARDMEMBER_YEAR", anchor: d("2026-11-02") }), NOW);
    expect(a.periodEnd).toEqual(d("2027-05-20"));
    expect(b.periodEnd).toEqual(d("2027-11-02"));
  });
  it("unassigned cards are grouped, labels show last digits", () => {
    const r = benefitRecord(base({ profileId: null, profileName: null, lastFour: null }), NOW);
    expect(rollup([r], "cardholder")[0].label).toBe("Unassigned");
    expect(rollup([r], "account")[0].label).toBe("Amex Gold");
    expect(rollup([], "product")).toEqual([]);
    expect(rollup([{ ...r, allocatedCents: 0 }], "product")[0].utilizationPct).toBe(0);
  });
});

describe("TC-REC: reconciliation", () => {
  const monthly = (usages: RollUsage[], over: Partial<RollBenefit> = {}) =>
    base({ usages, ...over });

  it("expected vs detected vs missing across the benefit year", () => {
    // Jan used, Feb nothing, Mar (current) nothing
    const r = reconcileBenefit(monthly([use("2027-01-01", 1000)]), NOW);
    expect(r).toMatchObject({ expectedCents: 3000, detectedCents: 1000, missingCents: 1000, unusedCents: 1000, pendingCents: 0 });
    expect(r.suggestion).toMatch(/past periods went unused/);
  });
  it("a purchase without its credit is pending", () => {
    const r = reconcileBenefit(monthly([use("2027-01-01", 1000), use("2027-02-01", 1000), use("2027-03-01", 700, { status: "EXPECTED" })]), NOW);
    expect(r).toMatchObject({ detectedCents: 2000, pendingCents: 700, missingCents: 0 });
    expect(r.suggestion).toMatch(/wait for the statement credit/);
  });
  it("flags a period about to end with nothing used", () => {
    const r = reconcileBenefit(monthly([use("2027-01-01", 1000), use("2027-02-01", 1000)]), d("2027-03-25"));
    expect(r.potentialMissed).toBe(true);
    expect(r.suggestion).toMatch(/Use \$10 before 2027-03-31/);
  });
  it("on track and not yet used wording", () => {
    const onTrack = reconcileBenefit(monthly([use("2027-01-01", 1000), use("2027-02-01", 1000), use("2027-03-01", 1000)]), NOW);
    expect(onTrack).toMatchObject({ potentialMissed: false, suggestion: "On track." });
    const early = reconcileBenefit(monthly([use("2027-01-01", 1000), use("2027-02-01", 1000)]), NOW);
    expect(early.suggestion).toBe("Not used yet this period.");
  });
  it("expired benefits report what was left", () => {
    const b = base({ period: "ONE_TIME", periodMonths: 12, amountPerPeriodCents: 5000, anchor: d("2027-01-01"), expiresOn: d("2027-02-01"), windowEnd: d("2027-02-01") });
    const r = reconcileBenefit(b, NOW);
    expect(r.expiredCents).toBe(5000);
    expect(r.suggestion).toMatch(/Expired/);
  });
  it("benefits on a card opened mid-year do not owe earlier periods", () => {
    const r = reconcileBenefit(monthly([], { anchor: d("2027-03-01") }), NOW);
    expect(r.expectedCents).toBe(1000);
    expect(r.missingCents).toBe(0);
  });
  it("dismissed and rejected usage is ignored", () => {
    const r = reconcileBenefit(monthly([use("2027-03-01", 1000, { status: "DISMISSED" }), use("2027-03-01", 1000, { verification: "REJECTED" })], { anchor: d("2027-03-01") }), NOW);
    expect(r.detectedCents).toBe(0);
  });
});

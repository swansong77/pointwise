import { addMonths, alertText, alertThreshold, ALERT_DAYS, ExpiryInput, lotsFromEvents, predictExpiration, preservationAdvice } from "../../../src/domain/loyalty-expiration";
import { growthSummary, monthlyHistory, TrackEvent, trackingTotals } from "../../../src/domain/loyalty-tracking";
import { bonusAdvice, bonusStats, effectiveCents } from "../../../src/domain/transfer-bonus";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const NOW = d("2026-11-25");
const input = (o: Partial<ExpiryInput> = {}): ExpiryInput => ({ balance: 120_000, policyType: "ACTIVITY", policyMonths: 18, policyVerified: false, lastActivityAt: d("2025-06-01"), expiresAtOverride: null, now: NOW, ...o });

describe("TC-EXP: expiration prediction", () => {
  it("activity policy: expires N months after the last activity, with days, risk and confidence", () => {
    const p = predictExpiration(input());
    expect(p.expiresAt).toEqual(d("2026-12-01"));
    expect(p.daysLeft).toBe(6);
    expect(p).toMatchObject({ atRiskPoints: 120_000, level: "HIGH", confidence: 50, threshold: 7 });
    expect(p.riskScore).toBe(100); // 95 + value bump, capped
    expect(predictExpiration(input({ policyVerified: true })).confidence).toBe(80);
  });
  it("a date entered from the program wins, with high confidence", () => {
    const p = predictExpiration(input({ expiresAtOverride: d("2027-03-01"), policyType: "NEVER" }));
    expect(p).toMatchObject({ expiresAt: d("2027-03-01"), confidence: 90, source: "entered by member" });
    expect(p.level).toBe("MEDIUM");
  });
  it("no expiration, card-bound and unknown policies never invent a date", () => {
    expect(predictExpiration(input({ policyType: "NEVER" }))).toMatchObject({ expiresAt: null, level: "NONE", confidence: 60 });
    expect(predictExpiration(input({ policyType: "NEVER", policyVerified: true })).confidence).toBe(85);
    expect(predictExpiration(input({ policyType: "WHILE_CARD_OPEN" }))).toMatchObject({ expiresAt: null, level: "LOW", riskScore: 5 });
    expect(predictExpiration(input({ policyType: "UNKNOWN" }))).toMatchObject({ expiresAt: null, level: "LOW", confidence: 15 });
  });
  it("missing inputs are explained, not guessed", () => {
    expect(predictExpiration(input({ lastActivityAt: null })).reason).toMatch(/not recorded/);
    expect(predictExpiration(input({ policyMonths: null })).reason).toMatch(/without a period/);
    expect(predictExpiration(input({ policyType: "FIXED", policyMonths: null })).reason).toMatch(/without a period/);
    expect(predictExpiration(input({ policyType: "FIXED", lastActivityAt: null })).reason).toMatch(/not recorded/);
  });
  it("zero balance has nothing to expire", () => {
    expect(predictExpiration(input({ balance: 0 }))).toMatchObject({ level: "NONE", atRiskPoints: 0, confidence: 95 });
  });
  it("already past: EXPIRED with no later threshold", () => {
    const p = predictExpiration(input({ lastActivityAt: d("2024-01-01") }));
    expect(p.level).toBe("EXPIRED");
    expect(p.threshold).toBeNull();
    expect(alertText("American Airlines", "miles", p)).toMatch(/may already have expired/);
  });
  it("fixed policy uses earning dates: oldest points expire first, tranches listed", () => {
    const lots = [{ earnedAt: d("2023-12-15"), points: 30_000 }, { earnedAt: d("2025-01-10"), points: 50_000 }];
    const p = predictExpiration(input({ policyType: "FIXED", policyMonths: 36, lots, balance: 80_000 }));
    expect(p.expiresAt).toEqual(d("2026-12-15"));
    expect(p.atRiskPoints).toBe(30_000);
    expect(p.tranches).toHaveLength(2);
    expect(p.reason).toMatch(/oldest 30,000 points expire first/);
    const noLots = predictExpiration(input({ policyType: "FIXED", policyMonths: 36 }));
    expect(noLots.confidence).toBe(30);
    expect(noLots.reason).toMatch(/assumes everything/);
  });
  it("value raises the risk score for big balances a year or less away", () => {
    const small = predictExpiration(input({ lastActivityAt: d("2025-12-01"), balance: 1_000 })); // 2027-06-01, 188 days
    const big = predictExpiration(input({ lastActivityAt: d("2025-12-01"), balance: 100_000, centsPerPoint: 1.5 }));
    expect(big.riskScore).toBe(small.riskScore + 10);
  });
  it("months are added without overflowing short months", () => {
    expect(addMonths(d("2026-01-31"), 1)).toEqual(d("2026-02-28"));
    expect(addMonths(d("2026-11-30"), 3)).toEqual(d("2027-02-28"));
  });
});

describe("TC-EXP: alert thresholds and text", () => {
  it("thresholds 365/180/90/60/30/14/7/1", () => {
    expect([...ALERT_DAYS]).toEqual([365, 180, 90, 60, 30, 14, 7, 1]);
    const t = (n: number | null) => alertThreshold(n);
    expect([t(400), t(365), t(200), t(90), t(61), t(30), t(15), t(8), t(7), t(2), t(1), t(0), t(-3), t(null)]).toEqual([null, 365, 365, 90, 90, 30, 30, 14, 7, 7, 1, 1, null, null]);
  });
  it("wording matches the examples", () => {
    const p = predictExpiration(input({ lastActivityAt: d("2025-12-20") })); // 2027-06-20
    expect(alertText("Marriott", "points", { ...p, daysLeft: 90 })).toBe("Marriott points expire in 90 days (120,000 at risk).");
    expect(alertText("American Airlines", "miles", { ...p, daysLeft: 7 })).toBe("120,000 miles at risk of expiration in American Airlines: 7 day(s) left.");
    expect(alertText("X", "points", { ...p, daysLeft: null })).toBe("120,000 points at risk of expiration in X.");
  });
});

describe("TC-EXP: activity preservation", () => {
  it("lists cheapest, easiest ways that fit the deadline first", () => {
    const a = preservationAdvice("AIRLINE", [], 20);
    expect(a[0]).toMatchObject({ key: "earn-1-point", estCostCents: 0, effort: "LOW", fitsDeadline: true });
    expect(a.find((m) => m.key === "stay-or-fly")!.fitsDeadline).toBe(false); // needs 30 days; 20 left
    expect(preservationAdvice("AIRLINE", [], 2).find((m) => m.key === "card-spend")!.fitsDeadline).toBe(false);
    // methods that miss the deadline sort last
    const tight = preservationAdvice("AIRLINE", [], 2);
    expect(tight[0].fitsDeadline).toBe(true);
    expect(tight[tight.length - 1].fitsDeadline).toBe(false);
  });
  it("when the program lists its reset conditions only those methods are returned, marked confirmed", () => {
    const a = preservationAdvice("HOTEL", ["STAY", "TRANSFER"], null);
    expect(a.every((m) => m.confirmedByPolicy)).toBe(true);
    expect(a.map((m) => m.key)).toEqual(expect.arrayContaining(["stay-or-fly", "transfer-in"]));
    expect(a.map((m) => m.key)).not.toContain("dining");
  });
  it("other program kinds still get the general methods", () => {
    expect(preservationAdvice("SHOPPING", [], 30).map((m) => m.key)).toContain("earn-1-point");
    expect(preservationAdvice("CASINO", [], 30).length).toBeGreaterThan(0);
  });
});

describe("TC-EXP: lots from events", () => {
  const ev = (kind: any, points: number, date: string) => ({ kind, points, occurredAt: d(date) });
  it("FIFO: redemptions use the oldest points first", () => {
    const lots = lotsFromEvents([ev("EARN", 50_000, "2024-01-01"), ev("BONUS", 20_000, "2024-06-01"), ev("REDEEM", -60_000, "2025-01-01"), ev("EARN", 5_000, "2025-05-01"), ev("SNAPSHOT", 0, "2025-06-01")], 15_000);
    expect(lots.map((l) => [l.earnedAt.toISOString().slice(0, 7), l.points])).toEqual([["2024-06", 10_000], ["2025-05", 5_000]]);
  });
  it("history that over-explains the balance is trimmed from the oldest", () => {
    const lots = lotsFromEvents([ev("EARN", 50_000, "2024-01-01"), ev("EARN", 50_000, "2025-01-01")], 60_000);
    expect(lots.reduce((s, l) => s + l.points, 0)).toBe(60_000);
    expect(lots.map((l) => [l.earnedAt.toISOString().slice(0, 4), l.points])).toEqual([["2024", 10_000], ["2025", 50_000]]);
    expect(lotsFromEvents([], 5)).toEqual([]);
  });
});

describe("TC-PTS: tracking totals and history", () => {
  const e = (kind: any, points: number, date: string, balanceAfter: number): TrackEvent => ({ kind, points, balanceAfter, occurredAt: d(date) });
  const events = [e("EARN", 50_000, "2026-01-10", 50_000), e("BONUS", 10_000, "2026-02-05", 60_000), e("PURCHASE", 5_000, "2026-03-02", 65_000), e("REDEEM", -30_000, "2026-05-20", 35_000), e("EXPIRE", -2_000, "2026-08-01", 33_000), e("TRANSFER_OUT", -3_000, "2026-09-09", 30_000), e("TRANSFER_IN", 4_000, "2026-10-09", 34_000), e("ADJUST", 1_000, "2026-10-20", 35_000), e("SNAPSHOT", 0, "2026-11-01", 35_000)];
  it("separates earned, bonus, purchased, redeemed, expired and transferred points", () => {
    const t = trackingTotals(events, 35_000, 2_500);
    expect(t).toMatchObject({ current: 35_000, pending: 2_500, earned: 50_000, bonus: 10_000, purchased: 5_000, redeemed: 30_000, expired: 2_000, transferredOut: 3_000, transferredIn: 4_000 });
    expect(t.netChange).toBe(50_000 + 10_000 + 5_000 + 4_000 + 1_000 - 30_000 - 2_000 - 3_000); // 35,000 = the balance
    expect(t.netChange).toBe(35_000);
  });
  it("monthly history carries balances through quiet months and ends at the current balance", () => {
    const h = monthlyHistory(events, 35_000, NOW, 12);
    expect(h).toHaveLength(12);
    expect(h[0].month).toBe("2025-12");
    expect(h[h.length - 1]).toMatchObject({ month: "2026-11", balance: 35_000 });
    const by = Object.fromEntries(h.map((x) => [x.month, x.balance]));
    expect(by["2026-01"]).toBe(50_000);
    expect(by["2026-04"]).toBe(65_000); // quiet month carries March forward
    expect(by["2026-05"]).toBe(35_000);
    expect(by["2025-12"]).toBe(0); // before the first event: balance less that event's change
    expect(h.find((x) => x.month === "2026-05")!.change).toBe(-30_000);
  });
  it("history with no events is flat at the current balance; growth summary names the best and worst months", () => {
    expect(monthlyHistory([], 9_000, NOW, 3).map((x) => x.balance)).toEqual([9_000, 9_000, 9_000]);
    const g = growthSummary(monthlyHistory(events, 35_000, NOW, 12));
    expect(g).toMatchObject({ startBalance: 0, endBalance: 35_000, change: 35_000, pct: null, bestMonth: "2026-01", worstMonth: "2026-05" });
    expect(growthSummary(monthlyHistory(events, 35_000, NOW, 8)).pct).toBe(-46.2); // from 65,000 in April
    expect(growthSummary([])).toMatchObject({ change: 0, bestMonth: null });
    expect(growthSummary([{ month: "2026-01", balance: 5, change: 0 }])).toMatchObject({ bestMonth: null, worstMonth: null });
  });
});

describe("TC-XFER: transfer bonuses", () => {
  const r = (pct: number, start: string) => ({ bonusPercent: pct, startsAt: d(start), endsAt: null });
  const history = [r(25, "2025-03-10"), r(30, "2025-06-12"), r(30, "2025-09-15"), r(40, "2025-12-05"), r(30, "2026-03-14")];
  it("history statistics", () => {
    const s = bonusStats(history);
    expect(s).toMatchObject({ count: 5, averagePercent: 31, maxPercent: 40, minPercent: 25 });
    expect(s.typicalIntervalDays).toBe(95);
    expect(s.byMonth[2]).toBe(2);
    expect(bonusStats([])).toMatchObject({ count: 0, averagePercent: 0, typicalIntervalDays: null, lastStart: null });
  });
  it("a current bonus above the average is worth acting on", () => {
    const a = bonusAdvice(35, bonusStats(history), NOW);
    expect(a.verdict).toBe("TRANSFER_NOW");
    expect(a.text).toMatch(/exceeds the historical average of 31%/);
    expect(a.confidence).toBe(75);
    expect(bonusAdvice(31, bonusStats(history), NOW).text).toMatch(/matches/);
  });
  it("a weak bonus with a recurring pattern says wait", () => {
    const a = bonusAdvice(20, bonusStats(history), NOW);
    expect(a).toMatchObject({ verdict: "WAIT", expectedWithinDays: 95 });
  });
  it("no bonus: wait when one is due, otherwise none expected, no data when empty", () => {
    expect(bonusAdvice(null, bonusStats(history), NOW)).toMatchObject({ verdict: "WAIT", expectedWithinDays: 30 });
    expect(bonusAdvice(null, bonusStats(history), NOW).text).toMatch(/Wait for an expected transfer bonus/);
    const old = bonusStats([r(25, "2023-01-10"), r(25, "2023-02-10"), r(25, "2023-03-10")]);
    expect(bonusAdvice(null, old, d("2026-08-01"))).toMatchObject({ verdict: "NO_BONUS_EXPECTED" });
    expect(bonusAdvice(null, bonusStats([]), NOW).verdict).toBe("NO_DATA");
    expect(bonusAdvice(30, bonusStats([r(30, "2026-01-01")]), NOW)).toMatchObject({ verdict: "TRANSFER_NOW", confidence: 30 });
    const noInterval = bonusStats([r(30, "2026-11-01"), r(30, "2026-12-01"), r(30, "2027-01-01")].slice(0, 3));
    expect(bonusAdvice(null, noInterval, NOW).verdict).toBe("WAIT"); // November falls in a bonus month
  });
  it("effective value of a transferred point", () => {
    expect(effectiveCents(1, 2, 30, 0.5)).toBe(1.3);
    expect(effectiveCents(1, 1, 0, 1.7)).toBe(1.7);
    expect(effectiveCents(2, 1, 0, 1)).toBe(0.5);
  });
});

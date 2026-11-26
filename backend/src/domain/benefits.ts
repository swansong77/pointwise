import { addMonths, daysBetween, startOfUtcDay } from './dates';

/**
 * Benefit period math, utilization and alert thresholds (pure). See docs/benefits-data-model.md.
 *
 * A benefit grants `amountPerPeriodCents` once per period. Periods are either aligned to the
 * calendar (monthly = calendar month, quarterly = Jan/Apr/Jul/Oct, semi-annual = Jan/Jul,
 * annual = calendar year) or to the cardmember year (starting on the account-open anniversary).
 * Multi-year benefits (e.g. a trusted-traveler fee credit every 4 years) always use the anchor.
 * Period ends are exclusive; the last usable day is `end - 1 day`.
 */

export type BenefitPeriod = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL' | 'MULTI_YEAR' | 'ONE_TIME' | 'CUSTOM';
export type PeriodBasis = 'CALENDAR' | 'CARDMEMBER_YEAR';
export type BenefitStatus = 'UNUSED' | 'PARTIAL' | 'COMPLETED' | 'EXPIRED' | 'EXPIRING_SOON';

export interface BenefitSchedule {
  period: BenefitPeriod;
  basis: PeriodBasis;
  /** required for MULTI_YEAR; otherwise derived from the period */
  periodMonths?: number;
  amountPerPeriodCents: number;
  /** ONE_TIME: the single window (defaults: the anchor … expiresOn, else 100 years) */
  windowStart?: Date | null;
  windowEnd?: Date | null;
  expiresOn?: Date | null;
}

export interface PeriodWindow {
  start: Date;
  /** exclusive */
  end: Date;
}

export const PERIOD_MONTHS: Record<'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL', number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUAL: 6,
  ANNUAL: 12,
};

export class BenefitRuleError extends Error {}

export function monthsOf(s: Pick<BenefitSchedule, 'period' | 'periodMonths'>): number {
  if (s.period === 'MULTI_YEAR') {
    if (!s.periodMonths || s.periodMonths < 13) throw new BenefitRuleError('MULTI_YEAR benefits need periodMonths > 12');
    return s.periodMonths;
  }
  if (s.period === 'CUSTOM') {
    if (!s.periodMonths || s.periodMonths < 1) throw new BenefitRuleError('CUSTOM benefits need periodMonths >= 1');
    return s.periodMonths;
  }
  if (s.period === 'ONE_TIME') return s.periodMonths && s.periodMonths > 0 ? s.periodMonths : 12;
  return PERIOD_MONTHS[s.period];
}

/** Face value per 12 months, in cents. */
export function annualValueCents(s: BenefitSchedule): number {
  return Math.round((s.amountPerPeriodCents * 12) / monthsOf(s));
}

/** Per-period amount from an annual value (the spreadsheet stores $/yr). */
export function perPeriodFromAnnual(annualCents: number, s: Pick<BenefitSchedule, 'period' | 'periodMonths'>): number {
  return Math.round((annualCents * monthsOf(s)) / 12);
}

const utc = (y: number, m: number, d = 1) => new Date(Date.UTC(y, m, d));

/** Uses the anchor (cardmember year / multi-year) when the schedule needs one and it is known. */
function usesAnchor(s: Pick<BenefitSchedule, 'period' | 'basis'>, anchor: Date | null): anchor is Date {
  return anchor != null && (s.basis === 'CARDMEMBER_YEAR' || s.period === 'MULTI_YEAR' || s.period === 'CUSTOM');
}

/** The period window that contains `at`. */
export function periodContaining(s: Pick<BenefitSchedule, 'period' | 'basis' | 'periodMonths'> & Partial<Pick<BenefitSchedule, 'windowStart' | 'windowEnd' | 'expiresOn'>>, anchor: Date | null, at: Date): PeriodWindow {
  if (s.period === 'ONE_TIME') {
    const start = startOfUtcDay(s.windowStart ?? anchor ?? utc(1970, 0));
    const end = s.windowEnd ?? (s.expiresOn ? addMonths(startOfUtcDay(s.expiresOn), 0) : addMonths(start, 1200));
    return { start, end: new Date(Math.max(end.getTime(), start.getTime() + 86_400_000)) };
  }
  const months = monthsOf(s);
  if (usesAnchor(s, anchor)) {
    const a = startOfUtcDay(anchor);
    // number of whole periods elapsed since the anchor (may be negative before the anchor)
    let k = Math.floor(((at.getUTCFullYear() - a.getUTCFullYear()) * 12 + (at.getUTCMonth() - a.getUTCMonth())) / months);
    let start = addMonths(a, k * months);
    if (start.getTime() > at.getTime()) {
      k -= 1;
      start = addMonths(a, k * months);
    }
    let end = addMonths(a, (k + 1) * months);
    if (end.getTime() <= at.getTime()) {
      k += 1;
      start = end;
      end = addMonths(a, (k + 1) * months);
    }
    return { start, end };
  }
  // calendar-aligned (multi-year without an anchor falls back to calendar multiples from year 0)
  const totalMonths = at.getUTCFullYear() * 12 + at.getUTCMonth();
  const startTotal = Math.floor(totalMonths / months) * months;
  const start = utc(Math.floor(startTotal / 12), startTotal % 12);
  const endTotal = startTotal + months;
  return { start, end: utc(Math.floor(endTotal / 12), endTotal % 12) };
}

/** All period windows that start within the benefit year containing `at` (calendar or cardmember year). */
export function periodsInBenefitYear(s: Pick<BenefitSchedule, 'period' | 'basis' | 'periodMonths'> & Partial<Pick<BenefitSchedule, 'windowStart' | 'windowEnd' | 'expiresOn'>>, anchor: Date | null, at: Date): PeriodWindow[] {
  const months = monthsOf(s);
  if (s.period === 'ONE_TIME' || s.period === 'CUSTOM' || months > 12) return [periodContaining(s, anchor, at)];
  const year =
    s.basis === 'CARDMEMBER_YEAR' && anchor
      ? periodContaining({ period: 'ANNUAL', basis: 'CARDMEMBER_YEAR' }, anchor, at)
      : periodContaining({ period: 'ANNUAL', basis: 'CALENDAR' }, null, at);
  const out: PeriodWindow[] = [];
  for (let i = 0; i < 12 / months; i++) {
    out.push({ start: addMonths(year.start, i * months), end: addMonths(year.start, (i + 1) * months) });
  }
  return out;
}

/** Last usable calendar day of a window. */
export function lastDay(w: PeriodWindow): Date {
  return new Date(w.end.getTime() - 86_400_000);
}

/** Days remaining including today (1 = today is the last day; 0 = ended). */
export function daysRemaining(w: PeriodWindow, now: Date): number {
  return Math.max(0, daysBetween(startOfUtcDay(now), w.end));
}

export interface Utilization {
  allocatedCents: number;
  usedCents: number;
  remainingCents: number;
  percentUsed: number;
  status: BenefitStatus;
  daysLeft: number;
}

export function utilization(allocatedCents: number, usedCents: number, w: PeriodWindow, now: Date, expiringWithinDays = 30): Utilization {
  const used = Math.max(0, usedCents);
  const remaining = Math.max(0, allocatedCents - used);
  const percentUsed = allocatedCents > 0 ? Math.min(100, Math.round((used / allocatedCents) * 100)) : 100;
  const daysLeft = daysRemaining(w, now);
  let status: BenefitStatus;
  if (remaining === 0) status = 'COMPLETED';
  else if (now.getTime() >= w.end.getTime()) status = 'EXPIRED';
  else if (daysLeft <= expiringWithinDays) status = 'EXPIRING_SOON';
  else status = used > 0 ? 'PARTIAL' : 'UNUSED';
  return { allocatedCents, usedCents: used, remainingCents: remaining, percentUsed, status, daysLeft };
}

/** Alert lead times scale with the period length — a 90-day warning is meaningless for a monthly credit. */
export function alertThresholds(s: Pick<BenefitSchedule, 'period' | 'periodMonths'>): number[] {
  const m = monthsOf(s);
  if (m <= 1) return [7, 1];
  if (m <= 3) return [30, 7, 1];
  if (m <= 6) return [60, 30, 7, 1];
  return [90, 60, 30, 7, 1];
}

/**
 * The single alert threshold due now (the smallest threshold that has been crossed), or null.
 * Sending only the smallest crossed threshold means a missed job run never produces a burst of
 * stale alerts; the delivery log (benefit, periodEnd, threshold, channel) makes it idempotent.
 */
export function dueThreshold(s: Pick<BenefitSchedule, 'period' | 'periodMonths'>, w: PeriodWindow, now: Date, remainingCents: number): number | null {
  if (remainingCents <= 0) return null;
  const left = daysRemaining(w, now);
  if (left < 1) return null;
  const crossed = alertThresholds(s).filter((t) => left <= t);
  return crossed.length ? Math.min(...crossed) : null;
}

export interface UsageAllocation {
  periodStart: Date;
  amountCents: number;
}

/**
 * Periods the card could actually use: windows that ended on or before the account was opened are
 * dropped (a card opened in June never "missed" January's credit). Unknown open date → all windows.
 * At least the last window is kept so a future-dated anchor still yields a period.
 */
export function activeWindows(windows: PeriodWindow[], openedAt: Date | null): PeriodWindow[] {
  if (!openedAt) return windows;
  const kept = windows.filter((w) => w.end.getTime() > openedAt.getTime());
  return kept.length ? kept : windows.slice(-1);
}

/**
 * Spread a year-to-date "used so far" amount (as kept in spreadsheets) across the benefit year's
 * periods, earliest first, at most one period's allocation each. Any excess is put on the last period.
 */
export function distributeUsage(s: BenefitSchedule, anchor: Date | null, now: Date, usedCents: number): UsageAllocation[] {
  if (usedCents <= 0) return [];
  const windows = activeWindows(periodsInBenefitYear(s, anchor, now), anchor);
  const out: UsageAllocation[] = [];
  let left = usedCents;
  for (const w of windows) {
    if (left <= 0) break;
    const amt = Math.min(left, s.amountPerPeriodCents);
    if (amt > 0) out.push({ periodStart: w.start, amountCents: amt });
    left -= amt;
  }
  if (left > 0) {
    const last = out[out.length - 1];
    if (last) last.amountCents += left;
    else out.push({ periodStart: windows[0].start, amountCents: left });
  }
  return out;
}

export interface BenefitYearSummary {
  annualValueCents: number;
  usedThisYearCents: number;
  remainingThisYearCents: number;
  /** value already lost: unused allocation of periods that have ended this benefit year */
  missedCents: number;
}

/** Year view: sums usage per period of the current benefit year. `usage` maps periodStart ISO → cents. */
export function benefitYearSummary(s: BenefitSchedule, anchor: Date | null, now: Date, usage: Map<string, number>): BenefitYearSummary {
  const windows = activeWindows(periodsInBenefitYear(s, anchor, now), anchor);
  let used = 0;
  let missed = 0;
  for (const w of windows) {
    const u = Math.min(s.amountPerPeriodCents, usage.get(w.start.toISOString()) ?? 0);
    used += u;
    if (w.end.getTime() <= now.getTime()) missed += s.amountPerPeriodCents - u;
  }
  const total = windows.length * s.amountPerPeriodCents;
  return { annualValueCents: annualValueCents(s), usedThisYearCents: used, remainingThisYearCents: total - used - missed, missedCents: missed };
}

/** Parse free text such as "Monthly", "Semi-annual", "Every 4 years", "Cardmember year". */
export function parsePeriodText(text: string | null | undefined): { period: BenefitPeriod; periodMonths: number; basis: PeriodBasis } {
  const t = (text ?? '').toLowerCase();
  const basis: PeriodBasis = /card ?member|anniversary|account ?year|membership year/.test(t) ? 'CARDMEMBER_YEAR' : 'CALENDAR';
  const years = /every\s+(\d+(?:\.\d+)?)\s*(?:-|to)?\s*(?:\d+(?:\.\d+)?)?\s*years?/.exec(t);
  if (years) {
    const months = Math.round(Number(years[1]) * 12);
    if (months > 12) return { period: 'MULTI_YEAR', periodMonths: months, basis: 'CARDMEMBER_YEAR' };
  }
  if (/one[- ]?time|once only|single use|\b(ends|expires?|activate by)\b/.test(t)) return { period: 'ONE_TIME', periodMonths: 12, basis };
  if (/month/.test(t)) return { period: 'MONTHLY', periodMonths: 1, basis };
  if (/quarter/.test(t)) return { period: 'QUARTERLY', periodMonths: 3, basis };
  if (/semi|half|twice|bi-?annual/.test(t)) return { period: 'SEMIANNUAL', periodMonths: 6, basis };
  return { period: 'ANNUAL', periodMonths: 12, basis };
}

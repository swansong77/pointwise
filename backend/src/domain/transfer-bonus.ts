/**
 * Transfer bonuses (pure): history statistics, seasonal expectation and a transfer / wait recommendation.
 * Bonuses are promotions, so everything here is probabilistic: the confidence grows with the number of observed
 * bonuses and the text says "expected", never "will".
 */

export interface BonusRecord {
  bonusPercent: number;
  startsAt: Date;
  endsAt: Date | null;
}

export interface BonusStats {
  count: number;
  averagePercent: number;
  maxPercent: number;
  minPercent: number;
  lastStart: Date | null;
  /** typical days between bonus starts, null with fewer than three */
  typicalIntervalDays: number | null;
  /** bonuses started per calendar month, index 0 = January */
  byMonth: number[];
}

const DAY = 86_400_000;

export function bonusStats(records: BonusRecord[]): BonusStats {
  const sorted = [...records].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const byMonth = new Array<number>(12).fill(0);
  for (const r of sorted) byMonth[r.startsAt.getUTCMonth()]++;
  const pcts = sorted.map((r) => r.bonusPercent);
  const gaps = sorted.slice(1).map((r, i) => (r.startsAt.getTime() - sorted[i].startsAt.getTime()) / DAY);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor(s.length / 2)] : 0;
  };
  return {
    count: sorted.length,
    averagePercent: pcts.length ? Math.round((pcts.reduce((s, p) => s + p, 0) / pcts.length) * 10) / 10 : 0,
    maxPercent: pcts.length ? Math.max(...pcts) : 0,
    minPercent: pcts.length ? Math.min(...pcts) : 0,
    lastStart: sorted.length ? sorted[sorted.length - 1].startsAt : null,
    typicalIntervalDays: gaps.length >= 2 ? Math.round(median(gaps)) : null,
    byMonth,
  };
}

export type BonusVerdict = 'TRANSFER_NOW' | 'WAIT' | 'NO_BONUS_EXPECTED' | 'NO_DATA';

export interface BonusAdvice {
  verdict: BonusVerdict;
  text: string;
  /** 0–100 */
  confidence: number;
  expectedWithinDays: number | null;
}

/** Effective value (cents) of one bank point sent through this partner: ratio × (1 + bonus) × the program's ¢/pt. */
export function effectiveCents(ratioFrom: number, ratioTo: number, bonusPercent: number, programCentsPerPoint: number): number {
  return Math.round((ratioTo / ratioFrom) * (1 + bonusPercent / 100) * programCentsPerPoint * 1000) / 1000;
}

/**
 * Compares the current bonus (if any) with history. A current bonus at or above the average is worth acting on;
 * one well below it is worth waiting out when bonuses recur; with no bonus, the seasonal pattern says whether one
 * is likely within the next two months.
 */
export function bonusAdvice(currentPercent: number | null, stats: BonusStats, now: Date): BonusAdvice {
  const confidence = Math.min(90, 25 + stats.count * 10);
  if (stats.count === 0 && !currentPercent) return { verdict: 'NO_DATA', text: 'No transfer bonus history is recorded for this route yet.', confidence: 10, expectedWithinDays: null };
  if (currentPercent && currentPercent > 0) {
    if (stats.count < 3) return { verdict: 'TRANSFER_NOW', text: `A ${currentPercent}% bonus is active. There is too little history to say how good it is; transfer only if you need the points.`, confidence: 30, expectedWithinDays: null };
    if (currentPercent >= stats.averagePercent)
      return { verdict: 'TRANSFER_NOW', text: `Current ${currentPercent}% bonus ${currentPercent > stats.averagePercent ? 'exceeds' : 'matches'} the historical average of ${stats.averagePercent}% (best seen: ${stats.maxPercent}%).`, confidence, expectedWithinDays: null };
    return { verdict: 'WAIT', text: `Current ${currentPercent}% bonus is below the historical average of ${stats.averagePercent}%; a better one is expected. Transfer now only if you must.`, confidence, expectedWithinDays: stats.typicalIntervalDays };
  }
  if (stats.count >= 3) {
    const m = now.getUTCMonth();
    const upcoming = stats.byMonth[m] + stats.byMonth[(m + 1) % 12];
    const interval = stats.typicalIntervalDays;
    const sinceLast = stats.lastStart ? Math.round((now.getTime() - stats.lastStart.getTime()) / DAY) : null;
    // a pattern only counts while it is alive: the last bonus is under two years old
    const alive = sinceLast != null && sinceLast <= 730;
    const due = alive && interval != null && sinceLast != null && sinceLast >= interval * 0.8 && sinceLast <= interval * 3;
    if (alive && (upcoming > 0 || due))
      return { verdict: 'WAIT', text: `Wait for an expected transfer bonus (typically ${stats.averagePercent}%${interval ? `, about every ${interval} days` : ''}${due && sinceLast != null ? `; the last one started ${sinceLast} days ago` : ''}).`, confidence: Math.min(confidence, 65), expectedWithinDays: due ? 30 : 45 };
  }
  return { verdict: 'NO_BONUS_EXPECTED', text: 'No bonus is active and none is expected soon; transfer only when you need the points.', confidence: Math.min(confidence, 50), expectedWithinDays: null };
}

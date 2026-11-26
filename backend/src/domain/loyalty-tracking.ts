/** Points tracking (pure): category totals from the event log, and monthly balance history for charts. */

export type EventKind = 'SNAPSHOT' | 'EARN' | 'BONUS' | 'PURCHASE' | 'REDEEM' | 'EXPIRE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUST';

export interface TrackEvent {
  kind: EventKind;
  /** signed change */
  points: number;
  balanceAfter: number;
  occurredAt: Date;
}

export interface TrackingTotals {
  current: number;
  pending: number;
  earned: number;
  bonus: number;
  purchased: number;
  redeemed: number;
  expired: number;
  transferredOut: number;
  transferredIn: number;
  netChange: number;
}

/** What came in, what went out, and where the balance stands. */
export function trackingTotals(events: TrackEvent[], current: number, pending: number): TrackingTotals {
  const sum = (k: EventKind) => events.filter((e) => e.kind === k).reduce((s, e) => s + Math.abs(e.points), 0);
  const adjust = events.filter((e) => e.kind === 'ADJUST').reduce((s, e) => s + e.points, 0);
  const t: TrackingTotals = {
    current,
    pending,
    earned: sum('EARN'),
    bonus: sum('BONUS'),
    purchased: sum('PURCHASE'),
    redeemed: sum('REDEEM'),
    expired: sum('EXPIRE'),
    transferredOut: sum('TRANSFER_OUT'),
    transferredIn: sum('TRANSFER_IN'),
    netChange: 0,
  };
  t.netChange = t.earned + t.bonus + t.purchased + t.transferredIn + adjust - t.redeemed - t.expired - t.transferredOut;
  return t;
}

export interface MonthPoint {
  /** YYYY-MM */
  month: string;
  balance: number;
  change: number;
}

const ym = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

/**
 * End-of-month balance for the last `months` months (including the current one), carrying the last known balance
 * forward through quiet months. Months before the first event show the first known balance less its change.
 */
export function monthlyHistory(events: TrackEvent[], current: number, now: Date, months = 12): MonthPoint[] {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const out: MonthPoint[] = [];
  let prev: number | null = null;
  for (let i = months - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    const upTo = sorted.filter((e) => e.occurredAt < end);
    const isCurrent = i === 0;
    let balance: number;
    if (isCurrent) balance = current;
    else if (upTo.length) balance = upTo[upTo.length - 1].balanceAfter;
    else if (sorted.length) balance = Math.max(0, sorted[0].balanceAfter - sorted[0].points);
    else balance = current;
    out.push({ month: ym(start), balance, change: prev == null ? 0 : balance - prev });
    prev = balance;
  }
  return out;
}

export interface Growth {
  startBalance: number;
  endBalance: number;
  change: number;
  /** percent, null when the start is zero */
  pct: number | null;
  bestMonth: string | null;
  worstMonth: string | null;
}

export function growthSummary(h: MonthPoint[]): Growth {
  if (!h.length) return { startBalance: 0, endBalance: 0, change: 0, pct: null, bestMonth: null, worstMonth: null };
  const start = h[0].balance;
  const end = h[h.length - 1].balance;
  const moves = h.slice(1);
  const best = moves.length ? moves.reduce((m, x) => (x.change > m.change ? x : m)) : null;
  const worst = moves.length ? moves.reduce((m, x) => (x.change < m.change ? x : m)) : null;
  return {
    startBalance: start,
    endBalance: end,
    change: end - start,
    pct: start > 0 ? Math.round(((end - start) / start) * 1000) / 10 : null,
    bestMonth: best && best.change > 0 ? best.month : null,
    worstMonth: worst && worst.change < 0 ? worst.month : null,
  };
}

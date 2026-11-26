/**
 * Loyalty asset valuation and expiration forecast (pure).
 *
 *  current   points at their ¢/pt + available certificates + active status value + memberships (pro-rated to the
 *            time left, at most a year) + unused card credits
 *  potential current + pending points + the part of unearned status value still within reach
 *  atRisk    points expiring within 180 days + certificates expiring within 90 + statuses unlikely to renew +
 *            memberships expiring within 90
 *  expired   points already expired + certificates that lapsed unused
 *  recovered certificates used and points redeemed in the last year
 *  annualNet recurring annual value (status + memberships) less membership renewal costs
 */
import { daysBetween, ExpiryPrediction } from './loyalty-expiration';
import { Cert, certState, Elite, EliteView, Member } from './loyalty-assets';

export interface ValuedAccount {
  id: string;
  member: string;
  memberId: string;
  program: string;
  unit: string;
  balance: number;
  pending: number;
  centsPerPoint: number;
  prediction: ExpiryPrediction;
  /** points that expired in the last year (from the event log) */
  expiredPoints: number;
  /** points redeemed in the last year */
  redeemedPoints: number;
}

export interface ValuedCert extends Cert {
  memberId: string;
  usedAt: Date | null;
}

export interface ValuedStatus extends Elite {
  memberId: string;
  view: EliteView;
}

export interface ValuedMembership extends Member {
  memberId: string;
}

export interface ValuationInput {
  now: Date;
  accounts: ValuedAccount[];
  certificates: ValuedCert[];
  statuses: ValuedStatus[];
  memberships: ValuedMembership[];
  /** card credits still unused (cents) */
  unusedCreditsCents: number;
}

export interface Valuation {
  currentCents: number;
  potentialCents: number;
  atRiskCents: number;
  expiredCents: number;
  recoveredCents: number;
  annualNetCents: number;
  byCategory: { points: number; certificates: number; status: number; memberships: number; credits: number };
  members: Array<{ memberId: string; member: string; currentCents: number; atRiskCents: number; annualNetCents: number; points: number }>;
  totalPoints: number;
}

const val = (points: number, cpp: number) => Math.round(points * cpp);

export function valueAssets(i: ValuationInput): Valuation {
  const { now } = i;
  const cat = { points: 0, certificates: 0, status: 0, memberships: 0, credits: i.unusedCreditsCents };
  let pending = 0;
  let atRisk = 0;
  let expired = 0;
  let recovered = 0;
  let upside = 0;
  let annual = 0;
  const m = new Map<string, Valuation['members'][number]>();
  const mem = (id: string, name: string) => {
    let x = m.get(id);
    if (!x) m.set(id, (x = { memberId: id, member: name, currentCents: 0, atRiskCents: 0, annualNetCents: 0, points: 0 }));
    return x;
  };
  let totalPoints = 0;

  for (const a of i.accounts) {
    const v = val(a.balance, a.centsPerPoint);
    cat.points += v;
    pending += val(a.pending, a.centsPerPoint);
    totalPoints += a.balance;
    const x = mem(a.memberId, a.member);
    x.currentCents += v;
    x.points += a.balance;
    const p = a.prediction;
    if (p.daysLeft != null && p.daysLeft <= 180 && p.atRiskPoints > 0 && p.level !== 'NONE') {
      const r = val(p.atRiskPoints, a.centsPerPoint);
      atRisk += r;
      x.atRiskCents += r;
    }
    expired += val(a.expiredPoints, a.centsPerPoint);
    recovered += val(a.redeemedPoints, a.centsPerPoint);
  }

  for (const c of i.certificates) {
    const view = certState(c, now);
    const v = c.potentialValueCents * Math.max(1, c.quantity);
    const x = mem(c.memberId, c.member);
    if (view.effectiveStatus === 'AVAILABLE') {
      cat.certificates += v;
      x.currentCents += v;
      if (view.daysLeft != null && view.daysLeft <= 90) {
        atRisk += v;
        x.atRiskCents += v;
      }
    } else if (view.effectiveStatus === 'EXPIRED') expired += v;
    else if (view.effectiveStatus === 'USED' && c.usedAt && daysBetween(c.usedAt, now) <= 365 && daysBetween(c.usedAt, now) >= 0) recovered += v;
  }

  for (const s of i.statuses) {
    const x = mem(s.memberId, s.member);
    const live = s.view.risk !== 'EXPIRED';
    if (!live) continue;
    cat.status += s.valueCents;
    x.currentCents += s.valueCents;
    annual += s.valueCents;
    x.annualNetCents += s.valueCents;
    if (!s.maintained && s.view.renewalLikelihood < 70) {
      const lost = Math.round((s.valueCents * (100 - s.view.renewalLikelihood)) / 100);
      atRisk += lost;
      x.atRiskCents += lost;
      upside += lost;
    }
  }

  for (const mb of i.memberships) {
    const x = mem(mb.memberId, mb.member);
    const daysLeft = mb.expiresAt ? daysBetween(now, mb.expiresAt) : null;
    if (daysLeft != null && daysLeft < 0) continue;
    const fraction = daysLeft == null ? 1 : Math.min(1, daysLeft / 365);
    const v = Math.round(mb.annualValueCents * fraction);
    cat.memberships += v;
    x.currentCents += v;
    const net = mb.annualValueCents - mb.renewalCostCents;
    annual += net;
    x.annualNetCents += net;
    if (daysLeft != null && daysLeft <= 90) {
      atRisk += v;
      x.atRiskCents += v;
    }
  }

  const current = cat.points + cat.certificates + cat.status + cat.memberships + cat.credits;
  return {
    currentCents: current,
    potentialCents: current + pending + upside,
    atRiskCents: atRisk,
    expiredCents: expired,
    recoveredCents: recovered,
    annualNetCents: annual,
    byCategory: cat,
    members: [...m.values()].sort((a, b) => b.currentCents - a.currentCents),
    totalPoints,
  };
}

// ───────────── expiration forecast ─────────────

export type AssetType = 'POINTS' | 'FREE_NIGHT' | 'COMPANION' | 'UPGRADE' | 'STATUS' | 'MEMBERSHIP' | 'CREDIT';

export interface ForecastItem {
  type: AssetType;
  label: string;
  member: string;
  date: Date;
  valueCents: number;
  detail?: string;
}

export const FORECAST_WINDOWS = [
  { key: 'next30', label: 'Next 30 days', days: 30 },
  { key: 'next90', label: 'Next 90 days', days: 90 },
  { key: 'next180', label: 'Next 180 days', days: 180 },
  { key: 'next365', label: 'Next year', days: 365 },
  { key: 'next730', label: 'Next two years', days: 730 },
] as const;

export interface ForecastBucket {
  key: string;
  label: string;
  items: ForecastItem[];
  totalCents: number;
}

/** Everything that expires, by window (each item appears in the first window that contains it). Past-due items are listed first as overdue. */
export function buildForecast(items: ForecastItem[], now: Date): { overdue: ForecastItem[]; buckets: ForecastBucket[] } {
  const sorted = [...items].sort((a, b) => a.date.getTime() - b.date.getTime());
  const overdue = sorted.filter((x) => daysBetween(now, x.date) < 0);
  const buckets: ForecastBucket[] = [];
  let lower = 0;
  for (const w of FORECAST_WINDOWS) {
    const inWin = sorted.filter((x) => {
      const d = daysBetween(now, x.date);
      return d >= lower && d <= w.days;
    });
    buckets.push({ key: w.key, label: w.label, items: inWin, totalCents: inWin.reduce((s, x) => s + x.valueCents, 0) });
    lower = w.days + 1;
  }
  return { overdue, buckets };
}

/**
 * Point expiration (pure): predicts when a loyalty balance expires from the program's policy and the account's
 * history, scores the risk, picks the alert threshold, and recommends ways to keep points alive. Policies are
 * general knowledge until verified, so every prediction carries a confidence and its source (docs/loyalty-platform.md).
 */

export const LOYALTY_ENGINE_VERSION = 'loyalty-expiration/1';
/** alert thresholds in days before expiration */
export const ALERT_DAYS = [365, 180, 90, 60, 30, 14, 7, 1] as const;

export type PolicyType = 'NEVER' | 'ACTIVITY' | 'FIXED' | 'WHILE_CARD_OPEN' | 'UNKNOWN';
export type RiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXPIRED';

const DAY = 86_400_000;

export function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, last));
  return r;
}

export const daysBetween = (from: Date, to: Date) => Math.ceil((to.getTime() - from.getTime()) / DAY);

export interface Lot {
  earnedAt: Date;
  points: number;
}

export interface ExpiryEvent {
  kind: 'SNAPSHOT' | 'EARN' | 'BONUS' | 'PURCHASE' | 'REDEEM' | 'EXPIRE' | 'TRANSFER_OUT' | 'TRANSFER_IN' | 'ADJUST';
  points: number;
  occurredAt: Date;
}

const INFLOW = new Set(['EARN', 'BONUS', 'PURCHASE', 'TRANSFER_IN']);
const OUTFLOW = new Set(['REDEEM', 'EXPIRE', 'TRANSFER_OUT']);

/** Points still held, grouped by when they were earned (oldest used first when points leave). */
export function lotsFromEvents(events: ExpiryEvent[], balance: number): Lot[] {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const lots: Lot[] = [];
  for (const e of sorted) {
    if (INFLOW.has(e.kind) && e.points > 0) lots.push({ earnedAt: e.occurredAt, points: e.points });
    else if (OUTFLOW.has(e.kind)) {
      let out = Math.abs(e.points);
      while (out > 0 && lots.length) {
        const take = Math.min(out, lots[0].points);
        lots[0].points -= take;
        out -= take;
        if (lots[0].points === 0) lots.shift();
      }
    }
  }
  // the recorded history may not explain the whole balance: scale down if it over-explains
  const held = lots.reduce((s, l) => s + l.points, 0);
  if (held > balance && held > 0) {
    let excess = held - balance;
    while (excess > 0 && lots.length) {
      const take = Math.min(excess, lots[0].points);
      lots[0].points -= take;
      excess -= take;
      if (lots[0].points === 0) lots.shift();
    }
  }
  return lots;
}

export interface ExpiryInput {
  balance: number;
  policyType: PolicyType;
  policyMonths: number | null;
  policyVerified: boolean;
  policySource?: string | null;
  resetConditions?: string[];
  lastActivityAt: Date | null;
  /** date the member knows from the program; wins over any prediction */
  expiresAtOverride: Date | null;
  lots?: Lot[];
  centsPerPoint?: number;
  now: Date;
}

export interface ExpiryTranche {
  date: Date;
  points: number;
}

export interface ExpiryPrediction {
  expiresAt: Date | null;
  daysLeft: number | null;
  atRiskPoints: number;
  riskScore: number;
  level: RiskLevel;
  /** 0–100 */
  confidence: number;
  reason: string;
  source: string;
  /** dated groups of points that expire (FIXED policies) */
  tranches: ExpiryTranche[];
  /** alert threshold currently reached, or null */
  threshold: number | null;
}

/** Smallest alert threshold that still covers the days left (365 … 1), or null if more than a year away or past due. */
export function alertThreshold(daysLeft: number | null): number | null {
  if (daysLeft == null || daysLeft < 0 || daysLeft > ALERT_DAYS[0]) return null;
  for (let i = ALERT_DAYS.length - 1; i >= 0; i--) if (daysLeft <= ALERT_DAYS[i]) return ALERT_DAYS[i];
  return null;
}

function riskFor(daysLeft: number | null, valueCents: number): number {
  if (daysLeft == null) return 0;
  let r = daysLeft <= 0 ? 100 : daysLeft <= 7 ? 95 : daysLeft <= 30 ? 85 : daysLeft <= 90 ? 65 : daysLeft <= 180 ? 40 : daysLeft <= 365 ? 20 : 5;
  if (daysLeft > 0 && valueCents >= 50_000) r += 10;
  return Math.min(100, r);
}

const levelFor = (score: number, daysLeft: number | null): RiskLevel => (daysLeft != null && daysLeft <= 0 ? 'EXPIRED' : score >= 65 ? 'HIGH' : score >= 35 ? 'MEDIUM' : score > 0 ? 'LOW' : 'NONE');

export function predictExpiration(i: ExpiryInput): ExpiryPrediction {
  const cpp = i.centsPerPoint ?? 1;
  const base = { tranches: [] as ExpiryTranche[], threshold: null as number | null };
  const none = (reason: string, confidence: number, source: string, level: RiskLevel = 'NONE', score = 0): ExpiryPrediction => ({ expiresAt: null, daysLeft: null, atRiskPoints: 0, riskScore: score, level, confidence, reason, source, ...base });
  if (i.balance <= 0) return none('No balance to expire.', 95, 'balance');

  const finish = (expiresAt: Date, atRisk: number, confidence: number, reason: string, source: string, tranches: ExpiryTranche[] = []): ExpiryPrediction => {
    const daysLeft = daysBetween(i.now, expiresAt);
    const score = riskFor(daysLeft, Math.round(atRisk * cpp));
    return { expiresAt, daysLeft, atRiskPoints: atRisk, riskScore: score, level: levelFor(score, daysLeft), confidence, reason, source, tranches, threshold: alertThreshold(daysLeft) };
  };

  if (i.expiresAtOverride) return finish(i.expiresAtOverride, i.balance, 90, `Expiry date entered from the program: ${i.expiresAtOverride.toISOString().slice(0, 10)}.`, 'entered by member');

  const src = i.policySource ?? 'program policy';
  const sure = i.policyVerified;
  switch (i.policyType) {
    case 'NEVER':
      return none('This program’s points do not expire.', sure ? 85 : 60, src);
    case 'WHILE_CARD_OPEN':
      return none('Points are kept while the earning card account stays open; they are lost if it closes.', sure ? 75 : 55, src, 'LOW', 5);
    case 'ACTIVITY': {
      if (!i.policyMonths) return none('Activity policy without a period; confirm the rule with the program.', 20, src, 'LOW', 20);
      if (!i.lastActivityAt) return none('Last qualifying activity is not recorded, so the expiry date cannot be predicted. Add it to get an alert.', 20, src, 'LOW', 25);
      return finish(addMonths(i.lastActivityAt, i.policyMonths), i.balance, sure ? 80 : 50, `Points expire ${i.policyMonths} months after the last qualifying activity (${i.lastActivityAt.toISOString().slice(0, 10)}).`, src);
    }
    case 'FIXED': {
      const months = i.policyMonths;
      if (!months) return none('Fixed-expiry policy without a period; confirm the rule with the program.', 20, src, 'LOW', 20);
      const lots = (i.lots ?? []).filter((l) => l.points > 0);
      if (!lots.length) {
        if (!i.lastActivityAt) return none('Earning dates are not recorded, so expiry cannot be predicted.', 20, src, 'LOW', 25);
        return finish(addMonths(i.lastActivityAt, months), i.balance, 30, `Points expire ${months} months after they are earned; earning dates are unknown, so this assumes everything was earned at the last activity.`, src);
      }
      const tranches = lots.map((l) => ({ date: addMonths(l.earnedAt, months), points: l.points })).sort((a, b) => a.date.getTime() - b.date.getTime());
      const first = tranches[0];
      const soon = tranches.filter((t) => daysBetween(i.now, t.date) <= 365).reduce((s, t) => s + t.points, 0);
      return finish(first.date, Math.min(i.balance, soon || first.points), sure ? 80 : 50, `Each point expires ${months} months after it was earned; the oldest ${first.points.toLocaleString('en-US')} points expire first.`, src, tranches);
    }
    default:
      return none('The expiration rule for this program is not known. Check it with the program and record it.', 15, src, 'LOW', 20);
  }
}

/** Alert text for one prediction, e.g. "120,000 miles at risk of expiration." */
export function alertText(program: string, unit: string, p: ExpiryPrediction): string {
  const pts = p.atRiskPoints.toLocaleString('en-US');
  if (p.level === 'EXPIRED') return `${pts} ${unit} in ${program} may already have expired.`;
  if (p.daysLeft != null && p.daysLeft <= 14) return `${pts} ${unit} at risk of expiration in ${program}: ${p.daysLeft} day(s) left.`;
  if (p.daysLeft != null) return `${program} ${unit} expire in ${p.daysLeft} days (${pts} at risk).`;
  return `${pts} ${unit} at risk of expiration in ${program}.`;
}

// ───────────── activity preservation ─────────────

export interface PreserveMethod {
  key: string;
  label: string;
  /** reset-condition tokens this method satisfies */
  tokens: string[];
  estCostCents: number;
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  /** days before the activity posts */
  leadDays: number;
  kinds: string[];
  note: string;
}

export const PRESERVE_METHODS: PreserveMethod[] = [
  { key: 'earn-1-point', label: 'Earn at least 1 point', tokens: ['EARN'], estCostCents: 0, effort: 'LOW', leadDays: 7, kinds: ['AIRLINE', 'HOTEL', 'OTHER', 'SHOPPING', 'DINING'], note: 'Any partner earning activity counts for most programs; confirm which ones do.' },
  { key: 'card-spend', label: 'Spend on a co-brand credit card', tokens: ['CARD_SPEND'], estCostCents: 0, effort: 'LOW', leadDays: 30, kinds: ['AIRLINE', 'HOTEL'], note: 'Spend you already make; posts with the statement.' },
  { key: 'shopping-portal', label: 'Buy through the program’s shopping portal', tokens: ['PORTAL', 'EARN', 'PARTNER'], estCostCents: 500, effort: 'LOW', leadDays: 14, kinds: ['AIRLINE', 'HOTEL', 'SHOPPING'], note: 'A small purchase you need anyway; points post after the merchant confirms.' },
  { key: 'dining', label: 'Dining program purchase', tokens: ['DINING', 'EARN'], estCostCents: 2000, effort: 'LOW', leadDays: 14, kinds: ['AIRLINE', 'DINING'], note: 'Register a card and dine at a participating restaurant.' },
  { key: 'transfer-in', label: 'Transfer a small block of bank points', tokens: ['TRANSFER', 'EARN'], estCostCents: 1000, effort: 'LOW', leadDays: 3, kinds: ['AIRLINE', 'HOTEL'], note: 'Costs the transferred points (usually a 1,000-point minimum); fast, but transfers cannot be undone.' },
  { key: 'buy-points', label: 'Buy a small number of points', tokens: ['PURCHASE', 'EARN'], estCostCents: 3500, effort: 'LOW', leadDays: 1, kinds: ['AIRLINE', 'HOTEL'], note: 'Usually the most expensive option; only if the deadline is close.' },
  { key: 'partner-purchase', label: 'Partner purchase (flowers, wine, car rental)', tokens: ['PARTNER', 'EARN'], estCostCents: 2500, effort: 'MEDIUM', leadDays: 21, kinds: ['AIRLINE', 'HOTEL'], note: 'Needs a purchase from a partner and time to post.' },
  { key: 'stay-or-fly', label: 'Take a qualifying stay or flight', tokens: ['STAY', 'FLIGHT'], estCostCents: 15_000, effort: 'HIGH', leadDays: 30, kinds: ['AIRLINE', 'HOTEL', 'RENTAL_CAR', 'CRUISE'], note: 'Only if you were going anyway.' },
];

export interface PreserveAdvice extends PreserveMethod {
  fitsDeadline: boolean;
  /** true when the program lists this kind of activity as a reset */
  confirmedByPolicy: boolean;
}

/**
 * Cheapest, easiest ways to reset the expiration clock. When the program lists its reset conditions, methods that
 * match them are marked confirmed; otherwise they are suggestions to confirm with the program.
 */
export function preservationAdvice(kind: string, resetConditions: string[], daysLeft: number | null): PreserveAdvice[] {
  const listed = new Set(resetConditions.map((r) => r.toUpperCase()));
  return PRESERVE_METHODS.filter((m) => m.kinds.includes(kind) || (m.kinds.includes('OTHER') && !['AIRLINE', 'HOTEL'].includes(kind)))
    .map((m) => ({ ...m, fitsDeadline: daysLeft == null || m.leadDays <= daysLeft, confirmedByPolicy: m.tokens.some((t) => listed.has(t)) }))
    .filter((m) => listed.size === 0 || m.confirmedByPolicy)
    .sort((a, b) => Number(b.fitsDeadline) - Number(a.fitsDeadline) || a.estCostCents - b.estCostCents || ['LOW', 'MEDIUM', 'HIGH'].indexOf(a.effort) - ['LOW', 'MEDIUM', 'HIGH'].indexOf(b.effort));
}

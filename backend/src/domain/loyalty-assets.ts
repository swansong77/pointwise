/**
 * Loyalty assets other than points (pure): free night / companion / upgrade certificates and their redemption
 * rules, elite status progress, and memberships. Every judgement carries its reasons so it can be audited.
 */
import { daysBetween } from './loyalty-expiration';
import { Condition, evaluateConditions } from './loyalty-conditions';

export const EXPIRING_SOON_DAYS = 90;

// ───────────── certificates ─────────────

export type CertCategory = 'FREE_NIGHT' | 'COMPANION' | 'UPGRADE';
export type CertStatus = 'AVAILABLE' | 'USED' | 'EXPIRED' | 'CANCELLED';

export interface Cert {
  id: string;
  category: CertCategory;
  name: string;
  program: string | null;
  member: string;
  status: CertStatus;
  quantity: number;
  issuedAt: Date | null;
  expiresAt: Date | null;
  pointCap: number | null;
  eligible: string[];
  blackout: string | null;
  restrictions: string | null;
  transferable: boolean;
  potentialValueCents: number;
  /** structured rules parsed from the restriction text (loyalty-conditions.ts) */
  conditions?: Condition[];
}

export type CertState = 'AVAILABLE' | 'EXPIRING' | 'EXPIRED' | 'USED' | 'CANCELLED';

export interface CertView {
  state: CertState;
  daysLeft: number | null;
  /** an available certificate past its date counts as expired even if nobody marked it */
  effectiveStatus: CertStatus;
}

export function certState(c: Pick<Cert, 'status' | 'expiresAt'>, now: Date): CertView {
  const daysLeft = c.expiresAt ? daysBetween(now, c.expiresAt) : null;
  if (c.status === 'USED') return { state: 'USED', daysLeft, effectiveStatus: 'USED' };
  if (c.status === 'CANCELLED') return { state: 'CANCELLED', daysLeft, effectiveStatus: 'CANCELLED' };
  if (c.status === 'EXPIRED' || (daysLeft != null && daysLeft < 0)) return { state: 'EXPIRED', daysLeft, effectiveStatus: 'EXPIRED' };
  return { state: daysLeft != null && daysLeft <= EXPIRING_SOON_DAYS ? 'EXPIRING' : 'AVAILABLE', daysLeft, effectiveStatus: 'AVAILABLE' };
}

export interface Stay {
  hotel: string;
  brand?: string;
  /** award price per night in points */
  pointsPerNight: number;
  /** cash price per night (cents) */
  cashRateCents: number;
  checkIn: Date;
  nights?: number;
  /** hotel category 1–9, when known */
  category?: number;
  bookingType?: 'AWARD' | 'CASH';
  originCountry?: string;
}

export interface RedemptionCheck {
  ok: boolean;
  reasons: string[];
  warnings: string[];
  /** value of redeeming (the cash price avoided) when ok */
  valueCents: number;
}

/** "2026-12-20..2027-01-02; 2027-02-10..2027-02-14" → ranges. Text that does not parse yields none. */
export function parseBlackout(text: string | null): Array<{ from: Date; to: Date }> {
  if (!text) return [];
  const out: Array<{ from: Date; to: Date }> = [];
  for (const part of text.split(/[;\n]/)) {
    const m = /(\d{4}-\d{2}-\d{2})\s*(?:\.\.|to|–|-)\s*(\d{4}-\d{2}-\d{2})/i.exec(part);
    if (m) out.push({ from: new Date(`${m[1]}T00:00:00Z`), to: new Date(`${m[2]}T23:59:59Z`) });
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Whether a free night certificate can be used for this stay, with the rule that blocks it. */
export function checkFreeNight(c: Cert, stay: Stay, now: Date): RedemptionCheck {
  const reasons: string[] = [];
  const warnings: string[] = [];
  const view = certState(c, now);
  if (c.category !== 'FREE_NIGHT') reasons.push('This is not a free night certificate.');
  if (view.effectiveStatus !== 'AVAILABLE') reasons.push(`The certificate is ${view.effectiveStatus.toLowerCase()}.`);
  if (c.quantity < 1) reasons.push('No certificates left.');
  if (c.expiresAt && stay.checkIn > c.expiresAt) reasons.push(`The stay (${stay.checkIn.toISOString().slice(0, 10)}) is after the certificate expires (${c.expiresAt.toISOString().slice(0, 10)}).`);
  if (c.pointCap != null && stay.pointsPerNight > c.pointCap) reasons.push(`The hotel costs ${stay.pointsPerNight.toLocaleString('en-US')} points a night; the certificate covers up to ${c.pointCap.toLocaleString('en-US')}.`);
  if (c.eligible.length) {
    const hay = norm(`${stay.hotel} ${stay.brand ?? ''}`);
    if (!c.eligible.some((e) => hay.includes(norm(e)))) reasons.push(`The hotel is not in the eligible list (${c.eligible.join(', ')}).`);
  }
  const ranges = parseBlackout(c.blackout);
  if (ranges.some((r) => stay.checkIn >= r.from && stay.checkIn <= r.to)) reasons.push('The check-in date falls in a blackout period.');
  if (c.conditions?.length) {
    // point cap, blackout and expiry are already enforced above from the structured fields
    const rest = c.conditions.filter((x) => !['POINT_CAP', 'BLACKOUT', 'EXPIRATION_RULE'].includes(x.type));
    const ev = evaluateConditions(rest, { pointsPerNight: stay.pointsPerNight, category: stay.category, bookingType: stay.bookingType ?? 'AWARD', originCountry: stay.originCountry, date: stay.checkIn });
    reasons.push(...ev.violations);
    warnings.push(...ev.warnings);
  }
  if (c.blackout && !ranges.length) warnings.push(`Blackout rule could not be read automatically: "${c.blackout}". Check it before booking.`);
  if (c.restrictions) warnings.push(`Restrictions: ${c.restrictions}`);
  if (view.state === 'EXPIRING' && view.daysLeft != null) warnings.push(`Expires in ${view.daysLeft} day(s).`);
  const ok = reasons.length === 0;
  return { ok, reasons, warnings, valueCents: ok ? stay.cashRateCents : 0 };
}

export interface CertOpportunity {
  certId: string;
  name: string;
  member: string;
  daysLeft: number | null;
  valueCents: number;
  /** best hotel from the candidates, if any qualifies */
  hotel: string | null;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
  warnings: string[];
}

/** Unused / expiring certificates with the best qualifying hotel from the candidates (or the stored potential value). */
export function certificateOpportunities(certs: Cert[], hotels: Stay[], now: Date): CertOpportunity[] {
  const out: CertOpportunity[] = [];
  for (const c of certs) {
    const v = certState(c, now);
    if (v.effectiveStatus !== 'AVAILABLE') continue;
    let best: { stay: Stay; check: RedemptionCheck } | null = null;
    if (c.category === 'FREE_NIGHT')
      for (const h of hotels) {
        const check = checkFreeNight(c, h, now);
        if (check.ok && (!best || check.valueCents > best.check.valueCents)) best = { stay: h, check };
      }
    const valueCents = best ? best.check.valueCents : c.potentialValueCents;
    const urgency = v.daysLeft != null && v.daysLeft <= 30 ? 'HIGH' : v.daysLeft != null && v.daysLeft <= EXPIRING_SOON_DAYS ? 'MEDIUM' : 'LOW';
    const when = v.daysLeft != null ? ` expiring in ${v.daysLeft} days` : '';
    const msg = best ? `You have a ${c.name}${when}. Redeem at ${best.stay.hotel}. Potential value: $${Math.round(valueCents / 100)}.` : `You have a ${c.name}${when}.${valueCents ? ` Potential value: $${Math.round(valueCents / 100)}.` : ''}`;
    out.push({ certId: c.id, name: c.name, member: c.member, daysLeft: v.daysLeft, valueCents, hotel: best?.stay.hotel ?? null, urgency, message: msg, warnings: best?.check.warnings ?? [] });
  }
  return out.sort((a, b) => (a.daysLeft ?? 99_999) - (b.daysLeft ?? 99_999) || b.valueCents - a.valueCents);
}

// ───────────── elite status ─────────────

export interface Elite {
  id: string;
  program: string;
  level: string;
  member: string;
  periodStart: Date | null;
  expiresAt: Date | null;
  metric: string | null;
  progress: number;
  required: number;
  maintained: boolean;
  valueCents: number;
}

export interface EliteView {
  pct: number | null;
  daysLeft: number | null;
  remaining: number;
  /** 0–100 chance of renewing at the current pace */
  renewalLikelihood: number;
  risk: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXPIRED';
  headline: string;
  actions: string[];
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function eliteView(e: Elite, now: Date): EliteView {
  const daysLeft = e.expiresAt ? daysBetween(now, e.expiresAt) : null;
  const remaining = Math.max(0, e.required - e.progress);
  const pct = e.required > 0 ? clamp(Math.round((e.progress / e.required) * 100), 0, 100) : e.maintained ? 100 : null;
  const unit = e.metric ?? 'qualifying units';
  const label = `${e.program} ${e.level}`;
  if (daysLeft != null && daysLeft < 0 && !e.maintained) return { pct, daysLeft, remaining, renewalLikelihood: 0, risk: 'EXPIRED', headline: `${label}: expired`, actions: ['Ask the program about reinstatement, a status match or a challenge.'] };
  if (e.maintained || (e.required > 0 && remaining === 0))
    return { pct: 100, daysLeft, remaining: 0, renewalLikelihood: 95, risk: 'NONE', headline: `${label}: maintained${e.expiresAt ? `, through ${e.expiresAt.toISOString().slice(0, 7)}` : ''}`, actions: [] };
  // pace: how much has been earned per day since the period began, projected to the deadline
  let likelihood = 50;
  let projected: number | null = null;
  if (e.periodStart && daysLeft != null) {
    const elapsed = Math.max(1, daysBetween(e.periodStart, now));
    projected = (e.progress / elapsed) * Math.max(daysLeft, 0);
    likelihood = remaining === 0 ? 95 : clamp(Math.round((projected / remaining) * 70), 5, 90);
  }
  const risk: EliteView['risk'] = likelihood < 40 ? 'HIGH' : likelihood < 70 ? 'MEDIUM' : 'LOW';
  const actions: string[] = [];
  if (remaining > 0) actions.push(`Earn ${remaining.toLocaleString('en-US')} more ${unit}${daysLeft != null && daysLeft > 0 ? ` in the next ${daysLeft} days (about ${(remaining / Math.max(daysLeft / 30.4375, 0.1)).toFixed(1)} per month)` : ''}.`);
  if (risk !== 'LOW') actions.push('Look for a status challenge, a credit-card shortcut or a bonus-qualification offer from the program.');
  return { pct, daysLeft, remaining, renewalLikelihood: likelihood, risk, headline: `${label}: ${pct != null ? `${pct}% there` : 'in progress'}${remaining > 0 ? `, needs ${remaining.toLocaleString('en-US')} ${unit}` : ''}`, actions };
}

// ───────────── memberships ─────────────

export type MembershipKind = 'CLEAR' | 'TSA_PRECHECK' | 'GLOBAL_ENTRY' | 'PRIORITY_PASS' | 'DRAGONPASS' | 'AIRLINE_CLUB' | 'HOTEL' | 'OTHER';

export interface Member {
  id: string;
  kind: MembershipKind;
  name: string;
  member: string;
  expiresAt: Date | null;
  renewalAt: Date | null;
  renewalCostCents: number;
  autoRenew: boolean;
  annualValueCents: number;
}

/** How early renewal opens, in days before expiry (government programs publish a window; the rest renew any time). */
export const RENEWAL_WINDOW_DAYS: Record<MembershipKind, number> = {
  GLOBAL_ENTRY: 365,
  TSA_PRECHECK: 180,
  CLEAR: 365,
  PRIORITY_PASS: 365,
  DRAGONPASS: 365,
  AIRLINE_CLUB: 365,
  HOTEL: 365,
  OTHER: 365,
};

export interface MembershipView {
  daysLeft: number | null;
  state: 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'NO_DATE';
  renewalEligible: boolean;
  headline: string;
}

export function membershipView(m: Member, now: Date): MembershipView {
  const date = m.expiresAt ?? m.renewalAt;
  if (!date) return { daysLeft: null, state: 'NO_DATE', renewalEligible: false, headline: `${m.name}: no expiration date recorded` };
  const daysLeft = daysBetween(now, date);
  if (daysLeft < 0) return { daysLeft, state: 'EXPIRED', renewalEligible: true, headline: `${m.name} expired ${-daysLeft} day(s) ago.` };
  const eligible = daysLeft <= RENEWAL_WINDOW_DAYS[m.kind];
  const span = daysLeft >= 60 ? `${Math.round(daysLeft / 30.4375)} months` : `${daysLeft} day(s)`;
  const auto = m.autoRenew ? ' It renews automatically.' : '';
  return { daysLeft, state: daysLeft <= EXPIRING_SOON_DAYS ? 'EXPIRING' : 'ACTIVE', renewalEligible: eligible, headline: `${m.name} expires in ${span}.${auto}` };
}

export interface CreditOption {
  benefit: string;
  card: string;
  remainingCents: number;
}

const CREDIT_PATTERNS: Partial<Record<MembershipKind, RegExp>> = {
  GLOBAL_ENTRY: /global entry|tsa|precheck|ntp/i,
  TSA_PRECHECK: /global entry|tsa|precheck|ntp/i,
  CLEAR: /clear/i,
  PRIORITY_PASS: /priority pass/i,
  DRAGONPASS: /dragonpass|lounge/i,
  AIRLINE_CLUB: /lounge|club/i,
};

/** A card credit that can pay for the renewal: matching name and enough left. */
export function renewalCreditSuggestion(m: Member, credits: CreditOption[]): { text: string; credit: CreditOption } | null {
  const re = CREDIT_PATTERNS[m.kind];
  if (!re) return null;
  const hit = credits.filter((c) => re.test(c.benefit) && c.remainingCents > 0).sort((a, b) => b.remainingCents - a.remainingCents)[0];
  if (!hit) return null;
  const covers = m.renewalCostCents > 0 && hit.remainingCents >= m.renewalCostCents;
  return { credit: hit, text: `Use the ${hit.benefit} on ${hit.card} for renewal${covers ? '' : m.renewalCostCents > 0 ? ' (covers part of the cost)' : ''}.` };
}

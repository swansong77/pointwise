/**
 * AI Mode (Copilot) planning (pure). Specialist "lenses" read what the existing engines found and turn it into a prioritized plan:
 * each item says what to do, why, how sure we are, what it is worth, what was assumed and what could go wrong. Nothing here calls a
 * model or changes anything; a model may later reword the plan, and every action comes from the server allow-list.
 */
import type { SearchAnswer, StepResult } from './answer-compose';
import { Lens, LENS_LABEL, Mode, MODE_SPEC } from './copilot-modes';
import { CallAction, reminderFor } from './search-actions';
import { applyMemory, Decision, EMPTY_PREFS, MemoryEffect, Preferences } from './copilot-memory';
import type { GoalProgress } from './goals';
import type { WhatIfOutcome } from './what-if';
import type { Roadmap } from './cos-roadmap';

export const COPILOT_VERSION = 'copilot/1';

export type Horizon = 'TODAY' | 'WEEK' | 'MONTH' | 'LATER';
export const HORIZON_LABEL: Record<Horizon, string> = { TODAY: 'Today', WEEK: 'This week', MONTH: 'This month', LATER: 'Later' };
const HORIZON_ORDER: Record<Horizon, number> = { TODAY: 0, WEEK: 1, MONTH: 2, LATER: 3 };

export interface Factor {
  label: string;
  effect: 'UP' | 'DOWN' | 'NEUTRAL';
  detail: string;
}

/**
 * The structured facts behind an item. Only these (never the prose) can go into the redacted view. `member` is the member's real
 * nickname here; the view replaces it with a label.
 */
export interface ItemFacts {
  kind: string;
  subject?: string;
  member?: string;
  card?: string;
  program?: string;
  amountCents?: number;
  points?: number;
  daysLeft?: number;
  count?: number;
  verdict?: string;
}

export interface PlanItem {
  id: string;
  lens: Lens;
  horizon: Horizon;
  /** higher first within a horizon */
  priority: number;
  title: string;
  recommendation: string;
  reason: string;
  evidence: string[];
  expectedValueCents: number | null;
  assumptions: string[];
  risks: string[];
  /** 0–100 */
  confidence: number;
  factors: Factor[];
  href: string;
  facts: ItemFacts;
  calls: CallAction[];
}

export interface LensRun {
  lens: Lens;
  label: string;
  /** the engines this specialist read */
  engines: string[];
  ok: boolean;
  found: number;
  note: string;
}

export interface CopilotPlan {
  version: string;
  mode: Mode;
  kind: 'AGENDA' | 'ANSWER' | 'WHATIF' | 'ROADMAP';
  question: string;
  scope: Horizon;
  headline: string;
  summary: string;
  items: PlanItem[];
  lenses: LensRun[];
  assumptions: string[];
  risks: string[];
  confidence: number;
  evidence: string[];
  /** counts by horizon, for the dashboard */
  counts: Record<Horizon, number>;
  valueAtStakeCents: number;
  /** items the member put aside (snoozed, dismissed, done), and how many were raised by their preferences */
  memory: { hidden: MemoryEffect['hidden']; boosted: number };
  /** a what-if comparison, when the question was one */
  whatIf?: WhatIfOutcome;
  /** a 90-day or yearly roadmap, when the question asked for one */
  roadmap?: Roadmap;
}

/** a goal and how far along it is, for the plan */
export interface GoalView {
  id: string;
  title: string;
  kind: string;
  dueAt: Date | null;
  progress: GoalProgress;
}

export interface AgendaExtra {
  /** how many items to return (default: what the mode and the question allow) */
  limit?: number;
  goals?: GoalView[];
  prefs?: Preferences;
  decisions?: Map<string, Decision>;
}

// ───────────── reading engine output defensively ─────────────

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const day = (x: unknown): string => {
  const d = typeof x === 'string' || x instanceof Date ? new Date(x) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
};
const daysUntil = (x: unknown, now: Date): number | null => {
  const d = typeof x === 'string' || x instanceof Date ? new Date(x) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86_400_000);
};
/** "$1,234.50" → cents */
export function centsOf(x: unknown): number | null {
  if (typeof x === 'number') return Number.isFinite(x) ? Math.round(x) : null;
  if (typeof x !== 'string') return null;
  const m = /-?\$?\s*(-?[\d,]+(?:\.\d+)?)/.exec(x);
  if (!m) return null;
  const v = Number(m[1].replace(/,/g, ''));
  return Number.isFinite(v) ? Math.round(v * 100) : null;
}
const usd = (cents: number) => '$' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const left = (d: number) => (d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);

export function horizonFor(daysLeft: number | null): Horizon {
  if (daysLeft == null) return 'LATER';
  if (daysLeft <= 1) return 'TODAY';
  if (daysLeft <= 7) return 'WEEK';
  if (daysLeft <= 31) return 'MONTH';
  return 'LATER';
}
/** more urgent and worth more ⇒ higher */
const urgency = (d: number | null) => (d == null ? 0.5 : d <= 1 ? 3 : d <= 7 ? 2 : d <= 31 ? 1 : 0.4);
const score = (cents: number | null, d: number | null) => Math.round(((cents ?? 0) / 100 + 5) * urgency(d));

export const TOOL_LENS: Record<string, Lens> = {
  get_expiring_offers: 'OFFER',
  get_offer_opportunities: 'OFFER',
  get_missed_offers: 'AUDIT',
  get_expiring_loyalty: 'LOYALTY',
  get_certificates: 'LOYALTY',
  get_transfer_bonuses: 'TRAVEL',
  get_benefit_summary: 'BENEFIT',
  get_renewals: 'CARD_STRATEGY',
  get_five24_status: 'PORTFOLIO',
  get_stale_accounts: 'AUDIT',
  goals: 'GOAL',
  'what-if': 'PORTFOLIO',
};

/** the engine calls an agenda needs, in the order the specialists work */
export const AGENDA_STEPS: Array<{ tool: string; label: string; input: Record<string, unknown> }> = [
  { tool: 'get_expiring_offers', label: 'Expiring offers and credits', input: {} },
  { tool: 'get_offer_opportunities', label: 'Offer opportunities', input: {} },
  { tool: 'get_expiring_loyalty', label: 'Points and miles at risk', input: {} },
  { tool: 'get_certificates', label: 'Certificates', input: {} },
  { tool: 'get_transfer_bonuses', label: 'Transfer bonuses', input: {} },
  { tool: 'get_benefit_summary', label: 'Credits to use', input: { status: 'expiring', withinDays: 45 } },
  { tool: 'get_renewals', label: 'Annual fees coming up', input: { withinDays: 60 } },
  { tool: 'get_five24_status', label: '5/24 status', input: {} },
  { tool: 'get_stale_accounts', label: 'Account data freshness', input: {} },
  { tool: 'get_missed_offers', label: 'Missed offers', input: {} },
];

// ───────────── the specialists ─────────────

const factor = (label: string, effect: Factor['effect'], detail: string): Factor => ({ label, effect, detail });

type Reader = (data: unknown, now: Date) => PlanItem[];

const offersExpiring: Reader = (data, now) => {
  const out: PlanItem[] = [];
  for (const b of arr(obj(data).buckets)) {
    for (const i of arr(obj(b).items).map(obj)) {
      const d = daysUntil(i.endsAt, now);
      const cents = num(i.valueCents) ?? 0;
      if (d == null || d < 0) continue;
      // certificates and credits have their own specialists, so they are not listed twice
      if (str(i.kind) === 'CERTIFICATE' || str(i.kind) === 'CREDIT') continue;
      const label = str(i.label) || 'An offer';
      const call = reminderFor(label, i.endsAt, '/offers/expirations', 3, now, 'remind-' + str(i.id));
      out.push({
        id: 'offer-exp:' + str(i.id),
        lens: 'OFFER',
        horizon: horizonFor(d),
        priority: score(cents, d),
        title: `${label} ends ${left(d)}`,
        recommendation: str(i.action) || 'Use it before it ends.',
        reason: cents > 0 ? `${usd(cents)} is lost if it lapses unused.` : 'It lapses unused if you do nothing.',
        evidence: [`Expiring offers: ends ${day(i.endsAt)}${str(i.card) ? ` on ${str(i.card)}` : ''}`],
        expectedValueCents: cents || null,
        assumptions: [],
        risks: d <= 1 ? ['Very little time left; it may not post in time.'] : [],
        confidence: 90,
        factors: [factor('Time left', d <= 7 ? 'UP' : 'NEUTRAL', `${plural(d, 'day')} left`), factor('Value', cents >= 2000 ? 'UP' : 'NEUTRAL', usd(cents))],
        href: '/offers/expirations',
        facts: { kind: 'OFFER_EXPIRING', subject: str(i.merchant) || label, member: str(i.cardholder) || undefined, card: str(i.card) || undefined, amountCents: cents, daysLeft: d },
        calls: call ? [call] : [],
      });
    }
  }
  return out;
};

const offerOpportunities: Reader = (data, now) =>
  arr(obj(data).items)
    .map(obj)
    .filter((o) => o.activated === false && (num(o.daysLeft) ?? 99) <= 45 && (num(o.expectedValueCents) ?? 0) >= 500)
    .slice(0, 4)
    .map((o) => {
      const d = num(o.daysLeft);
      const cents = num(o.expectedValueCents) ?? 0;
      const name = str(o.merchant) || str(o.title) || 'An offer';
      return {
        id: 'offer-act:' + (str(o.id) || name),
        lens: 'OFFER' as Lens,
        horizon: horizonFor(d),
        priority: score(cents, d) + 2,
        title: `Activate the ${name} offer`,
        recommendation: `Activate it on the issuer’s own site or app, then mark it activated in PointWise. PointWise never logs in for you.`,
        reason: cents > 0 ? `About ${usd(cents)} expected if you spend as the offer requires.` : 'It is not activated yet.',
        evidence: [`Offer opportunities: score ${num(o.score) ?? '-'}/100${d != null ? `, ${plural(d, 'day')} left` : ''}`],
        expectedValueCents: cents || null,
        assumptions: ['You would make the qualifying purchase anyway.'],
        risks: ['An offer only pays if the purchase meets its terms.'],
        confidence: Math.min(90, Math.max(30, num(o.confidence) ?? 60)),
        factors: [factor('Score', (num(o.score) ?? 0) >= 60 ? 'UP' : 'NEUTRAL', `${num(o.score) ?? '-'}/100`), factor('Activated', 'DOWN', 'not yet')],
        href: '/offers/inventory',
        facts: { kind: 'OFFER_ACTIVATE', subject: name, amountCents: cents, daysLeft: d ?? undefined },
        calls: [],
      };
    });

const certificates: Reader = (data, now) =>
  arr(obj(data).certificates)
    .map(obj)
    .filter((c) => c.expiresAt && !c.usedAt && str(c.status) !== 'USED')
    .map((c) => ({ c, d: daysUntil(c.expiresAt, now) }))
    .filter((x) => x.d != null && x.d >= 0 && x.d <= 90)
    .map(({ c, d }) => {
      const cents = num(c.potentialValueCents) ?? 0;
      const name = str(c.name) || 'A certificate';
      const call = reminderFor(name, c.expiresAt, '/loyalty', 14, now, 'remind-cert-' + str(c.id));
      return {
        id: 'cert:' + str(c.id),
        lens: 'LOYALTY' as Lens,
        horizon: horizonFor(d),
        priority: score(cents, d),
        title: `${name} expires ${left(d!)}`,
        recommendation: 'Book a stay or flight that uses it, or check what it can still be applied to.',
        reason: cents > 0 ? `Worth up to ${usd(cents)}; it is lost if it expires.` : 'It is lost if it expires unused.',
        evidence: [`Certificates: expires ${day(c.expiresAt)}`],
        expectedValueCents: cents || null,
        assumptions: ['Its restrictions (eligible hotels, blackout dates) still allow a booking.'],
        risks: ['Award or certificate space can be limited near the expiry date.'],
        confidence: 80,
        factors: [factor('Time left', d! <= 30 ? 'UP' : 'NEUTRAL', `${plural(d!, 'day')} left`)],
        href: '/loyalty',
        facts: { kind: 'CERTIFICATE_EXPIRING', subject: name, member: str(c.member) || undefined, program: str(c.program) || undefined, amountCents: cents, daysLeft: d! },
        calls: call ? [call] : [],
      };
    });

const loyaltyAtRisk: Reader = (data) =>
  arr(obj(data).items)
    .map(obj)
    .filter((i) => i.message && ['HIGH', 'EXPIRED', 'MEDIUM'].includes(str(obj(i.prediction).level)))
    .slice(0, 4)
    .map((i) => {
      const pr = obj(i.prediction);
      const d = num(pr.daysLeft);
      const cents = num(i.valueCents) ?? 0;
      const fix = str(obj(arr(i.preservation)[0]).label);
      return {
        id: 'loy-risk:' + str(i.accountId),
        lens: 'LOYALTY' as Lens,
        horizon: horizonFor(d),
        priority: score(cents, d) + (str(pr.level) === 'HIGH' ? 3 : 0),
        title: `${str(i.program) || 'A loyalty balance'} may expire${d != null ? ` ${left(d)}` : ''}`,
        recommendation: fix ? `Cheapest fix: ${fix}.` : 'Check the program’s activity rules and add qualifying activity.',
        reason: cents > 0 ? `About ${usd(cents)} of ${str(i.unit) || 'points'} at risk.` : 'The balance could lapse.',
        evidence: [`Loyalty expirations: risk ${str(pr.level).toLowerCase()}`],
        expectedValueCents: cents || null,
        assumptions: ['Expiry follows the program’s published policy as recorded in PointWise.'],
        risks: ['Programs can change their expiry rules without notice.'],
        confidence: Math.min(90, Math.max(30, num(pr.confidence) ?? 60)),
        factors: [factor('Risk', str(pr.level) === 'HIGH' || str(pr.level) === 'EXPIRED' ? 'UP' : 'NEUTRAL', str(pr.level).toLowerCase())],
        href: '/loyalty',
        facts: { kind: 'LOYALTY_AT_RISK', program: str(i.program) || undefined, member: str(i.member) || undefined, points: num(i.balance) ?? undefined, amountCents: cents, daysLeft: d ?? undefined, verdict: str(pr.level).toLowerCase() },
        calls: [],
      };
    });

const transferBonuses: Reader = (data) =>
  arr(data)
    .map(obj)
    .filter((r) => (num(r.activeBonusPercent) ?? 0) > 0)
    .slice(0, 2)
    .map((r) => {
      const pct = num(r.activeBonusPercent) ?? 0;
      return {
        id: `xfer:${str(r.currencyName)}:${str(r.programName)}`,
        lens: 'TRAVEL' as Lens,
        horizon: 'WEEK' as Horizon,
        priority: 6 + Math.round(pct / 10),
        title: `${pct}% transfer bonus: ${str(r.currencyName)} to ${str(r.programName)}`,
        recommendation: 'Only transfer if you already have a booking in mind that needs these points. Transfers cannot be undone, and PointWise never transfers for you.',
        reason: str(obj(r.advice).text) || 'A bonus makes a transfer cheaper while it lasts.',
        evidence: ['Transfer bonuses: active promotion'],
        expectedValueCents: null,
        assumptions: ['You hold the currency and the award is available.'],
        risks: ['Transfers are irreversible; award space may disappear after you transfer.'],
        confidence: 55,
        factors: [factor('Bonus', 'UP', `${pct}%`)],
        href: '/travel',
        facts: { kind: 'TRANSFER_BONUS', subject: str(r.currencyName), program: str(r.programName), count: pct },
        calls: [],
      };
    });

const credits: Reader = (data, now) =>
  arr(obj(data).items)
    .map(obj)
    .map((b) => ({ b, d: num(b.daysLeft), cents: centsOf(b.remaining) ?? 0 }))
    .filter((x) => x.cents > 0 && x.d != null && x.d >= 0 && x.d <= 45)
    .slice(0, 5)
    .map(({ b, d, cents }) => {
      const name = str(b.benefit) || 'A credit';
      const call = reminderFor(name, str(b.lastDay) ? str(b.lastDay) + 'T12:00:00Z' : null, '/benefits', 3, now, 'remind-benefit-' + name);
      return {
        id: `credit:${str(b.card)}:${name}`,
        lens: 'BENEFIT' as Lens,
        horizon: horizonFor(d),
        priority: score(cents, d),
        title: `Use ${usd(cents)} of ${name}`,
        recommendation: `Use it by ${str(b.lastDay) || 'the last day of the period'} and record it in PointWise.`,
        reason: `${usd(cents)} of this credit goes unused if the period ends.`,
        evidence: [`Benefits: ${str(b.status) || 'available'}, ${plural(d!, 'day')} left`],
        expectedValueCents: cents,
        assumptions: ['The credit’s terms still apply to a purchase you would make.'],
        risks: [],
        confidence: 85,
        factors: [factor('Time left', d! <= 7 ? 'UP' : 'NEUTRAL', `${plural(d!, 'day')} left`)],
        href: '/benefits',
        facts: { kind: 'CREDIT_UNUSED', subject: name, card: str(b.card) || undefined, amountCents: cents, daysLeft: d! },
        calls: call ? [call] : [],
      };
    });

/** annual fees that the card has not earned back, renewing within `maxDays`, as decisions to make */
export const renewalsWithin =
  (maxDays: number, limit = 3): Reader =>
  (data) =>
  arr(data)
    .map(obj)
    .filter((r) => r.coversFee === false && (num(r.daysUntil) ?? 999) <= maxDays)
    .slice(0, limit)
    .map((r) => {
      const d = num(r.daysUntil);
      const fee = centsOf(r.annualFee) ?? 0;
      const got = centsOf(r.valueReceived) ?? 0;
      return {
        id: 'renewal:' + str(r.card),
        lens: 'CARD_STRATEGY' as Lens,
        horizon: horizonFor(d),
        priority: score(fee - got, d) + 1,
        title: `${str(r.card)} renews ${d != null ? left(d) : 'soon'} for ${usd(fee)}`,
        recommendation: 'Decide before it renews: keep it, ask for a retention offer, or downgrade to a no-fee version.',
        reason: `It returned ${usd(got)} against the ${usd(fee)} fee, so it does not cover its fee yet.`,
        evidence: [`Renewals: fee ${usd(fee)} on ${str(r.renewsOn)}, value received ${usd(got)}`],
        expectedValueCents: got - fee,
        assumptions: ['Value received counts logged benefits and rewards on logged spend only.'],
        risks: ['Cancelling can lower your available credit and shorten your average account age; a downgrade usually keeps the account open.'],
        confidence: 70,
        factors: [factor('Fee coverage', 'DOWN', `${usd(got)} of ${usd(fee)}`)],
        href: '/portfolio',
        facts: { kind: 'RENEWAL_REVIEW', card: str(r.card), amountCents: fee, daysLeft: d ?? undefined, count: got },
        calls: [],
      };
    });

const renewals: Reader = renewalsWithin(60);

const five24: Reader = (data, now) =>
  arr(data)
    .map(obj)
    .filter((m) => m.underLimit === false || ((num(m.count) ?? 0) === 4 && !!m.nextSlotAt))
    .slice(0, 2)
    .map((m) => {
      const d = daysUntil(m.nextSlotAt, now);
      const over = m.underLimit === false;
      return {
        id: 'five24:' + str(m.member),
        lens: 'PORTFOLIO' as Lens,
        horizon: 'LATER' as Horizon,
        priority: 2,
        title: over ? `${str(m.member)} is at ${str(m.label)}${d != null ? `; a slot opens ${left(d)}` : ''}` : `${str(m.member)} has one 5/24 slot left (${str(m.label)})`,
        recommendation: over ? 'Hold new Chase applications until a slot opens; consider applying for the next card with another member.' : 'Save the last slot for the card that is worth it most.',
        reason: 'Chase typically declines applicants who opened 5 or more personal cards in the last 24 months.',
        evidence: [`5/24: ${str(m.label)}`],
        expectedValueCents: null,
        assumptions: ['Counts follow the issuer rule as modeled in PointWise and the opening dates you entered.'],
        risks: ['Issuer rules change; this is a rule of thumb, not a guarantee.'],
        confidence: 75,
        factors: [factor('Count', over ? 'DOWN' : 'NEUTRAL', str(m.label))],
        href: '/five24',
        facts: { kind: 'FIVE24', member: str(m.member) || undefined, count: num(m.count) ?? undefined, daysLeft: d ?? undefined, verdict: over ? 'over' : 'one-left' },
        calls: [],
      };
    });

const staleData: Reader = (data) =>
  arr(obj(data).accounts)
    .map(obj)
    .filter((a) => ['STALE', 'NEVER'].includes(str(a.freshness)))
    .slice(0, 2)
    .map((a) => ({
      id: `stale:${str(a.member)}:${str(a.program)}`,
      lens: 'AUDIT' as Lens,
      horizon: 'WEEK' as Horizon,
      priority: 3,
      title: `Update the ${str(a.program)} balance`,
      recommendation: str(obj(arr(a.plan)[0]).text) || 'Refresh the balance so expiry and value checks stay accurate.',
      reason: 'Old balances make expiry and redemption advice unreliable.',
      evidence: [`Account freshness: ${str(a.freshness).toLowerCase()}`],
      expectedValueCents: null,
      assumptions: [],
      risks: [],
      confidence: 80,
      factors: [factor('Data age', 'DOWN', str(a.freshness).toLowerCase())],
      href: '/loyalty',
      facts: { kind: 'DATA_STALE', program: str(a.program) || undefined, member: str(a.member) || undefined, verdict: str(a.freshness).toLowerCase() },
      calls: [],
    }));

const missed: Reader = (data) => {
  const lost = num(obj(data).totalLostCents) ?? 0;
  if (lost <= 0) return [];
  return [
    {
      id: 'missed-offers',
      lens: 'AUDIT',
      horizon: 'LATER',
      priority: 2,
      title: `About ${usd(lost)} in offers expired unused`,
      recommendation: 'Turn on offer alerts and review the offer inbox weekly so fewer lapse.',
      reason: 'Offers that expired without being used show where attention is slipping.',
      evidence: ['Missed offers: expired offers with no recorded use'],
      expectedValueCents: null,
      assumptions: [],
      risks: [],
      confidence: 70,
      factors: [factor('Missed', 'DOWN', usd(lost))],
      href: '/offers/inventory',
      facts: { kind: 'OFFERS_MISSED', amountCents: lost },
      calls: [],
    },
  ];
};

const READERS: Array<{ tool: string; read: Reader }> = [
  { tool: 'get_expiring_offers', read: offersExpiring },
  { tool: 'get_offer_opportunities', read: offerOpportunities },
  { tool: 'get_certificates', read: certificates },
  { tool: 'get_expiring_loyalty', read: loyaltyAtRisk },
  { tool: 'get_transfer_bonuses', read: transferBonuses },
  { tool: 'get_benefit_summary', read: credits },
  { tool: 'get_renewals', read: renewals },
  { tool: 'get_five24_status', read: five24 },
  { tool: 'get_stale_accounts', read: staleData },
  { tool: 'get_missed_offers', read: missed },
];

/** "today", "this week", "this month": how far ahead the person is asking about */
export function scopeOf(q: string): Horizon {
  const t = q.toLowerCase();
  if (/\btoday\b|\bright now\b|\burgent\b|\bfirst\b/.test(t)) return 'TODAY';
  if (/this week|next week|\bweek\b/.test(t)) return 'WEEK';
  if (/this month|next month|\bmonth(ly)?\b|next 30|next thirty/.test(t)) return 'MONTH';
  return 'WEEK';
}

/** Is this a "what should I do" question the agenda answers (rather than a specific question)? */
export function isAgendaQuestion(q: string): boolean {
  const t = q.toLowerCase();
  return /what (should|can|do) (i|we) (do|focus|work on|prioriti[sz]e)|what('| i)?s (next|on my plate|important|urgent)|my (to-?do|priorities|tasks|action plan|plan)|action plan|priorities|to-?do|what do i need to do|what needs (my )?attention|what should (i|we) do/.test(t);
}

const RANK: Record<Horizon, number> = HORIZON_ORDER;
const SCOPE_LIMIT: Record<Horizon, number> = { TODAY: 6, WEEK: 10, MONTH: 15, LATER: 20 };

const GOAL_PRIORITY = { AT_RISK: 8, BEHIND: 7, UNKNOWN: 1, ON_TRACK: 0, ACHIEVED: 0 } as const;

/** goals that need something from the member: behind, at risk, or not yet tracked */
export function goalItems(goals: GoalView[], now: Date): PlanItem[] {
  const out: PlanItem[] = [];
  for (const g of goals) {
    const p = g.progress;
    if (p.state === 'ON_TRACK' || p.state === 'ACHIEVED') continue;
    const d = g.dueAt ? daysUntil(g.dueAt, now) : null;
    out.push({
      id: 'goal:' + g.id,
      lens: 'GOAL',
      horizon: p.state === 'UNKNOWN' ? 'LATER' : d != null ? horizonFor(d) : 'MONTH',
      priority: GOAL_PRIORITY[p.state] + (d != null && d <= 30 ? 3 : 0),
      title: `Goal: ${g.title}${p.pct != null ? ` (${p.pct}%)` : ''}`,
      recommendation: p.next[0] ?? p.detail,
      reason: p.detail,
      evidence: [`Goal progress: ${p.current} toward ${p.target}`],
      expectedValueCents: null,
      assumptions: [],
      risks: p.state === 'AT_RISK' || p.state === 'BEHIND' ? ['At the current pace the goal may be missed.'] : [],
      confidence: p.confidence,
      factors: [factor('State', p.state === 'AT_RISK' || p.state === 'BEHIND' ? 'DOWN' : 'NEUTRAL', p.state.toLowerCase().replace('_', ' ')), ...(p.pct != null ? [factor('Progress', 'NEUTRAL', `${p.pct}%`)] : [])],
      href: '/copilot#goals',
      // the goal's own title is the member's text, so only its kind, state and progress go into a redacted view
      facts: { kind: 'GOAL', verdict: p.state.toLowerCase().replace('_', ' '), count: p.pct ?? undefined, daysLeft: d ?? undefined },
      calls: [],
    });
  }
  return out;
}

export function composeAgenda(results: StepResult[], mode: Mode, q: string, now: Date, extra: AgendaExtra = {}): CopilotPlan {
  const spec = MODE_SPEC[mode];
  const scope = scopeOf(q);
  const byTool = new Map(results.map((r) => [r.tool, r]));
  const all: PlanItem[] = [];
  const lensRuns = new Map<Lens, LensRun>();
  const order: Lens[] = ['OFFER', 'LOYALTY', 'TRAVEL', 'BENEFIT', 'CARD_STRATEGY', 'PORTFOLIO', 'AUDIT', 'GOAL'];
  for (const l of order) lensRuns.set(l, { lens: l, label: LENS_LABEL[l], engines: [], ok: true, found: 0, note: '' });
  const failures: string[] = [];

  for (const { tool, read } of READERS) {
    const lens = TOOL_LENS[tool];
    const run = lensRuns.get(lens)!;
    if (!spec.lenses.includes(lens)) continue;
    const r = byTool.get(tool);
    run.engines.push(tool);
    if (!r || !r.ok) {
      run.ok = false;
      failures.push(`${LENS_LABEL[lens]}: ${r?.error ?? 'engine not available'}`);
      continue;
    }
    const found = read(r.data, now);
    run.found += found.length;
    all.push(...found);
  }

  if (spec.lenses.includes('GOAL') && extra.goals) {
    const run = lensRuns.get('GOAL')!;
    run.engines.push('goals');
    const found = goalItems(extra.goals, now);
    run.found = found.length;
    all.push(...found);
  }

  all.sort((a, b) => RANK[a.horizon] - RANK[b.horizon] || b.priority - a.priority || a.id.localeCompare(b.id));
  // what the member put aside is hidden and what matches their preferences rises, before the list is cut to length
  const eff = applyMemory(all, extra.prefs ?? EMPTY_PREFS, extra.decisions ?? new Map(), now);
  const limit = extra.limit ?? Math.min(spec.limit, SCOPE_LIMIT[scope]);
  // a goal that needs attention keeps a place (up to two) even when dollar-sized items would crowd it out of a short plan
  const reserved = eff.items.filter((i) => i.lens === 'GOAL').slice(0, 2);
  const items = [...eff.items.filter((i) => !reserved.includes(i)).slice(0, Math.max(0, limit - reserved.length)), ...reserved].sort((a, b) => RANK[a.horizon] - RANK[b.horizon] || b.priority - a.priority || a.id.localeCompare(b.id));
  const counts: Record<Horizon, number> = { TODAY: 0, WEEK: 0, MONTH: 0, LATER: 0 };
  for (const i of items) counts[i.horizon]++;
  const valueAtStake = items.reduce((s, i) => s + Math.max(0, i.expectedValueCents ?? 0), 0);

  for (const run of lensRuns.values()) run.note = !run.engines.length ? 'Not used in this mode' : !run.ok ? 'Some data could not be read' : run.found ? `${plural(run.found, 'item')} found` : 'Nothing needs attention';

  const urgent = counts.TODAY;
  const headline = !items.length
    ? 'Nothing needs your attention right now.'
    : urgent
      ? `${plural(urgent, 'thing')} to do today${counts.WEEK ? `, ${counts.WEEK} more this week` : ''}.`
      : counts.WEEK
        ? `${plural(counts.WEEK, 'thing')} to do this week${counts.MONTH ? `, ${counts.MONTH} more this month` : ''}.`
        : `${plural(items.length, 'thing')} to plan for.`;
  const put = eff.hidden.length ? ` ${plural(eff.hidden.length, 'item')} you snoozed or dismissed ${eff.hidden.length === 1 ? 'is' : 'are'} hidden.` : '';
  const summary =
    (items.length
      ? `${headline} ${valueAtStake > 0 ? `About ${usd(valueAtStake)} is at stake. ` : ''}Start with: ${items[0].title}.`
      : 'No offers, credits, certificates or balances are close to expiring, and no card needs a decision. Check back tomorrow.') + put;

  const assumptions = [...new Set(items.flatMap((i) => i.assumptions))].slice(0, 6);
  const risks = [...new Set(items.flatMap((i) => i.risks))].slice(0, 6);
  const confidences = items.map((i) => i.confidence);
  const base = confidences.length ? Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length) : 90;
  const confidence = Math.max(20, base - Math.min(30, failures.length * 10));
  if (failures.length) assumptions.unshift(`Some data could not be read (${failures.join('; ')}), so this plan may be incomplete.`);

  return {
    version: COPILOT_VERSION,
    mode,
    kind: 'AGENDA',
    question: q,
    scope,
    headline,
    summary,
    items,
    lenses: order.map((l) => lensRuns.get(l)!).filter((r) => r.engines.length),
    assumptions,
    risks,
    confidence,
    evidence: [...new Set(items.flatMap((i) => i.evidence))].slice(0, 12),
    counts,
    valueAtStakeCents: valueAtStake,
    memory: { hidden: eff.hidden, boosted: eff.boosted },
  };
}

// ───────────── a specific question, answered by the search engines ─────────────

const INTENT_LENS: Record<string, Lens> = {
  SHOPPING: 'OFFER',
  OFFER_SEARCH: 'OFFER',
  NEW_OFFERS: 'OFFER',
  SYNC_OFFERS: 'OFFER',
  EXPIRATION_REVIEW: 'OFFER',
  POINTS_LOOKUP: 'LOYALTY',
  CERTIFICATE_REVIEW: 'LOYALTY',
  STATUS_REVIEW: 'PORTFOLIO',
  CARD_RECOMMENDATION: 'CARD_STRATEGY',
  ANNUAL_FEE_REVIEW: 'CARD_STRATEGY',
  BENEFIT_LOOKUP: 'BENEFIT',
  PORTFOLIO_REVIEW: 'PORTFOLIO',
  SPENDING: 'PORTFOLIO',
  TRAVEL: 'TRAVEL',
  REDEMPTION: 'TRAVEL',
};

/** Wraps a search answer as a plan so every Copilot reply has the same explainable shape. */
export function fromSearchAnswer(a: SearchAnswer, mode: Mode, q: string, stepTools: string[]): CopilotPlan {
  const lens = INTENT_LENS[a.intent] ?? 'AUDIT';
  const item: PlanItem = {
    id: 'answer:' + a.intent,
    lens,
    horizon: 'TODAY',
    priority: 1,
    title: a.title,
    recommendation: a.summary,
    reason: a.reasoning[0] ?? 'Computed from your own PointWise data.',
    evidence: a.evidence,
    expectedValueCents: null,
    assumptions: a.warnings,
    risks: [],
    confidence: a.confidence,
    factors: a.reasoning.slice(0, 4).map((r) => factor('Why', 'NEUTRAL', r)),
    href: a.actions[0]?.href ?? '/search',
    facts: { kind: 'ANSWER', verdict: a.intent.toLowerCase() },
    calls: a.calls ?? [],
  };
  const unanswered = a.unanswered;
  return {
    version: COPILOT_VERSION,
    mode,
    kind: 'ANSWER',
    question: q,
    scope: 'TODAY',
    headline: a.title,
    summary: a.summary,
    items: unanswered ? [] : [item],
    lenses: [{ lens, label: LENS_LABEL[lens], engines: stepTools, ok: !unanswered, found: unanswered ? 0 : 1, note: unanswered ? 'Could not tell what you meant' : 'Answered' }],
    assumptions: a.warnings,
    risks: [],
    confidence: a.confidence,
    evidence: a.evidence,
    counts: { TODAY: unanswered ? 0 : 1, WEEK: 0, MONTH: 0, LATER: 0 },
    valueAtStakeCents: 0,
    memory: { hidden: [], boosted: 0 },
  };
}

const WHATIF_LENS: Record<WhatIfOutcome['scenario'], Lens> = { APPLY: 'CARD_STRATEGY', WAIT: 'PORTFOLIO', TRANSFER: 'TRAVEL', CANCEL: 'CARD_STRATEGY', CHANGE: 'CARD_STRATEGY' };

/** A what-if comparison in the same explainable shape as every other reply. */
export function fromWhatIf(o: WhatIfOutcome, mode: Mode, q: string): CopilotPlan {
  const lens = WHATIF_LENS[o.scenario];
  const item: PlanItem = {
    id: 'whatif:' + o.scenario.toLowerCase(),
    lens,
    horizon: 'TODAY',
    priority: 1,
    title: o.title,
    recommendation: o.recommendation,
    reason: o.summary,
    evidence: o.evidence,
    expectedValueCents: o.netCents,
    assumptions: o.assumptions,
    risks: o.risks,
    confidence: o.confidence,
    factors: o.deltas.slice(0, 6).map((d) => factor(d.label, d.direction === 'BETTER' ? 'UP' : d.direction === 'WORSE' ? 'DOWN' : 'NEUTRAL', `${d.before} → ${d.after}`)),
    href: '/copilot',
    facts: { kind: 'WHATIF', verdict: o.verdict.toLowerCase() },
    calls: [],
  };
  return {
    version: COPILOT_VERSION,
    mode,
    kind: 'WHATIF',
    question: q,
    scope: 'TODAY',
    headline: o.title,
    summary: o.summary,
    items: [item],
    lenses: [{ lens, label: LENS_LABEL[lens], engines: ['what-if'], ok: true, found: 1, note: 'Compared' }],
    assumptions: o.assumptions,
    risks: o.risks,
    confidence: o.confidence,
    evidence: o.evidence,
    counts: { TODAY: 1, WEEK: 0, MONTH: 0, LATER: 0 },
    valueAtStakeCents: 0,
    memory: { hidden: [], boosted: 0 },
    whatIf: o,
  };
}

/** The question was a what-if but left something out: say what is missing instead of guessing. */
export function whatIfNeeds(q: string, mode: Mode, needs: string[]): CopilotPlan {
  const summary = `To compare that I need ${needs.join(' and ')}.`;
  return {
    version: COPILOT_VERSION,
    mode,
    kind: 'ANSWER',
    question: q,
    scope: 'TODAY',
    headline: 'I need a little more to compare that',
    summary,
    items: [],
    lenses: [],
    assumptions: [],
    risks: [],
    confidence: 0,
    evidence: [],
    counts: { TODAY: 0, WEEK: 0, MONTH: 0, LATER: 0 },
    valueAtStakeCents: 0,
    memory: { hidden: [], boosted: 0 },
  };
}

/** A roadmap as a plan: its three focus areas are the items, so it has the same explainable shape as every other reply. */
export function fromRoadmap(r: Roadmap, mode: Mode, q: string): CopilotPlan {
  const items: PlanItem[] = r.focus.map((f, n) => ({
    id: 'roadmap:' + f.area.toLowerCase(),
    lens: f.area === 'CARDS' || f.area === 'APPLICATIONS' ? 'CARD_STRATEGY' : f.area === 'POINTS' ? 'LOYALTY' : f.area === 'GOALS' || f.area === 'LIFE' ? 'GOAL' : 'OFFER',
    horizon: 'LATER',
    priority: 10 - n,
    title: 'Focus ' + (n + 1) + ': ' + f.label,
    recommendation: f.advice,
    reason: f.events + ' thing' + (f.events === 1 ? '' : 's') + ' on the calendar, worth about $' + Math.round(f.valueCents / 100).toLocaleString('en-US') + '.',
    evidence: ['Roadmap: dated expirations, renewals, 5/24 slots, goals and life events'],
    expectedValueCents: f.valueCents || null,
    assumptions: [],
    risks: [],
    confidence: 70,
    factors: [],
    href: '/chief-of-staff',
    facts: { kind: 'ROADMAP', verdict: f.area.toLowerCase(), count: f.events },
    calls: [],
  }));
  return {
    version: COPILOT_VERSION,
    mode,
    kind: 'ROADMAP',
    question: q,
    scope: 'LATER',
    headline: r.span === 90 ? 'Your next 90 days' : 'Your year ahead',
    summary: r.headline,
    items,
    lenses: [{ lens: 'GOAL', label: 'Chief of Staff', engines: ['roadmap'], ok: true, found: r.eventCount, note: r.eventCount + ' dated events' }],
    assumptions: ['Only dated items appear: expirations, renewals, 5/24 slot dates, goal dates and life events.'],
    risks: [],
    confidence: 70,
    evidence: [],
    counts: { TODAY: 0, WEEK: 0, MONTH: 0, LATER: items.length },
    valueAtStakeCents: r.atRiskCents,
    memory: { hidden: [], boosted: 0 },
    roadmap: r,
  };
}

/**
 * Chief of Staff scoring (pure). Takes the items the specialist lenses found and gives each one a single 0–100 priority, a band, the time
 * it takes, how risky it is, what it is worth and why, so a long list becomes a short one. The weights are written down here, not learned,
 * so a score can always be explained; nothing in this file calls a model or changes anything.
 */
import type { PlanItem } from './copilot-plan';

export const COS_VERSION = 'cos/1';

export type Band = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export const BAND_LABEL: Record<Band, string> = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', INFO: 'Informational' };
export const BAND_MIN: Record<Band, number> = { CRITICAL: 65, HIGH: 50, MEDIUM: 28, LOW: 12, INFO: 0 };
export const bandOf = (score: number): Band => (score >= BAND_MIN.CRITICAL ? 'CRITICAL' : score >= BAND_MIN.HIGH ? 'HIGH' : score >= BAND_MIN.MEDIUM ? 'MEDIUM' : score >= BAND_MIN.LOW ? 'LOW' : 'INFO');

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';
export type ImpactClass = 'PRESERVED' | 'CREATED' | 'FUTURE' | 'LOST' | 'NONE';

/**
 * What the score weighs, and how much (the six add up to 1). Effort and confidence are not added on top: a sure, quick task keeps its full
 * score and a shaky or long one is scaled down (`MODIFIER`), so an item with nothing at stake cannot rank just for being easy.
 */
export const WEIGHTS = { expirationRisk: 0.28, value: 0.34, timeSensitivity: 0.1, futureImpact: 0.12, portfolioImpact: 0.09, travelImpact: 0.07 } as const;
/** share of the score that does not depend on effort and confidence, and the share each of them can take away */
export const MODIFIER = { floor: 0.55, effort: 0.25, confidence: 0.2 } as const;
/** brings a typical sure, quick, high-stakes item to the top of the scale */
const SCALE = 1.25;

interface KindProfile {
  /** it lapses (offers, credits, certificates, balances, fees posting) if nothing is done */
  lapses: boolean;
  minutes: number;
  future: number;
  portfolio: number;
  travel: number;
  risk: RiskLevel;
  impact: ImpactClass;
  alternatives: string[];
}

const P = (lapses: boolean, minutes: number, future: number, portfolio: number, travel: number, risk: RiskLevel, impact: ImpactClass, alternatives: string[]): KindProfile => ({ lapses, minutes, future, portfolio, travel, risk, impact, alternatives });

export const KIND: Record<string, KindProfile> = {
  OFFER_EXPIRING: P(true, 10, 0.1, 0.1, 0, 'LOW', 'PRESERVED', ['Snooze it if you will not shop there.', 'Set a reminder for 3 days before it ends.']),
  OFFER_ACTIVATE: P(false, 3, 0.2, 0.1, 0, 'LOW', 'CREATED', ['Skip it if you would not make the purchase anyway.']),
  CREDIT_UNUSED: P(true, 10, 0.1, 0.2, 0, 'LOW', 'PRESERVED', ['Use it on something you would buy anyway.', 'If you will not use it, the card’s value is lower than its fee suggests; see the fee review.']),
  CERTIFICATE_EXPIRING: P(true, 45, 0.2, 0.1, 0.8, 'MEDIUM', 'PRESERVED', ['Check whether the program will extend it for a fee.', 'If no stay fits before it expires, ask the program about reinstatement.']),
  LOYALTY_AT_RISK: P(true, 10, 0.3, 0.2, 0.5, 'LOW', 'PRESERVED', ['Move the points to a program where they do not expire, if you will use them.', 'Spend or earn one point to reset the clock, if the program allows it.']),
  TRANSFER_BONUS: P(false, 20, 0.3, 0.1, 0.8, 'HIGH', 'CREATED', ['Wait for a larger bonus if you have no booking in mind.', 'Pay cash instead if the award is poor value.']),
  RENEWAL_REVIEW: P(true, 30, 0.6, 0.8, 0, 'MEDIUM', 'FUTURE', ['Ask for a retention offer.', 'Downgrade to a no-fee card in the same family.', 'Cancel if you no longer use its benefits.']),
  MEMBERSHIP_RENEWAL: P(true, 15, 0.2, 0.2, 0.7, 'LOW', 'PRESERVED', ['Renew early if the program rewards it.', 'Use a card credit that pays for the renewal.']),
  STATUS_REQUAL: P(false, 30, 0.6, 0.3, 0.7, 'MEDIUM', 'FUTURE', ['Ask the program for a status challenge or a match.', 'Let it lapse if you will not travel enough to benefit.']),
  FIVE24: P(false, 5, 0.5, 0.6, 0, 'LOW', 'FUTURE', ['Move the application to another household member who is under the limit.']),
  DATA_STALE: P(false, 5, 0.2, 0.1, 0.1, 'LOW', 'NONE', ['Ignore it if you no longer use the account.']),
  OFFERS_MISSED: P(false, 5, 0.2, 0.2, 0, 'LOW', 'LOST', ['Turn on offer alerts so fewer lapse.']),
  GOAL: P(false, 15, 0.6, 0.4, 0.3, 'LOW', 'FUTURE', ['Change the goal’s target or date if it no longer fits.']),
  LIFE_EVENT: P(false, 25, 0.4, 0.2, 0.7, 'LOW', 'FUTURE', ['Move the date, or drop the event, if plans have changed.']),
  WHATIF: P(false, 10, 0.4, 0.4, 0, 'LOW', 'NONE', []),
  ANSWER: P(false, 5, 0.2, 0.2, 0.2, 'LOW', 'NONE', []),
};
const DEFAULT_KIND: KindProfile = P(false, 10, 0.2, 0.2, 0.1, 'LOW', 'NONE', []);
const profile = (k: string): KindProfile => KIND[k] ?? DEFAULT_KIND;

/** how pressing the deadline is, 0–1 */
export function timeSensitivity(daysLeft: number | null): number {
  if (daysLeft == null) return 0.25;
  if (daysLeft <= 0) return 1;
  if (daysLeft <= 1) return 0.95;
  if (daysLeft <= 3) return 0.85;
  if (daysLeft <= 7) return 0.7;
  if (daysLeft <= 14) return 0.55;
  if (daysLeft <= 31) return 0.35;
  if (daysLeft <= 92) return 0.2;
  return 0.1;
}

/** a log scale: $0 → 0, $20 → .28, $100 → .53, $500 → .8, $2,000+ → 1 */
export function valueScore(cents: number): number {
  const d = Math.max(0, cents) / 100;
  return Math.min(1, Math.log10(1 + d / 5) / 2.5);
}

export interface ScoreInput {
  kind: string;
  /** what is at stake or on offer, in cents (0 when there is no dollar figure) */
  valueCents: number;
  daysLeft: number | null;
  /** 0–100 */
  confidence: number;
}

export interface ScoreBreakdown {
  expirationRisk: number;
  value: number;
  timeSensitivity: number;
  effortEase: number;
  confidence: number;
  futureImpact: number;
  portfolioImpact: number;
  travelImpact: number;
}

export interface Scored {
  score: number;
  band: Band;
  /** each factor, 0–1, so the number can be explained */
  factors: ScoreBreakdown;
}

export function score(i: ScoreInput): Scored {
  const k = profile(i.kind);
  const ts = timeSensitivity(i.daysLeft);
  const factors: ScoreBreakdown = {
    expirationRisk: k.lapses ? ts : 0,
    value: valueScore(i.valueCents),
    timeSensitivity: ts,
    effortEase: 1 - Math.min(1, k.minutes / 120),
    confidence: Math.max(0, Math.min(1, i.confidence / 100)),
    futureImpact: k.future,
    portfolioImpact: k.portfolio,
    travelImpact: k.travel,
  };
  let base = 0;
  for (const key of Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>) base += WEIGHTS[key] * factors[key];
  const modifier = MODIFIER.floor + MODIFIER.effort * factors.effortEase + MODIFIER.confidence * factors.confidence;
  const s = Math.max(0, Math.min(100, Math.round(base * modifier * SCALE * 100)));
  return { score: s, band: bandOf(s), factors };
}

// ───────────── an executive item ─────────────

export const STEP: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };
const FROM_STEP: RiskLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

/** The kind's own risk, raised a step when the answer is shaky or the clock is nearly out. */
export function riskLevel(kind: string, confidence: number, daysLeft: number | null): RiskLevel {
  let step = STEP[profile(kind).risk];
  if (confidence < 55) step++;
  if (daysLeft != null && daysLeft <= 1 && profile(kind).lapses) step++;
  return FROM_STEP[Math.min(2, step)];
}

export interface ExecImpact {
  cls: ImpactClass;
  /** value that is lost if nothing is done */
  atRiskCents: number;
  /** value that stays yours if you act */
  preservedCents: number;
  /** new value if you act */
  createdCents: number;
  /** value already gone */
  lostCents: number;
  /** value expected later (a goal, a status, a fee decision) */
  futureCents: number;
}

export function impactOf(kind: string, valueCents: number): ExecImpact {
  const cls = profile(kind).impact;
  const v = Math.max(0, valueCents);
  const lapses = profile(kind).lapses;
  return {
    cls,
    atRiskCents: lapses ? v : 0,
    preservedCents: cls === 'PRESERVED' ? v : 0,
    createdCents: cls === 'CREATED' ? v : 0,
    lostCents: cls === 'LOST' ? v : 0,
    futureCents: cls === 'FUTURE' ? v : 0,
  };
}

/** Existing agent profiles (`ai/agents.ts`) that stand behind each lens, plus the Chief of Staff that arranges them. */
export const LENS_AGENTS: Record<string, string[]> = {
  OFFER: ['merchant-offer-agent', 'offer-discovery'],
  LOYALTY: ['point-expiration', 'certificate', 'valuation'],
  TRAVEL: ['travel-rewards', 'transfer-bonus'],
  BENEFIT: ['benefit-utilization'],
  CARD_STRATEGY: ['card-strategy', 'annual-fee-review'],
  PORTFOLIO: ['five24-planning', 'family-portfolio'],
  AUDIT: ['loyalty-audit', 'offer-audit'],
  GOAL: [],
};
export const AGENT_LABEL: Record<string, string> = {
  'chief-of-staff': 'Chief of Staff',
  'merchant-offer-agent': 'Merchant Offer Agent',
  'offer-discovery': 'Offer Discovery Agent',
  'point-expiration': 'Expiration Agent',
  certificate: 'Certificate Agent',
  valuation: 'Loyalty Agent',
  'travel-rewards': 'Travel Agent',
  'transfer-bonus': 'Transfer Bonus Agent',
  'benefit-utilization': 'Benefit Agent',
  'card-strategy': 'Card Strategy Agent',
  'annual-fee-review': 'Annual Fee Agent',
  'five24-planning': '5/24 Agent',
  'family-portfolio': 'Household Agent',
  'loyalty-audit': 'Audit Agent',
  'offer-audit': 'Offer Audit Agent',
};

export interface ExecItem extends PlanItem {
  score: number;
  band: Band;
  /** each factor of the score, 0–1 */
  scoreFactors: ScoreBreakdown;
  /** an estimate; effort differs by person */
  timeMinutes: number;
  risk: { level: RiskLevel; note: string };
  impact: ExecImpact;
  /** the date it ends, when it has one */
  deadline: string | null;
  daysLeft: number | null;
  alternatives: string[];
  /** which of your data this came from */
  sources: string[];
  agents: Array<{ key: string; label: string }>;
  /** where it sits in the Action Center */
  center: CenterHorizon;
}

export type CenterHorizon = 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'ANNUAL';
export const CENTER_ORDER: CenterHorizon[] = ['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'ANNUAL'];
export const CENTER_LABEL: Record<CenterHorizon, string> = { TODAY: 'Today', WEEK: 'This week', MONTH: 'This month', QUARTER: 'This quarter', ANNUAL: 'Annual review' };

export function centerFor(daysLeft: number | null, planHorizon: PlanItem['horizon'], kind: string): CenterHorizon {
  if (kind === 'RENEWAL_REVIEW' || kind === 'STATUS_REQUAL' || kind === 'MEMBERSHIP_RENEWAL') {
    if (daysLeft != null && daysLeft <= 7) return 'WEEK';
    if (daysLeft != null && daysLeft <= 31) return 'MONTH';
    return daysLeft != null && daysLeft <= 92 ? 'QUARTER' : 'ANNUAL';
  }
  if (daysLeft != null) return daysLeft <= 1 ? 'TODAY' : daysLeft <= 7 ? 'WEEK' : daysLeft <= 31 ? 'MONTH' : daysLeft <= 92 ? 'QUARTER' : 'ANNUAL';
  return planHorizon === 'TODAY' ? 'TODAY' : planHorizon === 'WEEK' ? 'WEEK' : planHorizon === 'MONTH' ? 'MONTH' : 'QUARTER';
}

/** "Expiring offers: ends 2026-12-01" → "Expiring offers" */
export const sourcesOf = (evidence: string[]): string[] => [...new Set(evidence.map((e) => e.split(':')[0].trim()).filter(Boolean))];

export function agentsFor(lens: string): Array<{ key: string; label: string }> {
  const keys = [...(LENS_AGENTS[lens] ?? []), 'chief-of-staff'];
  return keys.map((key) => ({ key, label: AGENT_LABEL[key] ?? key }));
}

const dueDate = (days: number | null, now: Date): string | null => (days == null ? null : new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10));

/** Scores one plan item and attaches everything an executive summary needs to show about it. */
export function toExecItem(i: PlanItem, now: Date): ExecItem {
  const value = Math.abs(i.expectedValueCents ?? i.facts.amountCents ?? 0);
  const daysLeft = i.facts.daysLeft ?? null;
  const sc = score({ kind: i.facts.kind, valueCents: value, daysLeft, confidence: i.confidence });
  const k = profile(i.facts.kind);
  return {
    ...i,
    score: sc.score,
    band: sc.band,
    scoreFactors: sc.factors,
    timeMinutes: k.minutes,
    risk: { level: riskLevel(i.facts.kind, i.confidence, daysLeft), note: i.risks[0] ?? (k.risk === 'LOW' ? 'Low risk.' : 'Check the terms before you act.') },
    impact: impactOf(i.facts.kind, value),
    deadline: dueDate(daysLeft, now),
    daysLeft,
    alternatives: k.alternatives,
    sources: sourcesOf(i.evidence),
    agents: agentsFor(i.lens),
    center: centerFor(daysLeft, i.horizon, i.facts.kind),
  };
}

/** highest score first; ties by value then id, so the order never jumps between runs */
export const byScore = (a: ExecItem, b: ExecItem) => b.score - a.score || Math.abs(b.expectedValueCents ?? 0) - Math.abs(a.expectedValueCents ?? 0) || a.id.localeCompare(b.id);

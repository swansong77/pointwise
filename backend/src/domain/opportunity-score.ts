/**
 * Opportunity score 0–100 for an offer (pure). Nine named factors with weights in one versioned config; each
 * returns its contribution and a reason, and the result stores the weights it used (ADR-011). Confidence is
 * capped by the offer's source reliability and grows with how much spending data backs the score.
 */
import { confidenceCap, OfferSourceKind, VerificationKind } from './offer-import';
import { MerchantBehavior } from './spend-behavior';

export const OPP_VERSION = 'opportunity/1';
export const OPP_WEIGHTS = {
  urgency: 15,
  expectedSavings: 25,
  spendFrequency: 15,
  merchantUsage: 10,
  categoryPreference: 5,
  simplicity: 10,
  redemptionProbability: 10,
  historicalUtilization: 5,
  householdRelevance: 5,
} as const;
export type OppFactor = keyof typeof OPP_WEIGHTS;

export interface OppInput {
  daysLeft: number | null;
  valueCents: number;
  percent: number | null;
  maxRewardCents: number | null;
  minSpendCents: number | null;
  enrollmentRequired: boolean;
  alreadyActivated: boolean;
  source: OfferSourceKind;
  verification: VerificationKind;
  /** the user's behavior at this merchant, null if none */
  behavior: MerchantBehavior | null;
  /** share (0–1) of the user's spend in the merchant's category */
  categoryShare: number;
  /** past redemption rate (0–1) of the user's offers, null if unknown */
  utilization: number | null;
  householdMembers: number;
}

export interface FactorResult {
  factor: OppFactor;
  weight: number;
  /** 0–1 */
  value: number;
  points: number;
  reason: string;
}

export interface OppResult {
  score: number;
  /** expected value in cents given typical spend and redemption probability */
  expectedValueCents: number;
  confidence: number;
  factors: FactorResult[];
  version: string;
  weights: typeof OPP_WEIGHTS;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const usd = (c: number) => `$${(c / 100).toFixed(0)}`;

export function scoreOpportunity(i: OppInput, weights = OPP_WEIGHTS): OppResult {
  const b = i.behavior;
  const typical = b ? b.avgCents : 0;
  const f: Array<[OppFactor, number, string]> = [];

  const urgency = i.daysLeft == null ? 0.1 : i.daysLeft <= 3 ? 1 : i.daysLeft <= 7 ? 0.85 : i.daysLeft <= 14 ? 0.65 : i.daysLeft <= 30 ? 0.4 : 0.15;
  f.push(['urgency', urgency, i.daysLeft == null ? 'no expiry date' : `${i.daysLeft} day(s) left`]);

  // spend the user would plausibly make at the merchant while the offer runs
  const monthsLeft = i.daysLeft == null ? 1 : Math.max(i.daysLeft / 30.4375, 0);
  const expectedSpend = b ? Math.round(b.perMonth * monthsLeft * typical) : 0;
  const minOk = i.minSpendCents == null || expectedSpend >= i.minSpendCents;
  const redemption = !b ? 0.1 : i.minSpendCents == null ? clamp(0.5 + b.perMonth / 4) : minOk ? clamp(0.6 + b.perMonth / 8) : clamp(expectedSpend / i.minSpendCents) * 0.5;
  const basis = Math.max(expectedSpend, i.minSpendCents ?? 0);
  const reward = i.percent != null ? Math.min(Math.round((basis * i.percent) / 100), i.maxRewardCents ?? (i.valueCents || Infinity)) : i.valueCents;
  const expectedValueCents = Math.round(reward * redemption);
  f.push(['expectedSavings', clamp(expectedValueCents / 5000), `${usd(reward)} offer × ${Math.round(redemption * 100)}% likely = ${usd(expectedValueCents)} expected`]);
  f.push(['spendFrequency', clamp((b?.perMonth ?? 0) / 2), b ? `${b.perMonth} purchase(s)/month at this merchant` : 'no purchases here in the last 12 months']);
  f.push(['merchantUsage', b ? clamp(b.totalCents / 30_000) : 0, b ? `${usd(b.totalCents)} spent here in 12 months` : 'never used this merchant']);
  f.push(['categoryPreference', clamp(i.categoryShare * 4), `${Math.round(i.categoryShare * 100)}% of spend is in this category`]);
  const needsActivation = i.enrollmentRequired && !i.alreadyActivated;
  const steps = (needsActivation ? 1 : 0) + (i.minSpendCents ? 1 : 0) + (i.percent != null && i.maxRewardCents ? 0.5 : 0);
  const stepNames = [needsActivation && 'activate', i.minSpendCents && 'meet minimum spend'].filter(Boolean).join(', ') || 'cap applies';
  f.push(['simplicity', clamp(1 - steps / 2.5), steps === 0 ? 'no steps needed' : `${steps} step(s): ${stepNames}`]);
  f.push(['redemptionProbability', redemption, b ? `typical ${usd(typical)} per purchase` : 'no spending history to predict from']);
  f.push(['historicalUtilization', i.utilization ?? 0.5, i.utilization == null ? 'no history of redeeming offers (neutral)' : `${Math.round(i.utilization * 100)}% of past offers redeemed`]);
  f.push(['householdRelevance', b ? clamp(b.members / Math.max(i.householdMembers, 1)) : 0, b ? `${b.members} of ${i.householdMembers} household member(s) shop here` : 'no household spend here']);

  const factors: FactorResult[] = f.map(([factor, value, reason]) => ({ factor, weight: weights[factor], value: Math.round(value * 100) / 100, points: Math.round(weights[factor] * value * 10) / 10, reason }));
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const score = Math.round((factors.reduce((s, x) => s + x.points, 0) / total) * 100);
  const richness = clamp((b?.count ?? 0) / 6);
  const confidence = Math.round(Math.min(confidenceCap(i.source, i.verification), 55 + 45 * richness));
  return { score, expectedValueCents, confidence, factors, version: OPP_VERSION, weights };
}

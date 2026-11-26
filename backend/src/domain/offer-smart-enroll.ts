import { categoriesOf, effectiveValueCents, evaluateRules, normalizeMerchant, Rule, RuleContext } from './offer-enrollment-rules';
import { InvItem } from './offer-snapshot-diff';

/**
 * Smart enrollment: six sub-scores (0-100), an overall opportunity score, a decision (prioritize, add, review,
 * ignore) with reasons, and the action the member's mode allows. Weights are versioned and in one place.
 */
export const SMART_VERSION = 'smart-enroll/1';
export const SMART_WEIGHTS = { value: 40, expiration: 10, merchantPreference: 15, travel: 10, household: 5, likelihood: 20 } as const;
export type SmartFactor = keyof typeof SMART_WEIGHTS;

export const THRESHOLDS = { prioritize: 85, add: 60, review: 35 } as const;

export type SmartDecision = 'SHOULD_PRIORITIZE' | 'SHOULD_ADD' | 'SHOULD_REVIEW' | 'SHOULD_IGNORE';

export interface SmartContext {
  now: Date;
  preferredMerchants: string[];
  /** number of past purchases per normalised merchant name */
  merchantSpendCount: Map<string, number>;
  /** household members who have bought at the merchant */
  merchantMembers: Map<string, number>;
  householdMembers: number;
  goals: string[];
  /** past redemption rate (0-1), null when unknown */
  utilization: number | null;
}

export interface SmartScore {
  scores: Record<SmartFactor, number>;
  overall: number;
  decision: SmartDecision;
  reasons: string[];
  version: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function daysLeft(endsAt: Date | null, now: Date): number | null {
  return endsAt ? Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000) : null;
}

function valueScore(cents: number): number {
  return clamp(100 * Math.sqrt(cents / 25_000));
}

function expirationScore(days: number | null): number {
  if (days === null) return 40;
  if (days <= 0) return 0;
  if (days <= 7) return 90;
  if (days <= 14) return 75;
  if (days <= 30) return 55;
  if (days <= 60) return 40;
  return 30;
}

export function scoreOffer(item: InvItem, ctx: SmartContext): SmartScore {
  const reasons: string[] = [];
  const cents = effectiveValueCents(item);
  const days = daysLeft(item.endsAt, ctx.now);
  const key = normalizeMerchant(item.merchantText);
  const cats = categoriesOf(item);
  const preferred = ctx.preferredMerchants.some((m) => normalizeMerchant(m).length > 1 && key.includes(normalizeMerchant(m)));
  const spendCount = ctx.merchantSpendCount.get(key) ?? 0;
  const members = ctx.merchantMembers.get(key) ?? 0;

  const value = valueScore(cents);
  reasons.push(`Worth about $${(cents / 100).toFixed(2)}.`);
  const expiration = expirationScore(days);
  if (days !== null && days > 0 && days <= 14) reasons.push(`Ends in ${days} day(s).`);
  const merchantPreference = preferred ? 100 : spendCount >= 3 ? 85 : spendCount > 0 ? 65 : 30;
  if (preferred) reasons.push('A merchant you prefer.');
  else if (spendCount > 0) reasons.push(`You have bought here ${spendCount} time(s).`);
  const isTravel = cats.includes('travel');
  const travel = isTravel ? (ctx.goals.includes('TRAVEL') ? 100 : 75) : 20;
  if (isTravel) reasons.push('A travel offer.');
  const others = Math.min(Math.max(ctx.householdMembers - 1, 0), 3);
  const household = clamp(members > 1 ? 100 : members === 1 ? 55 + 10 * others : 35 + 10 * others);
  let likelihood = spendCount >= 3 ? 90 : spendCount > 0 ? 65 : 25;
  if (ctx.utilization !== null) likelihood = clamp(likelihood * 0.7 + ctx.utilization * 100 * 0.3);
  if (item.minSpendCents && item.minSpendCents > 20_000 && spendCount === 0) {
    likelihood = clamp(likelihood - 15);
    reasons.push('Needs a large first purchase.');
  }
  const scores: Record<SmartFactor, number> = { value, expiration, merchantPreference, travel, household, likelihood };

  const totalWeight = Object.values(SMART_WEIGHTS).reduce((a, b) => a + b, 0);
  let overall = clamp((Object.keys(SMART_WEIGHTS) as SmartFactor[]).reduce((s, f) => s + scores[f] * SMART_WEIGHTS[f], 0) / totalWeight);
  if (days !== null && days <= 0) {
    overall = 0;
    reasons.push('Already ended.');
  }
  const decision: SmartDecision = overall >= THRESHOLDS.prioritize ? 'SHOULD_PRIORITIZE' : overall >= THRESHOLDS.add ? 'SHOULD_ADD' : overall >= THRESHOLDS.review ? 'SHOULD_REVIEW' : 'SHOULD_IGNORE';
  return { scores, overall, decision, reasons, version: SMART_VERSION };
}

export type EnrollmentModeName = 'RECOMMEND' | 'BULK_APPROVAL' | 'AUTO';
export interface AutoFilter {
  allOffers?: boolean;
  categories?: string[];
  minValueCents?: number;
  preferredMerchants?: string[];
  matchSpendHistory?: boolean;
  minScore?: number;
}

export type DecisionState = 'RECOMMENDED' | 'PENDING_REVIEW' | 'IGNORED';
export interface EnrollAction {
  /** ENROLL_NOW is only returned in AUTO mode, for an offer that passes the member's filter or an always-rule */
  action: 'ENROLL_NOW' | 'RECOMMEND' | 'REVIEW' | 'IGNORE';
  state: DecisionState;
  score: SmartScore;
  reason: string;
  ruleId: string | null;
}

/** Whether an offer passes the member's automatic-enrollment filter. With no filter set, nothing is enrolled automatically. */
export function passesAutoFilter(item: InvItem, score: SmartScore, filter: AutoFilter, ctx: SmartContext): boolean {
  if (filter.allOffers) return true;
  const cents = effectiveValueCents(item);
  const key = normalizeMerchant(item.merchantText);
  if (filter.minScore !== undefined && score.overall < filter.minScore) return false;
  const checks: boolean[] = [];
  if (filter.categories?.length) checks.push(categoriesOf(item).some((c) => filter.categories!.includes(c)));
  if (filter.minValueCents !== undefined) checks.push(cents >= filter.minValueCents);
  if (filter.preferredMerchants?.length) checks.push(filter.preferredMerchants.some((m) => normalizeMerchant(m).length > 1 && key.includes(normalizeMerchant(m))));
  if (filter.matchSpendHistory) checks.push((ctx.merchantSpendCount.get(key) ?? 0) > 0);
  // every filter the member set must hold; a score floor alone does not enable automatic enrollment
  return checks.length > 0 && checks.every(Boolean);
}

/** Decides what to do with one discovered offer, for the member's rules, mode and filter. */
export function decide(item: InvItem, mode: EnrollmentModeName, filter: AutoFilter, rules: Rule[], ctx: SmartContext, rctx: RuleContext): EnrollAction {
  const score = scoreOffer(item, ctx);
  const rule = evaluateRules(item, rules, rctx);
  if (rule.verdict === 'NEVER') return { action: 'IGNORE', state: 'IGNORED', score, reason: rule.explanation, ruleId: rule.rule!.id };
  if (rule.verdict === 'ALWAYS') {
    if (mode === 'AUTO') return { action: 'ENROLL_NOW', state: 'RECOMMENDED', score, reason: `${rule.explanation} Automatic enrollment is on.`, ruleId: rule.rule!.id };
    return { action: 'RECOMMEND', state: 'RECOMMENDED', score, reason: `${rule.explanation} Waiting for your approval (${mode === 'BULK_APPROVAL' ? 'bulk approval' : 'recommend only'}).`, ruleId: rule.rule!.id };
  }
  if (score.decision === 'SHOULD_IGNORE') return { action: 'IGNORE', state: 'IGNORED', score, reason: `Low value for you (score ${score.overall}).`, ruleId: null };
  if (score.decision === 'SHOULD_REVIEW') return { action: 'REVIEW', state: 'PENDING_REVIEW', score, reason: `Worth a look (score ${score.overall}).`, ruleId: null };
  if (mode === 'AUTO' && passesAutoFilter(item, score, filter, ctx)) return { action: 'ENROLL_NOW', state: 'RECOMMENDED', score, reason: `Score ${score.overall} and it matches your automatic-enrollment filter.`, ruleId: null };
  return { action: 'RECOMMEND', state: 'RECOMMENDED', score, reason: `${score.decision === 'SHOULD_PRIORITIZE' ? 'Top priority' : 'Recommended'} (score ${score.overall}).`, ruleId: null };
}

type DupInput = Pick<InvItem, 'merchantText' | 'offerType' | 'valueCents' | 'percent' | 'points' | 'minSpendCents' | 'endsAt'> & { id: string };

/** The same offer shown on several cards of the household. They stay separate enrollments; this only flags them. */
export function duplicateCounts(items: DupInput[]): Map<string, number> {
  const groups = new Map<string, string[]>();
  for (const i of items) {
    const k = [normalizeMerchant(i.merchantText), i.offerType, i.valueCents, i.percent ?? '', i.points ?? '', i.minSpendCents ?? '', i.endsAt ? i.endsAt.toISOString().slice(0, 10) : ''].join('|');
    groups.set(k, [...(groups.get(k) ?? []), i.id]);
  }
  const out = new Map<string, number>();
  for (const ids of groups.values()) if (ids.length > 1) for (const id of ids) out.set(id, ids.length);
  return out;
}

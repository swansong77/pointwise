/**
 * Recommendation enrichment (pure). Takes the existing card score (`card-scorer.ts`: first-year value,
 * long-term value, 5/24 slot cost, approval odds) and adds what the scorer does not model: the user's
 * goals, recent applications (velocity), business eligibility, points balances, benefit utilization and
 * offer timing. Produces an adjusted score, an application-probability ESTIMATE, risks, alternatives,
 * advice and a per-factor audit trail. No model is involved (ADR-004); all weights are in REC_WEIGHTS
 * (ADR-008) and are stored with every recommendation.
 */
import type { ApprovalOdds, CardScore } from './card-scorer';
import { Advice, applicationDifficulty, ApplicantActivity, DifficultyResult, OfferVerdict, offerAdvice } from './offer-intel';

export const REC_ENGINE_VERSION = 'recommendation/2';

export const REC_WEIGHTS = {
  /** card kind matches a stated goal / contradicts every stated goal (cents of adjusted score) */
  goalMatchCents: 75_00,
  goalMismatchCents: -25_00,
  /** share of existing points in the card's currency that adds value (pooling), with a cap */
  balanceSynergyRate: 0.05,
  balanceSynergyCapCents: 200_00,
  /** applications in the last 6 months beyond this are penalised, each */
  velocityFreeApps6m: 2,
  velocityPenaltyCents: 50_00,
  /** benefits value is rescaled from the scorer's assumed use rate to the user's measured one */
  assumedBenefitUseRate: 0.5,
  /** application probability by approval odds, then multipliers */
  probability: { LIKELY: 0.85, POSSIBLE: 0.6, UNLIKELY: 0.25, UNKNOWN: 0.5 } as Record<ApprovalOdds, number>,
  velocityProbabilityStep: 0.1,
  businessWithoutBusiness: 0.15,
  difficulty: { EASY: 1, MODERATE: 0.85, HARD: 0.5, BLOCKED: 0 } as Record<string, number>,
  /** confidence reductions for inputs that were missing (named in the output) */
  confidencePenalty: { goals: 0.05, creditBand: 0.1, utilization: 0.03, offerHistory: 0.05 },
  minConfidence: 0.1,
  maxConfidence: 0.95,
} as const;

export type CardKind = 'TRAVEL' | 'CASHBACK' | 'HOTEL' | 'AIRLINE' | 'OTHER';
export const GOALS = ['TRAVEL', 'CASHBACK', 'HOTEL', 'AIRLINE', 'LOW_FEE'] as const;
export type Goal = (typeof GOALS)[number];

export interface RecInput {
  score: Pick<
    CardScore,
    | 'cardId'
    | 'slug'
    | 'name'
    | 'issuer'
    | 'eligible'
    | 'blockers'
    | 'warnings'
    | 'firstYearValueCents'
    | 'longTermValueCents'
    | 'score'
    | 'components'
    | 'approvalOdds'
    | 'spendFeasible'
    | 'confidence'
    | 'confidenceNotes'
  >;
  card: { kind: CardKind; isBusiness: boolean; currencyCode: string | null; annualFeeCents: number };
  user: {
    goals: string[];
    hasBusiness: boolean;
    creditBandKnown: boolean;
    appsLast6m: number;
    appsLast12m: number;
    /** value (cents) of existing points by currency code */
    balanceValueByCurrencyCents: Record<string, number>;
    /** current-period benefit utilization 0–100, null when nothing is tracked */
    benefitUtilizationPct: number | null;
  };
  offer: { verdict: OfferVerdict; daysToExpiry: number | null; bestEverCents: number | null; currentValueCents: number | null } | null;
  /** activity for the issuer-velocity rules; omit to skip difficulty */
  activity?: ApplicantActivity;
  alternateMember?: string | null;
}

export interface Factor {
  key: string;
  label: string;
  deltaCents: number;
  note: string;
}

export interface RecOutput {
  cardId: string;
  slug: string;
  name: string;
  issuer: string;
  eligible: boolean;
  adjustedScoreCents: number;
  firstYearValueCents: number;
  longTermValueCents: number;
  /** 0–1; an ESTIMATE from the self-reported credit band and issuer rules, never a promise */
  probability: number;
  probabilityIsEstimate: true;
  confidence: number;
  confidenceReasons: string[];
  factors: Factor[];
  risks: string[];
  advice: Advice[];
  difficulty: DifficultyResult | null;
}

const money = (c: number) => `$${(Math.abs(c) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const GOAL_KIND: Record<Goal, CardKind[]> = {
  TRAVEL: ['TRAVEL', 'AIRLINE', 'HOTEL'],
  CASHBACK: ['CASHBACK'],
  HOTEL: ['HOTEL'],
  AIRLINE: ['AIRLINE'],
  LOW_FEE: [],
};

function goalFactor(i: RecInput): Factor | null {
  const goals = i.user.goals.filter((g): g is Goal => (GOALS as readonly string[]).includes(g));
  if (!goals.length) return null;
  const matches = goals.some((g) => (g === 'LOW_FEE' ? i.card.annualFeeCents <= 0 : GOAL_KIND[g].includes(i.card.kind)));
  return matches
    ? { key: 'GOAL_FIT', label: 'Matches your goals', deltaCents: REC_WEIGHTS.goalMatchCents, note: `Fits ${goals.join(', ').toLowerCase()}` }
    : { key: 'GOAL_MISMATCH', label: 'Does not match your goals', deltaCents: REC_WEIGHTS.goalMismatchCents, note: `You asked for ${goals.join(', ').toLowerCase()}` };
}

/** Enriches one card score. Deterministic: same inputs → same output. */
export function enrich(i: RecInput): RecOutput {
  const s = i.score;
  const factors: Factor[] = [];
  const risks: string[] = [];
  const reasons: string[] = [];

  const goal = goalFactor(i);
  if (goal) factors.push(goal);

  const held = i.card.currencyCode ? (i.user.balanceValueByCurrencyCents[i.card.currencyCode] ?? 0) : 0;
  if (held > 0) {
    const d = Math.min(REC_WEIGHTS.balanceSynergyCapCents, Math.round(held * REC_WEIGHTS.balanceSynergyRate));
    if (d > 0) factors.push({ key: 'BALANCE_SYNERGY', label: 'You already hold these points', deltaCents: d, note: `${money(held)} of points in this currency can be pooled` });
  }

  const util = i.user.benefitUtilizationPct;
  if (util != null && s.components.benefitsCents > 0) {
    const d = Math.round((util / 100 - REC_WEIGHTS.assumedBenefitUseRate) * s.components.benefitsCents);
    if (d !== 0)
      factors.push({
        key: 'BENEFIT_UTILIZATION',
        label: d > 0 ? 'You use credits well' : 'You leave credits unused',
        deltaCents: d,
        note: `You use ${Math.round(util)}% of the benefits you already have; the score assumed ${Math.round(REC_WEIGHTS.assumedBenefitUseRate * 100)}%`,
      });
  }

  const extra = Math.max(0, i.user.appsLast6m - REC_WEIGHTS.velocityFreeApps6m);
  if (extra > 0) {
    factors.push({ key: 'VELOCITY', label: 'Many recent applications', deltaCents: -extra * REC_WEIGHTS.velocityPenaltyCents, note: `${i.user.appsLast6m} applications in the last 6 months` });
    risks.push(`${i.user.appsLast6m} new accounts in 6 months can lower approval odds with some issuers.`);
  }

  if (i.card.isBusiness && !i.user.hasBusiness) {
    risks.push('This is a business card and you have not said you have a business.');
  }

  // application probability: odds from the credit band, then multipliers
  const difficulty = i.activity ? applicationDifficulty(i.score.issuer, i.activity) : null;
  let p = REC_WEIGHTS.probability[s.approvalOdds];
  p *= Math.max(0, 1 - REC_WEIGHTS.velocityProbabilityStep * extra);
  if (i.card.isBusiness && !i.user.hasBusiness) p *= REC_WEIGHTS.businessWithoutBusiness;
  if (difficulty) p *= REC_WEIGHTS.difficulty[difficulty.level] ?? 1;
  if (!s.eligible) p = 0;
  p = Math.round(clamp(p, 0, 1) * 100) / 100;

  if (difficulty && difficulty.level !== 'EASY') risks.push(...difficulty.reasons);
  if (s.spendFeasible === false) risks.push('The minimum spend may be hard to reach with your usual spending.');
  risks.push(...s.warnings);
  if (!s.eligible) risks.push(...s.blockers);

  // confidence: the scorer's own, reduced for each missing input
  let confidence = s.confidence;
  const miss = (cond: boolean, pen: number, why: string) => {
    if (cond) {
      confidence -= pen;
      reasons.push(why);
    }
  };
  miss(!i.user.goals.length, REC_WEIGHTS.confidencePenalty.goals, 'You have not set reward goals.');
  miss(!i.user.creditBandKnown, REC_WEIGHTS.confidencePenalty.creditBand, 'Credit score band not provided, so approval odds are unknown.');
  miss(i.user.benefitUtilizationPct == null, REC_WEIGHTS.confidencePenalty.utilization, 'No benefit usage tracked yet.');
  miss(i.offer == null || i.offer.verdict === 'UNKNOWN', REC_WEIGHTS.confidencePenalty.offerHistory, 'Not enough offer history to judge today\'s offer.');
  reasons.push(...s.confidenceNotes);
  confidence = Math.round(clamp(confidence, REC_WEIGHTS.minConfidence, REC_WEIGHTS.maxConfidence) * 100) / 100;

  const advice = i.offer
    ? offerAdvice({
        verdict: i.offer.verdict,
        daysToExpiry: i.offer.daysToExpiry,
        bestEverCents: i.offer.bestEverCents,
        currentValueCents: i.offer.currentValueCents,
        applicantBlocked: !s.eligible,
        alternateMember: i.alternateMember ?? null,
      })
    : [];

  return {
    cardId: s.cardId,
    slug: s.slug,
    name: s.name,
    issuer: s.issuer,
    eligible: s.eligible,
    adjustedScoreCents: s.score + factors.reduce((n, f) => n + f.deltaCents, 0),
    firstYearValueCents: s.firstYearValueCents,
    longTermValueCents: s.longTermValueCents,
    probability: p,
    probabilityIsEstimate: true,
    confidence,
    confidenceReasons: reasons,
    factors,
    risks: [...new Set(risks)],
    advice,
    difficulty,
  };
}

/** Best eligible card by adjusted score, probability-weighted for ties, and up to three alternatives. */
export function selectRecommendation(outs: RecOutput[], alternatives = 3): { recommended: RecOutput | null; alternatives: RecOutput[] } {
  const ranked = outs
    .filter((o) => o.eligible)
    .sort((a, b) => b.adjustedScoreCents * Math.max(b.probability, 0.05) - a.adjustedScoreCents * Math.max(a.probability, 0.05) || a.name.localeCompare(b.name));
  return { recommended: ranked[0] ?? null, alternatives: ranked.slice(1, 1 + alternatives) };
}

/** Counts of accounts opened in the trailing windows, from opening dates (any issuer). */
export function recentApplications(openedAt: Array<Date | null>, now: Date): { last6m: number; last12m: number } {
  const since = (months: number) => now.getTime() - months * 30.4375 * 86_400_000;
  const dates = openedAt.filter((d): d is Date => !!d);
  return { last6m: dates.filter((d) => d.getTime() >= since(6)).length, last12m: dates.filter((d) => d.getTime() >= since(12)).length };
}

const AIRLINE_RE = /airline|miles|skymiles|aadvantage|mileageplus|rapid rewards|trueblue|lifemiles|avios|flying blue/i;
const HOTEL_RE = /hotel|marriott|bonvoy|hilton|honors|hyatt|ihg|wyndham|choice privileges|world of hyatt/i;

/** The kind of rewards a card earns, from its currency (used only to compare with the user's goals). */
export function cardKindOf(currency: { code: string; name: string; isCash: boolean } | null): CardKind {
  if (!currency) return 'OTHER';
  if (currency.isCash) return 'CASHBACK';
  const text = `${currency.code} ${currency.name}`;
  if (HOTEL_RE.test(text)) return 'HOTEL';
  if (AIRLINE_RE.test(text)) return 'AIRLINE';
  return 'TRAVEL'; // transferable bank points
}

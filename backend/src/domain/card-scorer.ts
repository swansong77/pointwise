import { addMonths } from './dates';
import { rankCards, round } from './recommendation.engine';
import { DomainCard, DomainWalletCard } from './types';

/**
 * Next-card scorer (pure). See docs/recommendation-scorer.md.
 *
 *   first-year value = welcome bonus (if the spend requirement is reachable)
 *                    + extra rewards over the household's current best card per category
 *                    + card credits × expected use rate
 *                    − first-year annual fee
 *   long-term value  = extra rewards + credits × use rate − annual fee   (per year, from year 2)
 *   score            = first-year value + max(0, long-term value) − 5/24 slot cost
 *
 * Every number is explained in `reasons`; the scorer never needs (or calls) an AI model.
 */

export type SpendSource = 'PROFILE' | 'TRANSACTIONS' | 'DEFAULT';
export type CreditBand = 'EXCELLENT' | 'VERY_GOOD' | 'GOOD' | 'FAIR' | 'POOR';
export type ApprovalOdds = 'LIKELY' | 'POSSIBLE' | 'UNLIKELY' | 'UNKNOWN';

const BAND_RANK: Record<CreditBand, number> = { POOR: 0, FAIR: 1, GOOD: 2, VERY_GOOD: 3, EXCELLENT: 4 };
export const BAND_LABEL: Record<CreditBand, string> = { EXCELLENT: 'excellent', VERY_GOOD: 'very good', GOOD: 'good', FAIR: 'fair', POOR: 'poor' };
/** score multiplier by approval odds (expected value of applying) */
export const ODDS_FACTOR: Record<ApprovalOdds, number> = { LIKELY: 1, POSSIBLE: 0.75, UNLIKELY: 0.4, UNKNOWN: 1 };

/** Self-reported band vs the band a card usually needs: at or above → likely; one band below → possible; more → unlikely. */
export function approvalOdds(applicant: CreditBand | null | undefined, needed: CreditBand | null | undefined): ApprovalOdds {
  if (!applicant || !needed) return 'UNKNOWN';
  const gap = BAND_RANK[needed] - BAND_RANK[applicant];
  return gap <= 0 ? 'LIKELY' : gap === 1 ? 'POSSIBLE' : 'UNLIKELY';
}

export interface SpendLine {
  categoryId: string;
  parentCategoryId?: string | null;
  name: string;
  monthlyCents: number;
}

export interface CandidateCard extends DomainCard {
  slug: string;
  issuerName: string;
  enforcesFive24: boolean;
  productFamily?: string | null;
  /** annual value of the card's credits (catalog benefit templates) */
  benefitsAnnualCents: number;
  /** curated value of the current welcome bonus (else bonus points × valuation) */
  bonusValuationCents?: number | null;
  firstYearFeeWaived?: boolean;
  /** current offer is ≥ 20 % above its 24-month median (offer history) */
  offerElevated?: boolean;
  /** credit typically needed for approval (catalog) */
  recommendedCredit?: CreditBand | null;
}

export interface ApplicantFive24 {
  count: number;
  limit: number;
  underLimit: boolean;
  /** drop-off dates of the cards that currently count */
  dropOffs: Date[];
  /** cards without an open date — the count may be understated */
  unknownCount: number;
}

export interface Applicant {
  profileId: string;
  nickname: string;
  /** false for minors / members who cannot apply for their own card */
  canApply: boolean;
  cannotApplyReason?: string;
  five24: ApplicantFive24;
  /** catalog card ids this member holds as the primary cardholder (open or opened in the last 24 months) */
  heldCardIds: string[];
  /** product families of those cards */
  heldFamilies: string[];
  /** self-reported credit band (optional) */
  creditBand?: CreditBand | null;
}

export interface ScoreOptions {
  fallbackCategoryId: string | null;
  /** currencyId → user's ¢/pt override */
  valuations?: Record<string, number>;
  /** share of a card's credits the household expects to use (0–1, default 0.5) */
  benefitUseRate?: number;
  /** cost of using one 5/24 slot while under the limit (default $150) */
  slotValueCents?: number;
  spendSource: SpendSource;
  now?: Date;
}

export interface CategoryGain {
  category: string;
  newCentsPerDollar: number;
  currentCentsPerDollar: number;
  annualGainCents: number;
}

export interface Five24Impact {
  countsToward: boolean;
  before: number;
  after: number;
  /** issuer denies at 5/24 and the applicant is at or over the limit */
  blockedByRule: boolean;
  /** opening this card brings the applicant to the limit */
  usesLastSlot: boolean;
  /** when the applicant would be under the limit again after opening it (null = not affected) */
  underLimitAgainAt: Date | null;
  slotCostCents: number;
}

export interface CardScore {
  cardId: string;
  slug: string;
  name: string;
  issuer: string;
  profileId: string;
  member: string;
  eligible: boolean;
  blockers: string[];
  warnings: string[];
  firstYearValueCents: number;
  longTermValueCents: number;
  score: number;
  components: {
    bonusCents: number;
    earnCents: number;
    benefitsCents: number;
    firstYearFeeCents: number;
    annualFeeCents: number;
  };
  /** (extra rewards + credits used) ÷ annual fee; null for no-fee cards */
  feeReturn: number | null;
  spendFeasible: boolean | null;
  /** self-reported credit band vs the card's typical requirement */
  approvalOdds: ApprovalOdds;
  five24: Five24Impact;
  confidence: number;
  confidenceNotes: string[];
  reasons: string[];
  topCategories: CategoryGain[];
}

export const DEFAULT_BENEFIT_USE_RATE = 0.5;
export const DEFAULT_SLOT_VALUE_CENTS = 150_00;
/** no-fee 1.5 % card — what a household with no cards would otherwise earn */
export const BASELINE_CENTS_PER_DOLLAR = 1.5;

const $ = (cents: number) => `${cents < 0 ? '-' : ''}$${Math.abs(Math.round(cents / 100)).toLocaleString('en-US')}`;
const fmtNum = (n: number) => n.toLocaleString('en-US');

export function countsTowardFive24(card: Pick<CandidateCard, 'type' | 'businessReportsToPersonal'>): boolean {
  return card.type === 'PERSONAL' || !!card.businessReportsToPersonal;
}

export function bonusValueCents(card: CandidateCard, valuations: Record<string, number> = {}): number {
  if (card.bonusValuationCents != null) return card.bonusValuationCents;
  if (!card.bonusPoints) return 0;
  const cpp = valuations[card.currency.id] ?? Number(card.currency.centsPerPoint);
  return Math.round(card.bonusPoints * cpp);
}

/** first instant the applicant is under the limit again after opening one more card that counts */
export function underLimitAgainAt(f: ApplicantFive24, now: Date): Date | null {
  const after = f.count + 1;
  if (after < f.limit) return null;
  const drops = [...f.dropOffs.filter((d) => d > now), addMonths(now, 24)].sort((a, b) => a.getTime() - b.getTime());
  const needed = after - f.limit + 1;
  return drops[Math.min(needed, drops.length) - 1];
}

function asWalletCard(card: DomainCard): DomainWalletCard {
  return {
    id: `candidate:${card.id}`,
    nickname: null,
    status: 'APPROVED',
    approvedAt: null,
    closedAt: null,
    annualFeeOverrideCents: null,
    bonusEarned: false,
    bonusSpendCents: 0,
    selectedCategoryIds: [],
    card,
  };
}

/** extra rewards per category vs the household's current best card (or the 1.5 % baseline) */
export function categoryGains(card: DomainCard, household: DomainWalletCard[], spend: SpendLine[], opt: Pick<ScoreOptions, 'fallbackCategoryId' | 'valuations' | 'now'>): CategoryGain[] {
  const candidate = asWalletCard(card);
  const approved = household.filter((c) => c.status === 'APPROVED');
  return spend
    .filter((s) => s.monthlyCents > 0)
    .map((s) => {
      const target = { categoryId: s.categoryId, parentCategoryId: s.parentCategoryId ?? null, fallbackCategoryId: opt.fallbackCategoryId };
      const rankOpts = { valuations: opt.valuations, now: opt.now };
      const newRate = rankCards([candidate], target, rankOpts)[0]?.centsPerDollar ?? 0;
      const current = approved.length ? (rankCards(approved, target, rankOpts)[0]?.centsPerDollar ?? 0) : BASELINE_CENTS_PER_DOLLAR;
      const annualGainCents = Math.round((Math.max(0, newRate - current) * s.monthlyCents * 12) / 100);
      return { category: s.name, newCentsPerDollar: newRate, currentCentsPerDollar: current, annualGainCents };
    })
    .sort((a, b) => b.annualGainCents - a.annualGainCents);
}

export function scoreCard(card: CandidateCard, applicant: Applicant, household: DomainWalletCard[], spend: SpendLine[], opt: ScoreOptions): CardScore {
  const now = opt.now ?? new Date();
  const useRate = Math.min(1, Math.max(0, opt.benefitUseRate ?? DEFAULT_BENEFIT_USE_RATE));
  const slotValue = opt.slotValueCents ?? DEFAULT_SLOT_VALUE_CENTS;
  const blockers: string[] = [];
  const warnings: string[] = [];
  const reasons: string[] = [];
  const confidenceNotes: string[] = [];
  let confidence = 0.9;

  // ── eligibility
  if (!applicant.canApply) blockers.push(applicant.cannotApplyReason ?? `${applicant.nickname} cannot apply for their own card`);
  if (applicant.heldCardIds.includes(card.id)) blockers.push(`${applicant.nickname} already has this card`);
  const counts = countsTowardFive24(card);
  const f = applicant.five24;
  const blockedByRule = card.enforcesFive24 && !f.underLimit;
  if (blockedByRule) {
    const again = f.dropOffs.filter((d) => d > now).sort((a, b) => a.getTime() - b.getTime())[f.count - f.limit];
    blockers.push(`${card.issuerName} usually denies applicants at ${f.limit}/24 — ${applicant.nickname} is ${f.count}/24${again ? ` until ${again.toISOString().slice(0, 10)}` : ''}`);
  }
  if (card.productFamily && applicant.heldFamilies.includes(card.productFamily) && !applicant.heldCardIds.includes(card.id)) {
    warnings.push(`${applicant.nickname} already has a ${card.productFamily}-family card — the welcome bonus may be restricted`);
    confidence -= 0.2;
    confidenceNotes.push('Bonus eligibility uncertain (same product family)');
  }

  // ── value
  const gains = categoryGains(card, household, spend, opt);
  const earnCents = gains.reduce((s, g) => s + g.annualGainCents, 0);
  const benefitsCents = Math.round(card.benefitsAnnualCents * useRate);
  const firstYearFeeCents = card.firstYearFeeWaived ? 0 : card.annualFeeCents;
  let bonusCents = bonusValueCents(card, opt.valuations);
  let spendFeasible: boolean | null = null;
  if (card.bonusSpendCents && card.bonusMonths) {
    const projected = spend.reduce((s, l) => s + l.monthlyCents, 0) * card.bonusMonths;
    spendFeasible = projected >= card.bonusSpendCents;
    if (!spendFeasible && bonusCents > 0) {
      warnings.push(`Your usual spend (~${$(projected)} in ${card.bonusMonths} months) does not reach the ${$(card.bonusSpendCents)} requirement — bonus not counted`);
      bonusCents = 0;
    }
  }
  if (bonusCents > 0) {
    const cpp = opt.valuations?.[card.currency.id] ?? Number(card.currency.centsPerPoint);
    reasons.push(
      card.bonusPoints && card.bonusValuationCents == null
        ? `Welcome bonus worth ~${$(bonusCents)} (${fmtNum(card.bonusPoints)} ${card.currency.isCash ? 'cents' : 'points'} × ${cpp}¢)${card.bonusSpendCents ? ` after ${$(card.bonusSpendCents)} in ${card.bonusMonths} months` : ''}`
        : `Welcome bonus worth ~${$(bonusCents)}`,
    );
    if (card.offerElevated) reasons.push('The current welcome offer is elevated (≥ 20 % above its 24-month median)');
  }
  if (card.bonusValuationCents == null && card.bonusPoints && !card.currency.isCash) {
    confidence -= 0.05;
    confidenceNotes.push('Bonus valued at the default point valuation');
  }
  const top = gains.filter((g) => g.annualGainCents > 0).slice(0, 3);
  if (earnCents > 0)
    reasons.push(`Earns ~${$(earnCents)}/yr more than your current best cards, mostly on ${top.map((g) => `${g.category} (${g.newCentsPerDollar}¢ vs ${g.currentCentsPerDollar}¢ per $)`).join(', ')}`);
  else reasons.push('Does not earn more than your current cards on your usual spend');
  if (benefitsCents > 0) reasons.push(`Credits worth ~${$(benefitsCents)}/yr at ${Math.round(useRate * 100)} % expected use`);
  if (card.annualFeeCents > 0) reasons.push(`Annual fee ${$(card.annualFeeCents)}${card.firstYearFeeWaived ? ' (waived the first year)' : ''}`);

  // ── 5/24
  const after = counts ? f.count + 1 : f.count;
  const usesLastSlot = counts && f.underLimit && after >= f.limit;
  const slotCostCents = counts && f.underLimit ? slotValue * (usesLastSlot ? 2 : 1) : 0;
  const again = counts ? underLimitAgainAt(f, now) : null;
  if (!counts) reasons.push('Does not count toward 5/24 (business card not reported on personal credit)');
  else if (!f.underLimit) reasons.push(`${applicant.nickname} is already over 5/24, so this card costs no 5/24 slot`);
  else reasons.push(`Uses one of ${applicant.nickname}'s 5/24 slots (${f.count}/24 → ${after}/24)`);
  if (usesLastSlot) warnings.push(`Takes ${applicant.nickname} to ${after}/24 — cards from issuers that enforce 5/24 are out of reach until ${again?.toISOString().slice(0, 10)}`);
  if (f.unknownCount > 0) {
    confidence -= 0.1;
    confidenceNotes.push(`${f.unknownCount} card(s) without an open date — the 5/24 count may be understated`);
  }

  // ── approval odds from the self-reported credit band
  const odds = approvalOdds(applicant.creditBand, card.recommendedCredit);
  if (odds === 'POSSIBLE' || odds === 'UNLIKELY') {
    warnings.push(
      `${applicant.nickname}'s credit (${BAND_LABEL[applicant.creditBand!]}) is below what ${card.name} usually needs (${BAND_LABEL[card.recommendedCredit!]}) — approval is ${odds === 'UNLIKELY' ? 'unlikely' : 'less certain'}`,
    );
  } else if (odds === 'UNKNOWN' && card.recommendedCredit && !applicant.creditBand) {
    confidenceNotes.push(`Add ${applicant.nickname}'s credit band to estimate approval odds`);
  }

  // ── confidence from data quality
  if (opt.spendSource === 'DEFAULT') {
    confidence -= 0.3;
    confidenceNotes.push('Spend estimated from a typical household — add your spend profile');
  } else if (opt.spendSource === 'PROFILE') {
    confidence -= 0.05;
    confidenceNotes.push('Spend from your spend profile');
  } else confidenceNotes.push('Spend measured from your logged transactions');

  const firstYearValueCents = bonusCents + earnCents + benefitsCents - firstYearFeeCents;
  const longTermValueCents = earnCents + benefitsCents - card.annualFeeCents;
  if (longTermValueCents < 0) warnings.push(`After the first year the fee outweighs the value by ${$(-longTermValueCents)}/yr — plan to downgrade or cancel`);

  return {
    cardId: card.id,
    slug: card.slug,
    name: card.name,
    issuer: card.issuerName,
    profileId: applicant.profileId,
    member: applicant.nickname,
    eligible: blockers.length === 0,
    blockers,
    warnings,
    firstYearValueCents,
    longTermValueCents,
    // expected value of applying: approval odds scale the gain (the slot cost applies only if approved too)
    score: Math.round((firstYearValueCents + Math.max(0, longTermValueCents) - slotCostCents) * ODDS_FACTOR[odds]),
    components: { bonusCents, earnCents, benefitsCents, firstYearFeeCents, annualFeeCents: card.annualFeeCents },
    feeReturn: card.annualFeeCents > 0 ? round((earnCents + benefitsCents) / card.annualFeeCents) : null,
    spendFeasible,
    approvalOdds: odds,
    five24: { countsToward: counts, before: f.count, after, blockedByRule, usesLastSlot, underLimitAgainAt: again, slotCostCents },
    confidence: round(Math.min(0.95, Math.max(0.1, confidence))),
    confidenceNotes,
    reasons,
    topCategories: top,
  };
}

const byRank = (a: CardScore, b: CardScore) => (a.eligible !== b.eligible ? (a.eligible ? -1 : 1) : b.score - a.score || a.name.localeCompare(b.name));

/** All candidates for one member, best first (ineligible ones last, with their blockers). */
export function rankCandidates(cards: CandidateCard[], applicant: Applicant, household: DomainWalletCard[], spend: SpendLine[], opt: ScoreOptions): CardScore[] {
  return cards.map((c) => scoreCard(c, applicant, household, spend, opt)).sort(byRank);
}

export interface MemberChoice {
  best: CardScore | null;
  ranking: CardScore[];
  why: string;
}

/** For one card: which household member should apply (eligibility, 5/24 slot cost, family rules). */
export function whoShouldApply(card: CandidateCard, applicants: Applicant[], household: DomainWalletCard[], spend: SpendLine[], opt: ScoreOptions): MemberChoice {
  const ranking = applicants.map((a) => scoreCard(card, a, household, spend, opt)).sort(byRank);
  const best = ranking.find((r) => r.eligible) ?? null;
  let why = `No one in the household is a good fit for ${card.name} right now.`;
  if (best) {
    const parts = [`${best.member} should apply for ${card.name}`];
    if (!best.five24.countsToward) parts.push('it does not count toward 5/24');
    else if (!best.five24.slotCostCents) parts.push(`${best.member} is already over 5/24, so no slot is used`);
    else parts.push(`uses one 5/24 slot (${best.five24.before}/24 → ${best.five24.after}/24)`);
    const others = ranking.filter((r) => r !== best && !r.eligible).map((r) => `${r.member}: ${r.blockers[0]}`);
    why = `${parts.join(' — ')}.${others.length ? ` Others: ${others.join('; ')}.` : ''}`;
  }
  return { best, ranking, why };
}

export interface HouseholdPlan {
  members: Array<{ profileId: string; member: string; top: CardScore[] }>;
  /** the single best (card, member) pair across the household */
  pick: CardScore | null;
  why: string;
}

/** Best next card per member, and the household's overall pick. */
export function householdNextCards(cards: CandidateCard[], applicants: Applicant[], household: DomainWalletCard[], spend: SpendLine[], opt: ScoreOptions, perMember = 3): HouseholdPlan {
  const members = applicants.map((a) => {
    const ranked = rankCandidates(cards, a, household, spend, opt);
    return { profileId: a.profileId, member: a.nickname, top: ranked.filter((r) => r.eligible).slice(0, perMember) };
  });
  const all = members.flatMap((m) => m.top).sort(byRank);
  const pick = all[0] ?? null;
  const why = pick
    ? `${pick.member} → ${pick.name}: first-year value ~${$(pick.firstYearValueCents)}, then ~${$(pick.longTermValueCents)}/yr. ${pick.reasons[0] ?? ''}`.trim()
    : 'No eligible cards for anyone in the household right now.';
  return { members, pick, why };
}

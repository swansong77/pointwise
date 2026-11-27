/**
 * Executive scores and the annual outlook (pure). Five scores, each 0–100 with the reasons behind it, so "how healthy is the household"
 * has an answer that can be checked. The outlook is an estimate and says what it assumed.
 */
export const SCORES_VERSION = 'cos-scores/1';

export type Grade = 'STRONG' | 'GOOD' | 'FAIR' | 'WEAK';
export const GRADE_LABEL: Record<Grade, string> = { STRONG: 'Strong', GOOD: 'Good', FAIR: 'Fair', WEAK: 'Needs work' };
export const gradeOf = (s: number): Grade => (s >= 80 ? 'STRONG' : s >= 60 ? 'GOOD' : s >= 40 ? 'FAIR' : 'WEAK');
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const usd = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US');

export interface ScoreCard {
  key: 'HOUSEHOLD' | 'LOYALTY' | 'PORTFOLIO' | 'OFFERS' | 'TRAVEL';
  label: string;
  score: number;
  grade: Grade;
  reasons: string[];
  href: string;
}

export interface ScoreSignals {
  loyalty: { healthScore: number | null; atRiskCents: number; totalCents: number; expiredCents: number };
  portfolio: { cards: number; feesCents: number; valueCents: number; toReview: number };
  offers: { availableCount: number; availableCents: number; expiringUnactivated: number; missedCents: number; hitRate: number | null; savedCents: number };
  travel: { membershipsValid: number; membershipsExpiring: number; certificatesUsable: number; certificatesExpiring: number; points: number; activeBonus: boolean; tripGoalPct: number | null };
  household: { criticalItems: number; goalsTotal: number; goalsBehind: number; membersOverLimit: number; members: number };
}

const card = (key: ScoreCard['key'], label: string, score: number, reasons: string[], href: string): ScoreCard => {
  const s = clamp(score);
  return { key, label, score: s, grade: gradeOf(s), reasons: reasons.length ? reasons : ['Nothing is holding this score down.'], href };
};

export function loyaltyScore(s: ScoreSignals['loyalty']): ScoreCard {
  const reasons: string[] = [];
  let score = s.healthScore ?? 60;
  if (s.healthScore == null) reasons.push('Not enough loyalty data to score precisely, so this starts from a neutral 60.');
  else reasons.push(`Loyalty health is ${s.healthScore}/100.`);
  if (s.totalCents > 0 && s.atRiskCents / s.totalCents > 0.1) {
    const p = Math.min(25, Math.round((s.atRiskCents / s.totalCents) * 60));
    score -= p;
    reasons.push(`${usd(s.atRiskCents)} of your ${usd(s.totalCents)} in points, certificates and status is at risk (−${p}).`);
  }
  if (s.expiredCents > 0) {
    const p = Math.min(15, Math.round(s.expiredCents / 10_000));
    score -= p;
    reasons.push(`${usd(s.expiredCents)} has already expired (−${p}).`);
  }
  return card('LOYALTY', 'Loyalty health', score, reasons, '/loyalty');
}

export function portfolioScore(s: ScoreSignals['portfolio']): ScoreCard {
  const reasons: string[] = [];
  if (s.cards === 0) return card('PORTFOLIO', 'Card portfolio', 50, ['No cards yet, so there is nothing to score.'], '/wallet');
  let score: number;
  if (s.feesCents === 0) {
    score = 90;
    reasons.push('You pay no annual fees.');
  } else {
    const cover = s.valueCents / s.feesCents;
    score = Math.min(100, Math.round(cover * 70));
    reasons.push(`Your cards returned ${usd(s.valueCents)} against ${usd(s.feesCents)} in fees (${(cover * 100).toFixed(0)}% covered).`);
  }
  if (s.toReview > 0) {
    const p = Math.min(32, s.toReview * 8);
    score -= p;
    reasons.push(`${s.toReview} of ${s.cards} card${s.cards === 1 ? '' : 's'} ${s.toReview === 1 ? 'is' : 'are'} worth a keep-or-cancel decision (−${p}).`);
  }
  return card('PORTFOLIO', 'Card portfolio', score, reasons, '/chief-of-staff#fees');
}

export function offerScore(s: ScoreSignals['offers']): ScoreCard {
  const reasons: string[] = [];
  if (s.availableCount === 0 && s.savedCents === 0 && s.missedCents === 0) return card('OFFERS', 'Offer health', 60, ['No offers are tracked yet, so this starts from a neutral 60.'], '/offers/inventory');
  let score = 80;
  if (s.missedCents > 0) {
    const p = Math.min(40, Math.round(s.missedCents / 1_000));
    score -= p;
    reasons.push(`${usd(s.missedCents)} of recommended offers expired unused in the last 90 days (−${p}).`);
  }
  if (s.expiringUnactivated > 0) {
    const p = Math.min(25, s.expiringUnactivated * 5);
    score -= p;
    reasons.push(`${s.expiringUnactivated} offer${s.expiringUnactivated === 1 ? '' : 's'} ending soon ${s.expiringUnactivated === 1 ? 'has' : 'have'} not been activated (−${p}).`);
  }
  if (s.hitRate != null && s.hitRate >= 0.7) {
    score += 10;
    reasons.push(`${Math.round(s.hitRate * 100)}% of planned purchases earned what was expected (+10).`);
  }
  if (s.savedCents > 0) reasons.push(`${usd(s.savedCents)} saved from offers and credits this year.`);
  return card('OFFERS', 'Offer health', score, reasons, '/offers/inventory');
}

export function travelScore(s: ScoreSignals['travel']): ScoreCard {
  const reasons: string[] = [];
  let score = 50;
  if (s.certificatesUsable > 0 && s.certificatesExpiring === 0) {
    score += 15;
    reasons.push(`${s.certificatesUsable} certificate${s.certificatesUsable === 1 ? '' : 's'} ready to use, none expiring soon (+15).`);
  }
  if (s.certificatesExpiring > 0) {
    score -= 15;
    reasons.push(`${s.certificatesExpiring} certificate${s.certificatesExpiring === 1 ? '' : 's'} expiring soon (−15).`);
  }
  if (s.membershipsValid > 0 && s.membershipsExpiring === 0) {
    score += 15;
    reasons.push(`${s.membershipsValid} travel membership${s.membershipsValid === 1 ? '' : 's'} in good standing (+15).`);
  }
  if (s.membershipsExpiring > 0) {
    score -= 10;
    reasons.push(`${s.membershipsExpiring} travel membership${s.membershipsExpiring === 1 ? '' : 's'} up for renewal (−10).`);
  }
  if (s.points >= 50_000) {
    score += 10;
    reasons.push(`${s.points.toLocaleString('en-US')} points to book with (+10).`);
  }
  if (s.activeBonus) {
    score += 5;
    reasons.push('A transfer bonus is running (+5).');
  }
  if (s.tripGoalPct != null) {
    score += Math.round(s.tripGoalPct / 10);
    reasons.push(`Your trip goal is ${s.tripGoalPct}% funded.`);
  }
  return card('TRAVEL', 'Travel readiness', score, reasons, '/travel');
}

/** the household as a whole: the other four, and whether anything urgent or off-track is waiting */
export function householdScore(parts: ScoreCard[], h: ScoreSignals['household']): ScoreCard {
  const reasons: string[] = [];
  const avg = parts.length ? parts.reduce((s, p) => s + p.score, 0) / parts.length : 60;
  let score = avg * 0.6 + (100 - Math.min(100, h.criticalItems * 15)) * 0.4;
  reasons.push(`The average of your other scores is ${Math.round(avg)}.`);
  if (h.criticalItems > 0) reasons.push(`${h.criticalItems} critical action${h.criticalItems === 1 ? '' : 's'} waiting.`);
  if (h.goalsBehind > 0) {
    const p = Math.min(15, h.goalsBehind * 5);
    score -= p;
    reasons.push(`${h.goalsBehind} of ${h.goalsTotal} goal${h.goalsTotal === 1 ? '' : 's'} ${h.goalsBehind === 1 ? 'is' : 'are'} behind or at risk (−${p}).`);
  }
  if (h.membersOverLimit > 0) {
    score -= 5;
    reasons.push(`${h.membersOverLimit} member${h.membersOverLimit === 1 ? ' is' : 's are'} at or over the 5/24 limit (−5).`);
  }
  return card('HOUSEHOLD', 'Household health', score, reasons, '/household');
}

export function scoreCards(sig: ScoreSignals): ScoreCard[] {
  const parts = [loyaltyScore(sig.loyalty), portfolioScore(sig.portfolio), offerScore(sig.offers), travelScore(sig.travel)];
  return [householdScore(parts, sig.household), ...parts];
}

// ───────────── annual outlook ─────────────

export interface OutlookInput {
  now: Date;
  /** credit received so far this year (offers and credits) */
  realizedYtdCents: number;
  /** credit received per month, last months first-to-last, from the savings summary */
  recentMonthsCents: number[];
  /** rewards earned on logged spend over the last 12 months */
  rewardsRunRate12mCents: number;
  /** value that is yours if you act on what is already scheduled (credits, certificates) */
  scheduledValueCents: number;
  /** annual fees that still post this year */
  feesRemainingCents: number;
}

export interface Outlook {
  version: string;
  realizedYtdCents: number;
  projectedAdditionalCents: number;
  feesRemainingCents: number;
  netCents: number;
  lowCents: number;
  highCents: number;
  confidence: number;
  assumptions: string[];
}

const yearFraction = (now: Date): number => {
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  const end = Date.UTC(now.getUTCFullYear() + 1, 0, 1);
  return (now.getTime() - start) / (end - start);
};

export function annualOutlook(i: OutlookInput): Outlook {
  const done = yearFraction(i.now);
  const remainingMonths = Math.max(0, (1 - done) * 12);
  const months = i.recentMonthsCents.filter((c) => Number.isFinite(c));
  const withData = months.filter((c) => c > 0).length;
  const pace = months.length ? months.reduce((s, c) => s + c, 0) / months.length : done > 0 ? i.realizedYtdCents / Math.max(1, done * 12) : 0;
  const projected = Math.round(pace * remainingMonths + (i.rewardsRunRate12mCents * remainingMonths) / 12 + i.scheduledValueCents * 0.7);
  const net = i.realizedYtdCents + projected - i.feesRemainingCents;
  return {
    version: SCORES_VERSION,
    realizedYtdCents: i.realizedYtdCents,
    projectedAdditionalCents: projected,
    feesRemainingCents: i.feesRemainingCents,
    netCents: net,
    lowCents: Math.round(net - projected * 0.25),
    highCents: Math.round(net + projected * 0.25),
    confidence: withData >= 6 ? 70 : withData >= 3 ? 55 : 35,
    assumptions: [
      `Offers and credits continue at about ${usd(Math.round(pace))} a month.`,
      'Rewards on spend continue at the last 12 months’ pace.',
      '70% of the credits and certificates already scheduled get used.',
      'Annual fees post on their renewal dates.',
      'This is an estimate, shown as a range.',
    ],
  };
}

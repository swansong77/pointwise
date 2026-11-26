import { money } from './format';

export type Verdict = 'BEST_EVER' | 'NEAR_HIGH' | 'ELEVATED' | 'TYPICAL' | 'BELOW_TYPICAL' | 'UNKNOWN';
export type Difficulty = 'EASY' | 'MODERATE' | 'HARD' | 'BLOCKED';
export type Tone = 'slate' | 'green' | 'amber' | 'red' | 'brand';

export interface Advice {
  code: string;
  text: string;
  tone: 'urgent' | 'positive' | 'neutral' | 'caution';
  priority: number;
}

export interface MarketOffer {
  card: string;
  slug: string;
  issuer: string;
  bonusType: string | null;
  bonusAmount: number | null;
  minSpendCents: number | null;
  spendMonths: number | null;
  annualFeeCents: number;
  valuationCents: number | null;
  median24mCents: number | null;
  bestEverCents: number | null;
  bestEverSince: string | null;
  percentile: number | null;
  versions: number;
  daysAtCurrent: number | null;
  daysToExpiry: number | null;
  expiresAt: string | null;
  verdict: Verdict;
  advice: Advice[];
  difficulty: { level: Difficulty; reasons: string[]; rules: Array<{ rule: string; verified: boolean }> };
  you: {
    eligible: boolean;
    blockers: string[];
    warnings: string[];
    firstYearValueCents: number;
    longTermValueCents: number;
    approvalOdds: string;
    five24: { countsToward: boolean; before: number; after: number; slotCostCents: number };
    confidence: number;
  } | null;
}

export interface Market {
  engine: string;
  member: { profileId: string; nickname: string };
  offers: MarketOffer[];
  expiringSoon: string[];
  historicalHighs: string[];
  recommended: { slug: string; card: string; why: string } | null;
  disclaimer: string;
}

export const VERDICT: Record<Verdict, { label: string; tone: Tone }> = {
  BEST_EVER: { label: 'Best ever', tone: 'green' },
  NEAR_HIGH: { label: 'Near historic high', tone: 'green' },
  ELEVATED: { label: 'Elevated', tone: 'brand' },
  TYPICAL: { label: 'Typical', tone: 'slate' },
  BELOW_TYPICAL: { label: 'Below typical', tone: 'amber' },
  UNKNOWN: { label: 'No history', tone: 'slate' },
};

export const DIFFICULTY: Record<Difficulty, { label: string; tone: Tone }> = {
  EASY: { label: 'Easy', tone: 'green' },
  MODERATE: { label: 'Moderate', tone: 'amber' },
  HARD: { label: 'Hard', tone: 'red' },
  BLOCKED: { label: 'Blocked', tone: 'red' },
};

export const ADVICE_TONE: Record<Advice['tone'], Tone> = { urgent: 'red', positive: 'green', neutral: 'slate', caution: 'amber' };

export type MarketSort = 'value' | 'expiry' | 'first-year' | 'history';
export const MARKET_SORTS: Array<{ id: MarketSort; label: string }> = [
  { id: 'value', label: 'Offer value' },
  { id: 'first-year', label: 'Your first-year value' },
  { id: 'expiry', label: 'Ending soonest' },
  { id: 'history', label: 'Closest to historic high' },
];

/** Sorted copy; offers without the sort key go last. */
export function sortOffers(offers: MarketOffer[], by: MarketSort): MarketOffer[] {
  const key = (o: MarketOffer): number => {
    switch (by) {
      case 'value':
        return -(o.valuationCents ?? -1);
      case 'first-year':
        return -(o.you?.firstYearValueCents ?? Number.NEGATIVE_INFINITY);
      case 'expiry':
        return o.daysToExpiry != null && o.daysToExpiry >= 0 ? o.daysToExpiry : Number.POSITIVE_INFINITY;
      case 'history':
        return o.bestEverCents && o.valuationCents ? -(o.valuationCents / o.bestEverCents) : Number.POSITIVE_INFINITY;
    }
  };
  return [...offers].sort((a, b) => key(a) - key(b));
}

/** "100K points", "$300", "2 nights" */
export function bonusLabel(o: Pick<MarketOffer, 'bonusType' | 'bonusAmount'>): string {
  if (o.bonusAmount == null) return '—';
  if (o.bonusType === 'CASH') return money(o.bonusAmount);
  const n = o.bonusAmount >= 1000 ? `${Math.round(o.bonusAmount / 1000)}K` : String(o.bonusAmount);
  const unit = o.bonusType === 'MILES' ? 'miles' : o.bonusType === 'NIGHTS' ? 'nights' : o.bonusType === 'POINTS' ? 'points' : '';
  return `${n} ${unit}`.trim();
}

export function expiryLabel(days: number | null): string {
  if (days == null) return 'No end date';
  if (days < 0) return 'Expired';
  if (days === 0) return 'Ends today';
  return days === 1 ? 'Ends tomorrow' : `Ends in ${days} days`;
}

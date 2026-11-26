import type { RankedCard } from './types';
import { money } from './format';

/** Short notes under a ranked card: how far to trust the rate and what limits it. */
export function rateNotes(r: Pick<RankedCard, 'verified' | 'cap' | 'blended' | 'multiplier' | 'effectiveMultiplier' | 'matchLevel'>): string[] {
  const notes: string[] = [];
  if (r.matchLevel === 'NONE') return notes;
  if (r.cap) notes.push(`${r.blended ? 'Blended with the base rate above' : 'Capped at'} ${money(r.cap.capCents, { compact: true })} ${r.cap.capPeriod === 'QUARTER' ? 'a quarter' : 'a year'}`);
  if (r.blended && r.effectiveMultiplier != null) notes.push(`${Number(r.effectiveMultiplier.toFixed(2))}x counted on your spending`);
  if (r.verified === false) notes.push('Rate not confirmed by the issuer yet');
  return notes;
}

/** The label of a category row on the dashboard: sub-categories are shown under their parent. */
export const categoryIndent = (parentSlug: string | null | undefined): boolean => !!parentSlug;

export interface RewardBadge {
  id: string;
  text: string;
  /** needs a portal, a linked account or an activation: shown, not used to rank */
  conditional: boolean;
  rotating: boolean;
}

/** "3x on dining": the issuer's wording without its own leading rate ("5% on ...", "Unlimited 1.5x miles on ..."). */
export const stripLeadingRate = (description: string): string => description.replace(/^(unlimited\s+)?\d+(\.\d+)?\s*(x|%)\s*/i, '').replace(/^\d+(\.\d+)?\s+points?\s+per\s+\$1\s+/i, '').trim();

/** Every earning rate of a card for the wallet, best first, the base ("everything else") rate last. */
export function rewardBadges(rewards: Array<{ id: string; multiplier: string | number; description: string; isRotating: boolean; conditional?: boolean; category?: { slug?: string } | null; merchantId?: string | null }>): RewardBadge[] {
  const isBase = (r: { category?: { slug?: string } | null; merchantId?: string | null }) => r.category?.slug === 'everything-else' && !r.merchantId;
  return [...rewards]
    .sort((a, b) => Number(isBase(a)) - Number(isBase(b)) || Number(b.multiplier) - Number(a.multiplier))
    .map((r) => ({ id: r.id, text: `${Number(r.multiplier)}x ${stripLeadingRate(r.description)}`, conditional: !!r.conditional, rotating: r.isRotating }));
}

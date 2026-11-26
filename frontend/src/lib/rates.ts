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

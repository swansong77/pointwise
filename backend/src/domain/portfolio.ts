/**
 * Portfolio value analytics (pure). All money in integer cents. See docs/benefit-notification-system.md
 * and docs/prd.md (Rewards analytics).
 *
 * Definitions (per card, over the trailing benefit year):
 *   faceBenefitCents       sum of annual face value of enabled benefits
 *   realizedBenefitCents   benefit value actually used this benefit year
 *   netValueCents          faceBenefitCents − annualFeeCents        (the spreadsheet's "Credits minus fee")
 *   effectiveValueCents    realizedBenefitCents + rewardsCents − annualFeeCents
 *   returnOnSpend          rewardsCents / spendCents                (null without spend)
 *   breakEvenSpendCents    spend needed for the card's extra earn over a baseline card to cover the
 *                          fee not already covered by realized benefits:
 *                          max(0, fee − realized) / (earnRate − baselineRate); null if earnRate ≤ baseline
 */

export const DEFAULT_BASELINE_RATE = 0.015; // a no-fee 1.5 % card

export interface CardValueInput {
  walletCardId: string;
  name: string;
  profileId: string | null;
  status: string;
  annualFeeCents: number;
  faceBenefitCents: number;
  realizedBenefitCents: number;
  missedBenefitCents: number;
  rewardsCents: number;
  spendCents: number;
  /** value per $1 when no spend history exists (e.g. best everyday multiplier × cpp / 100) */
  fallbackEarnRate?: number;
}

export interface ValueTotals {
  annualFeeCents: number;
  faceBenefitCents: number;
  realizedBenefitCents: number;
  missedBenefitCents: number;
  rewardsCents: number;
  spendCents: number;
  netValueCents: number;
  effectiveValueCents: number;
  returnOnSpend: number | null;
}

export interface CardValue extends ValueTotals {
  walletCardId: string;
  name: string;
  profileId: string | null;
  status: string;
  earnRate: number | null;
  breakEvenSpendCents: number | null;
}

const ratio = (num: number, den: number): number | null => (den > 0 ? Math.round((num / den) * 10_000) / 10_000 : null);

function totalsOf(x: Omit<ValueTotals, 'netValueCents' | 'effectiveValueCents' | 'returnOnSpend'>): ValueTotals {
  return {
    ...x,
    netValueCents: x.faceBenefitCents - x.annualFeeCents,
    effectiveValueCents: x.realizedBenefitCents + x.rewardsCents - x.annualFeeCents,
    returnOnSpend: ratio(x.rewardsCents, x.spendCents),
  };
}

export function breakEvenSpend(annualFeeCents: number, realizedBenefitCents: number, earnRate: number | null, baselineRate = DEFAULT_BASELINE_RATE): number | null {
  const uncovered = Math.max(0, annualFeeCents - realizedBenefitCents);
  if (uncovered === 0) return 0;
  if (earnRate == null || earnRate <= baselineRate) return null;
  // round away float noise (0.03 − 0.02 = 0.00999…) before taking the ceiling
  return Math.ceil(Math.round((uncovered / (earnRate - baselineRate)) * 1000) / 1000);
}

export function cardValue(c: CardValueInput, baselineRate = DEFAULT_BASELINE_RATE): CardValue {
  const earnRate = c.spendCents > 0 ? c.rewardsCents / c.spendCents : (c.fallbackEarnRate ?? null);
  return {
    walletCardId: c.walletCardId,
    name: c.name,
    profileId: c.profileId,
    status: c.status,
    ...totalsOf({
      annualFeeCents: c.annualFeeCents,
      faceBenefitCents: c.faceBenefitCents,
      realizedBenefitCents: c.realizedBenefitCents,
      missedBenefitCents: c.missedBenefitCents,
      rewardsCents: c.rewardsCents,
      spendCents: c.spendCents,
    }),
    earnRate: earnRate == null ? null : Math.round(earnRate * 10_000) / 10_000,
    breakEvenSpendCents: breakEvenSpend(c.annualFeeCents, c.realizedBenefitCents, earnRate, baselineRate),
  };
}

export function sumValues(cards: Array<Pick<CardValue, keyof Omit<ValueTotals, 'netValueCents' | 'effectiveValueCents' | 'returnOnSpend'>>>): ValueTotals {
  const z = { annualFeeCents: 0, faceBenefitCents: 0, realizedBenefitCents: 0, missedBenefitCents: 0, rewardsCents: 0, spendCents: 0 };
  for (const c of cards) {
    z.annualFeeCents += c.annualFeeCents;
    z.faceBenefitCents += c.faceBenefitCents;
    z.realizedBenefitCents += c.realizedBenefitCents;
    z.missedBenefitCents += c.missedBenefitCents;
    z.rewardsCents += c.rewardsCents;
    z.spendCents += c.spendCents;
  }
  return totalsOf(z);
}

/** Roll-up by cardholder (profileId; null = unassigned / account owner). */
export function rollupByHolder(cards: CardValue[]): Array<{ profileId: string | null; cards: number } & ValueTotals> {
  const groups = new Map<string | null, CardValue[]>();
  for (const c of cards) groups.set(c.profileId, [...(groups.get(c.profileId) ?? []), c]);
  return [...groups.entries()].map(([profileId, list]) => ({ profileId, cards: list.length, ...sumValues(list) }));
}

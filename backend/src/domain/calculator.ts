import { rankCards, round } from './recommendation.engine';
import { DomainWalletCard } from './types';

export interface SpendLine {
  categoryId: string;
  /** annual spend in cents */
  annualSpendCents: number;
}

export interface CalculatorCategoryResult {
  categoryId: string;
  annualSpendCents: number;
  bestWalletCardId: string | null;
  bestCardName: string | null;
  centsPerDollar: number;
  rewardsCents: number;
}

export interface CalculatorResult {
  categories: CalculatorCategoryResult[];
  grossRewardsCents: number;
  annualFeesCents: number;
  netValueCents: number;
}

export interface CalculatorOptions {
  fallbackCategoryId: string | null;
  /** categoryId -> parent category id */
  parentOf?: Record<string, string | null>;
  valuations?: Record<string, number>;
  now?: Date;
}

export function annualFee(wc: DomainWalletCard): number {
  return wc.annualFeeOverrideCents ?? wc.card.annualFeeCents;
}

/** Validate spend lines; throws on invalid input. */
export function validateSpend(lines: SpendLine[]): void {
  const seen = new Set<string>();
  for (const l of lines) {
    if (!Number.isInteger(l.annualSpendCents) || l.annualSpendCents < 0) {
      throw new RangeError(`annualSpendCents must be a non-negative integer (category ${l.categoryId})`);
    }
    if (l.annualSpendCents > 100_000_000_00) {
      throw new RangeError('annualSpendCents exceeds the supported maximum ($100M)');
    }
    if (seen.has(l.categoryId)) throw new RangeError(`duplicate category ${l.categoryId}`);
    seen.add(l.categoryId);
  }
}

/**
 * Annual value of a wallet: Σ(spend × best ¢/$) − Σ annual fees of approved cards.
 */
export function calculateWalletValue(
  walletCards: DomainWalletCard[],
  spend: SpendLine[],
  opts: CalculatorOptions,
): CalculatorResult {
  validateSpend(spend);
  const categories = spend.map((line) => {
    const ranked = rankCards(
      walletCards,
      {
        categoryId: line.categoryId,
        parentCategoryId: opts.parentOf?.[line.categoryId] ?? null,
        fallbackCategoryId: opts.fallbackCategoryId,
      },
      { valuations: opts.valuations, now: opts.now },
    );
    const best = ranked[0];
    const cpd = best ? best.centsPerDollar : 0;
    return {
      categoryId: line.categoryId,
      annualSpendCents: line.annualSpendCents,
      bestWalletCardId: best ? best.walletCardId : null,
      bestCardName: best ? best.name : null,
      centsPerDollar: cpd,
      rewardsCents: Math.round((line.annualSpendCents * cpd) / 100),
    };
  });
  const grossRewardsCents = categories.reduce((s, c) => s + c.rewardsCents, 0);
  const annualFeesCents = walletCards
    .filter((wc) => wc.status === 'APPROVED')
    .reduce((s, wc) => s + annualFee(wc), 0);
  return {
    categories,
    grossRewardsCents,
    annualFeesCents,
    netValueCents: grossRewardsCents - annualFeesCents,
  };
}

export interface CompareResult {
  current: CalculatorResult;
  withCandidate: CalculatorResult;
  incrementalValueCents: number;
  /** first-year value including welcome bonus (valued at candidate currency cpp) */
  firstYearValueCents: number;
}

/** What would adding `candidate` to the wallet be worth? */
export function compareCandidate(
  walletCards: DomainWalletCard[],
  candidate: DomainWalletCard,
  spend: SpendLine[],
  opts: CalculatorOptions,
): CompareResult {
  const current = calculateWalletValue(walletCards, spend, opts);
  const withCandidate = calculateWalletValue([...walletCards, { ...candidate, status: 'APPROVED' }], spend, opts);
  const incremental = withCandidate.netValueCents - current.netValueCents;
  const cpp = opts.valuations?.[candidate.card.currency.id] ?? Number(candidate.card.currency.centsPerPoint);
  const bonusValue = candidate.card.bonusPoints ? Math.round(candidate.card.bonusPoints * cpp) : 0;
  return {
    current,
    withCandidate,
    incrementalValueCents: incremental,
    firstYearValueCents: incremental + bonusValue,
  };
}

export { round };

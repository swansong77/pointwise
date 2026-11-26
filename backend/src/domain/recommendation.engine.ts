import { DomainRewardRule, DomainWalletCard, PurchaseTarget } from './types';

/**
 * Best-card engine.
 *
 * Reconstructed rule from the analyzed app (docs/storage.md §4):
 *   value per dollar (¢) = multiplier × currency valuation (¢ per point)
 * Precedence: a user pin wins; otherwise rank by value desc, then multiplier desc, then name.
 * Only APPROVED cards participate. Rotating rules apply only when the user selected that category.
 */

export type MatchLevel = 'MERCHANT' | 'CATEGORY' | 'PARENT_CATEGORY' | 'FALLBACK' | 'NONE';

export interface RankedCard {
  walletCardId: string;
  cardId: string;
  name: string;
  color: string;
  multiplier: number;
  centsPerPoint: number;
  centsPerDollar: number;
  matchLevel: MatchLevel;
  reason: string;
  pinned: boolean;
}

export interface RankOptions {
  now?: Date;
  /** currencyId -> user's ¢/pt override */
  valuations?: Record<string, number>;
  /** walletCardId pinned by the user for this target */
  pinnedWalletCardId?: string | null;
}

const LEVEL_PRIORITY: Record<MatchLevel, number> = {
  MERCHANT: 4,
  CATEGORY: 3,
  PARENT_CATEGORY: 2,
  FALLBACK: 1,
  NONE: 0,
};

export function isRuleActive(rule: DomainRewardRule, now: Date): boolean {
  if (rule.startsAt && rule.startsAt.getTime() > now.getTime()) return false;
  if (rule.endsAt && rule.endsAt.getTime() < now.getTime()) return false;
  return true;
}

export function matchLevel(rule: DomainRewardRule, target: PurchaseTarget): MatchLevel {
  if (rule.merchantId) {
    return target.merchantId && rule.merchantId === target.merchantId ? 'MERCHANT' : 'NONE';
  }
  if (rule.categoryId && target.categoryId && rule.categoryId === target.categoryId) return 'CATEGORY';
  if (rule.categoryId && target.parentCategoryId && rule.categoryId === target.parentCategoryId) {
    return 'PARENT_CATEGORY';
  }
  if (rule.categoryId && target.fallbackCategoryId && rule.categoryId === target.fallbackCategoryId) {
    return 'FALLBACK';
  }
  return 'NONE';
}

/** Rotating rules must be activated by selecting their category on the wallet card. */
export function isRuleEnabledForCard(rule: DomainRewardRule, wc: DomainWalletCard): boolean {
  if (!rule.isRotating) return true;
  return rule.categoryId != null && wc.selectedCategoryIds.includes(rule.categoryId);
}

export function bestRuleForCard(
  wc: DomainWalletCard,
  target: PurchaseTarget,
  now: Date,
): { rule: DomainRewardRule | null; level: MatchLevel; multiplier: number } {
  let best: { rule: DomainRewardRule | null; level: MatchLevel; multiplier: number } = {
    rule: null,
    level: 'NONE',
    multiplier: 0,
  };
  for (const rule of wc.card.rewards) {
    if (!isRuleActive(rule, now) || !isRuleEnabledForCard(rule, wc)) continue;
    const level = matchLevel(rule, target);
    if (level === 'NONE') continue;
    const m = Number(rule.multiplier);
    if (
      m > best.multiplier ||
      (m === best.multiplier && LEVEL_PRIORITY[level] > LEVEL_PRIORITY[best.level])
    ) {
      best = { rule, level, multiplier: m };
    }
  }
  return best;
}

export function effectiveCentsPerPoint(wc: DomainWalletCard, valuations: Record<string, number> = {}): number {
  const override = valuations[wc.card.currency.id];
  return override != null && override >= 0 ? override : Number(wc.card.currency.centsPerPoint);
}

export function round(n: number, places = 2): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function rankCards(
  walletCards: DomainWalletCard[],
  target: PurchaseTarget,
  options: RankOptions = {},
): RankedCard[] {
  const now = options.now ?? new Date();
  const ranked: RankedCard[] = walletCards
    .filter((wc) => wc.status === 'APPROVED')
    .map((wc) => {
      const { rule, level, multiplier } = bestRuleForCard(wc, target, now);
      const cpp = effectiveCentsPerPoint(wc, options.valuations);
      return {
        walletCardId: wc.id,
        cardId: wc.card.id,
        name: wc.nickname || wc.card.name,
        color: wc.card.color,
        multiplier,
        centsPerPoint: cpp,
        centsPerDollar: round(multiplier * cpp),
        matchLevel: level,
        reason: rule ? rule.description : 'No reward rule for this purchase',
        pinned: options.pinnedWalletCardId === wc.id,
      };
    });

  ranked.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (b.centsPerDollar !== a.centsPerDollar) return b.centsPerDollar - a.centsPerDollar;
    if (b.multiplier !== a.multiplier) return b.multiplier - a.multiplier;
    return a.name.localeCompare(b.name);
  });
  return ranked;
}

export function bestCard(
  walletCards: DomainWalletCard[],
  target: PurchaseTarget,
  options: RankOptions = {},
): RankedCard | null {
  const ranked = rankCards(walletCards, target, options);
  return ranked.length > 0 ? ranked[0] : null;
}

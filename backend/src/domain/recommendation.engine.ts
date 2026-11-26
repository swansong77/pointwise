import { DomainRewardRule, DomainWalletCard, PurchaseTarget } from './types';

/**
 * Best-card engine.
 *
 * Reconstructed rule from the analyzed app (docs/storage.md §4):
 *   value per dollar (¢) = multiplier × currency valuation (¢ per point)
 * Precedence: a user pin wins; otherwise rank by value desc, then multiplier desc, then name.
 * Only APPROVED cards participate. Rotating rules apply only when the user selected that category.
 *
 * Added in the rate review (docs/rewards-audit.md, ADR-028):
 *  - conditional rules (portal-only, "up to", linked-account rates) are never used to rank;
 *  - a capped rate is blended with the card's base rate for the part of the member's yearly spend in the category that
 *    is above the cap, when that spend is known; otherwise the headline rate ranks and the cap is shown;
 *  - each ranked card says whether the rate it used has been confirmed by an issuer page.
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
  /** the multiplier used for ranking (equals `multiplier` unless a cap and known spend pull it down) */
  effectiveMultiplier: number;
  /** the cap on the rule that was used, if any */
  cap: { capCents: number; capPeriod: 'QUARTER' | 'YEAR' } | null;
  /** true when a known spend above the cap lowered the rate */
  blended: boolean;
  /** an issuer page confirmed the rate used */
  verified: boolean;
}

export interface RankOptions {
  now?: Date;
  /** currencyId -> user's ¢/pt override */
  valuations?: Record<string, number>;
  /** walletCardId pinned by the user for this target */
  pinnedWalletCardId?: string | null;
  /** the member's yearly spend in this category in cents, when known (from the spending profile) */
  annualSpendCents?: number | null;
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

/** The yearly cap of a rule in cents, or null when it has none. A quarterly cap counts four times a year. */
export function annualCapCents(rule: Pick<DomainRewardRule, 'capCents' | 'capPeriod'>): number | null {
  if (!rule.capCents || rule.capCents <= 0) return null;
  return rule.capPeriod === 'QUARTER' ? rule.capCents * 4 : rule.capCents;
}

/**
 * The rate a member really gets on `annualSpendCents` a year in the category: the headline rate up to the cap, the card's
 * base rate beyond it. Without a cap, or without a known spend, it is the headline rate.
 */
export function effectiveMultiplier(rule: Pick<DomainRewardRule, 'multiplier' | 'capCents' | 'capPeriod'>, baseMultiplier: number, annualSpendCents: number | null | undefined): number {
  const headline = Number(rule.multiplier);
  const cap = annualCapCents(rule);
  if (cap === null || annualSpendCents == null || annualSpendCents <= cap) return headline;
  return (cap * headline + (annualSpendCents - cap) * baseMultiplier) / annualSpendCents;
}

/** The card's base ("everything else") rate, used for the part of a capped category above its cap. */
export function baseMultiplier(wc: DomainWalletCard, target: PurchaseTarget, now: Date): number {
  let m = 0;
  for (const rule of wc.card.rewards) {
    if (rule.conditional || !isRuleActive(rule, now) || !isRuleEnabledForCard(rule, wc)) continue;
    if (rule.categoryId && target.fallbackCategoryId && rule.categoryId === target.fallbackCategoryId && !rule.merchantId) m = Math.max(m, Number(rule.multiplier));
  }
  return m;
}

export function bestRuleForCard(
  wc: DomainWalletCard,
  target: PurchaseTarget,
  now: Date,
  annualSpendCents?: number | null,
): { rule: DomainRewardRule | null; level: MatchLevel; multiplier: number; effective: number } {
  let best: { rule: DomainRewardRule | null; level: MatchLevel; multiplier: number; effective: number } = {
    rule: null,
    level: 'NONE',
    multiplier: 0,
    effective: 0,
  };
  const base = baseMultiplier(wc, target, now);
  for (const rule of wc.card.rewards) {
    if (rule.conditional || !isRuleActive(rule, now) || !isRuleEnabledForCard(rule, wc)) continue;
    const level = matchLevel(rule, target);
    if (level === 'NONE') continue;
    const m = Number(rule.multiplier);
    const eff = effectiveMultiplier(rule, base, annualSpendCents);
    if (eff > best.effective || (eff === best.effective && m > best.multiplier) || (eff === best.effective && m === best.multiplier && LEVEL_PRIORITY[level] > LEVEL_PRIORITY[best.level])) {
      best = { rule, level, multiplier: m, effective: eff };
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
      const { rule, level, multiplier, effective } = bestRuleForCard(wc, target, now, options.annualSpendCents);
      const cpp = effectiveCentsPerPoint(wc, options.valuations);
      const capped = rule && annualCapCents(rule) !== null ? { capCents: rule.capCents as number, capPeriod: (rule.capPeriod === 'QUARTER' ? 'QUARTER' : 'YEAR') as 'QUARTER' | 'YEAR' } : null;
      return {
        walletCardId: wc.id,
        cardId: wc.card.id,
        name: wc.nickname || wc.card.name,
        color: wc.card.color,
        multiplier,
        centsPerPoint: cpp,
        centsPerDollar: round(effective * cpp),
        effectiveMultiplier: round(effective, 3),
        cap: capped,
        blended: effective < multiplier,
        verified: !!rule?.verifiedAt,
        matchLevel: level,
        reason: rule ? rule.description : wc.card.rewards.length === 0 ? 'No earning rates are recorded for this card' : 'No reward rule for this purchase',
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

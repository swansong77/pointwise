import { excludedMerchantSlugs } from '../../src/domain/reward-exclusions';
import { rankCards } from '../../src/domain/recommendation.engine';
import { CAT, CUR, card, rule, wc } from './fixtures';

const NOW = new Date('2026-06-15T12:00:00Z');

describe('grocery rates and superstores', () => {
  it('Amex "U.S. supermarkets" excludes superstores and clubs', () => {
    const r = { cardSlug: 'amex-gold', issuerName: 'American Express', categorySlug: 'groceries', description: '4X points at U.S. supermarkets, on up to $25,000 a calendar year, then 1X' };
    expect(excludedMerchantSlugs(r).sort()).toEqual(['costco', 'target', 'walmart']);
  });
  it('reads an exclusion the rule text states', () => {
    const d = (description: string, cardSlug = 'x') => excludedMerchantSlugs({ cardSlug, categorySlug: 'groceries', description });
    expect(d('5% on grocery stores (not Walmart or Target), on up to $1,500 a quarter').sort()).toEqual(['target', 'walmart']);
    expect(d('3% cash back at grocery stores (not superstores like Walmart and Target)').sort()).toEqual(['target', 'walmart']);
    expect(d('2x points at grocery stores (not discount stores, supercenters or wholesale clubs)').sort()).toEqual(['costco', 'target', 'walmart']);
    expect(d('2% at grocery stores')).toEqual([]);
  });
  it('only grocery rates are affected', () => {
    expect(excludedMerchantSlugs({ cardSlug: 'amex-gold', issuerName: 'American Express', categorySlug: 'dining', description: '4X at restaurants (not Walmart)' })).toEqual([]);
  });

  it('a card with an excluded merchant falls back to its base rate there, and keeps the grocery rate elsewhere', () => {
    const gold = card({
      id: 'gold',
      currency: CUR.cash,
      rewards: [rule({ categoryId: CAT.groceries, multiplier: 4, excludedMerchantIds: ['walmart-id'] }), rule({ categoryId: CAT.fallback, multiplier: 1 })],
    });
    const flat = card({ id: 'flat', currency: CUR.cash, rewards: [rule({ categoryId: CAT.fallback, multiplier: 2 })] });
    const cards = [wc({ id: 'w1', card: gold }), wc({ id: 'w2', card: flat })];
    const atWalmart = rankCards(cards, { categoryId: CAT.groceries, merchantId: 'walmart-id', fallbackCategoryId: CAT.fallback }, { now: NOW });
    expect(atWalmart[0].cardId).toBe('flat');
    expect(atWalmart.find((r) => r.cardId === 'gold')!.multiplier).toBe(1);
    const atKroger = rankCards(cards, { categoryId: CAT.groceries, merchantId: 'kroger-id', fallbackCategoryId: CAT.fallback }, { now: NOW });
    expect(atKroger[0].cardId).toBe('gold');
    // a category page (no merchant) still shows the headline rate
    expect(rankCards(cards, { categoryId: CAT.groceries, fallbackCategoryId: CAT.fallback }, { now: NOW })[0].cardId).toBe('gold');
  });
});

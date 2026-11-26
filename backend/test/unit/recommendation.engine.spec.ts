import {
  bestCard,
  bestRuleForCard,
  effectiveCentsPerPoint,
  isRuleActive,
  isRuleEnabledForCard,
  matchLevel,
  rankCards,
  round,
} from '../../src/domain/recommendation.engine';
import { CAT, CUR, MER, card, rule, sampleWallet, wc } from './fixtures';

const target = (categoryId: string | null, extra: Record<string, unknown> = {}) => ({
  categoryId,
  fallbackCategoryId: CAT.fallback,
  ...extra,
});
const NOW = new Date('2026-06-15T12:00:00Z');

describe('recommendation engine', () => {
  describe('isRuleActive', () => {
    it('is active with no dates', () => expect(isRuleActive(rule({}), NOW)).toBe(true));
    it('is inactive before start', () => expect(isRuleActive(rule({ startsAt: new Date('2026-07-01') }), NOW)).toBe(false));
    it('is inactive after end', () => expect(isRuleActive(rule({ endsAt: new Date('2026-06-01') }), NOW)).toBe(false));
    it('is active inside the window', () =>
      expect(isRuleActive(rule({ startsAt: new Date('2026-04-01'), endsAt: new Date('2026-06-30') }), NOW)).toBe(true));
    it('boundary: start equal to now is active', () => expect(isRuleActive(rule({ startsAt: NOW }), NOW)).toBe(true));
    it('boundary: end equal to now is active', () => expect(isRuleActive(rule({ endsAt: NOW }), NOW)).toBe(true));
  });

  describe('matchLevel', () => {
    it('matches merchant rules only for that merchant', () => {
      const r = rule({ merchantId: MER.shopnow });
      expect(matchLevel(r, target(CAT.dining, { merchantId: MER.shopnow }))).toBe('MERCHANT');
      expect(matchLevel(r, target(CAT.dining, { merchantId: MER.freshcart }))).toBe('NONE');
      expect(matchLevel(r, target(CAT.dining))).toBe('NONE');
    });
    it('matches category, parent category, and fallback', () => {
      expect(matchLevel(rule({ categoryId: CAT.dining }), target(CAT.dining))).toBe('CATEGORY');
      expect(matchLevel(rule({ categoryId: CAT.dining }), target(CAT.coffee, { parentCategoryId: CAT.dining }))).toBe('PARENT_CATEGORY');
      expect(matchLevel(rule({ categoryId: CAT.fallback }), target(CAT.dining))).toBe('FALLBACK');
      expect(matchLevel(rule({ categoryId: CAT.gas }), target(CAT.dining))).toBe('NONE');
    });
    it('returns NONE for a rule with no category or merchant', () => {
      expect(matchLevel(rule({}), target(CAT.dining))).toBe('NONE');
    });
    it('returns NONE when target has no category and no fallback', () => {
      expect(matchLevel(rule({ categoryId: CAT.dining }), { categoryId: null, fallbackCategoryId: null })).toBe('NONE');
    });
  });

  describe('isRuleEnabledForCard', () => {
    const c = card({ id: 'x' });
    it('non-rotating rules are always enabled', () => expect(isRuleEnabledForCard(rule({}), wc({ id: 'w', card: c }))).toBe(true));
    it('rotating rules need the category selected', () => {
      const r = rule({ categoryId: CAT.gas, isRotating: true });
      expect(isRuleEnabledForCard(r, wc({ id: 'w', card: c }))).toBe(false);
      expect(isRuleEnabledForCard(r, wc({ id: 'w', card: c, selectedCategoryIds: [CAT.gas] }))).toBe(true);
    });
    it('rotating rule without category is never enabled', () => {
      expect(isRuleEnabledForCard(rule({ isRotating: true }), wc({ id: 'w', card: c, selectedCategoryIds: [CAT.gas] }))).toBe(false);
    });
  });

  describe('bestRuleForCard', () => {
    it('takes the highest multiplier among applicable rules', () => {
      const c = card({ id: 'c', rewards: [rule({ categoryId: CAT.fallback, multiplier: 2 }), rule({ categoryId: CAT.dining, multiplier: 1.5 })] });
      const res = bestRuleForCard(wc({ id: 'w', card: c }), target(CAT.dining), NOW);
      expect(res.multiplier).toBe(2);
      expect(res.level).toBe('FALLBACK');
    });
    it('prefers the more specific level on equal multipliers', () => {
      const c = card({ id: 'c', rewards: [rule({ categoryId: CAT.fallback, multiplier: 2 }), rule({ categoryId: CAT.dining, multiplier: 2 })] });
      expect(bestRuleForCard(wc({ id: 'w', card: c }), target(CAT.dining), NOW).level).toBe('CATEGORY');
    });
    it('keeps the first equally-specific rule (no downgrade)', () => {
      const c = card({ id: 'c', rewards: [rule({ categoryId: CAT.dining, multiplier: 2 }), rule({ categoryId: CAT.fallback, multiplier: 2 })] });
      expect(bestRuleForCard(wc({ id: 'w', card: c }), target(CAT.dining), NOW).level).toBe('CATEGORY');
    });
    it('ignores expired and non-activated rules', () => {
      const c = card({
        id: 'c',
        rewards: [
          rule({ categoryId: CAT.gas, multiplier: 5, endsAt: new Date('2026-01-01') }),
          rule({ categoryId: CAT.gas, multiplier: 4, isRotating: true }),
          rule({ categoryId: CAT.fallback, multiplier: 1 }),
        ],
      });
      expect(bestRuleForCard(wc({ id: 'w', card: c }), target(CAT.gas), NOW).multiplier).toBe(1);
    });
    it('returns NONE when nothing applies', () => {
      const c = card({ id: 'c', rewards: [rule({ categoryId: CAT.gas, multiplier: 5 })] });
      const res = bestRuleForCard(wc({ id: 'w', card: c }), { categoryId: CAT.dining, fallbackCategoryId: null }, NOW);
      expect(res).toEqual({ rule: null, level: 'NONE', multiplier: 0 });
    });
  });

  describe('effectiveCentsPerPoint', () => {
    const w = wc({ id: 'w', card: card({ id: 'c', currency: CUR.miles }) });
    it('uses the currency default', () => expect(effectiveCentsPerPoint(w)).toBe(1.5));
    it('uses a user override', () => expect(effectiveCentsPerPoint(w, { [CUR.miles.id]: 2 })).toBe(2));
    it('allows a zero override', () => expect(effectiveCentsPerPoint(w, { [CUR.miles.id]: 0 })).toBe(0));
    it('ignores negative overrides', () => expect(effectiveCentsPerPoint(w, { [CUR.miles.id]: -1 })).toBe(1.5));
  });

  describe('rankCards', () => {
    it('dining: Gold 4X×1.25 = 5¢ beats Voyager 3X×1.5 = 4.5¢', () => {
      const ranked = rankCards(sampleWallet(), target(CAT.dining), { now: NOW });
      expect(ranked.map((r) => r.walletCardId)).toEqual(['w-gold', 'w-voyager', 'w-double', 'w-flex']);
      expect(ranked[0].centsPerDollar).toBe(5);
      expect(ranked[1].centsPerDollar).toBe(4.5);
    });
    it('gas: activated rotating 5% wins', () => {
      const best = bestCard(sampleWallet(), target(CAT.gas), { now: NOW });
      expect(best?.walletCardId).toBe('w-flex');
      expect(best?.centsPerDollar).toBe(5);
      expect(best?.reason).toContain('rotating');
    });
    it('groceries: Flex groceries not activated, so Gold wins at 5¢ over Double 2¢', () => {
      const best = bestCard(sampleWallet(), target(CAT.groceries), { now: NOW });
      expect(best?.walletCardId).toBe('w-gold');
    });
    it('unknown category falls back to everything-else rates', () => {
      const best = bestCard(sampleWallet(), target('cat-unknown'), { now: NOW });
      expect(best?.walletCardId).toBe('w-double');
      expect(best?.matchLevel).toBe('FALLBACK');
    });
    it('user valuations change the winner', () => {
      const best = bestCard(sampleWallet(), target(CAT.dining), { now: NOW, valuations: { [CUR.miles.id]: 2.0 } });
      expect(best?.walletCardId).toBe('w-voyager'); // 3×2.0 = 6 > 5
    });
    it('pinned card is always first', () => {
      const ranked = rankCards(sampleWallet(), target(CAT.dining), { now: NOW, pinnedWalletCardId: 'w-double' });
      expect(ranked[0].walletCardId).toBe('w-double');
      expect(ranked[0].pinned).toBe(true);
      expect(ranked[1].walletCardId).toBe('w-gold');
    });
    it('excludes non-approved cards', () => {
      const w = sampleWallet();
      w[1].status = 'CLOSED';
      w[0].status = 'APPLIED';
      w[3].status = 'DENIED';
      const ranked = rankCards(w, target(CAT.dining), { now: NOW });
      expect(ranked.map((r) => r.walletCardId)).toEqual(['w-flex']);
    });
    it('uses nickname when present', () => {
      const w = sampleWallet();
      w[1].nickname = 'My Gold';
      expect(bestCard(w, target(CAT.dining), { now: NOW })?.name).toBe('My Gold');
    });
    it('merchant-specific rule beats category', () => {
      const shop = card({ id: 'shop', rewards: [rule({ merchantId: MER.shopnow, multiplier: 5, description: '5% at ShopNow' })] });
      const w = [...sampleWallet(), wc({ id: 'w-shop', card: shop })];
      const best = bestCard(w, target('cat-online', { merchantId: MER.shopnow }), { now: NOW });
      expect(best?.walletCardId).toBe('w-shop');
      expect(best?.matchLevel).toBe('MERCHANT');
    });
    it('ties broken by multiplier then name', () => {
      const a = card({ id: 'a', name: 'Bravo', rewards: [rule({ categoryId: CAT.fallback, multiplier: 2 })] });
      const b = card({ id: 'b', name: 'Alpha', rewards: [rule({ categoryId: CAT.fallback, multiplier: 2 })] });
      const c = card({ id: 'c', name: 'Charlie', currency: { ...CUR.cash, id: 'half', centsPerPoint: 0.5 }, rewards: [rule({ categoryId: CAT.fallback, multiplier: 4 })] });
      const ranked = rankCards([wc({ id: 'wa', card: a }), wc({ id: 'wb', card: b }), wc({ id: 'wc', card: c })], target(CAT.dining), { now: NOW });
      expect(ranked.map((r) => r.name)).toEqual(['Charlie', 'Alpha', 'Bravo']);
    });
    it('empty wallet returns empty ranking and null best', () => {
      expect(rankCards([], target(CAT.dining))).toEqual([]);
      expect(bestCard([], target(CAT.dining))).toBeNull();
    });
    it('card with no applicable rule gets 0 and a reason', () => {
      const none = card({ id: 'n', rewards: [] });
      const r = rankCards([wc({ id: 'w', card: none })], target(CAT.dining), { now: NOW })[0];
      expect(r.centsPerDollar).toBe(0);
      expect(r.reason).toMatch(/No reward rule/);
    });
    it('defaults now to current time', () => {
      expect(rankCards(sampleWallet(), target(CAT.dining))[0].walletCardId).toBe('w-gold');
    });
  });

  it('round()', () => {
    expect(round(4.4999)).toBe(4.5);
    expect(round(1.005, 1)).toBe(1);
  });
});

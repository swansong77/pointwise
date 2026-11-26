import { annualCapCents, baseMultiplier, effectiveMultiplier, rankCards } from '../../src/domain/recommendation.engine';
import { CAT, CUR, card, rule, wc } from './fixtures';

const NOW = new Date('2026-06-15T12:00:00Z');
const target = (categoryId: string | null, extra: Record<string, unknown> = {}) => ({ categoryId, fallbackCategoryId: CAT.fallback, ...extra });
const base = (m: number) => rule({ categoryId: CAT.fallback, multiplier: m, description: `${m}x everything else` });

describe('capped rates', () => {
  it('knows the yearly cap of a rule', () => {
    expect(annualCapCents({ capCents: 600_000, capPeriod: 'YEAR' })).toBe(600_000);
    expect(annualCapCents({ capCents: 150_000, capPeriod: 'QUARTER' })).toBe(600_000);
    expect(annualCapCents({ capCents: null, capPeriod: null })).toBeNull();
    expect(annualCapCents({ capCents: 0, capPeriod: 'YEAR' })).toBeNull();
  });

  it('keeps the headline rate with no cap, an unknown spend, or spend under the cap', () => {
    const r = rule({ multiplier: 6, capCents: 600_000, capPeriod: 'YEAR' });
    expect(effectiveMultiplier(r, 1, undefined)).toBe(6);
    expect(effectiveMultiplier(r, 1, null)).toBe(6);
    expect(effectiveMultiplier(r, 1, 600_000)).toBe(6);
    expect(effectiveMultiplier(rule({ multiplier: 3 }), 1, 5_000_000)).toBe(3);
  });

  it('blends with the base rate for the part of the spend above the cap', () => {
    const r = rule({ multiplier: 6, capCents: 600_000, capPeriod: 'YEAR' });
    // $12,000 a year: $6,000 at 6x and $6,000 at 1x = 3.5x on average
    expect(effectiveMultiplier(r, 1, 1_200_000)).toBeCloseTo(3.5, 5);
    expect(effectiveMultiplier(rule({ multiplier: 2, capCents: 100_000, capPeriod: 'QUARTER' }), 1, 800_000)).toBeCloseTo(1.5, 5);
  });

  it('a big spender prefers the uncapped card, a light spender the capped one', () => {
    const capped = card({ id: 'capped', currency: CUR.cash, rewards: [rule({ categoryId: CAT.groceries, multiplier: 6, capCents: 600_000, capPeriod: 'YEAR' }), base(1)] });
    const flat = card({ id: 'flat', currency: CUR.cash, rewards: [rule({ categoryId: CAT.groceries, multiplier: 3 }), base(1)] });
    const cards = [wc({ id: 'w1', card: capped }), wc({ id: 'w2', card: flat })];
    const light = rankCards(cards, target(CAT.groceries), { now: NOW, annualSpendCents: 300_000 });
    expect(light[0].cardId).toBe('capped');
    expect(light[0].blended).toBe(false);
    expect(light[0].cap).toEqual({ capCents: 600_000, capPeriod: 'YEAR' });
    const heavy = rankCards(cards, target(CAT.groceries), { now: NOW, annualSpendCents: 3_000_000 });
    expect(heavy[0].cardId).toBe('flat');
    const blended = heavy.find((r) => r.cardId === 'capped')!;
    expect(blended.blended).toBe(true);
    expect(blended.multiplier).toBe(6);
    expect(blended.effectiveMultiplier).toBeLessThan(6);
    expect(blended.centsPerDollar).toBeCloseTo(blended.effectiveMultiplier * blended.centsPerPoint, 1);
    // without a known spend the headline rate ranks, with the cap shown
    const unknown = rankCards(cards, target(CAT.groceries), { now: NOW });
    expect(unknown[0].cardId).toBe('capped');
    expect(unknown[0].cap).not.toBeNull();
  });

  it('finds the base rate of a card, ignoring conditional and expired rules', () => {
    const c = card({ id: 'c', rewards: [base(1.5), rule({ categoryId: CAT.fallback, multiplier: 9, conditional: true }), rule({ categoryId: CAT.fallback, multiplier: 8, endsAt: new Date('2026-01-01') })] });
    expect(baseMultiplier(wc({ id: 'w', card: c }), target(CAT.dining), NOW)).toBe(1.5);
    expect(baseMultiplier(wc({ id: 'w', card: card({ id: 'x', rewards: [] }) }), target(CAT.dining), NOW)).toBe(0);
  });
});

describe('conditional and unverified rates', () => {
  it('never ranks a card on a conditional rate (portal-only, "up to")', () => {
    const portal = card({ id: 'portal', currency: CUR.cash, rewards: [rule({ categoryId: CAT.dining, multiplier: 8, conditional: true }), base(1)] });
    const plain = card({ id: 'plain', currency: CUR.cash, rewards: [rule({ categoryId: CAT.dining, multiplier: 2 }), base(1)] });
    const ranked = rankCards([wc({ id: 'w1', card: portal }), wc({ id: 'w2', card: plain })], target(CAT.dining), { now: NOW });
    expect(ranked[0].cardId).toBe('plain');
    expect(ranked.find((r) => r.cardId === 'portal')!.multiplier).toBe(1);
  });

  it('says whether an issuer page confirmed the rate that was used', () => {
    const confirmed = card({ id: 'a', currency: CUR.cash, rewards: [rule({ categoryId: CAT.dining, multiplier: 3, verifiedAt: new Date('2026-11-26') })] });
    const guess = card({ id: 'b', currency: CUR.cash, rewards: [rule({ categoryId: CAT.dining, multiplier: 2 })] });
    const ranked = rankCards([wc({ id: 'w1', card: confirmed }), wc({ id: 'w2', card: guess })], target(CAT.dining), { now: NOW });
    expect(ranked.map((r) => [r.cardId, r.verified])).toEqual([['a', true], ['b', false]]);
  });
});

describe('category hierarchy', () => {
  it('a parent rate (travel) applies to a sub-category (airlines) but not the other way round', () => {
    const travel = card({ id: 'travel', currency: CUR.cash, rewards: [rule({ categoryId: CAT.travel, multiplier: 3 }), base(1)] });
    const airline = card({ id: 'air', currency: CUR.cash, rewards: [rule({ categoryId: CAT.airlines, multiplier: 5 }), base(1)] });
    const cards = [wc({ id: 'w1', card: travel }), wc({ id: 'w2', card: airline })];
    const forAirlines = rankCards(cards, target(CAT.airlines, { parentCategoryId: CAT.travel }), { now: NOW });
    expect(forAirlines.map((r) => [r.cardId, r.multiplier, r.matchLevel])).toEqual([['air', 5, 'CATEGORY'], ['travel', 3, 'PARENT_CATEGORY']]);
    const forTravel = rankCards(cards, target(CAT.travel, { parentCategoryId: null }), { now: NOW });
    expect(forTravel.find((r) => r.cardId === 'air')!.multiplier).toBe(1);
    expect(forTravel[0].cardId).toBe('travel');
  });
});

describe('ties', () => {
  it('on the same value the rate with the higher (or no) cap ranks first, even with a lower headline rate', () => {
    // 4x points at 1.5 cents = 6 cents, capped at $25,000 a year, against 6% cash back capped at $6,000 a year
    const gold = card({ id: 'gold', name: 'Gold', currency: { ...CUR.points, centsPerPoint: 1.5 }, rewards: [rule({ categoryId: CAT.dining, multiplier: 4, capCents: 2_500_000, capPeriod: 'YEAR' }), base(1)] });
    const cash = card({ id: 'cash', name: 'Cash', currency: CUR.cash, rewards: [rule({ categoryId: CAT.dining, multiplier: 6, capCents: 600_000, capPeriod: 'YEAR' }), base(1)] });
    const r = rankCards([wc({ id: 'w-cash', card: cash }), wc({ id: 'w-gold', card: gold })], target(CAT.dining), { now: NOW });
    expect(r.map((x) => x.name)).toEqual(['Gold', 'Cash']);
    const uncapped = card({ id: 'u', name: 'Flat', currency: CUR.cash, rewards: [rule({ categoryId: CAT.dining, multiplier: 6 }), base(1)] });
    expect(rankCards([wc({ id: 'a', card: gold }), wc({ id: 'b', card: uncapped })], target(CAT.dining), { now: NOW })[0].name).toBe('Flat');
  });
});

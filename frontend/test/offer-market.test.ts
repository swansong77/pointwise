import { describe, expect, it } from 'vitest';
import { bonusLabel, expiryLabel, MarketOffer, sortOffers, VERDICT, DIFFICULTY } from '../src/lib/offer-market';

const o = (slug: string, over: Partial<MarketOffer> = {}): MarketOffer =>
  ({ card: slug, slug, issuer: 'X', bonusType: 'POINTS', bonusAmount: 60000, minSpendCents: null, spendMonths: null, annualFeeCents: 0, valuationCents: 100, median24mCents: null, bestEverCents: 200, bestEverSince: null, percentile: null, versions: 3, daysAtCurrent: 1, daysToExpiry: null, expiresAt: null, verdict: 'TYPICAL', advice: [], difficulty: { level: 'EASY', reasons: [], rules: [] }, you: null, ...over }) as MarketOffer;

describe('offer market helpers', () => {
  it('labels bonuses and expiry', () => {
    expect(bonusLabel({ bonusType: 'POINTS', bonusAmount: 100000 })).toBe('100K points');
    expect(bonusLabel({ bonusType: 'MILES', bonusAmount: 50000 })).toBe('50K miles');
    expect(bonusLabel({ bonusType: 'CASH', bonusAmount: 30000 })).toBe('$300');
    expect(bonusLabel({ bonusType: 'NIGHTS', bonusAmount: 2 })).toBe('2 nights');
    expect(bonusLabel({ bonusType: null, bonusAmount: null })).toBe('—');
    expect(expiryLabel(null)).toBe('No end date');
    expect(expiryLabel(-1)).toBe('Expired');
    expect(expiryLabel(0)).toBe('Ends today');
    expect(expiryLabel(1)).toBe('Ends tomorrow');
    expect(expiryLabel(9)).toBe('Ends in 9 days');
  });
  it('sorts by value, expiry, your first-year value and closeness to the high', () => {
    const list = [o('a', { valuationCents: 100, daysToExpiry: 30 }), o('b', { valuationCents: 300, daysToExpiry: 5 }), o('c', { valuationCents: 200, daysToExpiry: null, bestEverCents: 200 })];
    expect(sortOffers(list, 'value').map((x) => x.slug)).toEqual(['b', 'c', 'a']);
    expect(sortOffers(list, 'expiry').map((x) => x.slug)).toEqual(['b', 'a', 'c']);
    expect(sortOffers(list, 'history').map((x) => x.slug)).toEqual(['b', 'c', 'a']);
    const you = (n: number) => ({ eligible: true, blockers: [], warnings: [], firstYearValueCents: n, longTermValueCents: 0, approvalOdds: 'LIKELY', five24: { countsToward: true, before: 0, after: 1, slotCostCents: 0 }, confidence: 0.5 });
    const mine = [o('x', { you: you(10) }), o('y', { you: you(50) }), o('z')];
    expect(sortOffers(mine, 'first-year').map((x) => x.slug)).toEqual(['y', 'x', 'z']);
  });
  it('has a label for every verdict and difficulty', () => {
    for (const v of ['BEST_EVER', 'NEAR_HIGH', 'ELEVATED', 'TYPICAL', 'BELOW_TYPICAL', 'UNKNOWN'] as const) expect(VERDICT[v].label).toBeTruthy();
    for (const d of ['EASY', 'MODERATE', 'HARD', 'BLOCKED'] as const) expect(DIFFICULTY[d].label).toBeTruthy();
  });
});

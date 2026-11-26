import { describe, expect, it } from 'vitest';
import { EMPTY_FILTERS, inventoryPath, LIFECYCLE, LIFECYCLE_ORDER, offerValueText, QUICK_FILTERS } from '../src/lib/offer-inventory';

const money = (c: number) => `$${(c / 100).toFixed(c % 100 ? 2 : 0)}`;

describe('offer inventory helpers', () => {
  it('labels all eight lifecycle states and knows which can still earn', () => {
    expect(LIFECYCLE_ORDER).toHaveLength(8);
    expect(LIFECYCLE_ORDER.filter((s) => LIFECYCLE[s].live)).toEqual(['AVAILABLE', 'ADDED', 'ACTIVATED', 'PARTIALLY_USED']);
    expect(LIFECYCLE.PARTIALLY_USED.label).toBe('Partially used');
  });
  it('builds the query string from filters and leaves unset ones out', () => {
    expect(inventoryPath(EMPTY_FILTERS)).toBe('/offers/intel/inventory/unified?sort=ENDING&page=1&pageSize=50');
    const p = inventoryPath({ ...EMPTY_FILTERS, q: ' amex hilton ', states: ['ADDED', 'ACTIVATED'], expiresWithinDays: 30, minValueCents: 5000, profileId: 'p1', sort: 'VALUE', page: 2 });
    expect(p).toContain('q=amex+hilton');
    expect(p).toContain('states=ADDED%2CACTIVATED');
    expect(p).toContain('expiresWithinDays=30');
    expect(p).toContain('minValueCents=5000');
    expect(p).toContain('profileId=p1');
    expect(p).toContain('sort=VALUE');
    expect(p).toContain('page=2');
  });
  it('has quick filters for the questions people ask', () => {
    expect(QUICK_FILTERS.map((q) => q.key)).toEqual(expect.arrayContaining(['expiring30', 'over50', 'amex', 'chase', 'hilton']));
    expect(QUICK_FILTERS.find((q) => q.key === 'expiring30')!.apply).toMatchObject({ expiresWithinDays: 30 });
  });
  it('describes an offer the way a person would say it', () => {
    expect(offerValueText({ valueCents: 10000, percent: null, points: null, minSpendCents: 50000 }, money)).toBe('$100 back on $500');
    expect(offerValueText({ valueCents: 2000, percent: 10, points: null, minSpendCents: null }, money)).toBe('10% back up to $20');
    expect(offerValueText({ valueCents: 0, percent: null, points: 5000, minSpendCents: null }, money)).toBe('5,000 points');
  });
});

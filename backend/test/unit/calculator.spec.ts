import { annualFee, calculateWalletValue, compareCandidate, validateSpend } from '../../src/domain/calculator';
import { CAT, CUR, card, rule, sampleWallet, wc } from './fixtures';

const opts = { fallbackCategoryId: CAT.fallback, now: new Date('2026-06-15T00:00:00Z') };

describe('calculator', () => {
  describe('validateSpend', () => {
    it('accepts valid lines', () => expect(() => validateSpend([{ categoryId: 'a', annualSpendCents: 0 }])).not.toThrow());
    it('rejects negative', () => expect(() => validateSpend([{ categoryId: 'a', annualSpendCents: -1 }])).toThrow(RangeError));
    it('rejects non-integer', () => expect(() => validateSpend([{ categoryId: 'a', annualSpendCents: 1.5 }])).toThrow(RangeError));
    it('rejects too large', () => expect(() => validateSpend([{ categoryId: 'a', annualSpendCents: 100_000_000_01 }])).toThrow(/maximum/));
    it('rejects duplicates', () =>
      expect(() => validateSpend([{ categoryId: 'a', annualSpendCents: 1 }, { categoryId: 'a', annualSpendCents: 2 }])).toThrow(/duplicate/));
  });

  it('annualFee uses override when present', () => {
    const w = wc({ id: 'w', card: card({ id: 'c', annualFeeCents: 9500 }) });
    expect(annualFee(w)).toBe(9500);
    expect(annualFee({ ...w, annualFeeOverrideCents: 0 })).toBe(0);
  });

  it('computes rewards per category and net value', () => {
    const res = calculateWalletValue(
      sampleWallet(),
      [
        { categoryId: CAT.dining, annualSpendCents: 600_000 }, // $6,000 × 5¢ = $300
        { categoryId: CAT.gas, annualSpendCents: 200_000 }, // $2,000 × 5¢ = $100
        { categoryId: 'cat-other', annualSpendCents: 1_000_000 }, // $10,000 × 2¢ = $200
      ],
      opts,
    );
    expect(res.categories.map((c) => c.rewardsCents)).toEqual([30_000, 10_000, 20_000]);
    expect(res.grossRewardsCents).toBe(60_000);
    expect(res.annualFeesCents).toBe(9500 + 25000);
    expect(res.netValueCents).toBe(60_000 - 34_500);
    expect(res.categories[0].bestCardName).toBe('Gold');
  });

  it('handles an empty wallet', () => {
    const res = calculateWalletValue([], [{ categoryId: CAT.dining, annualSpendCents: 100 }], opts);
    expect(res.categories[0]).toMatchObject({ bestWalletCardId: null, bestCardName: null, centsPerDollar: 0, rewardsCents: 0 });
    expect(res.netValueCents).toBe(0);
  });

  it('uses parentOf map for subcategories', () => {
    const res = calculateWalletValue(sampleWallet(), [{ categoryId: CAT.coffee, annualSpendCents: 100_000 }], {
      ...opts,
      parentOf: { [CAT.coffee]: CAT.dining },
    });
    expect(res.categories[0].bestCardName).toBe('Gold');
  });

  it('excludes non-approved card fees', () => {
    const w = sampleWallet();
    w[1].status = 'CLOSED';
    expect(calculateWalletValue(w, [], opts).annualFeesCents).toBe(9500);
  });

  describe('compareCandidate', () => {
    const groceryCard = wc({
      id: 'candidate',
      status: 'APPLIED',
      card: card({ id: 'blue', annualFeeCents: 9500, bonusPoints: 25_000, rewards: [rule({ categoryId: CAT.groceries, multiplier: 6 })] }),
    });
    it('reports incremental and first-year value', () => {
      const spend = [{ categoryId: CAT.groceries, annualSpendCents: 600_000 }];
      const res = compareCandidate(sampleWallet(), groceryCard, spend, opts);
      // groceries: current best Gold 5¢ → $300; with candidate 6¢ → $360; minus $95 fee = -$35
      expect(res.current.categories[0].rewardsCents).toBe(30_000);
      expect(res.withCandidate.categories[0].rewardsCents).toBe(36_000);
      expect(res.incrementalValueCents).toBe(6_000 - 9_500);
      expect(res.firstYearValueCents).toBe(6_000 - 9_500 + 25_000);
    });
    it('values bonus with user valuation and handles no bonus', () => {
      const miles = wc({ id: 'cand', card: card({ id: 'm', currency: CUR.miles, bonusPoints: 10_000 }) });
      const res = compareCandidate([], miles, [], { ...opts, valuations: { [CUR.miles.id]: 2 } });
      expect(res.firstYearValueCents).toBe(20_000);
      const noBonus = wc({ id: 'nb', card: card({ id: 'nb' }) });
      expect(compareCandidate([], noBonus, [], opts).firstYearValueCents).toBe(0);
    });
  });
});

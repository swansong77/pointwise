import { breakEvenSpend, cardValue, CardValueInput, rollupByHolder, sumValues } from '../../../src/domain/portfolio';

const base: CardValueInput = {
  walletCardId: 'w1',
  name: 'Premium',
  profileId: 'me',
  status: 'APPROVED',
  annualFeeCents: 69500,
  faceBenefitCents: 150000,
  realizedBenefitCents: 60000,
  missedBenefitCents: 10000,
  rewardsCents: 40000,
  spendCents: 1000000,
};

describe('cardValue', () => {
  it('computes net, effective value, return on spend and break-even', () => {
    const v = cardValue(base);
    expect(v).toMatchObject({
      netValueCents: 150000 - 69500,
      effectiveValueCents: 60000 + 40000 - 69500,
      returnOnSpend: 0.04,
      earnRate: 0.04,
    });
    // uncovered fee 9 500¢ / (4% − 1.5%) = 380 000¢
    expect(v.breakEvenSpendCents).toBe(380000);
  });
  it('uses the fallback earn rate without spend history', () => {
    const v = cardValue({ ...base, spendCents: 0, rewardsCents: 0, fallbackEarnRate: 0.03 });
    expect(v.returnOnSpend).toBeNull();
    expect(v.earnRate).toBe(0.03);
    expect(v.breakEvenSpendCents).toBe(633334);
  });
  it('no earn rate at all → break-even unknown', () => {
    expect(cardValue({ ...base, spendCents: 0, rewardsCents: 0 }).breakEvenSpendCents).toBeNull();
  });
});

describe('breakEvenSpend', () => {
  it('is 0 when realized benefits already cover the fee', () => {
    expect(breakEvenSpend(9500, 20000, 0.01)).toBe(0);
  });
  it('is null when the card earns no more than the baseline', () => {
    expect(breakEvenSpend(9500, 0, 0.015)).toBeNull();
    expect(breakEvenSpend(9500, 0, null)).toBeNull();
  });
  it('supports a custom baseline', () => {
    expect(breakEvenSpend(10000, 0, 0.03, 0.02)).toBe(1000000);
  });
});

describe('roll-ups', () => {
  const a = cardValue(base);
  const b = cardValue({ ...base, walletCardId: 'w2', annualFeeCents: 0, faceBenefitCents: 0, realizedBenefitCents: 0, missedBenefitCents: 0, rewardsCents: 20000, spendCents: 1000000 });
  const c = cardValue({ ...base, walletCardId: 'w3', profileId: 'spouse' });

  it('sums totals across cards', () => {
    const t = sumValues([a, b]);
    expect(t).toMatchObject({ annualFeeCents: 69500, rewardsCents: 60000, spendCents: 2000000, returnOnSpend: 0.03 });
    expect(sumValues([]).returnOnSpend).toBeNull();
  });
  it('groups by cardholder', () => {
    const r = rollupByHolder([a, b, c]);
    expect(r.map((x) => [x.profileId, x.cards])).toEqual([
      ['me', 2],
      ['spouse', 1],
    ]);
  });
});

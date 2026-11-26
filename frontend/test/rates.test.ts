import { describe, expect, it } from 'vitest';
import { rateNotes } from '@/lib/rates';

const base = { verified: true, cap: null, blended: false, multiplier: 3, effectiveMultiplier: 3, matchLevel: 'CATEGORY' };

describe('rate notes', () => {
  it('says nothing for a confirmed, uncapped rate or when no rule matched', () => {
    expect(rateNotes(base)).toEqual([]);
    expect(rateNotes({ ...base, verified: false, matchLevel: 'NONE' })).toEqual([]);
  });
  it('flags an unconfirmed rate and a cap', () => {
    expect(rateNotes({ ...base, verified: false })).toEqual(['Rate not confirmed by the issuer yet']);
    expect(rateNotes({ ...base, cap: { capCents: 600_000, capPeriod: 'YEAR' } })).toEqual(['Capped at $6,000 a year']);
    expect(rateNotes({ ...base, cap: { capCents: 150_000, capPeriod: 'QUARTER' } })).toEqual(['Capped at $1,500 a quarter']);
  });
  it('explains a blended rate', () => {
    expect(rateNotes({ ...base, cap: { capCents: 600_000, capPeriod: 'YEAR' }, blended: true, effectiveMultiplier: 2.4567 })).toEqual(['Blended with the base rate above $6,000 a year', '2.46x counted on your spending']);
  });
});

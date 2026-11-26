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

import { rewardBadges, stripLeadingRate } from '../src/lib/rates';
describe('wallet reward badges', () => {
  it('strips the issuer\'s own leading rate so it is not shown twice', () => {
    expect(stripLeadingRate('Unlimited 1.5x miles on all purchases')).toBe('miles on all purchases');
    expect(stripLeadingRate('1.5% cash back on all purchases')).toBe('cash back on all purchases');
    expect(stripLeadingRate('3X points at restaurants')).toBe('points at restaurants');
    expect(stripLeadingRate('2 points per $1 on travel')).toBe('on travel');
    expect(stripLeadingRate('4% on dining')).toBe('on dining');
    expect(stripLeadingRate('Cash back at gas stations')).toBe('Cash back at gas stations');
  });
  it('lists every rate, best first and the base rate last, and flags conditional ones', () => {
    const b = rewardBadges([
      { id: 'a', multiplier: '1', description: '1x on all other purchases', isRotating: false, category: { slug: 'everything-else' } },
      { id: 'b', multiplier: '5', description: '5x on travel through Chase Travel', isRotating: false, conditional: true, category: { slug: 'travel' } },
      { id: 'c', multiplier: '3', description: '3x on dining', isRotating: false, category: { slug: 'dining' } },
      { id: 'd', multiplier: '1.5', description: '1.5x on x', isRotating: true, category: { slug: 'gas' } },
    ]);
    expect(b.map((x) => x.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(b[0]).toMatchObject({ text: '5x on travel through Chase Travel', conditional: true });
    expect(b[2].rotating).toBe(true);
  });
});

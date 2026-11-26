import { describe, expect, it } from 'vitest';
import { KIND_LABEL, monthLabel } from '../src/lib/offer-dashboards';

describe('offer dashboard helpers', () => {
  it('labels months from year-month text', () => {
    expect(monthLabel('2026-11')).toBe('Nov ’26');
    expect(monthLabel('2027-01')).toBe('Jan ’27');
  });
  it('names the three kinds of expiring value', () => {
    expect(KIND_LABEL).toEqual({ OFFER: 'Offer', CREDIT: 'Credit', CERTIFICATE: 'Certificate' });
  });
});

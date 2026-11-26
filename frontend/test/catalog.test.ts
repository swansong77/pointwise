import { EVIDENCE_FROM, formatFieldValue, verificationBadge, verificationTone } from '@/lib/catalog';

describe('formatFieldValue', () => {
  it('formats money, booleans, numbers, strings and empty values', () => {
    expect(formatFieldValue('annualFeeCents', 32500)).toBe('$325');
    expect(formatFieldValue('foreignTxFee', false)).toBe('No');
    expect(formatFieldValue('foreignTxFee', true)).toBe('Yes');
    expect(formatFieldValue('bonusAmount', 90000)).toBe('90,000');
    expect(formatFieldValue('offerExpiresAt', '2027-01-15')).toBe('2027-01-15');
    expect(formatFieldValue('x', null)).toBe('—');
  });
});

describe('verificationBadge', () => {
  it('curated or researched cards are unverified until an issuer page confirms them; demo and admin cards get no badge', () => {
    expect(verificationBadge({ catalogSource: 'SEED', dataAsOf: '2026-06-01T00:00:00.000Z', lastVerifiedAt: null })).toEqual({
      label: 'Unverified · as of Jun 2026',
      tone: 'amber',
      title: expect.stringMatching(/issuer/),
    });
    expect(verificationBadge({ catalogSource: 'RESEARCH', dataAsOf: null })?.label).toBe('Unverified');
    expect(verificationBadge({ catalogSource: 'SEED', lastVerifiedAt: '2026-11-20T10:00:00.000Z' })).toMatchObject({ label: 'Verified Nov 2026', tone: 'green' });
    expect(verificationBadge({ catalogSource: 'ADMIN', lastVerifiedAt: '2026-11-20T10:00:00.000Z' })?.tone).toBe('green');
    expect(verificationBadge({ catalogSource: 'DEMO', lastVerifiedAt: '2026-11-20T10:00:00.000Z' })).toBeNull();
    expect(verificationBadge({ catalogSource: 'ADMIN' })).toBeNull();
    expect(verificationBadge({ catalogSource: 'SEED', lastVerifiedAt: '2026-11-22T00:00:00.000Z', verifiedScope: 'ISSUER_LISTING' })).toMatchObject({ label: 'On issuer site · Nov 2026', tone: 'green' });
    expect(verificationBadge({})).toBeNull();
  });
  it('research verification tones and evidence labels', () => {
    expect(verificationTone('VERIFIED')).toBe('green');
    expect(verificationTone('PARTIAL')).toBe('amber');
    expect(verificationTone('UNVERIFIED')).toBe('red');
    expect(EVIDENCE_FROM.AGENT).toMatch(/agent/);
  });
});

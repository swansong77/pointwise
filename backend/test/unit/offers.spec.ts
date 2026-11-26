import {
  OfferLike,
  OfferRuleError,
  UserOfferLike,
  applyUsage,
  daysLeft,
  effectiveStatus,
  isExpired,
  isExpiringSoon,
  isSnoozed,
  isStarted,
  matchesAlert,
  remainingCents,
  snooze,
  sortOffers,
} from '../../src/domain/offers';

const NOW = new Date('2026-06-15T12:00:00Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const offer = (o: Partial<OfferLike> = {}): OfferLike => ({ kind: 'CASH', valueCents: 1000, startsAt: null, endsAt: inDays(10), isRepeatable: false, maxTimes: null, ...o });
const uo = (u: Partial<UserOfferLike> = {}): UserOfferLike => ({ status: 'ACTIVE', amountUsedCents: 0, timesUsed: 0, snoozedUntil: null, redeemedAt: null, ...u });

describe('offer rules', () => {
  it('expiry / start / snooze predicates', () => {
    expect(isExpired(offer({ endsAt: inDays(-1) }), NOW)).toBe(true);
    expect(isExpired(offer({ endsAt: null }), NOW)).toBe(false);
    expect(isStarted(offer({ startsAt: inDays(1) }), NOW)).toBe(false);
    expect(isStarted(offer({ startsAt: null }), NOW)).toBe(true);
    expect(isSnoozed(uo({ snoozedUntil: inDays(1) }), NOW)).toBe(true);
    expect(isSnoozed(uo({ snoozedUntil: inDays(-1) }), NOW)).toBe(false);
  });

  it('effectiveStatus', () => {
    expect(effectiveStatus(offer(), uo(), NOW)).toBe('ACTIVE');
    expect(effectiveStatus(offer({ endsAt: inDays(-1) }), uo(), NOW)).toBe('EXPIRED');
    expect(effectiveStatus(offer({ endsAt: inDays(-1) }), uo({ status: 'REDEEMED' }), NOW)).toBe('REDEEMED');
  });

  it('remainingCents', () => {
    expect(remainingCents(offer(), uo({ amountUsedCents: 300 }))).toBe(700);
    expect(remainingCents(offer(), uo({ amountUsedCents: 3000 }))).toBe(0);
    expect(remainingCents(offer({ kind: 'POINTS' }), uo())).toBe(0);
  });

  it('daysLeft', () => {
    expect(daysLeft(offer({ endsAt: null }), NOW)).toBeNull();
    expect(daysLeft(offer({ endsAt: inDays(2.5) }), NOW)).toBe(3);
  });

  describe('isExpiringSoon', () => {
    it('true within window', () => expect(isExpiringSoon(offer({ endsAt: inDays(3) }), uo(), NOW, 7)).toBe(true));
    it('boundary: exactly N days', () => expect(isExpiringSoon(offer({ endsAt: inDays(7) }), uo(), NOW, 7)).toBe(true));
    it('false outside window', () => expect(isExpiringSoon(offer({ endsAt: inDays(8) }), uo(), NOW, 7)).toBe(false));
    it('false when redeemed, snoozed, expired or open-ended', () => {
      expect(isExpiringSoon(offer({ endsAt: inDays(3) }), uo({ status: 'REDEEMED' }), NOW, 7)).toBe(false);
      expect(isExpiringSoon(offer({ endsAt: inDays(3) }), uo({ snoozedUntil: inDays(1) }), NOW, 7)).toBe(false);
      expect(isExpiringSoon(offer({ endsAt: inDays(-1) }), uo(), NOW, 7)).toBe(false);
      expect(isExpiringSoon(offer({ endsAt: null }), uo(), NOW, 7)).toBe(false);
    });
  });

  describe('applyUsage', () => {
    it('records partial usage', () => {
      expect(applyUsage(offer(), uo(), { amountUsedCents: 400 }, NOW)).toMatchObject({ status: 'ACTIVE', amountUsedCents: 400 });
    });
    it('auto-redeems when fully used', () => {
      expect(applyUsage(offer(), uo(), { amountUsedCents: 1000 }, NOW)).toMatchObject({ status: 'REDEEMED', redeemedAt: NOW });
    });
    it('rejects over-use, negative and fractional amounts', () => {
      expect(() => applyUsage(offer(), uo(), { amountUsedCents: 1001 }, NOW)).toThrow(OfferRuleError);
      expect(() => applyUsage(offer(), uo(), { amountUsedCents: -1 }, NOW)).toThrow(/non-negative/);
      expect(() => applyUsage(offer(), uo(), { amountUsedCents: 1.5 }, NOW)).toThrow(/integer/);
    });
    it('points offers allow any amount and do not auto-redeem', () => {
      expect(applyUsage(offer({ kind: 'POINTS' }), uo(), { amountUsedCents: 99999 }, NOW).status).toBe('ACTIVE');
    });
    it('zero-value cash offers do not auto-redeem', () => {
      expect(applyUsage(offer({ valueCents: 0 }), uo(), { amountUsedCents: 5 }, NOW).status).toBe('ACTIVE');
    });
    it('enforces maxTimes on repeatable offers and completes at max', () => {
      const rep = offer({ isRepeatable: true, maxTimes: 3, valueCents: 500 });
      expect(applyUsage(rep, uo(), { timesUsed: 2 }, NOW).status).toBe('ACTIVE');
      expect(applyUsage(rep, uo(), { timesUsed: 3 }, NOW).status).toBe('REDEEMED');
      expect(() => applyUsage(rep, uo(), { timesUsed: 4 }, NOW)).toThrow(/cannot exceed 3/);
    });
    it('unlimited repeatable offers accept large counts', () => {
      expect(applyUsage(offer({ isRepeatable: true, maxTimes: null }), uo(), { timesUsed: 50 }, NOW).timesUsed).toBe(50);
    });
    it('non-repeatable offers allow at most one use', () => {
      expect(() => applyUsage(offer(), uo(), { timesUsed: 2 }, NOW)).toThrow(/cannot exceed 1/);
      expect(() => applyUsage(offer(), uo(), { timesUsed: -1 }, NOW)).toThrow(/non-negative/);
    });
    it('redeem / unredeem toggles', () => {
      const r = applyUsage(offer(), uo(), { redeemed: true }, NOW);
      expect(r).toMatchObject({ status: 'REDEEMED', timesUsed: 1, redeemedAt: NOW });
      const keepDate = applyUsage(offer(), uo({ redeemedAt: inDays(-2), timesUsed: 1 }), { redeemed: true }, NOW);
      expect(keepDate.redeemedAt).toEqual(inDays(-2));
      expect(applyUsage(offer({ isRepeatable: true, maxTimes: 5 }), uo(), { redeemed: true }, NOW).timesUsed).toBe(0);
      expect(applyUsage(offer(), r, { redeemed: false }, NOW)).toMatchObject({ status: 'ACTIVE', redeemedAt: null });
    });
    it('cannot redeem before start', () => {
      expect(() => applyUsage(offer({ startsAt: inDays(1) }), uo(), { redeemed: true }, NOW)).toThrow(/not started/);
    });
    it('cannot change an expired offer unless already redeemed', () => {
      expect(() => applyUsage(offer({ endsAt: inDays(-1) }), uo(), { amountUsedCents: 1 }, NOW)).toThrow(/expired/);
      expect(applyUsage(offer({ endsAt: inDays(-1) }), uo({ status: 'REDEEMED' }), { redeemed: false }, NOW).status).toBe('ACTIVE');
    });
  });

  describe('snooze', () => {
    it('sets snooze in the future', () => expect(snooze(uo(), inDays(3), NOW).snoozedUntil).toEqual(inDays(3)));
    it('rejects past and > 1 year', () => {
      expect(() => snooze(uo(), inDays(-1), NOW)).toThrow(/future/);
      expect(() => snooze(uo(), inDays(400), NOW)).toThrow(/year/);
    });
  });

  describe('sortOffers', () => {
    const items = [
      { title: 'B', endsAt: inDays(5), valueCents: 500, addedAt: inDays(-1), isFavorite: false },
      { title: 'A', endsAt: null, valueCents: 2000, addedAt: inDays(-3), isFavorite: false },
      { title: 'C', endsAt: inDays(1), valueCents: 100, addedAt: inDays(-2), isFavorite: true },
      { title: 'D', endsAt: inDays(5), valueCents: 500, addedAt: inDays(0), isFavorite: false },
    ];
    it('endDate (default): favorites first, open-ended last, ties by title', () =>
      expect(sortOffers(items).map((i) => i.title)).toEqual(['C', 'B', 'D', 'A']));
    it('value', () => expect(sortOffers(items, 'value').map((i) => i.title)).toEqual(['C', 'A', 'B', 'D']));
    it('addedDate', () => expect(sortOffers(items, 'addedDate').map((i) => i.title)).toEqual(['C', 'D', 'B', 'A']));
    it('alphabetical', () => expect(sortOffers(items, 'alphabetical').map((i) => i.title)).toEqual(['C', 'A', 'B', 'D']));
    it('does not mutate input', () => {
      const copy = [...items];
      sortOffers(items, 'value');
      expect(items).toEqual(copy);
    });
  });

  describe('matchesAlert', () => {
    const o = { title: 'Coffee: 20% back', description: 'At Bean Street', valueCents: 800, issuerId: 'iss-1' };
    it('keyword match (case-insensitive, description too)', () => {
      expect(matchesAlert(o, { keywords: ['COFFEE'], issuerIds: [] })).toBe(true);
      expect(matchesAlert(o, { keywords: ['bean street'], issuerIds: [] })).toBe(true);
      expect(matchesAlert(o, { keywords: ['hotel'], issuerIds: [] })).toBe(false);
      expect(matchesAlert(o, { keywords: ['  '], issuerIds: [] })).toBe(false);
    });
    it('empty keyword list matches everything', () => expect(matchesAlert(o, { keywords: [], issuerIds: [] })).toBe(true));
    it('minimum value', () => {
      expect(matchesAlert(o, { keywords: [], minValueCents: 1000, issuerIds: [] })).toBe(false);
      expect(matchesAlert(o, { keywords: [], minValueCents: 800, issuerIds: [] })).toBe(true);
    });
    it('issuer filter', () => {
      expect(matchesAlert(o, { keywords: [], issuerIds: ['iss-2'] })).toBe(false);
      expect(matchesAlert(o, { keywords: [], issuerIds: ['iss-1'] })).toBe(true);
      expect(matchesAlert({ ...o, issuerId: null }, { keywords: [], issuerIds: ['iss-1'] })).toBe(false);
      expect(matchesAlert({ title: 'x', valueCents: 1 }, { keywords: ['x'], issuerIds: [] })).toBe(true);
    });
  });
});

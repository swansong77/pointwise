import { expectedSavingsCents, InventoryRow, lifecycleState, matchesQuery, sortRows, summarize } from '../../../src/domain/offer-lifecycle';

const NOW = new Date('2026-12-01T12:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const uo = (o: Partial<{ status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED'; amountUsedCents: number; timesUsed: number; activationStatus: 'NOT_REQUIRED' | 'PENDING' | 'ACTIVATED' | 'FAILED' }> = {}) => ({
  status: 'ACTIVE' as const,
  amountUsedCents: 0,
  timesUsed: 0,
  activationStatus: 'PENDING' as const,
  ...o,
});
const offer = (o: Partial<{ endsAt: Date | null; enrollmentRequired: boolean }> = {}) => ({ endsAt: d('2027-01-15'), enrollmentRequired: true, ...o });

describe('TC-LIFE: one lifecycle for every offer', () => {
  it('maps a card offer through added, activated, partly used and redeemed', () => {
    expect(lifecycleState({ offer: offer(), userOffer: uo() }, NOW)).toBe('ADDED');
    expect(lifecycleState({ offer: offer(), userOffer: uo({ activationStatus: 'ACTIVATED' }) }, NOW)).toBe('ACTIVATED');
    expect(lifecycleState({ offer: offer({ enrollmentRequired: false }), userOffer: uo({ activationStatus: 'NOT_REQUIRED' }) }, NOW)).toBe('ACTIVATED');
    expect(lifecycleState({ offer: offer(), userOffer: uo({ activationStatus: 'ACTIVATED', amountUsedCents: 2500 }) }, NOW)).toBe('PARTIALLY_USED');
    expect(lifecycleState({ offer: offer(), userOffer: uo({ activationStatus: 'ACTIVATED', timesUsed: 1 }) }, NOW)).toBe('PARTIALLY_USED');
    expect(lifecycleState({ offer: offer(), userOffer: uo({ status: 'REDEEMED', amountUsedCents: 10000 }) }, NOW)).toBe('REDEEMED');
  });
  it('an offer past its end date is expired, unless it was redeemed first', () => {
    expect(lifecycleState({ offer: offer({ endsAt: d('2026-11-30') }), userOffer: uo({ activationStatus: 'ACTIVATED' }) }, NOW)).toBe('EXPIRED');
    expect(lifecycleState({ offer: offer(), userOffer: uo({ status: 'EXPIRED' }) }, NOW)).toBe('EXPIRED');
    expect(lifecycleState({ offer: offer({ endsAt: d('2026-11-30') }), userOffer: uo({ status: 'REDEEMED' }) }, NOW)).toBe('REDEEMED');
  });
  it('a failed activation is rejected', () => {
    expect(lifecycleState({ offer: offer(), userOffer: uo({ activationStatus: 'FAILED' }) }, NOW)).toBe('REJECTED');
  });
  it('an offer found by a sync but not on a card yet is available, rejected or removed', () => {
    const snap = (status: 'AVAILABLE' | 'ENROLLED' | 'REDEEMED' | 'EXPIRED' | 'REMOVED', decision = 'NEW') => lifecycleState({ offer: offer(), snapshot: { status, decision } }, NOW);
    expect(snap('AVAILABLE')).toBe('AVAILABLE');
    expect(snap('AVAILABLE', 'RECOMMENDED')).toBe('AVAILABLE');
    expect(snap('AVAILABLE', 'IGNORED')).toBe('REJECTED');
    expect(snap('AVAILABLE', 'AUTO_ENROLLED')).toBe('ADDED');
    expect(snap('ENROLLED')).toBe('ADDED');
    expect(snap('REMOVED')).toBe('REMOVED');
    expect(snap('REDEEMED')).toBe('REDEEMED');
    expect(lifecycleState({ offer: offer({ endsAt: d('2026-01-01') }), snapshot: { status: 'AVAILABLE', decision: 'NEW' } }, NOW)).toBe('EXPIRED');
  });
  it('an offer with no row at all is available until it ends', () => {
    expect(lifecycleState({ offer: offer() }, NOW)).toBe('AVAILABLE');
    expect(lifecycleState({ offer: offer({ endsAt: d('2026-01-01') }) }, NOW)).toBe('EXPIRED');
  });
});

describe('TC-LIFE: expected savings', () => {
  it('scales the value by the source confidence and is zero once the offer cannot earn', () => {
    const live = expectedSavingsCents({ state: 'ADDED', valueCents: 10000, source: 'ISSUER_OFFICIAL', verification: 'VERIFIED' });
    const weak = expectedSavingsCents({ state: 'ADDED', valueCents: 10000, source: 'USER_ENTERED', verification: 'UNVERIFIED' });
    expect(live).toBeGreaterThan(weak);
    expect(live).toBeLessThanOrEqual(10000);
    for (const state of ['REDEEMED', 'EXPIRED', 'REMOVED', 'REJECTED'] as const) expect(expectedSavingsCents({ state, valueCents: 10000, source: 'ISSUER_OFFICIAL', verification: 'VERIFIED' })).toBe(0);
  });
});

const row = (o: Partial<InventoryRow>): InventoryRow => ({
  id: 'r',
  origin: 'USER_OFFER',
  offerId: 'o',
  title: 'Spend $500, get $100 back',
  merchant: { id: 'm1', name: 'Hilton', slug: 'hilton' },
  merchantText: 'Hilton',
  categoryId: 'travel',
  categoryName: 'Travel',
  walletCardId: 'w1',
  card: 'American Express Platinum Card',
  issuer: 'American Express',
  profileId: 'p1',
  cardholder: 'Alex',
  offerType: 'SPEND_GET',
  valueCents: 10000,
  percent: null,
  points: null,
  minSpendCents: 50000,
  endsAt: d('2027-01-15'),
  daysLeft: 45,
  state: 'ADDED',
  enrollmentRequired: true,
  activationStatus: 'PENDING',
  addedAt: d('2026-11-01'),
  activatedAt: null,
  redeemedAt: null,
  actualSavingsCents: 0,
  expectedSavingsCents: 9000,
  source: 'ACCOUNT_DATA',
  reliability: 90,
  verification: 'UNVERIFIED',
  lastVerified: d('2026-11-30'),
  ...o,
});

describe('TC-LIFE: inventory search and filters', () => {
  const rows = [
    row({ id: 'a' }),
    row({ id: 'b', merchant: { id: 'm2', name: 'Marriott', slug: 'marriott' }, merchantText: 'Marriott', issuer: 'Chase', card: 'Chase Sapphire Reserve', cardholder: 'Riley', profileId: 'p2', walletCardId: 'w2', valueCents: 2500, expectedSavingsCents: 2000, endsAt: d('2026-12-20') }),
    row({ id: 'c', state: 'EXPIRED', expectedSavingsCents: 0, endsAt: d('2026-11-01') }),
  ];
  const ids = (q: Parameters<typeof matchesQuery>[1]) => rows.filter((r) => matchesQuery(r, q, NOW)).map((r) => r.id);
  it('finds offers by merchant, issuer and cardholder, all words required', () => {
    expect(ids({ q: 'hilton' })).toEqual(['a', 'c']);
    expect(ids({ q: 'amex hilton' })).toEqual(['a', 'c']); // "amex" is read as American Express
    expect(ids({ q: 'american express hilton' })).toEqual(['a', 'c']);
    expect(ids({ q: 'chase' })).toEqual(['b']);
    expect(ids({ q: 'riley' })).toEqual(['b']);
  });
  it('filters by card, member, state, value and the expiry window', () => {
    expect(ids({ walletCardId: 'w2' })).toEqual(['b']);
    expect(ids({ profileId: 'p1' })).toEqual(['a', 'c']);
    expect(ids({ states: ['EXPIRED'] })).toEqual(['c']);
    expect(ids({ minValueCents: 5000 })).toEqual(['a', 'c']);
    expect(ids({ expiresWithinDays: 30 })).toEqual(['b']); // c has already ended, a is 45 days out
    expect(ids({ expiresWithinDays: 60 })).toEqual(['a', 'b']);
  });
  it('sorts by ending date, value or expected savings with a stable tie-break', () => {
    expect(sortRows(rows).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(sortRows(rows, 'VALUE').map((r) => r.id)).toEqual(['a', 'c', 'b']);
    expect(sortRows(rows, 'EXPECTED').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
  it('summarises live offers, expiring ones and expected versus actual savings', () => {
    const s = summarize(rows, NOW);
    expect(s).toMatchObject({ total: 3, live: 2, expiringSoon: 1, expectedCents: 11000, actualCents: 0 });
    expect(s.byState).toMatchObject({ ADDED: 2, EXPIRED: 1, REDEEMED: 0 });
  });
});

import { bucketExpirations, ExpiringItem } from '../../../src/domain/expiration-buckets';
import { householdOffers } from '../../../src/domain/household-offers';
import { InventoryRow } from '../../../src/domain/offer-lifecycle';
import { summarizeSavings } from '../../../src/domain/savings-summary';

const NOW = new Date('2026-12-01T12:00:00Z');
const d = (s: string) => new Date(`${s}T00:00:00Z`);

const item = (o: Partial<ExpiringItem>): ExpiringItem => ({ kind: 'OFFER', id: 'i', label: 'Offer', cardholder: 'Alex', card: 'Amex Platinum', walletCardId: 'w1', merchant: 'Hilton', endsAt: d('2026-12-05'), valueCents: 10_000, action: 'Use it', ...o });

describe('TC-EXP: expiration buckets', () => {
  const items = [
    item({ id: 'a', label: 'Hilton offer', endsAt: d('2026-12-05'), valueCents: 10_000 }),
    item({ id: 'b', kind: 'CREDIT', label: 'Travel credit', endsAt: d('2026-12-10'), valueCents: 30_000 }),
    item({ id: 'c', kind: 'CERTIFICATE', label: 'Free night', endsAt: d('2026-12-25'), valueCents: 25_000 }),
    item({ id: 'd', label: 'Far offer', endsAt: d('2027-01-20'), valueCents: 5_000 }),
    item({ id: 'e', label: 'Beyond', endsAt: d('2027-06-01'), valueCents: 9_999 }),
    item({ id: 'f', label: 'Gone', endsAt: d('2026-11-20'), valueCents: 8_000 }),
    item({ id: 'g', label: 'Worthless', endsAt: d('2026-12-03'), valueCents: 0 }),
  ];
  const s = bucketExpirations(items, NOW);
  it('sorts items into this week, next week, 30 days and 60 days, soonest first', () => {
    expect(s.buckets.map((b) => [b.key, b.items.map((i) => i.id)])).toEqual([
      ['WEEK', ['a']],
      ['TWO_WEEKS', ['b']],
      ['MONTH', ['c']],
      ['TWO_MONTHS', ['d']],
    ]);
    expect(s.buckets[0].items[0].daysLeft).toBe(4);
  });
  it('leaves out what has lapsed, is worth nothing or is beyond the last bucket, and totals the rest', () => {
    expect(s.count).toBe(4);
    expect(s.totalCents).toBe(10_000 + 30_000 + 25_000 + 5_000);
    expect(s.urgentCents).toBe(10_000);
    expect(s.byKind).toEqual({ OFFER: { count: 2, cents: 15_000 }, CREDIT: { count: 1, cents: 30_000 }, CERTIFICATE: { count: 1, cents: 25_000 } });
    expect(s.nextDeadline!.id).toBe('a');
  });
  it('an item that ends today is still counted, and an empty list is safe', () => {
    expect(bucketExpirations([item({ id: 'x', endsAt: d('2026-12-01') })], NOW).buckets[0].items[0].daysLeft).toBe(0);
    expect(bucketExpirations([], NOW)).toMatchObject({ count: 0, totalCents: 0, nextDeadline: null });
  });
});

const row = (o: Partial<InventoryRow>): InventoryRow => ({
  id: 'r',
  origin: 'USER_OFFER',
  offerId: 'o',
  title: 'Spend $500, get $100 back',
  merchant: { id: 'hilton', name: 'Hilton', slug: 'hilton' },
  merchantText: 'Hilton',
  categoryId: 'travel',
  categoryName: 'Travel',
  walletCardId: 'w1',
  card: 'Amex Platinum',
  issuer: 'American Express',
  profileId: 'p1',
  cardholder: 'Alex',
  offerType: 'SPEND_GET',
  valueCents: 10_000,
  percent: null,
  points: null,
  minSpendCents: 50_000,
  endsAt: d('2026-12-20'),
  daysLeft: 19,
  state: 'ACTIVATED',
  enrollmentRequired: true,
  activationStatus: 'ACTIVATED',
  addedAt: d('2026-11-01'),
  activatedAt: d('2026-11-02'),
  redeemedAt: null,
  actualSavingsCents: 0,
  expectedSavingsCents: 9_000,
  source: 'ACCOUNT_DATA',
  reliability: 90,
  verification: 'UNVERIFIED',
  lastVerified: d('2026-11-30'),
  ...o,
});

describe('TC-SAVE: savings summary', () => {
  const rows = [
    row({ id: '1', actualSavingsCents: 10_000, state: 'REDEEMED', redeemedAt: d('2026-11-15'), expectedSavingsCents: 0 }),
    row({ id: '2', merchant: { id: 'uber', name: 'Uber Eats', slug: 'uber-eats' }, merchantText: 'Uber Eats', walletCardId: 'w2', card: 'Sapphire', profileId: 'p2', cardholder: 'Riley', valueCents: 2_000, expectedSavingsCents: 1_800 }),
    row({ id: '3', state: 'EXPIRED', expectedSavingsCents: 0, actualSavingsCents: 0 }),
    row({ id: '4', actualSavingsCents: 4_000, state: 'PARTIALLY_USED', redeemedAt: null, activatedAt: d('2026-10-03'), walletCardId: 'w2', card: 'Sapphire', profileId: 'p2', cardholder: 'Riley', expectedSavingsCents: 5_000 }),
  ];
  const credits = [{ walletCardId: 'w1', card: 'Amex Platinum', cardholder: 'Alex', profileId: 'p1', usedThisYearCents: 20_000 }];
  const s = summarizeSavings(rows, [{ status: 'DONE', expectedCents: 20_000, actualCents: 25_000 }, { status: 'DONE', expectedCents: 10_000, actualCents: 4_000 }, { status: 'PLANNED', expectedCents: 5_000, actualCents: null }], credits, 7_500, NOW);
  it('totals what was received, what is still expected, what was missed and credits used this year', () => {
    expect(s.totals).toEqual({ actualCents: 14_000, expectedCents: 1_800 + 5_000, missedCents: 7_500, creditsThisYearCents: 20_000, savedCents: 34_000 });
  });
  it('breaks savings down by card, member and merchant, with credits on their card and member', () => {
    expect(s.byCard.find((c) => c.key === 'w1')).toMatchObject({ actualCents: 10_000 + 20_000, expectedCents: 0 });
    expect(s.byCard.find((c) => c.key === 'w2')).toMatchObject({ actualCents: 4_000, expectedCents: 6_800 });
    expect(s.byMember.map((m) => [m.label, m.actualCents])).toEqual([['Alex', 30_000], ['Riley', 4_000]]);
    expect(s.byMerchant[0].label).toBe('Hilton');
    expect(s.byMerchant.find((m) => m.label === 'Uber Eats')).toMatchObject({ actualCents: 0, expectedCents: 1_800 });
  });
  it('charts the last twelve months, oldest first, with empty months present', () => {
    expect(s.byMonth).toHaveLength(12);
    expect(s.byMonth[0].month).toBe('2026-01');
    expect(s.byMonth[11].month).toBe('2026-12');
    expect(s.byMonth.find((m) => m.month === '2026-11')!.actualCents).toBe(10_000);
    expect(s.byMonth.find((m) => m.month === '2026-10')!.actualCents).toBe(4_000);
    expect(s.byMonth.find((m) => m.month === '2026-03')!.actualCents).toBe(0);
  });
  it('compares what finished plans expected with what they returned', () => {
    expect(s.plans).toEqual({ done: 2, expectedCents: 30_000, actualCents: 29_000, metCount: 1, hitRate: 50 });
    expect(summarizeSavings([], [], [], 0, NOW).plans.hitRate).toBeNull();
  });
});

describe('TC-HOUSE-OFFERS: household optimization', () => {
  const members = [
    { id: 'p1', nickname: 'Alex', isPrimary: true },
    { id: 'p2', nickname: 'Riley', isPrimary: false },
    { id: 'p3', nickname: 'Sam', isPrimary: false },
  ];
  const rows = [
    row({ id: '1' }), // Alex: Hilton $100, 9,000 expected
    row({ id: '2', walletCardId: 'w2', card: 'Sapphire', profileId: 'p2', cardholder: 'Riley', expectedSavingsCents: 7_000 }), // the same offer on Riley's card
    row({ id: '3', merchant: { id: 'uber', name: 'Uber Eats', slug: 'uber-eats' }, merchantText: 'Uber Eats', valueCents: 2_000, expectedSavingsCents: 1_800, endsAt: d('2026-12-10') }),
    row({ id: '4', state: 'EXPIRED', expectedSavingsCents: 0, merchant: { id: 'old', name: 'Old', slug: 'old' }, merchantText: 'Old' }),
    row({ id: '5', walletCardId: 'w3', card: 'Kid card', profileId: 'p3', cardholder: 'Sam', state: 'REDEEMED', actualSavingsCents: 1_000, expectedSavingsCents: 0 }),
  ];
  const h = householdOffers(rows, members, NOW);
  it('summarises each member: cards, live offers, expected value, expiring soon and received', () => {
    const alex = h.members.find((m) => m.member === 'Alex')!;
    expect(alex).toMatchObject({ cards: 1, liveOffers: 2, expectedCents: 10_800, expiringSoon: 2, receivedCents: 0 });
    expect(alex.top[0]).toMatchObject({ merchant: 'Hilton', expectedCents: 9_000 });
    expect(h.members.find((m) => m.member === 'Sam')).toMatchObject({ liveOffers: 0, receivedCents: 1_000 });
    expect(h.totals).toEqual({ liveOffers: 3, expectedCents: 9_000 + 7_000 + 1_800 });
  });
  it('finds the same offer on several cards and says how to use it', () => {
    expect(h.overlaps).toHaveLength(1);
    expect(h.overlaps[0]).toMatchObject({ merchant: 'Hilton', valueCents: 10_000 });
    expect(h.overlaps[0].holders.map((x) => x.member)).toEqual(['Alex', 'Riley']);
    expect(h.overlaps[0].advice).toMatch(/same Hilton offer is on 2 cards \(Alex, Riley\).*\$500 on each/);
  });
  it('names who should pay at each merchant and who has no offer there', () => {
    const hilton = h.routing.find((r) => r.merchant === 'Hilton')!;
    expect(hilton.best.member).toBe('Alex');
    expect(hilton.membersWithout).toEqual(['Sam']);
    expect(hilton.advice).toMatch(/Alex should pay at Hilton.*Sam has no offer there/);
    expect(h.routing.map((r) => r.merchant)).not.toContain('Old'); // expired offers are not routed to
    expect(h.routing[0].merchant).toBe('Hilton');
  });
  it('is safe with no offers', () => {
    expect(householdOffers([], members, NOW)).toMatchObject({ overlaps: [], routing: [], totals: { liveOffers: 0, expectedCents: 0 } });
  });
});

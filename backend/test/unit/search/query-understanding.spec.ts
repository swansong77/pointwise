import { Dictionaries, Intent, parseQuantities, parseWindow, understand } from '../../../src/domain/query-understanding';
import { MerchantIdentity } from '../../../src/domain/merchant-resolve';
import { MERCHANT_IDENTITIES } from '../../../src/seed/merchant-identities';

const NOW = new Date('2026-11-26T15:00:00Z');
const merchants: MerchantIdentity[] = MERCHANT_IDENTITIES.map((i, n) => ({ id: `m${n}`, slug: i.slug, name: i.name, hosts: i.hosts, aliases: i.aliases, mcc: i.mcc, parentCompany: i.parent }));

const dict: Dictionaries = {
  merchants,
  cards: [
    { id: 'c1', name: 'American Express Platinum Card', walletCardId: 'w1' },
    { id: 'c2', name: 'American Express Gold Card', walletCardId: 'w2' },
    { id: 'c3', name: 'Capital One Venture X Rewards Credit Card', walletCardId: 'w3' },
    { id: 'c3b', name: 'Capital One Venture Rewards Credit Card', walletCardId: null },
    { id: 'c4', name: 'Chase Sapphire Reserve', walletCardId: 'w4' },
    { id: 'c5', name: 'Chase Sapphire Preferred', walletCardId: null },
    { id: 'c6', name: 'Citi Strata Premier Card', walletCardId: 'w6' },
  ],
  members: [
    { id: 'p1', nickname: 'Alex', relationship: 'SELF' },
    { id: 'p2', nickname: 'Riley', relationship: 'SPOUSE' },
    { id: 'p3', nickname: 'Sam', relationship: 'CHILD' },
  ],
  programs: [
    { id: 'pr1', name: 'World of Hyatt', kind: 'HOTEL' },
    { id: 'pr2', name: 'Hilton Honors', kind: 'HOTEL' },
    { id: 'pr3', name: 'United MileagePlus', kind: 'AIRLINE' },
  ],
};
const u = (q: string) => understand(q, dict, NOW);

describe('TC-QU: quantities', () => {
  it.each([
    ['What card should I use at Costco for $1,500?', 150_000],
    ['Costco $1500', 150_000],
    ['Costco electronics $2,500', 250_000],
    ['Home Depot project $5,000', 500_000],
    ['$2.5k laptop', 250_000],
    ['Hilton stay $1200', 120_000],
    ['a 1200 dollar stay', 120_000],
    ['Hilton stay 1200', 120_000],
  ])('%s → %d cents', (q, cents) => {
    expect(parseQuantities(q).amountCents).toBe(cents);
  });
  it('reads nights and points apart from dollars, and never reads a year, 5/24 or a count as money', () => {
    expect(parseQuantities('Hilton Chicago 3 nights')).toMatchObject({ nights: 3, amountCents: null });
    expect(parseQuantities('transfer 50,000 points to Hyatt')).toMatchObject({ points: 50_000, amountCents: null });
    expect(parseQuantities('60k miles').points).toBe(60_000);
    expect(parseQuantities('What is my 5/24 status?').amountCents).toBeNull();
    expect(parseQuantities('cards opened in the last 24 months').amountCents).toBeNull();
    expect(parseQuantities('trip in 2027').amountCents).toBeNull();
  });
});

describe('TC-QU: dates', () => {
  it('reads relative windows', () => {
    expect(parseWindow('what expires this month', NOW).window).toMatchObject({ label: 'this month', days: 4 }); // Nov 26 to Nov 30
    expect(parseWindow('offers expiring in 30 days', NOW).window).toMatchObject({ label: 'next 30 days', days: 30 });
    expect(parseWindow('within 2 weeks', NOW).window!.days).toBe(14);
    expect(parseWindow('next month', NOW).window!.from.toISOString().slice(0, 10)).toBe('2026-12-01');
    expect(parseWindow('tomorrow', NOW).window).toMatchObject({ single: true, days: 1 });
  });
  it('reads months and dates, rolling to next year when the month has passed', () => {
    const jan = parseWindow('a trip in January', NOW).window!;
    expect(jan.from.toISOString().slice(0, 10)).toBe('2027-01-01');
    expect(jan.to.toISOString().slice(0, 10)).toBe('2027-01-31');
    expect(parseWindow('book for December 15', NOW).window).toMatchObject({ single: true });
    expect(parseWindow('2027-02-10', NOW).window!.from.toISOString().slice(0, 10)).toBe('2027-02-10');
  });
  it('does not read 5/24 or the verb "may" as a date', () => {
    expect(parseWindow('What is my 5/24 status', NOW).window).toBeNull();
    expect(parseWindow('what may I use', NOW).window).toBeNull();
  });
});

const CASES: Array<[query: string, intent: Intent, check?: (x: ReturnType<typeof u>) => void]> = [
  // shopping
  ['What card should I use at Costco?', 'SHOPPING', (x) => expect(x.entities.merchants[0].name).toBe('Costco')],
  ['What card should I use at Costco for $1,500?', 'SHOPPING', (x) => expect([x.entities.merchants[0].name, x.entities.amountCents]).toEqual(['Costco', 150_000])],
  ['Costco $1500', 'SHOPPING'],
  ['Costco electronics $2,500', 'SHOPPING', (x) => expect(x.entities.item).toBe('costco electronics')],
  ['Home Depot project $5,000', 'SHOPPING', (x) => expect(x.entities.merchants[0].name).toBe('The Home Depot')],
  ['MacBook Pro M5', 'SHOPPING', (x) => expect(x.entities.item).toBe('macbook pro m5')],
  ['Best card for a Disney vacation.', 'SHOPPING', (x) => expect(x.entities.merchants[0].name).toBe('Disney')],
  ['Best card?', 'SHOPPING', (x) => expect(x.missing).toContain('merchant or item')],
  ['Disney tickets', 'SHOPPING'],
  // travel
  ['I am staying at Hilton for 3 nights.', 'TRAVEL', (x) => expect([x.entities.hotels, x.entities.nights]).toEqual([['Hilton'], 3])],
  ['Hilton stay $1200', 'TRAVEL', (x) => expect([x.entities.merchants[0].name, x.entities.amountCents]).toEqual(['Hilton', 120_000])],
  ['Hilton Chicago 3 nights', 'TRAVEL', (x) => expect([x.entities.destination, x.entities.nights]).toEqual(['Chicago', 3])],
  ['Flight to Hawaii', 'TRAVEL', (x) => expect(x.entities.destination).toBe('Hawaii')],
  ['Business class to Seoul', 'TRAVEL', (x) => expect([x.entities.cabin, x.entities.destination]).toEqual(['BUSINESS', 'Seoul'])],
  ['Hyatt vacation', 'TRAVEL', (x) => expect(x.entities.hotels).toEqual(['Hyatt'])],
  ['My son needs a flight to New York', 'TRAVEL', (x) => expect([x.entities.destination, x.entities.members[0]]).toEqual(['New York', expect.objectContaining({ name: 'Sam', via: 'RELATION' })])],
  ['Create travel plan', 'TRAVEL', (x) => expect(x.kind).toBe('COMMAND')],
  // offers
  ['Show all Hilton offers.', 'OFFER_SEARCH', (x) => expect(x.entities.merchants[0].name).toBe('Hilton')],
  ['What Hilton offers do I have?', 'OFFER_SEARCH'],
  ['Show all Chase Offers.', 'OFFER_SEARCH', (x) => expect(x.entities.issuer).toBe('Chase')],
  ['Best Amex offers available.', 'OFFER_SEARCH', (x) => expect(x.entities.issuer).toBe('American Express')],
  ['What offers expire this month?', 'EXPIRATION_REVIEW', (x) => expect([x.scope, x.entities.window!.label]).toEqual(['OFFERS', 'this month'])],
  ['Offers expiring in 30 days.', 'EXPIRATION_REVIEW', (x) => expect(x.entities.window!.days).toBe(30)],
  ["What's expiring?", 'EXPIRATION_REVIEW'],
  ['Show new offers', 'NEW_OFFERS', (x) => expect(x.kind).toBe('COMMAND')],
  // certificates
  ['Which free night certificates expire next?', 'CERTIFICATE_REVIEW', (x) => expect(x.entities.certificateKind).toBe('FREE_NIGHT')],
  ['What certificates expire next?', 'CERTIFICATE_REVIEW'],
  ['Do I have a Hyatt free night?', 'CERTIFICATE_REVIEW', (x) => expect(x.entities.hotels).toEqual(['Hyatt'])],
  ['Can I use my IHG certificate at this hotel?', 'CERTIFICATE_REVIEW', (x) => expect(x.entities.hotels).toEqual(['IHG'])],
  ['Use certificate', 'CERTIFICATE_REVIEW'],
  ['Check expiring certificates', 'CERTIFICATE_REVIEW', (x) => expect(x.kind).toBe('COMMAND')],
  // points
  ['How many points do I have?', 'POINTS_LOOKUP'],
  ['How many Hilton points do I have?', 'POINTS_LOOKUP', (x) => expect(x.entities.programs.map((p) => p.name)).toContain('Hilton Honors')],
  ['Show my Hyatt points', 'POINTS_LOOKUP', (x) => expect(x.entities.programs.map((p) => p.name)).toContain('World of Hyatt')],
  ['What are my most valuable points?', 'POINTS_LOOKUP'],
  ['What loyalty assets are expiring?', 'EXPIRATION_REVIEW', (x) => expect(x.scope).toBe('POINTS')],
  // card strategy
  ['What card should I get next?', 'CARD_RECOMMENDATION'],
  ['What should I apply for next?', 'CARD_RECOMMENDATION'],
  ['Recommend new card', 'CARD_RECOMMENDATION'],
  ['What is my current 5/24 status?', 'STATUS_REVIEW'],
  ['What is my Chase 5/24 status?', 'STATUS_REVIEW', (x) => expect(x.entities.issuer).toBe('Chase')],
  ['How many cards have I opened in the last 24 months?', 'STATUS_REVIEW'],
  ['Should I keep Venture X?', 'ANNUAL_FEE_REVIEW', (x) => expect(x.entities.cards.map((c) => c.name)).toEqual(['Capital One Venture X Rewards Credit Card'])],
  ['Review annual fees', 'ANNUAL_FEE_REVIEW', (x) => expect(x.kind).toBe('COMMAND')],
  // portfolio and commands
  ['Analyze household portfolio', 'PORTFOLIO_REVIEW', (x) => expect(x.kind).toBe('COMMAND')],
  ['Review benefits', 'BENEFIT_LOOKUP', (x) => expect(x.kind).toBe('COMMAND')],
  ['Sync offers', 'SYNC_OFFERS', (x) => expect(x.kind).toBe('COMMAND')],
  ['Sync All Accounts', 'SYNC_OFFERS'],
  ['Generate redemption strategy', 'REDEMPTION', (x) => expect(x.kind).toBe('COMMAND')],
  ['How much have I spent on dining?', 'SPENDING'],
];

describe('TC-QU: every example in the request is understood', () => {
  // a row without a check gets a no-op: with only two entries jest would pass its `done` callback in that slot
  it.each(CASES.map(([q, intent, check]) => [q, intent, check ?? (() => undefined)] as const))('%s → %s', (q, intent, check) => {
    const x = u(q);
    expect(x.intent).toBe(intent);
    expect(x.confidence).toBeGreaterThanOrEqual(0.5);
    check(x);
  });
});

describe('TC-QU: entities', () => {
  it('matches cards by their distinctive words and nicknames, preferring the longer name and the wallet card', () => {
    expect(u('Amex Platinum for hotels').entities.cards.map((c) => c.name)).toEqual(['American Express Platinum Card']);
    expect(u('should I keep my Venture X').entities.cards.map((c) => c.id)).toEqual(['c3']); // not "Venture" alone
    expect(u('chase sapphire reserve').entities.cards.map((c) => c.id)).toEqual(['c4']);
    expect(u('what about the gold card').entities.cards.map((c) => c.id)).toEqual(['c2']);
    expect(u('Costco').entities.cards).toEqual([]);
  });
  it('knows a household member by name or by relation, and says when the household has none', () => {
    expect(u('what if Riley pays').entities.members[0]).toMatchObject({ name: 'Riley', via: 'NAME', id: 'p2' });
    expect(u('what if my spouse pays').entities.members[0]).toMatchObject({ name: 'Riley', via: 'RELATION', id: 'p2' });
    expect(u('my wife needs a flight').entities.members[0].id).toBe('p2');
    expect(u('my dad needs a flight').entities.members[0]).toMatchObject({ id: '', via: 'RELATION', relationship: 'PARENT' }); // no parent in the household
  });
  it('picks the merchant with a confidence, and none for unrelated words', () => {
    expect(u('Costco $1500').entities.merchants[0]).toMatchObject({ name: 'Costco' });
    expect(u('how many points do I have').entities.merchants).toEqual([]);
  });
  it('is stable: the same text gives the same answer', () => {
    expect(u('Hilton stay $1200')).toEqual(u('Hilton stay $1200'));
  });
  it('says what is missing and stays low-confidence on text it cannot read', () => {
    expect(u('Best card?').missing).toEqual(['merchant or item', 'amount']);
    const odd = u('purple monkey');
    expect(odd.intent).toBe('UNKNOWN');
    expect(odd.confidence).toBe(0);
  });
  it('handles empty, long and odd input without throwing', () => {
    expect(u('').intent).toBe('UNKNOWN');
    expect(u('   ').intent).toBe('UNKNOWN');
    expect(u('x'.repeat(5000)).text.length).toBe(300);
    expect(() => u('$$$ ((( [[[ \\ ///')).not.toThrow();
  });
});

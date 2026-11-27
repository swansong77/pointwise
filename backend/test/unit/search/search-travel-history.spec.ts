import { composeAnswer, StepResult } from '../../../src/domain/answer-compose';
import { Dictionaries, understand } from '../../../src/domain/query-understanding';
import { EntryRow, isStale, normalizeQuery, pushTurn, redactQuery, refsFrom, summarizeHistory } from '../../../src/domain/search-history';
import { applyFollowUp, routeFor, sanitizeSlots, slotsFrom } from '../../../src/domain/search-router';
import { MERCHANT_IDENTITIES } from '../../../src/seed/merchant-identities';

const NOW = new Date('2026-11-26T15:00:00Z');
const merchants = MERCHANT_IDENTITIES.map((i, n) => ({ id: `m${n}`, slug: i.slug, name: i.name, hosts: i.hosts, aliases: i.aliases, mcc: i.mcc, parentCompany: i.parent }));
const dict: Dictionaries = {
  merchants,
  cards: [{ id: 'c1', name: 'American Express Platinum Card', walletCardId: 'w1' }],
  members: [
    { id: 'p1', nickname: 'Alex', relationship: 'SELF' },
    { id: 'p2', nickname: 'Riley', relationship: 'SPOUSE' },
    { id: 'p3', nickname: 'Sam', relationship: 'CHILD' },
  ],
  programs: [{ id: 'pr1', name: 'World of Hyatt', kind: 'HOTEL' }],
};
const u = (q: string) => understand(q, dict, NOW);
const route = (q: string) => routeFor(u(q));
const award = (q: string) => route(q).steps.find((s) => s.tool === 'plan_award_trip');

describe('TC-TRAVEL: flights', () => {
  it('a flight with dates runs the award planner with those dates, and says what it assumed', () => {
    const r = route('Flight to Hawaii next month');
    const step = r.steps.find((s) => s.tool === 'plan_award_trip')!;
    expect(step.input).toEqual({ destination: 'Hawaii', dateFrom: '2026-12-01', dateTo: '2026-12-08', cabin: 'ECONOMY' });
    expect(r.assumptions).toEqual(['Assumed a 7-day trip starting 2026-12-01; give exact dates for an exact answer.', 'Assumed economy; say "business class" or "first class" to change it.']);
    expect(r.steps.map((s) => s.tool)).toEqual(['plan_award_trip', 'best_card_for', 'get_loyalty_summary', 'get_transfer_bonuses']);
    expect(r.title).toBe('Flight to Hawaii');
  });
  it('a named cabin is not assumed, and a month rolls to next year when it has passed', () => {
    const r = route('Business class to Seoul in January');
    expect(r.steps[0]).toMatchObject({ tool: 'plan_award_trip', input: { destination: 'Seoul', dateFrom: '2027-01-01', dateTo: '2027-01-08', cabin: 'BUSINESS' } });
    expect(r.assumptions).toEqual(['Assumed a 7-day trip starting 2027-01-01; give exact dates for an exact answer.']);
  });
  it('a day and a number of nights give an exact trip with nothing assumed about its length', () => {
    const r = route('Fly business class to Tokyo December 15 for 10 nights');
    expect(r.steps[0].input).toMatchObject({ destination: 'Tokyo', dateFrom: '2026-12-15', dateTo: '2026-12-25', cabin: 'BUSINESS' });
    expect(r.assumptions).toEqual([]);
  });
  it('a flight without dates asks for them, offers ways to say it, and still shows card, points and bonuses', () => {
    const r = route('Flight to Hawaii');
    expect(award('Flight to Hawaii')).toBeUndefined();
    expect(r.needs).toContain('dates');
    expect(r.followUps).toEqual(expect.arrayContaining(['Hawaii in January']));
    expect(r.steps.map((s) => s.tool)).toEqual(['best_card_for', 'get_loyalty_summary', 'get_transfer_bonuses']);
  });
  it('a family member’s trip looks at their points and the household’s', () => {
    const r = route('My son needs a flight to New York');
    expect(r.steps.find((s) => s.tool === 'get_loyalty_summary')!.label).toBe('Sam’s points and the household’s');
    expect(r.needs).toContain('dates');
  });
  it('an airline named with a destination also shows that airline’s offers', () => {
    expect(route('United flight to Chicago next month').steps.map((s) => s.tool)).toEqual(['plan_award_trip', 'best_card_for', 'search_offer_inventory', 'get_loyalty_summary', 'get_transfer_bonuses']);
  });
  it('a hotel stay and a priced fare are still purchases', () => {
    expect(route('Hilton Chicago 3 nights').steps.map((s) => s.tool)).toEqual(['best_card_for', 'search_offer_inventory', 'get_certificates', 'get_loyalty_summary', 'get_transfer_bonuses']);
    expect(route('United flight $850').steps[0]).toMatchObject({ tool: 'plan_purchase', input: { amountDollars: 850 } });
  });
});

describe('TC-MEMORY: slots carry dates and survive the round trip', () => {
  it('"What about business class?" keeps the destination and the dates', () => {
    const first = u('Flight to Seoul in January');
    const slots = slotsFrom(first);
    expect(slots).toMatchObject({ destination: 'Seoul', windowFrom: '2027-01-01', windowTo: '2027-01-31', windowSingle: false });
    const { understanding, usedFollowUp } = applyFollowUp(u('What about business class?'), slots);
    expect(usedFollowUp).toBe(true);
    expect(understanding.intent).toBe('TRAVEL');
    expect(routeFor(understanding).steps[0]).toMatchObject({ tool: 'plan_award_trip', input: { destination: 'Seoul', dateFrom: '2027-01-01', cabin: 'BUSINESS' } });
  });
  it('slots coming back from the browser are checked, and bad dates or intents are dropped', () => {
    const ok = sanitizeSlots({ intent: 'TRAVEL', destination: 'Seoul', windowFrom: '2027-01-01', windowTo: '2027-01-31', windowSingle: true, windowLabel: 'january' });
    expect(ok).toMatchObject({ windowFrom: '2027-01-01', windowSingle: true, windowLabel: 'january' });
    const bad = sanitizeSlots({ intent: 'TRAVEL', windowFrom: 'tomorrow; DROP TABLE', windowTo: 5, windowSingle: 'yes', nights: -3, amountCents: 1e20 });
    expect(bad).toMatchObject({ windowFrom: null, windowTo: null, windowSingle: false, nights: null, amountCents: null });
    expect(sanitizeSlots({ intent: 'EVIL' })).toBeNull();
    expect(sanitizeSlots(null)).toBeNull();
  });
});

const step = (tool: string, summary: string, data: unknown): StepResult => ({ tool, label: tool, ok: true, summary, data });

describe('TC-MEMBER: a family member’s points', () => {
  const accounts = [
    { id: 'a1', member: 'Sam', programName: 'United MileagePlus', balance: 10_000, unit: 'miles', valueCents: 12_000 },
    { id: 'a2', member: 'Alex', programName: 'Chase Ultimate Rewards', balance: 50_000, unit: 'points', valueCents: 100_000 },
  ];
  it('shows their balance first, then the rest of the household with a note about booking for family', () => {
    const q = u('My son needs a flight to New York');
    const a = composeAnswer(q, routeFor(q), [step('get_loyalty_summary', 'all', { accounts })]);
    const lines = a.sections[0].lines;
    expect(lines[0]).toBe('Sam holds 10,000 points and miles.');
    expect(lines.join('\n')).toMatch(/The rest of the household holds 50,000; some programs let family members book or pool/);
    expect(lines.join('\n')).toContain('• Alex: Chase Ultimate Rewards 50,000 points');
    expect(a.warnings.join(' ')).toMatch(/dates/);
  });
  it('says so when the member has nothing', () => {
    const q = u('My son needs a flight to New York');
    const a = composeAnswer(q, routeFor(q), [step('get_loyalty_summary', 'all', { accounts: [accounts[1]] })]);
    expect(a.sections[0].lines[0]).toBe('Sam has no points or miles recorded.');
  });
  it('assumptions are shown with the answer', () => {
    const q = u('Flight to Hawaii next month');
    const a = composeAnswer(q, routeFor(q), [step('plan_award_trip', 'Best option: 60,000 points', {})]);
    expect(a.warnings).toEqual(expect.arrayContaining(['Assumed economy; say "business class" or "first class" to change it.']));
  });
});

describe('TC-HISTORY: what is remembered, and what is not', () => {
  it('removes card numbers and e-mail addresses before anything is stored', () => {
    expect(redactQuery('my card is 4111 1111 1111 1111 and email me@example.com, what is my 5/24?')).toBe('my card is [number removed] and email [email removed], what is my 5/24?');
    expect(redactQuery('   spaced    out  ')).toBe('spaced out');
    expect(redactQuery('x'.repeat(500)).length).toBe(300);
    expect(normalizeQuery('What card should I use at Costco?')).toBe(normalizeQuery('what card should i use at costco'));
    expect(normalizeQuery('4111 1111 1111 1111')).not.toContain('4111');
  });
  it('keeps what a question named, not the household’s data', () => {
    const refs = refsFrom(u('What card should I use at Costco for $1,500?'), [
      { type: 'CARD', id: 'w1', title: 'Amex Platinum', href: '/wallet/w1' },
      { type: 'CARD', id: 'w1', title: 'Amex Platinum', href: '/wallet/w1' },
      { type: 'OFFER', id: 'o1', title: 'secret offer', href: '/x' },
    ]);
    expect(refs.merchants).toEqual([{ name: 'Costco', slug: 'costco' }]);
    expect(refs.cards).toEqual([{ name: 'Amex Platinum', walletCardId: 'w1' }]);
    expect(JSON.stringify(refs)).not.toContain('secret');
  });

  const e = (id: string, o: Partial<EntryRow>): EntryRow => ({ id, query: id, normalized: id, intent: 'SHOPPING', kind: 'HISTORY', name: null, uses: 1, summary: 's', entityRefs: null, lastUsedAt: new Date('2026-11-20T00:00:00Z'), ...o });
  it('builds the dashboard: common, recent, saved, favourite merchants, recent cards and recommendations', () => {
    const entries: EntryRow[] = [
      e('a', { uses: 5, lastUsedAt: new Date('2026-11-25T00:00:00Z'), entityRefs: { merchants: [{ name: 'Costco', slug: 'costco' }], cards: [{ name: 'Gold', walletCardId: 'w2' }], programs: [], destination: null } }),
      e('b', { uses: 2, lastUsedAt: new Date('2026-11-24T00:00:00Z'), intent: 'POINTS_LOOKUP', entityRefs: { merchants: [{ name: 'Hilton', slug: 'hilton' }, { name: 'Costco', slug: 'costco' }], cards: [{ name: 'Gold', walletCardId: 'w2' }, { name: 'Plat', walletCardId: 'w1' }], programs: [], destination: null } }),
      e('c', { uses: 1, lastUsedAt: new Date('2026-11-23T00:00:00Z'), intent: 'TRAVEL' }),
      e('s', { kind: 'SAVED', name: 'Costco check', lastUsedAt: new Date('2026-11-22T00:00:00Z') }),
    ];
    const d = summarizeHistory(entries);
    expect(d.mostCommon.map((x) => x.id)).toEqual(['a', 'b']); // asked once is not common
    expect(d.recent.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(d.saved.map((x) => x.id)).toEqual(['s']);
    expect(d.favoriteMerchants).toEqual([{ name: 'Costco', slug: 'costco', count: 7 }, { name: 'Hilton', slug: 'hilton', count: 2 }]);
    expect(d.recentCards.map((c) => c.name)).toEqual(['Gold', 'Plat']);
    expect(d.recentRecommendations.map((x) => x.id)).toEqual(['a', 'c']); // shopping and travel, not points lookups
    expect(summarizeHistory([])).toMatchObject({ mostCommon: [], recent: [], saved: [], favoriteMerchants: [] });
  });
  it('keeps the last ten turns of a conversation and lets a quiet one go stale', () => {
    let turns: unknown = [];
    for (let i = 0; i < 14; i++) turns = pushTurn(turns, { q: 'q' + i, intent: null, summary: 's', at: NOW.toISOString() });
    expect((turns as unknown[]).length).toBe(10);
    expect((turns as Array<{ q: string }>)[0].q).toBe('q4');
    expect(isStale(new Date('2026-11-25T00:00:00Z'), NOW)).toBe(true);
    expect(isStale(new Date('2026-11-26T10:00:00Z'), NOW)).toBe(false);
  });
});

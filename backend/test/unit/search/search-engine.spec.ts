import { composeAnswer, StepResult } from '../../../src/domain/answer-compose';
import { Dictionaries, understand } from '../../../src/domain/query-understanding';
import { applyFollowUp, emptySlots, routeFor, slotsFrom } from '../../../src/domain/search-router';
import { rankDocs, SearchDoc } from '../../../src/domain/search-index';
import { MERCHANT_IDENTITIES } from '../../../src/seed/merchant-identities';

const NOW = new Date('2026-11-26T15:00:00Z');
const merchants = MERCHANT_IDENTITIES.map((i, n) => ({ id: `m${n}`, slug: i.slug, name: i.name, hosts: i.hosts, aliases: i.aliases, mcc: i.mcc, parentCompany: i.parent }));
const dict: Dictionaries = {
  merchants,
  cards: [{ id: 'c1', name: 'American Express Platinum Card', walletCardId: 'w1' }],
  members: [
    { id: 'p1', nickname: 'Alex', relationship: 'SELF' },
    { id: 'p2', nickname: 'Riley', relationship: 'SPOUSE' },
  ],
  programs: [
    { id: 'pr1', name: 'World of Hyatt', kind: 'HOTEL' },
    { id: 'pr2', name: 'Hilton Honors', kind: 'HOTEL' },
  ],
};
const u = (q: string) => understand(q, dict, NOW);
const route = (q: string) => routeFor(u(q));
const tools = (q: string) => route(q).steps.map((s) => s.tool);

describe('TC-ROUTE: which engines answer which question', () => {
  it.each([
    ['What card should I use at Costco for $1,500?', ['plan_purchase']],
    ['What card should I use at Costco?', ['best_card_for', 'search_offer_inventory']],
    ['Hilton stay $1200', ['plan_purchase']],
    ['MacBook Pro M5', ['best_card_for']],
    ['Show all Hilton offers', ['search_offer_inventory']],
    ['What offers expire this month?', ['get_expiring_offers']],
    ["What's expiring?", ['get_expiring_offers', 'get_expiring_loyalty']],
    ['What loyalty assets are expiring?', ['get_expiring_loyalty']],
    ['How many points do I have?', ['get_loyalty_summary']],
    ['Which free night certificates expire next?', ['get_certificates']],
    ['What is my current 5/24 status?', ['get_five24_status']],
    ['What card should I get next?', ['recommend_next_card']],
    ['Review annual fees', ['get_renewals']],
    ['Should I keep Venture X?', ['get_renewals']],
    ['Analyze household portfolio', ['get_household', 'get_portfolio_value']],
    ['Show new offers', ['get_offer_inbox']],
    ['Hilton Chicago 3 nights', ['best_card_for', 'search_offer_inventory', 'get_certificates', 'get_loyalty_summary', 'get_transfer_bonuses']],
    ['Flight to Hawaii', ['best_card_for', 'get_loyalty_summary', 'get_transfer_bonuses']],
    ['Generate redemption strategy', ['get_loyalty_summary', 'get_transfer_bonuses', 'get_certificates']],
    ['purple monkey', []],
  ])('%s → %j', (q, expected) => {
    expect(tools(q)).toEqual(expected);
  });

  it('passes the entities to the engines as arguments', () => {
    expect(route('What card should I use at Costco for $1,500?').steps[0].input).toEqual({ merchant: 'Costco', amountDollars: 1500 });
    expect(route('Hilton stay $1200').steps[0].input).toMatchObject({ merchant: 'Hilton', amountDollars: 1200 });
    expect(route('Offers expiring in 30 days').steps[0].input).toEqual({});
    expect(route('Show all Chase offers').steps[0].input).toEqual({ query: 'Chase' });
    expect(route('Offers expiring in 30 days worth more than $50').intent).toBeDefined();
    expect(route('Which free night certificates expire next?').steps[0].input).toEqual({ category: 'FREE_NIGHT' });
    expect(route('Should I keep Venture X?').steps).toHaveLength(1); // the card is not in this test's wallet
    expect(route('What is my Chase 5/24 status?').steps[0]).toMatchObject({ tool: 'get_five24_status' });
  });

  it('asks for what is missing instead of guessing', () => {
    const r = route('Hilton Chicago 3 nights');
    expect(r.needs).toContain('amount');
    expect(r.followUps[0]).toBe('Hilton $1,200');
    expect(route('Best card?').needs).toEqual(['merchant or item', 'amount']);
  });
});

describe('TC-FOLLOW: a conversation remembers', () => {
  it('"It will cost $1,200" keeps the merchant and the question', () => {
    const first = u('What card should I use for a Hilton stay?');
    const slots = slotsFrom(first);
    const { understanding, usedFollowUp } = applyFollowUp(u('It will cost $1,200.'), slots);
    expect(usedFollowUp).toBe(true);
    expect(understanding.intent).toBe(first.intent);
    expect(understanding.entities.amountCents).toBe(120_000);
    expect(understanding.entities.hotels).toEqual([]); // the merchant carries over as a merchant
    expect(routeFor(understanding).steps[0]).toMatchObject({ tool: 'plan_purchase', input: { merchant: 'Hilton', amountDollars: 1200 } });
  });
  it('"What if my spouse pays?" asks the same question for Riley', () => {
    const slots = slotsFrom(u('Hilton stay $1200'));
    const { understanding, usedFollowUp } = applyFollowUp(u('What if my spouse pays?'), slots);
    expect(usedFollowUp).toBe(true);
    expect(understanding.entities.members[0]).toMatchObject({ name: 'Riley' });
    expect(routeFor(understanding).steps[0]).toMatchObject({ tool: 'plan_purchase', input: { merchant: 'Hilton', amountDollars: 1200, member: 'Riley' } });
  });
  it('a question with its own meaning is not treated as a follow-up', () => {
    const slots = slotsFrom(u('Hilton stay $1200'));
    const { understanding, usedFollowUp } = applyFollowUp(u('How many points do I have?'), slots);
    expect(usedFollowUp).toBe(false);
    expect(understanding.intent).toBe('POINTS_LOOKUP');
  });
  it('without a previous question there is nothing to carry', () => {
    expect(applyFollowUp(u('It will cost $1,200'), null).usedFollowUp).toBe(false);
    expect(applyFollowUp(u('It will cost $1,200'), emptySlots()).usedFollowUp).toBe(false);
  });
});

const step = (tool: string, summary: string, data: unknown = {}, label = tool): StepResult => ({ tool, label, ok: true, summary, data });

describe('TC-COMPOSE: the answer', () => {
  it('a purchase plan answers with the card, why, evidence, who pays and what to do first', () => {
    const q = u('Hilton stay $1200');
    const data = {
      merchant: { id: 'm1', name: 'Hilton' },
      plans: [{ legs: [{ walletCardId: 'w1', cardName: 'Amex Platinum', member: 'Alex', amountCents: 120_000 }], justification: ['Amex Platinum returns $60.00 on $1200.00.'], evidence: ['card earn: Amex Platinum — 5x'], warnings: ['note'], actions: ['Activate "Hilton offer"'], confidence: 85 }],
      strategies: [{ key: 'BEST', label: 'Best strategy', why: 'x' }, { key: 'CONSERVATIVE', label: 'Conservative strategy', why: 'only dependable value' }],
      household: { options: [{}, {}], reason: 'Alex holds the offer.' },
      expiryImpact: [{ message: 'Purchase before 2026-12-15: Hilton offer expires.' }],
      bestTimeToBuy: { reason: 'Buy on Dec 1.', gainCents: 500 },
    };
    const a = composeAnswer(q, routeFor(q), [step('plan_purchase', 'Best: Amex Platinum for $1200. Expected return $90.\nAmex Platinum returns $60.00', data)]);
    expect(a.summary).toBe('Best: Amex Platinum for $1200. Expected return $90.');
    expect(a.confidence).toBe(85);
    expect(a.reasoning).toEqual(expect.arrayContaining(['Amex Platinum returns $60.00 on $1200.00.', 'Do first: Activate "Hilton offer"', 'Who should pay: Alex holds the offer.', 'Best time: Buy on Dec 1.', 'Conservative strategy: only dependable value']));
    expect(a.evidence).toEqual(['card earn: Amex Platinum — 5x']);
    expect(a.warnings).toContain('note');
    expect(a.related.find((r) => r.type === 'CARD')).toMatchObject({ title: 'Amex Platinum', href: '/wallet/w1', subtitle: 'Alex · $1,200' });
    expect(a.actions[0].href).toBe('/offers/plan');
    expect(a.understood).toEqual(expect.arrayContaining([{ type: 'merchant', label: 'Hilton' }, { type: 'amount', label: '$1,200' }]));
  });

  it('points are filtered to the program asked about, with a total', () => {
    const q = u('Show my Hyatt points');
    const accounts = [
      { id: 'a1', member: 'Alex', programName: 'World of Hyatt', balance: 30_000, unit: 'points', valueCents: 54_000 },
      { id: 'a2', member: 'Riley', programName: 'World of Hyatt', balance: 12_000, unit: 'points', valueCents: 21_600 },
      { id: 'a3', member: 'Alex', programName: 'Hilton Honors', balance: 90_000, unit: 'points', valueCents: 45_000 },
    ];
    const a = composeAnswer(q, routeFor(q), [step('get_loyalty_summary', 'all programs…', { accounts })]);
    expect(a.sections[0].lines[0]).toBe('42,000 points across 2 accounts ($756).');
    expect(a.sections[0].lines.join(' ')).not.toContain('Hilton');
    expect(a.related.map((r) => r.id)).toEqual(['a1', 'a2', 'a3']);
    expect(composeAnswer(u('How many Delta points do I have?'), routeFor(u('How many Delta points do I have?')), [step('get_loyalty_summary', 'x', { accounts })]).summary).toBe('No Delta points found in your accounts.');
  });

  it('an expiry question with a window keeps only what ends inside it', () => {
    const q = u('What offers expire this month?');
    const data = {
      buckets: [
        { items: [{ kind: 'OFFER', id: 'o1', label: 'Hilton offer', cardholder: 'Alex', endsAt: '2026-11-29T00:00:00Z', daysLeft: 3, valueCents: 10_000, action: 'Use it' }, { kind: 'CREDIT', id: 'c1', label: 'Travel credit', daysLeft: 2, valueCents: 5_000 }] },
        { items: [{ kind: 'OFFER', id: 'o2', label: 'Later offer', daysLeft: 40, valueCents: 7_000 }] },
      ],
    };
    const a = composeAnswer(q, routeFor(q), [step('get_expiring_offers', 'x', data)]);
    expect(a.sections[0].lines[0]).toBe('1 item expires this month, $100 at stake.');
    expect(a.sections[0].lines.join('\n')).toContain('Hilton offer');
    expect(a.sections[0].lines.join('\n')).not.toContain('Later offer');
    expect(a.sections[0].lines.join('\n')).not.toContain('Travel credit'); // offers only
  });

  it('a step that failed lowers confidence and is reported, and the rest still answers', () => {
    const q = u('Hilton Chicago 3 nights');
    const a = composeAnswer(q, routeFor(q), [step('best_card_for', 'Best for hotels: Amex Platinum'), { tool: 'get_certificates', label: 'Certificates', ok: false, summary: '', data: null, error: 'timeout' }]);
    expect(a.summary).toBe('Best for hotels: Amex Platinum');
    expect(a.warnings).toEqual(expect.arrayContaining(['Certificates could not be read: timeout', 'To be exact I also need: amount.']));
    expect(a.confidence).toBeLessThanOrEqual(70);
    expect(a.unanswered).toBe(false);
  });

  it('a question it cannot read is not answered with a guess', () => {
    const q = u('purple monkey');
    const a = composeAnswer(q, routeFor(q), []);
    expect(a).toMatchObject({ unanswered: true, confidence: 0, actions: [] });
    expect(a.followUps.length).toBeGreaterThan(2);
  });

  it('warns when the household has no such member', () => {
    const q = u('my dad needs a flight to Seoul');
    const a = composeAnswer(q, routeFor(q), [step('best_card_for', 'Best for airlines: Amex Platinum')]);
    expect(a.warnings.join(' ')).toMatch(/no dad in your household/);
  });
});

const docs: SearchDoc[] = [
  { type: 'WALLET_CARD', id: 'w1', title: 'American Express Platinum Card', subtitle: 'Alex', keywords: ['amex'], href: '/wallet/w1', weight: 1 },
  { type: 'CARD', id: 'c1', title: 'American Express Gold Card', href: '/cards/c1', weight: 0.5 },
  { type: 'CERTIFICATE', id: 'x1', title: 'Hyatt free night', subtitle: 'Alex · expires 2027-01-31', href: '/loyalty' },
  { type: 'OFFER', id: 'o1', title: 'Hilton: $100 back on $500', subtitle: 'Alex · Amex Platinum', keywords: ['hilton'], href: '/offers/inventory' },
  { type: 'MERCHANT', id: 'm1', title: 'Hilton', href: '/merchants/hilton', weight: 0.8 },
  { type: 'MEMBER', id: 'p2', title: 'Riley', subtitle: 'Spouse', href: '/household' },
  { type: 'PAGE', id: 'p', title: 'Offer inventory', keywords: ['offers'], href: '/offers/inventory' },
];

describe('TC-INDEX: forgiving search over the index', () => {
  const ids = (q: string, limit = 8) => rankDocs(docs, q, limit).map((h) => h.doc.id);
  it('finds by prefix, nickname and the concept behind a phrase', () => {
    expect(ids('plat')[0]).toBe('w1');
    expect(ids('amex')).toEqual(expect.arrayContaining(['w1', 'c1']));
    expect(ids('amex plat')[0]).toBe('w1');
    expect(ids('free night')[0]).toBe('x1');
    expect(ids('riley')).toEqual(['p2']);
  });
  it('forgives a typo and a missing letter', () => {
    expect(ids('hilto')).toContain('m1');
    expect(ids('hiltn')).toContain('m1');
    expect(ids('platnum')[0]).toBe('w1');
  });
  it('ranks an exact title above a longer match, and your own card above the catalog', () => {
    expect(ids('hilton')[0]).toBe('m1');
    expect(ids('american express')[0]).toBe('w1');
  });
  it('every word must find a home, and nothing matches nothing', () => {
    expect(ids('hilton zebra')).toEqual([]);
    expect(ids('')).toEqual([]);
    expect(ids('qqqqzz')).toEqual([]);
  });
  it('is stable and honours the limit', () => {
    expect(ids('card', 1)).toHaveLength(1);
    expect(ids('hilton')).toEqual(ids('hilton'));
  });
});

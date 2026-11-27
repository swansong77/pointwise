import { checkLifeEvent, expectedValue, isTravel, LifeEstimate } from '../../../src/domain/cos-life';
import { governance, GovMember, GovPick } from '../../../src/domain/cos-governance';
import { householdChief } from '../../../src/domain/cos-household';
import { phasesFor, roadmap, roadmapSpan, RoadEvent } from '../../../src/domain/cos-roadmap';
import { toExecItem } from '../../../src/domain/cos-score';
import type { PlanItem } from '../../../src/domain/copilot-plan';

const NOW = new Date('2026-11-26T15:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const mem = (over: Partial<GovMember> = {}): GovMember => ({ member: 'Alex', profileId: 'p1', isPrimary: true, count: 2, limit: 5, underLimit: true, nextSlotAt: null, drops: [day(30), day(200)], recentApprovals: [], ...over });
const pick = (over: Partial<GovPick> = {}): GovPick => ({ member: 'Alex', profileId: 'p1', card: 'Sapphire Preferred', slug: 'csp', firstYearCents: 90_000, longTermCents: 30_000, usesSlot: true, elevated: false, business: false, ...over });

describe('TC-COS: application governance', () => {
  it('says where each member stands: open, one slot left or at the limit, with the next dates', () => {
    const g = governance([mem(), mem({ member: 'Riley', profileId: 'p2', isPrimary: false, count: 4 }), mem({ member: 'Sam', profileId: 'p3', isPrimary: false, count: 6, underLimit: false, nextSlotAt: day(90), drops: [day(90), day(120)] })], [], NOW);
    expect(g.members.map((m) => [m.member, m.label, m.state, m.slots])).toEqual([['Alex', '2/24', 'OPEN', 3], ['Riley', '4/24', 'ONE_LEFT', 1], ['Sam', '6/24', 'AT_LIMIT', 0]]);
    expect(g.members[2]).toMatchObject({ nextSlotAt: '2027-02-24' });
    expect(g.members[0].upcomingDrops).toEqual(['2026-12-26', '2027-06-14']);
  });

  it('tells a member over the limit to wait, with the date', () => {
    const g = governance([mem({ count: 6, underLimit: false, nextSlotAt: day(90) })], [], NOW);
    expect(g.advice[0]).toMatchObject({ kind: 'WAIT', date: '2027-02-24' });
    expect(g.advice[0].text).toBe('Alex: wait until 2027-02-24 for Chase eligibility');
  });

  it('suggests the best next card and says it is a suggestion; moves it to the member who is under the limit', () => {
    const members = [mem({ member: 'Alex', profileId: 'p1', count: 6, underLimit: false, nextSlotAt: day(60) }), mem({ member: 'Riley', profileId: 'p2', isPrimary: false, count: 1 })];
    const g = governance(members, [pick({ member: 'Riley', profileId: 'p2' })], NOW);
    const apply = g.advice.find((a) => a.kind === 'APPLY')!;
    expect(apply.text).toBe('Apply for Sapphire Preferred next (Riley)');
    expect(apply.detail).toMatch(/\$900 in the first year, then \$300 a year.*uses one of Riley's 5\/24 slots \(1\/24 → 2\/24\).*yours to decide/);
    expect(g.advice.find((a) => a.kind === 'MOVE')!.text).toBe('Move the Sapphire Preferred application to Riley');
    expect(g.headline).toMatch(/1 member at the 5\/24 limit; a good next card is ready/);
  });

  it('adds business cards (not counted toward 5/24), elevated offers and a last-slot warning', () => {
    const g = governance([mem({ count: 4 })], [pick({ firstYearCents: 50_000 }), pick({ card: 'Ink Cash', slug: 'ink', business: true, usesSlot: false, firstYearCents: 60_000 }), pick({ card: 'Hot Offer', slug: 'hot', elevated: true, firstYearCents: 40_000 })], NOW);
    expect(g.advice.map((a) => a.kind)).toEqual(expect.arrayContaining(['APPLY', 'LAST_SLOT', 'BUSINESS', 'BONUS']));
    expect(g.advice.find((a) => a.kind === 'BUSINESS')!.detail).toMatch(/usually do not count toward 5\/24.*real business/);
    expect(g.advice.find((a) => a.kind === 'BONUS')!.text).toBe('Hot Offer has an elevated welcome offer');
    expect(JSON.stringify(g)).not.toMatch(/automatically (apply|cancel|transfer|book)/i);
  });

  it('is quiet when nothing is worth doing', () => {
    const g = governance([mem()], [], NOW);
    expect(g.advice).toEqual([]);
    expect(g.headline).toBe('No application is worth making right now');
  });
});

const ev = (days: number, over: Partial<RoadEvent> = {}): RoadEvent => ({ date: day(days), title: 'Event ' + days, area: 'OFFERS', valueCents: 10_000, atRisk: false, href: '/x', ...over });

describe('TC-COS: roadmaps', () => {
  it('questions that ask for one', () => {
    expect([
      'What should I do over the next 90 days?',
      'What should I focus on this year?',
      'How do I maximize value from my cards?',
      'Give me a 90-day plan',
      "What's my plan for the next quarter",
      'What should I do today?',
      'How many points do I have?',
      'What card should I use this year at Costco?',
    ].map(roadmapSpan)).toEqual([90, 365, 365, 90, 90, null, null, null]);
  });

  it('three 30-day phases, or four quarters', () => {
    expect(phasesFor(90, NOW).map((p) => p.label)).toEqual(['Next 30 days', 'Days 31–60', 'Days 61–90']);
    expect(phasesFor(365, NOW).map((p) => p.label)).toEqual(['Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4']);
  });

  it('puts each dated event in its phase, ignores what is outside the span, and totals value and what is at risk', () => {
    const r = roadmap([ev(5, { atRisk: true, valueCents: 25_000 }), ev(40, { area: 'CARDS' }), ev(75, { area: 'APPLICATIONS' }), ev(200), ev(-30)], 90, NOW);
    expect(r.phases.map((p) => p.events.length)).toEqual([1, 1, 1]);
    expect(r.eventCount).toBe(3);
    expect(r.totalValueCents).toBe(45_000);
    expect(r.atRiskCents).toBe(25_000);
    expect(r.phases[0]).toMatchObject({ valueCents: 25_000, atRiskCents: 25_000 });
    expect(r.headline).toBe('3 things on the calendar for the next 90 days, worth about $450; $250 of it is lost if nothing is done.');
    const year = roadmap([ev(5), ev(100), ev(200), ev(300), ev(400)], 365, NOW);
    expect(year.phases.map((p) => p.events.length)).toEqual([1, 1, 1, 1]);
  });

  it('names the three areas to focus on, biggest first, with advice', () => {
    const r = roadmap([ev(5, { area: 'CARDS', valueCents: 50_000 }), ev(6, { area: 'OFFERS', valueCents: 20_000 }), ev(7, { area: 'OFFERS', valueCents: 20_000 }), ev(8, { area: 'POINTS', valueCents: 30_000 }), ev(9, { area: 'GOALS', valueCents: 0 })], 90, NOW);
    expect(r.focus.map((f) => f.area)).toEqual(['CARDS', 'OFFERS', 'POINTS']);
    expect(r.focus[1]).toMatchObject({ events: 2, valueCents: 40_000 });
    expect(r.focus[0].advice).toMatch(/Decide each fee before the card renews/);
  });

  it('says when nothing is scheduled', () => {
    expect(roadmap([], 365, NOW).headline).toBe('Nothing is scheduled for the year ahead.');
  });
});

describe('TC-COS: life events', () => {
  const ok = (over: object) => checkLifeEvent({ kind: 'FAMILY_VACATION', title: 'Disney trip', destination: 'Orlando', startsOn: day(60).toISOString(), endsOn: day(67).toISOString(), travelers: 4, budgetCents: 500_000, ...over }, NOW);

  it('accepts a good event and cleans it', () => {
    const r = ok({ title: '  Disney   trip ' });
    expect(r).toMatchObject({ ok: true, value: { kind: 'FAMILY_VACATION', title: 'Disney trip', destination: 'Orlando', travelers: 4, budgetCents: 500_000, status: 'PLANNING' } });
    expect(checkLifeEvent({ kind: 'MOVING', title: 'Move to Austin' }, NOW)).toMatchObject({ ok: true, value: { destination: null, travelers: 1, budgetCents: null } });
  });
  it('rejects bad events with a reason a person can act on', () => {
    for (const [over, msg] of [[{ kind: 'NOPE' }, /Unknown event type/], [{ title: ' ' }, /needs a title/], [{ destination: '' }, /where you are going/], [{ startsOn: 'soon' }, /not valid/], [{ endsOn: day(10).toISOString() }, /end date/], [{ startsOn: day(-10).toISOString(), endsOn: undefined }, /already passed/], [{ travelers: 0 }, /1 to 20/], [{ budgetCents: -1 }, /budget/], [{ status: 'WAT' }, /Unknown status/], [{ startsOn: day(5000).toISOString(), endsOn: undefined }, /too far ahead/]] as const) {
      const r = ok(over);
      expect(r.ok).toBe(false);
      expect((r as { error: string }).error).toMatch(msg);
    }
    expect(checkLifeEvent({ kind: 'HOME_PROJECT', title: 'Kitchen' }, NOW).ok).toBe(true); // a purchase needs no destination
    expect([isTravel('MISSION_TRIP'), isTravel('MOVING')]).toEqual([true, false]);
  });
  it('a finished event may be in the past', () => {
    expect(ok({ startsOn: day(-30).toISOString(), endsOn: day(-25).toISOString(), status: 'DONE' }).ok).toBe(true);
  });
  it('the expected value is the rewards, the usable credits and the usable certificates, so it can be explained', () => {
    const e: Pick<LifeEstimate, 'bestCards' | 'travelCredits' | 'certificates'> = {
      bestCards: [{ use: 'Flights', card: 'Gold', member: null, expectedCents: 12_000, netCostCents: 0, why: '' }, { use: 'Hotels', card: 'Plat', member: null, expectedCents: -5, netCostCents: 0, why: '' }],
      travelCredits: { cents: 20_000, items: [] },
      certificates: [{ name: 'Hyatt', cents: 25_000, expiresOn: '2027-01-01', usable: true }, { name: 'Late', cents: 99_000, expiresOn: '2026-12-01', usable: false }],
    };
    expect(expectedValue(e)).toBe(12_000 + 20_000 + 25_000);
  });
});

const planItem = (id: string, member: string | undefined, over: Partial<PlanItem> = {}): PlanItem => ({ id, lens: 'OFFER', horizon: 'WEEK', priority: 10, title: id, recommendation: 'Do it', reason: 'Because', evidence: ['Expiring offers: x'], expectedValueCents: 10_000, assumptions: [], risks: [], confidence: 90, factors: [], href: '/x', facts: { kind: 'OFFER_EXPIRING', daysLeft: 3, member }, calls: [], ...over });

describe('TC-COS: household chief', () => {
  const members = [
    { profileId: 'p1', member: 'Alex', relationship: 'SELF', isPrimary: true, age: 41, five24: { count: 2, underLimit: true }, cardsHeld: 3, authorizedOn: 0 },
    { profileId: 'p2', member: 'Riley', relationship: 'SPOUSE', isPrimary: false, age: 40, five24: { count: 6, underLimit: false }, cardsHeld: 2, authorizedOn: 0 },
    { profileId: 'p3', member: 'Sam', relationship: 'CHILD', isPrimary: false, age: 14, five24: null, cardsHeld: 0, authorizedOn: 0 },
  ];
  const items = [planItem('a', 'Alex'), planItem('b', 'riley'), planItem('c', undefined), planItem('d', 'Stranger')].map((i) => toExecItem(i, NOW));

  it('gives each member their own actions and the household the rest', () => {
    const h = householdChief(members, items, [], []);
    expect(h.members.map((m) => [m.member, m.actions.map((a) => a.id), m.five24])).toEqual([['Alex', ['a'], '2/24'], ['Riley', ['b'], '6/24'], ['Sam', [], null]]);
    expect(h.shared.map((a) => a.id).sort()).toEqual(['c', 'd']);
    expect(h.headline).toBe('2 of 3 members have something to do, and 2 things belong to the household');
  });
  it('suggests adding a child as an authorized user on a card that charges nothing for one', () => {
    const h = householdChief(members, [], [{ card: 'Gold', holder: 'Alex', feeCents: 0 }, { card: 'Platinum', holder: 'Alex', feeCents: 19_500 }], []);
    expect(h.authorizedUsers).toHaveLength(1);
    expect(h.authorizedUsers[0].text).toMatch(/Sam could be added as an authorized user on Alex's Gold, which charges nothing.*before 18/);
    expect(householdChief(members, [], [{ card: 'Platinum', holder: 'Alex', feeCents: 19_500 }], []).authorizedUsers).toEqual([]);
    expect(householdChief([{ ...members[2], authorizedOn: 1 }], [], [{ card: 'Gold', holder: 'Alex', feeCents: 0 }], []).authorizedUsers).toEqual([]);
  });
  it('shows which household card is best for the biggest spending categories', () => {
    const h = householdChief(members, [], [], [{ category: 'Dining', card: 'Gold', holder: 'Riley', centsPerDollar: 4, annualSpendCents: 480_000 }]);
    expect(h.bestCardByCategory[0].text).toBe("Dining: Gold (Riley's) earns 4¢ per dollar on about $4,800 a year");
  });
});

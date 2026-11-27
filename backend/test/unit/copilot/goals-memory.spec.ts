import { applyMemory, checkDecision, checkPreferences, DISMISS_DAYS, isHidden } from '../../../src/domain/copilot-memory';
import { checkGoal, goalProgress, GoalSignals } from '../../../src/domain/goals';
import { composeAgenda, GoalView, PlanItem } from '../../../src/domain/copilot-plan';
import type { StepResult } from '../../../src/domain/answer-compose';

const NOW = new Date('2026-11-26T15:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

describe('TC-GOALS: validation', () => {
  it('accepts each kind with its target and rejects bad ones', () => {
    const ok = (kind: string, target?: object, title = 'A goal') => checkGoal({ kind, title, target }, NOW);
    expect(ok('STATUS', { program: 'Hyatt', level: 'Globalist' })).toMatchObject({ ok: true });
    expect(ok('FIVE24')).toMatchObject({ ok: true, value: { target: { max: 4 } } });
    expect(ok('TRIP', { destination: 'Seoul', pointsNeeded: 120000 })).toMatchObject({ ok: true });
    expect(ok('CASHBACK', { annualCents: 100000 })).toMatchObject({ ok: true });
    expect(ok('FEES', { maxCents: 0 })).toMatchObject({ ok: true });
    expect(ok('MILES', { program: 'Delta', points: 100000 })).toMatchObject({ ok: true });
    expect(ok('CUSTOM')).toMatchObject({ ok: true });
    for (const bad of [ok('NOPE'), ok('STATUS', { program: 'Hyatt' }), ok('FIVE24', { max: 99 }), ok('TRIP', { destination: 'X', pointsNeeded: -1 }), ok('CASHBACK', {}), ok('MILES', { program: 'D', points: 0 }), ok('CUSTOM', {}, ' ')]) expect(bad.ok).toBe(false);
    expect(checkGoal({ kind: 'CUSTOM', title: 'x y', dueAt: '2020-01-01' }, NOW)).toMatchObject({ ok: false });
    expect(checkGoal({ kind: 'CUSTOM', title: 'x y', dueAt: 'soon' }, NOW)).toMatchObject({ ok: false });
    expect(checkGoal({ kind: 'CUSTOM', title: 'x y', dueAt: day(30).toISOString() }, NOW)).toMatchObject({ ok: true });
  });
});

const signals = (over: Partial<GoalSignals> = {}): GoalSignals => ({
  five24: [{ profileId: 'p1', member: 'Alex', count: 3, limit: 5, nextSlotAt: null }, { profileId: 'p2', member: 'Riley', count: 6, limit: 5, nextSlotAt: day(120) }],
  annualFeesCents: 69500,
  rewards12mCents: 42000,
  balances: [{ program: 'World of Hyatt', member: 'Alex', balance: 30000 }, { program: 'Delta SkyMiles', member: 'Alex', balance: 85000 }],
  statuses: [{ program: 'World of Hyatt', level: 'Explorist', member: 'Alex', progress: 20, required: 30, maintained: false, pct: 67, headline: 'Explorist: 67% there', expiresAt: day(90) }],
  ...over,
});
const g = (kind: string, target: object, extra: object = {}) => ({ kind: kind as never, title: 'g', target, ...extra });

describe('TC-GOALS: progress comes from the member’s own data', () => {
  it('5/24', () => {
    expect(goalProgress(g('FIVE24', { max: 4 }, { profileId: 'p1' }), signals(), NOW)).toMatchObject({ state: 'ON_TRACK', current: 'Alex: 3/24' });
    const behind = goalProgress(g('FIVE24', { max: 4 }, { profileId: 'p2' }), signals(), NOW);
    expect(behind).toMatchObject({ state: 'BEHIND', current: 'Riley: 6/24' });
    expect(behind.detail).toMatch(/next card drops off/);
    expect(goalProgress(g('FIVE24', { max: 4 }), signals({ five24: [] }), NOW).state).toBe('UNKNOWN');
  });
  it('status', () => {
    const p = goalProgress(g('STATUS', { program: 'Hyatt', level: 'Globalist' }), signals(), NOW);
    expect(p.state).toBe('ON_TRACK');
    expect(p.detail).toMatch(/different tier/);
    expect(goalProgress(g('STATUS', { program: 'Hyatt', level: 'Explorist' }), signals(), NOW)).toMatchObject({ pct: 67, current: '20 of 30' });
    expect(goalProgress(g('STATUS', { program: 'Hilton', level: 'Gold' }), signals(), NOW).state).toBe('UNKNOWN');
    const kept = signals({ statuses: [{ program: 'Hyatt', level: 'Globalist', member: 'A', progress: 60, required: 60, maintained: true, pct: 100, headline: 'kept', expiresAt: null }] });
    expect(goalProgress(g('STATUS', { program: 'Hyatt', level: 'Globalist' }), kept, NOW).state).toBe('ACHIEVED');
  });
  it('trip, miles, cash back and fees', () => {
    expect(goalProgress(g('TRIP', { destination: 'Seoul', pointsNeeded: 170000, program: 'Delta' }), signals(), NOW)).toMatchObject({ pct: 50, state: 'ON_TRACK' });
    expect(goalProgress(g('TRIP', { destination: 'Seoul', pointsNeeded: 170000, program: 'Delta' }, { dueAt: day(30) }), signals(), NOW).state).toBe('AT_RISK');
    expect(goalProgress(g('TRIP', { destination: 'Seoul', pointsNeeded: 80000, program: 'Delta' }), signals(), NOW).state).toBe('ACHIEVED');
    expect(goalProgress(g('MILES', { program: 'Delta', points: 100000 }), signals(), NOW)).toMatchObject({ pct: 85 });
    expect(goalProgress(g('MILES', { program: 'United', points: 100000 }), signals(), NOW).state).toBe('UNKNOWN');
    expect(goalProgress(g('CASHBACK', { annualCents: 84000 }), signals(), NOW)).toMatchObject({ pct: 50 });
    expect(goalProgress(g('FEES', { maxCents: 50000 }), signals(), NOW)).toMatchObject({ state: 'BEHIND', pct: 72 });
    expect(goalProgress(g('FEES', { maxCents: 100000 }), signals(), NOW).state).toBe('ON_TRACK');
  });
  it('custom goals use the number the member sets', () => {
    expect(goalProgress(g('CUSTOM', {}, { manualProgress: 40 }), signals(), NOW)).toMatchObject({ pct: 40, state: 'ON_TRACK' });
    expect(goalProgress(g('CUSTOM', {}), signals(), NOW).state).toBe('UNKNOWN');
    expect(goalProgress(g('CUSTOM', {}, { manualProgress: 100 }), signals(), NOW).state).toBe('ACHIEVED');
  });
});

const item = (id: string, over: Partial<PlanItem> = {}): PlanItem => ({
  id, lens: 'OFFER', horizon: 'WEEK', priority: 10, title: id, recommendation: 'r', reason: 'r', evidence: ['e'], expectedValueCents: null, assumptions: [], risks: [], confidence: 80, factors: [], href: '/', facts: { kind: 'X' }, calls: [], ...over,
});

describe('TC-MEMORY: preferences and decisions', () => {
  it('validates preferences, keeping only what was given', () => {
    expect(checkPreferences({ airlines: [' Delta ', 'delta', 'United'], priorities: ['TRAVEL', 'TRAVEL'] })).toEqual({ ok: true, value: { airlines: ['Delta', 'United'], priorities: ['TRAVEL'] } });
    for (const bad of [{ airlines: 'Delta' }, { hotels: Array.from({ length: 13 }, (_, i) => 'hotel' + i) }, { merchants: ['x'.repeat(61)] }, { priorities: ['FUN'] }, null, []]) expect(checkPreferences(bad).ok).toBe(false);
  });
  it('decisions last as long as the action implies', () => {
    const d = (action: string, days?: number) => checkDecision({ itemId: 'offer-exp:1', action, days }, NOW);
    expect(d('DISMISS')).toMatchObject({ ok: true });
    expect((d('DISMISS') as { value: { until: string } }).value.until).toBe(day(DISMISS_DAYS).toISOString());
    expect((d('SNOOZE') as { value: { until: string } }).value.until).toBe(day(7).toISOString());
    expect((d('SNOOZE', 3) as { value: { until: string } }).value.until).toBe(day(3).toISOString());
    expect((d('DONE') as { value: { until: string } }).value.until).toBe(day(30).toISOString());
    for (const bad of [d('SNOOZE', 0), d('SNOOZE', 91), d('NOPE'), checkDecision({ itemId: '', action: 'DONE' }, NOW)]) expect(bad.ok).toBe(false);
    expect(isHidden({ until: day(1).toISOString() }, NOW)).toBe(true);
    expect(isHidden({ until: day(-1).toISOString() }, NOW)).toBe(false);
  });
  it('hides what was put aside, lifts what matches, and never invents an item', () => {
    const items = [item('a', { priority: 5, facts: { kind: 'X', program: 'Delta SkyMiles' } }), item('b', { priority: 9 }), item('c', { priority: 8, lens: 'CARD_STRATEGY' })];
    const decisions = new Map([['b', { itemId: 'b', action: 'SNOOZE' as const, until: day(3).toISOString(), at: NOW.toISOString() }]]);
    const eff = applyMemory(items, { airlines: ['delta'], hotels: [], destinations: [], merchants: [], priorities: ['LOW_FEE'] }, decisions, NOW);
    expect(eff.hidden.map((h) => h.id)).toEqual(['b']);
    expect(eff.items.map((i) => i.id)).toEqual(['c', 'a']);
    expect(eff.items.find((i) => i.id === 'a')!.factors.map((f) => f.label)).toContain('Matches your preferences');
    expect(eff.boosted).toBe(2);
    // an expired decision no longer hides
    const old = new Map([['b', { itemId: 'b', action: 'DISMISS' as const, until: day(-1).toISOString(), at: NOW.toISOString() }]]);
    expect(applyMemory(items, { airlines: [], hotels: [], destinations: [], merchants: [], priorities: [] }, old, NOW).items).toHaveLength(3);
  });
});

describe('TC-COPILOT: the agenda uses goals and memory', () => {
  const ok = (tool: string, data: unknown): StepResult => ({ tool, label: tool, ok: true, summary: '', data });
  const results = [
    // equal value and urgency, so only a preference can put the second one first
    ok('get_expiring_offers', { buckets: [{ items: [{ id: 'o1', label: 'Hilton $20', endsAt: day(2), valueCents: 2000, action: 'Use' }, { id: 'o2', label: 'Uber $20', endsAt: day(3), valueCents: 2000, action: 'Use' }] }] }),
  ];
  const behind: GoalView = { id: 'g1', title: 'Visit Korea', kind: 'TRIP', dueAt: day(30), progress: { pct: 20, current: '34,000 points', target: '170,000 points for Seoul', state: 'AT_RISK', detail: '136,000 more points needed for Seoul.', next: ['Look at transfer bonuses.'], confidence: 70 } };
  const fine: GoalView = { id: 'g2', title: 'Stay under 5/24', kind: 'FIVE24', dueAt: null, progress: { pct: 100, current: 'Alex: 3/24', target: '4/24 or fewer', state: 'ON_TRACK', detail: 'ok', next: [], confidence: 85 } };

  it('adds goals that need attention, not those on track, and never puts the goal’s own words in the redactable facts', () => {
    const plan = composeAgenda(results, 'PLANNING', 'What should I do this month?', NOW, { goals: [behind, fine] });
    const goal = plan.items.find((i) => i.id === 'goal:g1')!;
    expect(goal).toMatchObject({ lens: 'GOAL', horizon: 'MONTH' });
    expect(goal.title).toMatch(/Visit Korea \(20%\)/);
    expect(plan.items.some((i) => i.id === 'goal:g2')).toBe(false);
    expect(JSON.stringify(goal.facts)).not.toMatch(/Korea|Seoul/);
    expect(plan.lenses.find((l) => l.lens === 'GOAL')).toMatchObject({ found: 1 });
  });

  it('hides snoozed items, says so, and raises preferred ones', () => {
    const decisions = new Map([['offer-exp:o1', { itemId: 'offer-exp:o1', action: 'SNOOZE' as const, until: day(5).toISOString(), at: NOW.toISOString() }]]);
    const plan = composeAgenda(results, 'PLANNING', 'What should I do this month?', NOW, { decisions });
    expect(plan.items.map((i) => i.id)).toEqual(['offer-exp:o2']);
    expect(plan.memory.hidden).toHaveLength(1);
    expect(plan.summary).toMatch(/1 item you snoozed or dismissed is hidden/);
    const prefs = composeAgenda(results, 'PLANNING', 'What should I do this month?', NOW, { prefs: { airlines: [], hotels: [], destinations: [], merchants: ['uber'], priorities: [] } });
    expect(prefs.items[0].id).toBe('offer-exp:o2');
    expect(prefs.memory.boosted).toBe(1);
  });

  it('a goal that needs attention keeps a place even in a short plan', () => {
    const many = ok('get_expiring_offers', { buckets: [{ items: Array.from({ length: 8 }, (_, i) => ({ id: 'x' + i, label: 'Offer ' + i, endsAt: day(2), valueCents: 20000 + i, action: 'Use' })) }] });
    const plan = composeAgenda([many], 'QUICK', 'What should I do this month?', NOW, { goals: [behind] });
    expect(plan.items).toHaveLength(5);
    expect(plan.items.some((i) => i.id === 'goal:g1')).toBe(true);
  });

  it('without goals or memory it is unchanged', () => {
    expect(composeAgenda(results, 'PLANNING', 'What should I do this month?', NOW).items.map((i) => i.id)).toEqual(['offer-exp:o1', 'offer-exp:o2']);
  });
});

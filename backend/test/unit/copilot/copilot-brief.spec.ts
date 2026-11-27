import type { StepResult } from '../../../src/domain/answer-compose';
import { alertsFor, AlertSignals, cardVerdicts, dailyBrief, daysLeftInMonth, MAX_ALERTS_PER_RUN, monthlyBrief, notificationFor, periodKey, weeklyBrief } from '../../../src/domain/copilot-brief';
import { composeAgenda } from '../../../src/domain/copilot-plan';

const NOW = new Date('2026-11-26T15:00:00Z'); // a Thursday
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const ok = (tool: string, data: unknown): StepResult => ({ tool, label: tool, ok: true, summary: '', data });

const results = [
  ok('get_expiring_offers', { buckets: [{ items: [{ id: 'o1', label: 'Hilton $100', endsAt: day(1), valueCents: 10000, action: 'Use' }, { id: 'o2', label: 'Uber $20', endsAt: day(5), valueCents: 2000, action: 'Use' }, { id: 'o3', label: 'Dining $15', endsAt: day(20), valueCents: 1500, action: 'Use' }] }] }),
  ok('get_transfer_bonuses', [{ currencyName: 'MR', programName: 'Hilton Honors', activeBonusPercent: 30, advice: { text: 'ok' } }]),
  ok('get_certificates', { certificates: [{ id: 'c1', name: 'Hyatt free night', member: 'A', expiresAt: day(25), potentialValueCents: 25000, status: 'ACTIVE' }] }),
  ok('get_five24_status', [{ member: 'Riley', label: '6/24', count: 6, underLimit: false, nextSlotAt: '2027-03-01' }]),
];
const plan = composeAgenda(results, 'PLANNING', 'What should I do this month?', NOW, {
  goals: [{ id: 'g', title: 'Visit Korea', kind: 'TRIP', dueAt: day(30), progress: { pct: 20, current: 'x', target: 'y', state: 'AT_RISK', detail: 'Behind pace', next: ['Save more'], confidence: 70 } }],
});

describe('TC-BRIEF: periods', () => {
  it('keys are the day, the Monday and the month', () => {
    expect(periodKey('DAILY', NOW)).toBe('2026-11-26');
    expect(periodKey('WEEKLY', NOW)).toBe('2026-11-23');
    expect(periodKey('WEEKLY', new Date('2026-11-22T10:00:00Z'))).toBe('2026-11-16'); // Sunday belongs to the week before
    expect(periodKey('MONTHLY', NOW)).toBe('2026-11');
    expect(daysLeftInMonth(NOW)).toBe(4);
    expect(daysLeftInMonth(new Date('2026-11-30T01:00:00Z'))).toBe(0);
  });
});

describe('TC-BRIEF: daily', () => {
  const b = dailyBrief(plan, { newOffers: 3, newOffersCents: 4500 }, NOW);
  const sec = (k: string) => b.sections.find((s) => s.key === k)!;

  it('puts each item once: priorities by when, with travel, goals and household apart', () => {
    expect(b.kind).toBe('DAILY');
    expect(b.periodKey).toBe('2026-11-26');
    expect(sec('today').lines[0].text).toMatch(/Hilton \$100 ends/);
    expect(sec('week').lines.map((l) => l.text).join(' ')).toMatch(/Uber/);
    expect(sec('travel').lines[0].text).toMatch(/transfer bonus/);
    expect(sec('goals').lines[0].text).toMatch(/Visit Korea/);
    expect(sec('household').lines.map((l) => l.text).join(' ')).toMatch(/Riley/);
    const all = b.sections.filter((s) => s.key !== 'new').flatMap((s) => s.lines.map((l) => l.itemId));
    expect(new Set(all).size).toBe(all.length);
  });

  it('says what is new, and what to say when a section is empty', () => {
    expect(sec('new').lines[0].text).toBe('3 new offers found, worth about $45');
    const quiet = dailyBrief(composeAgenda([ok('get_expiring_offers', { buckets: [] })], 'QUICK', 'What should I do today?', NOW), { newOffers: 0, newOffersCents: 0 }, NOW);
    expect(quiet.headline).toBe('All clear today');
    expect(quiet.sections.find((s) => s.key === 'today')!.lines).toEqual([]);
    expect(quiet.sections.find((s) => s.key === 'today')!.empty).toBe('Nothing is due today.');
  });

  it('headline reflects the day, lines are tagged by urgency, and every line can be set aside', () => {
    expect(b.headline).toMatch(/to do today/);
    expect(sec('today').lines[0].tone).toBe('urgent');
    expect(sec('week').lines[0].tone).toBe('warn');
    expect(sec('today').lines.every((l) => l.itemId)).toBe(true);
    expect(b.stats).toMatchObject({ today: plan.counts.TODAY, newOffers: 3 });
    expect(b.confidence).toBe(plan.confidence);
  });
});

describe('TC-BRIEF: weekly', () => {
  const w = { newOffers: 4, newOffersCents: 9000, addedOffers: 2, savedCents: 3500, redeemedOffers: 1, missedCents: 4000, certsUsed: 1, changes: [{ program: 'Hyatt', what: 'balance 30,000' }], healthScore: 62, healthLabel: 'FAIR', healthReasons: ['2 balances are stale'] };
  const b = weeklyBrief(plan, w, NOW);
  const sec = (k: string) => b.sections.find((s) => s.key === k)!;
  it('covers what changed, savings, what was missed, health and next steps', () => {
    expect(b.kind).toBe('WEEKLY');
    expect(b.periodKey).toBe('2026-11-23');
    expect(sec('changed').lines.map((l) => l.text)).toEqual(expect.arrayContaining(['4 new offers found, about $90', '2 offers added', '1 offer redeemed', '1 certificate used', 'Hyatt: balance 30,000']));
    expect(sec('savings').lines[0].text).toMatch(/\$35 saved/);
    expect(sec('missed').lines[0]).toMatchObject({ tone: 'warn', valueCents: -4000 });
    expect(sec('health').lines[0].text).toMatch(/62\/100 \(fair\)/);
    expect(sec('recommendations').lines.length).toBeGreaterThan(0);
    expect(b.headline).toMatch(/\$40 that slipped away/);
    expect(b.assumptions[0]).toMatch(/only offers you added/);
  });
  it('a quiet week says so', () => {
    const q = weeklyBrief(composeAgenda([ok('get_expiring_offers', { buckets: [] })], 'PLANNING', 'week', NOW), { ...w, newOffers: 0, newOffersCents: 0, addedOffers: 0, savedCents: 0, redeemedOffers: 0, missedCents: 0, certsUsed: 0, changes: [], healthScore: null, healthLabel: null, healthReasons: [] }, NOW);
    expect(q.headline).toBe('A quiet, on-track week');
    expect(q.sections.find((s) => s.key === 'changed')!.lines).toEqual([]);
    expect(q.sections.find((s) => s.key === 'health')!.empty).toMatch(/Not enough/);
  });
});

describe('TC-BRIEF: monthly review', () => {
  const card = (over: object) => ({ card: 'Card', feeCents: 39500, valueCents: 50000, daysToRenewal: 24, hasSiblingNoFee: false, openedMonths: 30, ...over });
  it('keep, downgrade, cancel or review, from what each card returned', () => {
    const v = cardVerdicts([
      card({ card: 'Free', feeCents: 0, valueCents: 0 }),
      card({ card: 'Earner' }),
      card({ card: 'Sibling', valueCents: 10000, hasSiblingNoFee: true }),
      card({ card: 'Dud', valueCents: 5000 }),
      card({ card: 'Close', valueCents: 30000 }),
      card({ card: 'Young', valueCents: 5000, openedMonths: 6 }),
    ]);
    expect(v.map((x) => [x.card, x.verdict])).toEqual([['Free', 'KEEP'], ['Earner', 'KEEP'], ['Sibling', 'DOWNGRADE'], ['Dud', 'CANCEL'], ['Close', 'REVIEW'], ['Young', 'REVIEW']]);
    expect(v[3].reason).toMatch(/retention offer/);
    expect(v[4].reason).toMatch(/renews in 24 days/);
    expect(v[1].netCents).toBe(10500);
  });
  it('arranges them as keep/downgrade/cancel, fees, apply, transfer, redeem, wait and goals, never as an instruction', () => {
    const m = { cards: [card({ card: 'Dud', valueCents: 5000 }), card({ card: 'Earner' })], applyPick: { member: 'Riley', card: 'Sapphire', firstYearCents: 90000, usesSlot: true }, members: [{ member: 'Riley', count: 6, underLimit: false, nextSlotAt: day(90) }, { member: 'Alex', count: 2, underLimit: true, nextSlotAt: null }], feesCents: 79000, valueCents: 55000 };
    const b = monthlyBrief(plan, m, NOW);
    const sec = (k: string) => b.sections.find((s) => s.key === k)!;
    expect(b.periodKey).toBe('2026-11');
    expect(sec('cards').lines.map((l) => l.text)).toEqual(['Consider cancelling Dud', 'Keep Earner']);
    expect(sec('cards').lines[0].tone).toBe('urgent');
    expect(sec('fees').lines[0].text).toMatch(/\$790 in annual fees.*\$550/);
    expect(sec('apply').lines[0].detail).toMatch(/you decide whether and when/);
    expect(sec('transfer').lines.length).toBe(1);
    expect(sec('redeem').lines.map((l) => l.text).join(' ')).toMatch(/Hyatt free night/);
    expect(sec('wait').lines.map((l) => l.text)).toEqual(['Riley is at 6/24']);
    expect(sec('goals').lines[0].text).toMatch(/Visit Korea/);
    expect(b.headline).toBe('1 card worth a decision this month');
    expect(b.summary).toBe('2 cards reviewed: 1 keep, 0 downgrade, 1 cancel, 0 to review.');
    expect(b.assumptions.join(' ')).toMatch(/nothing is done for you/);
    expect(JSON.stringify(b)).not.toMatch(/automatically (apply|cancel|transfer|book)/i);
  });
  it('an empty wallet says so and is less sure', () => {
    const b = monthlyBrief(plan, { cards: [], applyPick: null, members: [], feesCents: 0, valueCents: 0 }, NOW);
    expect(b.sections.find((s) => s.key === 'cards')!.empty).toMatch(/no cards/);
    expect(b.confidence).toBeLessThanOrEqual(40);
  });
});

describe('TC-ALERTS: only what is worth interrupting for', () => {
  const base: AlertSignals = { offersAvailableCents: 32400, offersAvailableCount: 5, topOffers: ['Hilton', 'Marriott', 'Uber'], applyPick: { member: 'Riley', card: 'Sapphire Preferred', slug: 'csp', firstYearCents: 90000, memberIsPrimary: false, usesSlot: true }, goalsNeedingAttention: [{ id: 'g1', title: 'Visit Korea', detail: 'Behind pace' }], creditsUnusedCents: 4500, daysLeftInMonth: 4 };

  it('names the savings, the best applicant, the goal and the unused credits, most pressing first', () => {
    const a = alertsFor(base, NOW);
    expect(a.map((x) => x.key)).toEqual(['credits', 'goal:g1', 'savings']);
    expect(a.find((x) => x.key === 'savings')!.title).toBe('You can save about $324 using available offers');
    expect(a.find((x) => x.key === 'savings')!.body).toMatch(/including Hilton and Marriott/);
    expect(a.find((x) => x.key === 'credits')!.title).toMatch(/\$45 of this month’s credits/);
    expect(MAX_ALERTS_PER_RUN).toBe(3);
  });
  it('the best applicant is only raised when it is someone else and worth it', () => {
    const all = alertsFor({ ...base, offersAvailableCents: 0, goalsNeedingAttention: [], creditsUnusedCents: 0 }, NOW);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ key: 'apply', link: '/next-card' });
    expect(all[0].title).toBe('Riley is the best person to apply for Sapphire Preferred');
    expect(all[0].body).toMatch(/whether and when to apply is yours to decide/);
    const you = { ...base, offersAvailableCents: 0, goalsNeedingAttention: [], creditsUnusedCents: 0 };
    expect(alertsFor({ ...you, applyPick: { ...base.applyPick!, memberIsPrimary: true } }, NOW)).toEqual([]);
    expect(alertsFor({ ...you, applyPick: { ...base.applyPick!, firstYearCents: 10000 } }, NOW)).toEqual([]);
  });
  it('thresholds: small savings, plenty of month left and no credits stay quiet', () => {
    const none = { ...base, applyPick: null, goalsNeedingAttention: [] };
    expect(alertsFor({ ...none, offersAvailableCents: 4000, creditsUnusedCents: 0 }, NOW)).toEqual([]);
    expect(alertsFor({ ...none, offersAvailableCents: 0, daysLeftInMonth: 20 }, NOW)).toEqual([]);
    expect(alertsFor({ ...none, offersAvailableCents: 0, creditsUnusedCents: 2000 }, NOW)).toEqual([]);
  });
  it('dedupe keys repeat within a week or month so asking twice makes one notification', () => {
    const a = alertsFor(base, NOW);
    const again = alertsFor(base, new Date('2026-11-27T15:00:00Z'));
    expect(a.map((x) => x.dedupeKey)).toEqual(again.map((x) => x.dedupeKey));
    expect(a.find((x) => x.key === 'savings')!.dedupeKey).toBe('copilot:savings:2026-11-23');
    expect(alertsFor(base, new Date('2026-12-02T15:00:00Z')).find((x) => x.key === 'savings')!.dedupeKey).not.toBe('copilot:savings:2026-11-23');
  });
  it('a briefing is announced by name', () => {
    const n = notificationFor(dailyBrief(plan, { newOffers: 0, newOffersCents: 0 }, NOW));
    expect(n.title).toBe('Your daily Copilot briefing');
    expect(n.body.length).toBeLessThanOrEqual(260);
  });
});

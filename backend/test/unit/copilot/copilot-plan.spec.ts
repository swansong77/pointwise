import { composeAgenda, centsOf, horizonFor, isAgendaQuestion, scopeOf } from '../../../src/domain/copilot-plan';
import type { StepResult } from '../../../src/domain/answer-compose';

const NOW = new Date('2026-11-26T15:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const ok = (tool: string, data: unknown): StepResult => ({ tool, label: tool, ok: true, summary: '', data });
const bad = (tool: string): StepResult => ({ tool, label: tool, ok: false, summary: '', data: null, error: 'timed out' });

const FULL: StepResult[] = [
  ok('get_expiring_offers', { buckets: [{ items: [{ id: 'o1', label: 'Hilton: $100 back', cardholder: 'Alex', card: 'Contoso Gold', endsAt: new Date(NOW.getTime() + 1 * 86_400_000), valueCents: 10000, action: 'Spend $500 with Hilton' }, { id: 'cert-dup', kind: 'CERTIFICATE', label: 'Hyatt free night', endsAt: new Date(NOW.getTime() + 25 * 86_400_000), valueCents: 25000, action: 'x' }, { id: 'o2', label: 'Uber Eats $20', cardholder: 'Riley', card: 'Fabrikam', endsAt: new Date(NOW.getTime() + 20 * 86_400_000), valueCents: 2000, action: 'Order once' }] }] }),
  ok('get_offer_opportunities', { items: [{ id: 'tiny', merchant: 'Tiny', score: 90, expectedValueCents: 80, daysLeft: 2, activated: false }, { id: 'x1', merchant: 'Marriott', score: 80, expectedValueCents: 6000, daysLeft: 9, activated: false, confidence: 70 }, { id: 'x2', merchant: 'Done', activated: true, daysLeft: 3 }] }),
  ok('get_expiring_loyalty', { items: [{ accountId: 'a1', member: 'Alex', program: 'Hilton Honors', unit: 'points', balance: 40000, valueCents: 20000, prediction: { level: 'HIGH', daysLeft: 12, confidence: 80 }, message: 'x', preservation: [{ label: 'Earn 1 point' }] }, { accountId: 'a2', member: 'Alex', program: 'Fine', prediction: { level: 'NONE' }, message: null }] }),
  ok('get_certificates', { certificates: [{ id: 'c1', name: 'Hyatt free night', member: 'Alex', program: 'World of Hyatt', expiresAt: day(25), potentialValueCents: 25000, status: 'ACTIVE' }, { id: 'c2', name: 'Used one', expiresAt: day(5), usedAt: day(-2) }] }),
  ok('get_transfer_bonuses', [{ currencyName: 'Membership Rewards', programName: 'Hilton Honors', activeBonusPercent: 30, advice: { text: 'Good time' } }, { currencyName: 'X', programName: 'Y', activeBonusPercent: 0 }]),
  ok('get_benefit_summary', { items: [{ benefit: 'Uber credit', card: 'Contoso Gold', status: 'AVAILABLE', remaining: '$15', lastDay: '2026-11-30', daysLeft: 4 }, { benefit: 'Empty', card: 'C', remaining: '$0', daysLeft: 2 }] }),
  ok('get_renewals', [{ card: 'Contoso Platinum', renewsOn: '2026-12-20', daysUntil: 24, annualFee: '$695', valueReceived: '$300', coversFee: false }, { card: 'Good', daysUntil: 10, annualFee: '$95', valueReceived: '$500', coversFee: true }]),
  ok('get_five24_status', [{ member: 'Riley', label: '5/24', count: 5, underLimit: false, nextSlotAt: '2027-02-01' }, { member: 'Alex', label: '2/24', count: 2, underLimit: true }]),
  ok('get_stale_accounts', { accounts: [{ member: 'Alex', program: 'Delta SkyMiles', freshness: 'STALE', plan: [{ text: 'Update the balance' }] }, { member: 'Alex', program: 'Fresh', freshness: 'CURRENT' }] }),
  ok('get_missed_offers', { totalLostCents: 4500 }),
];

describe('TC-COPILOT: the agenda', () => {
  const plan = composeAgenda(FULL, 'RESEARCH', 'What should I do this month?', NOW);

  it('puts the most urgent first and groups by horizon', () => {
    expect(plan.kind).toBe('AGENDA');
    expect(plan.items[0].id).toBe('offer-exp:o1');
    expect(plan.items[0].horizon).toBe('TODAY');
    const order = plan.items.map((i) => i.horizon);
    expect([...order].sort((a, b) => ['TODAY', 'WEEK', 'MONTH', 'LATER'].indexOf(a) - ['TODAY', 'WEEK', 'MONTH', 'LATER'].indexOf(b))).toEqual(order);
    expect(plan.headline).toMatch(/to do today/);
    expect(plan.counts.TODAY).toBe(1);
    // a "today" question is shorter than a "this month" one
    expect(composeAgenda(FULL, 'RESEARCH', 'What should I do today?', NOW).items).toHaveLength(6);
    expect(plan.items.length).toBeGreaterThan(6);
  });

  it('every item is explainable: reason, evidence, confidence, factors, assumptions or risks', () => {
    for (const i of plan.items) {
      expect(i.recommendation.length).toBeGreaterThan(5);
      expect(i.reason.length).toBeGreaterThan(5);
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.confidence).toBeGreaterThanOrEqual(20);
      expect(i.confidence).toBeLessThanOrEqual(100);
      expect(i.factors.length).toBeGreaterThan(0);
      expect(i.href.startsWith('/')).toBe(true);
    }
  });

  it('reads each engine: offers, certificates, loyalty, benefits, fees, 5/24, transfers, stale data, missed offers', () => {
    const kinds = new Set(plan.items.map((i) => i.facts.kind));
    for (const k of ['OFFER_EXPIRING', 'OFFER_ACTIVATE', 'CERTIFICATE_EXPIRING', 'LOYALTY_AT_RISK', 'TRANSFER_BONUS', 'CREDIT_UNUSED', 'RENEWAL_REVIEW', 'FIVE24', 'DATA_STALE', 'OFFERS_MISSED']) expect(kinds).toContain(k);
  });

  it('skips what is already done: activated offers, used certificates, empty credits, fee-covering cards, free balances', () => {
    const ids = plan.items.map((i) => i.id).join(' ');
    expect(ids).not.toMatch(/x2|c2|Empty|Good|a2|tiny|cert-dup/);
  });

  it('never proposes an automatic change: activation and transfers say the person does it', () => {
    const act = plan.items.find((i) => i.facts.kind === 'OFFER_ACTIVATE')!;
    expect(act.recommendation).toMatch(/never logs in/);
    const xfer = plan.items.find((i) => i.facts.kind === 'TRANSFER_BONUS')!;
    expect(xfer.recommendation).toMatch(/never transfers/);
    for (const i of plan.items) for (const c of i.calls) expect(c.kind).toBe('REMINDER');
  });

  it('offers reminders only for things that still have time', () => {
    expect(plan.items.find((i) => i.id === 'offer-exp:o2')!.calls[0].kind).toBe('REMINDER');
  });

  it('modes choose the specialists and the length', () => {
    const quick = composeAgenda(FULL, 'QUICK', 'What should I do today?', NOW);
    expect(quick.items.length).toBe(5);
    const strat = composeAgenda(FULL, 'CARD_STRATEGY', 'What should I do?', NOW);
    expect(new Set(strat.items.map((i) => i.lens))).toEqual(new Set(['CARD_STRATEGY', 'PORTFOLIO', 'BENEFIT']));
    const audit = composeAgenda(FULL, 'AUDIT', 'What should I do?', NOW);
    expect(audit.items.some((i) => i.lens === 'AUDIT')).toBe(true);
    expect(plan.lenses.map((l) => l.label)).toContain('Merchant Offers');
  });

  it('says so when nothing needs attention', () => {
    const empty = composeAgenda([ok('get_expiring_offers', { buckets: [] })], 'QUICK', 'What should I do today?', NOW);
    expect(empty.items).toHaveLength(0);
    expect(empty.headline).toMatch(/Nothing needs/);
    expect(empty.confidence).toBeGreaterThan(50);
  });

  it('a failed engine lowers confidence and is said plainly, never hidden', () => {
    const p = composeAgenda([...FULL.slice(0, 5), bad('get_benefit_summary'), bad('get_renewals'), ...FULL.slice(7)], 'PLANNING', 'What should I do today?', NOW);
    expect(p.assumptions[0]).toMatch(/could not be read/);
    expect(p.confidence).toBeLessThan(plan.confidence);
    expect(p.lenses.find((l) => l.lens === 'BENEFIT')!.ok).toBe(false);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(composeAgenda(FULL, 'RESEARCH', 'What should I do this month?', NOW))).toBe(JSON.stringify(plan));
  });
});

describe('TC-COPILOT: reading questions', () => {
  it.each([
    ['What should I do today?', true],
    ['what should I do this month', true],
    ["What's on my plate?", true],
    ['Give me my action plan', true],
    ['What needs attention', true],
    ['What card should I use at Costco for $1,500?', false],
    ['How many points do I have?', false],
    ['Show all Hilton offers', false],
  ])('agenda question %s → %s', (q, expected) => expect(isAgendaQuestion(q)).toBe(expected));

  it.each([
    ['What should I do today?', 'TODAY'],
    ['plan for this week', 'WEEK'],
    ['What should I do this month?', 'MONTH'],
    ['What should I do?', 'WEEK'],
  ])('scope of %s is %s', (q, h) => expect(scopeOf(q)).toBe(h));

  it('horizons and money parsing', () => {
    expect([0, 1, 2, 7, 8, 31, 32, null].map((d) => horizonFor(d as number | null))).toEqual(['TODAY', 'TODAY', 'WEEK', 'WEEK', 'MONTH', 'MONTH', 'LATER', 'LATER']);
    expect([centsOf('$1,234.50'), centsOf('$15'), centsOf('nothing'), centsOf(250)]).toEqual([123450, 1500, null, 250]);
  });
});

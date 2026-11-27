import type { PlanItem } from '../../../src/domain/copilot-plan';
import { agentsFor, bandOf, BAND_MIN, byScore, centerFor, impactOf, MODIFIER, riskLevel, score, sourcesOf, timeSensitivity, toExecItem, valueScore, WEIGHTS } from '../../../src/domain/cos-score';

const NOW = new Date('2026-11-26T15:00:00Z');
const s = (kind: string, dollars: number, daysLeft: number | null, confidence = 90) => score({ kind, valueCents: dollars * 100, daysLeft, confidence });

describe('TC-COS: priority score', () => {
  it('the weights add up to one, and effort and confidence can only scale a score down', () => {
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(MODIFIER.floor + MODIFIER.effort + MODIFIER.confidence).toBeCloseTo(1, 10);
  });

  it('puts familiar situations in the band a person would expect', () => {
    const table: Array<[string, string, number, number | null, string]> = [
      ['$100 offer ends tomorrow', 'OFFER_EXPIRING', 100, 1, 'CRITICAL'],
      ['$250 certificate ends in 3 days', 'CERTIFICATE_EXPIRING', 250, 3, 'CRITICAL'],
      ['$100 offer ends in a week', 'OFFER_EXPIRING', 100, 7, 'HIGH'],
      ['$20 credit ends in a week', 'CREDIT_UNUSED', 20, 7, 'MEDIUM'],
      ['$10 credit ends in 20 days', 'CREDIT_UNUSED', 10, 20, 'LOW'],
      ['$100 offer to activate, 30 days left', 'OFFER_ACTIVATE', 100, 30, 'MEDIUM'],
      ['$100 fee decision in 60 days', 'RENEWAL_REVIEW', 100, 60, 'MEDIUM'],
      ['goal behind, no deadline', 'GOAL', 0, null, 'LOW'],
      ['stale balance', 'DATA_STALE', 0, null, 'INFO'],
    ];
    for (const [label, kind, dollars, days, band] of table) expect([label, s(kind, dollars, days).band]).toEqual([label, band]);
  });

  it('rises with value and with urgency, never leaves 0–100, and is the same every time', () => {
    let prev = -1;
    for (const d of [0, 5, 20, 100, 500, 2000, 20000]) {
      const x = s('OFFER_EXPIRING', d, 5).score;
      expect(x).toBeGreaterThanOrEqual(prev);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      prev = x;
    }
    prev = -1;
    for (const days of [400, 90, 30, 14, 7, 3, 1, 0]) {
      const x = s('CREDIT_UNUSED', 50, days).score;
      expect(x).toBeGreaterThanOrEqual(prev);
      prev = x;
    }
    expect(s('OFFER_EXPIRING', 100, 3)).toEqual(s('OFFER_EXPIRING', 100, 3));
  });

  it('a shakier answer scores lower; a longer task scores lower than a quick one of equal worth', () => {
    expect(s('OFFER_EXPIRING', 100, 5, 40).score).toBeLessThan(s('OFFER_EXPIRING', 100, 5, 95).score);
    const quick = score({ kind: 'OFFER_ACTIVATE', valueCents: 10_000, daysLeft: 10, confidence: 80 });
    const long = score({ kind: 'RENEWAL_REVIEW', valueCents: 10_000, daysLeft: 10, confidence: 80 });
    expect(quick.factors.effortEase).toBeGreaterThan(long.factors.effortEase);
  });

  it('things that lapse score higher than the same thing that is only an opportunity', () => {
    expect(s('OFFER_EXPIRING', 100, 5).score).toBeGreaterThan(s('OFFER_ACTIVATE', 100, 5).score);
    expect(s('OFFER_ACTIVATE', 100, 5).factors.expirationRisk).toBe(0);
  });

  it('bands have the edges they claim', () => {
    expect([64, 65, 49, 50, 27, 28, 11, 12, 0, 100].map(bandOf)).toEqual(['HIGH', 'CRITICAL', 'MEDIUM', 'HIGH', 'LOW', 'MEDIUM', 'INFO', 'LOW', 'INFO', 'CRITICAL']);
    expect(BAND_MIN.CRITICAL).toBeGreaterThan(BAND_MIN.HIGH);
  });

  it('time and value curves', () => {
    expect([0, 1, 3, 7, 14, 31, 92, 400, null].map(timeSensitivity)).toEqual([1, 0.95, 0.85, 0.7, 0.55, 0.35, 0.2, 0.1, 0.25]);
    expect([0, 2000, 10_000, 50_000, 1_000_000].map((c) => Math.round(valueScore(c) * 100))).toEqual([0, 28, 53, 80, 100]);
    expect(valueScore(0)).toBe(0);
    expect(valueScore(10_000_000)).toBe(1);
  });
});

describe('TC-COS: risk, impact and the Action Center', () => {
  it('risk starts from the kind and rises for a shaky answer or a closing window', () => {
    expect(riskLevel('OFFER_EXPIRING', 90, 5)).toBe('LOW');
    expect(riskLevel('OFFER_EXPIRING', 40, 5)).toBe('MEDIUM');
    expect(riskLevel('OFFER_EXPIRING', 90, 1)).toBe('MEDIUM');
    expect(riskLevel('CERTIFICATE_EXPIRING', 90, 5)).toBe('MEDIUM');
    expect(riskLevel('CERTIFICATE_EXPIRING', 40, 1)).toBe('HIGH');
    expect(riskLevel('TRANSFER_BONUS', 90, 5)).toBe('HIGH');
    expect(riskLevel('TRANSFER_BONUS', 20, 0)).toBe('HIGH'); // never beyond high
  });

  it('classifies value as at risk, preserved, created, lost or future', () => {
    expect(impactOf('OFFER_EXPIRING', 10_000)).toMatchObject({ cls: 'PRESERVED', atRiskCents: 10_000, preservedCents: 10_000, createdCents: 0 });
    expect(impactOf('OFFER_ACTIVATE', 6_000)).toMatchObject({ cls: 'CREATED', createdCents: 6_000, atRiskCents: 0 });
    expect(impactOf('OFFERS_MISSED', 4_500)).toMatchObject({ cls: 'LOST', lostCents: 4_500 });
    expect(impactOf('RENEWAL_REVIEW', 20_000)).toMatchObject({ cls: 'FUTURE', futureCents: 20_000, atRiskCents: 20_000 });
    expect(impactOf('GOAL', -5)).toMatchObject({ futureCents: 0 });
  });

  it('places items in the Action Center by when they matter', () => {
    expect([centerFor(0, 'TODAY', 'OFFER_EXPIRING'), centerFor(5, 'WEEK', 'OFFER_EXPIRING'), centerFor(20, 'MONTH', 'OFFER_EXPIRING'), centerFor(60, 'LATER', 'CERTIFICATE_EXPIRING'), centerFor(200, 'LATER', 'LOYALTY_AT_RISK')]).toEqual(['TODAY', 'WEEK', 'MONTH', 'QUARTER', 'ANNUAL']);
    expect([centerFor(40, 'LATER', 'RENEWAL_REVIEW'), centerFor(300, 'LATER', 'RENEWAL_REVIEW'), centerFor(5, 'LATER', 'STATUS_REQUAL')]).toEqual(['QUARTER', 'ANNUAL', 'WEEK']);
    expect([centerFor(null, 'TODAY', 'GOAL'), centerFor(null, 'MONTH', 'GOAL'), centerFor(null, 'LATER', 'GOAL')]).toEqual(['TODAY', 'MONTH', 'QUARTER']);
  });

  it('agents behind a lens always include the Chief of Staff, and sources are named once', () => {
    expect(agentsFor('OFFER').map((a) => a.label)).toEqual(['Merchant Offer Agent', 'Offer Discovery Agent', 'Chief of Staff']);
    expect(agentsFor('GOAL').map((a) => a.key)).toEqual(['chief-of-staff']);
    expect(sourcesOf(['Expiring offers: ends 2026-12-01', 'Expiring offers: ends 2026-12-03', 'Benefits: 4 days left'])).toEqual(['Expiring offers', 'Benefits']);
  });
});

const item = (id: string, kind: string, over: Partial<PlanItem> = {}): PlanItem => ({
  id, lens: 'OFFER', horizon: 'WEEK', priority: 10, title: id, recommendation: 'Do it', reason: 'Because', evidence: ['Expiring offers: ends 2026-11-30'], expectedValueCents: 10_000, assumptions: [], risks: [], confidence: 90, factors: [], href: '/x', facts: { kind, daysLeft: 4, amountCents: 10_000 }, calls: [], ...over,
});

describe('TC-COS: an executive item', () => {
  it('carries everything an executive summary shows: why, value, deadline, risk, alternatives, sources, agents, time', () => {
    const e = toExecItem(item('a', 'OFFER_EXPIRING'), NOW);
    expect(e).toMatchObject({ id: 'a', band: expect.stringMatching(/CRITICAL|HIGH/), timeMinutes: 10, deadline: '2026-11-30', daysLeft: 4, center: 'WEEK', reason: 'Because' });
    expect(e.risk).toEqual({ level: 'LOW', note: 'Low risk.' });
    expect(e.impact.atRiskCents).toBe(10_000);
    expect(e.alternatives.length).toBeGreaterThan(0);
    expect(e.sources).toEqual(['Expiring offers']);
    expect(e.agents.map((a) => a.key)).toContain('chief-of-staff');
    expect(Object.keys(e.scoreFactors).sort()).toEqual([...Object.keys(WEIGHTS), 'confidence', 'effortEase'].sort());
    expect(e.score).toBeGreaterThan(0);
  });

  it('uses the item’s own risk text, and handles an unknown kind and no deadline', () => {
    expect(toExecItem(item('b', 'OFFER_EXPIRING', { risks: ['Ends today.'] }), NOW).risk.note).toBe('Ends today.');
    const u = toExecItem(item('c', 'SOMETHING_NEW', { facts: { kind: 'SOMETHING_NEW' }, expectedValueCents: null }), NOW);
    expect(u.deadline).toBeNull();
    expect(u.band).toBe('INFO');
  });

  it('sorts highest first with a stable tie-break', () => {
    const list = [item('z', 'OFFER_EXPIRING', { facts: { kind: 'OFFER_EXPIRING', daysLeft: 20, amountCents: 1_000 }, expectedValueCents: 1_000 }), item('b', 'OFFER_EXPIRING'), item('a', 'OFFER_EXPIRING')].map((i) => toExecItem(i, NOW)).sort(byScore);
    expect(list.map((x) => x.id)).toEqual(['a', 'b', 'z']);
  });
});

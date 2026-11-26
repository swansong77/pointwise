import { daysLeftInQuarter, nextQuarter, quarterBounds, quarterOf, RotatingEntry, validateEntry } from '../../src/domain/rotating-calendar';
import { ROTATING_CALENDAR } from '../../src/seed/rotating-calendar';
import { CATEGORIES } from '../../src/seed/categories';

const cats = new Set(CATEGORIES.map((c) => c[0]));
const entry = (o: Partial<RotatingEntry> = {}): RotatingEntry => ({ cards: ['x'], quarter: '2027-Q1', categories: [{ cat: 'gas', mult: 5, desc: '5% at gas stations' }], sourceUrl: 'https://example.com/q', checkedOn: '2026-12-15', ...o });

describe('quarters', () => {
  it('names the quarter of a date and the next one', () => {
    expect(quarterOf(new Date('2026-11-26T12:00:00Z'))).toBe('2026-Q4');
    expect(quarterOf(new Date('2027-01-01T00:00:00Z'))).toBe('2027-Q1');
    expect(nextQuarter('2026-Q4')).toBe('2027-Q1');
    expect(nextQuarter('2026-Q1')).toBe('2026-Q2');
    expect(() => nextQuarter('Q4')).toThrow();
  });
  it('gives the first and last instant of a quarter', () => {
    const b = quarterBounds('2026-Q4');
    expect(b.startsAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(b.endsAt.toISOString()).toBe('2026-12-31T23:59:59.000Z');
    expect(quarterBounds('2027-Q1').endsAt.toISOString()).toBe('2027-03-31T23:59:59.000Z');
    expect(() => quarterBounds('x')).toThrow();
  });
  it('counts the days left in the quarter', () => {
    expect(daysLeftInQuarter(new Date('2026-12-10T00:00:00Z'))).toBe(22);
    expect(daysLeftInQuarter(new Date('2026-10-01T00:00:00Z'))).toBeGreaterThan(90);
  });
});

describe('validateEntry', () => {
  it('accepts a good entry', () => expect(validateEntry(entry(), cats)).toEqual([]));
  it('rejects every kind of bad input', () => {
    const bad = validateEntry(entry({ quarter: '2027Q1', cards: [], categories: [{ cat: 'nope', mult: 50, desc: 'x' }, { cat: 'nope', mult: 5, desc: 'five percent' }], capDollars: -1, sourceUrl: 'http://x', checkedOn: 'yesterday' }), cats).join(' | ');
    for (const w of ['not like 2026-Q4', 'no cards', 'unknown category', 'not between 0 and 10', 'describe the rate', 'cap -1', 'https page', 'YYYY-MM-DD', 'twice']) expect(bad).toContain(w);
    expect(validateEntry(entry({ categories: [] }), cats)).toContain('no categories');
  });
});

describe('the committed calendar', () => {
  it('is valid, lists each card and quarter once, and only names real categories', () => {
    const seen = new Set<string>();
    for (const e of ROTATING_CALENDAR) {
      expect(validateEntry(e, cats)).toEqual([]);
      for (const c of e.cards) {
        expect(seen.has(`${c}:${e.quarter}`)).toBe(false);
        seen.add(`${c}:${e.quarter}`);
      }
    }
  });
});

import { parseRotating, quarterIn } from '../../src/domain/rotating-parse';
import { ROTATING_SOURCES } from '../../src/seed/rotating-sources';

// Synthetic page text in the shapes issuers use; not copied from any issuer page.
const NOW = new Date('2026-12-10T00:00:00Z');
describe('parseRotating', () => {
  it('reads a quarter named as a month range, with the rate, categories and cap', () => {
    const r = parseRotating('Welcome. Earn 5% bonus on grocery stores and restaurants from January - March 2027, up to $1,500 in combined purchases each quarter you activate. Other text 3% on drugstores.', NOW);
    expect(r).toMatchObject({ ok: true, parsed: { quarter: '2027-Q1', mult: 5, capDollars: 1500 } });
    if (r.ok) expect(r.parsed.categories.map((c) => c.cat).sort()).toEqual(['dining', 'groceries']);
  });
  it('reads Q-style labels and defaults the year', () => {
    expect(quarterIn('5% bonus in Q2 2027', NOW)).toBe('2027-Q2');
    expect(quarterIn('Q3 bonus', NOW)).toBe('2026-Q3');
    expect(quarterIn('April to June 2027', NOW)).toBe('2027-Q2');
    expect(quarterIn('February to May', NOW)).toBeNull();
    expect(quarterIn('no dates here', NOW)).toBeNull();
  });
  it('refuses a page it cannot read with certainty', () => {
    const no = (t: string) => { const r = parseRotating(t, NOW); return r.ok ? 'ok' : r.reason; };
    expect(no('Earn 5% on up to $1,500 each quarter when you activate.')).toMatch(/no quarter/);
    expect(no('5% bonus on gas stations in Q1 2027. 5% bonus on grocery stores in Q2 2027.')).toMatch(/more than one quarter/);
    expect(no('5% bonus on gas stations in Q1 2027. 3% bonus on restaurants in Q1 2027.')).toMatch(/more than one rate/);
    expect(no('')).toMatch(/no quarter/);
  });
  it('the committed sources are https issuer pages and unreadable ones say why', () => {
    for (const s of ROTATING_SOURCES) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.cards.length).toBeGreaterThan(0);
      if (s.unreadable) expect(s.unreadable.length).toBeGreaterThan(20);
    }
  });
});

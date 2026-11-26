import { dropOffDate, evaluateCard, Five24Card, five24Label, five24Status, five24Timeline } from '../../../src/domain/five24';

const NOW = new Date('2026-11-21T12:00:00Z');
let n = 0;
const card = (openedAt: string | null, over: Partial<Five24Card> = {}): Five24Card => ({
  id: `c${++n}`,
  name: `Card ${n}`,
  issuer: 'Issuer',
  type: 'PERSONAL',
  cardholder: 'PRIMARY',
  status: 'APPROVED',
  openedAt: openedAt ? new Date(openedAt) : null,
  ...over,
});

describe('5/24 label', () => {
  it.each([
    [0, '0/24'],
    [1, '1/24'],
    [5, '5/24'],
    [6, '6/24+'],
    [9, '6/24+'],
  ])('%i → %s', (c, l) => expect(five24Label(c)).toBe(l));
});

describe('dropOffDate', () => {
  it('day precision: exactly 24 months later', () => {
    expect(dropOffDate(new Date('2025-03-15T00:00:00Z')).toISOString()).toBe('2027-03-15T00:00:00.000Z');
  });
  it('clamps month ends (Aug 31 → Aug 31; Feb 29 → Feb 28)', () => {
    expect(dropOffDate(new Date('2024-02-29T00:00:00Z')).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
  it('month precision: first day of the 25th month (conservative)', () => {
    expect(dropOffDate(new Date('2025-03-01T00:00:00Z'), 'MONTH').toISOString()).toBe('2027-04-01T00:00:00.000Z');
  });
});

describe('evaluateCard rules', () => {
  it('counts a personal card opened within 24 months', () => {
    const r = evaluateCard(card('2025-06-01'), NOW);
    expect(r).toMatchObject({ counts: true, reason: 'PERSONAL' });
    expect(r.dropsOffAt?.toISOString()).toBe('2027-06-01T00:00:00.000Z');
  });
  it('counts closed personal cards', () => {
    expect(evaluateCard(card('2025-06-01', { status: 'CLOSED' }), NOW).counts).toBe(true);
  });
  it('counts authorized-user cards', () => {
    expect(evaluateCard(card('2025-06-01', { cardholder: 'AUTHORIZED_USER' }), NOW)).toMatchObject({ counts: true, reason: 'AUTHORIZED_USER' });
  });
  it('ignores business cards unless the issuer reports them to personal bureaus', () => {
    expect(evaluateCard(card('2025-06-01', { type: 'BUSINESS' }), NOW)).toMatchObject({ counts: false, reason: 'BUSINESS_NOT_REPORTED' });
    expect(evaluateCard(card('2025-06-01', { type: 'BUSINESS', businessReportsToPersonal: true }), NOW)).toMatchObject({
      counts: true,
      reason: 'BUSINESS_REPORTS_TO_PERSONAL',
    });
  });
  it('honours a manual exclusion (e.g. AU card removed on reconsideration)', () => {
    expect(evaluateCard(card('2025-06-01', { excludeFrom524: true, excludeReason: 'AU – recon' }), NOW)).toMatchObject({
      counts: false,
      reason: 'MANUAL_EXCLUSION',
      note: 'AU – recon',
    });
    expect(evaluateCard(card('2025-06-01', { excludeFrom524: true }), NOW).note).toBeNull();
  });
  it('does not count applications or denials', () => {
    expect(evaluateCard(card('2025-06-01', { status: 'APPLIED' }), NOW).reason).toBe('NOT_OPENED');
    expect(evaluateCard(card('2025-06-01', { status: 'DENIED' }), NOW).reason).toBe('NOT_OPENED');
  });
  it('flags missing and future open dates', () => {
    expect(evaluateCard(card(null), NOW).reason).toBe('NO_OPEN_DATE');
    expect(evaluateCard(card('2027-01-01'), NOW).reason).toBe('FUTURE_DATE');
  });
  it('boundary: opened exactly 24 months ago no longer counts; one day later still does', () => {
    expect(evaluateCard(card('2024-11-21T12:00:00Z'), NOW)).toMatchObject({ counts: false, reason: 'OUTSIDE_WINDOW' });
    expect(evaluateCard(card('2024-11-22T00:00:00Z'), NOW).counts).toBe(true);
  });
  it('month precision keeps a card counting through the 24th month', () => {
    // opened "2024-11" → counts until 2026-12-01
    expect(evaluateCard(card('2024-11-01', { precision: 'MONTH' }), NOW).counts).toBe(true);
    expect(evaluateCard(card('2024-10-01', { precision: 'MONTH' }), NOW).counts).toBe(false);
  });
});

describe('five24Status', () => {
  const cards = [
    card('2025-01-10'),
    card('2025-04-02'),
    card('2025-04-02', { cardholder: 'AUTHORIZED_USER' }),
    card('2025-09-15'),
    card('2026-02-01'),
    card('2026-05-20'),
    card('2023-01-01'), // outside
    card('2025-05-05', { type: 'BUSINESS' }), // excluded
    card(null), // unknown
  ];

  it('counts, labels and lists contributing / excluded / unknown cards', () => {
    const s = five24Status(cards, NOW);
    expect(s.count).toBe(6);
    expect(s.label).toBe('6/24+');
    expect(s.underLimit).toBe(false);
    expect(s.slotsAvailable).toBe(0);
    expect(s.contributing.map((c) => c.dropsOffAt?.toISOString().slice(0, 10))).toEqual([
      '2027-01-10',
      '2027-04-02',
      '2027-04-02',
      '2027-09-15',
      '2028-02-01',
      '2028-05-20',
    ]);
    expect(s.excluded.map((e) => e.reason).sort()).toEqual(['BUSINESS_NOT_REPORTED', 'OUTSIDE_WINDOW']);
    expect(s.unknown).toHaveLength(1);
    expect(s.nextDropAt?.toISOString().slice(0, 10)).toBe('2027-01-10');
    // 6 counted, limit 5 → two must drop off: the second drop date
    expect(s.nextSlotAt?.toISOString().slice(0, 10)).toBe('2027-04-02');
  });

  it('under the limit: next slot is null and slots are reported', () => {
    const s = five24Status([card('2026-01-01'), card('2026-03-01')], NOW);
    expect(s).toMatchObject({ count: 2, label: '2/24', underLimit: true, slotsAvailable: 3, nextSlotAt: null });
  });

  it('exactly at 5: next slot is the first drop', () => {
    const s = five24Status(cards.slice(0, 5), NOW);
    expect(s.count).toBe(5);
    expect(s.nextSlotAt?.toISOString().slice(0, 10)).toBe('2027-01-10');
  });

  it('empty portfolio', () => {
    expect(five24Status([], NOW)).toMatchObject({ count: 0, label: '0/24', nextDropAt: null, nextSlotAt: null });
  });

  it('defaults now to the current time', () => {
    expect(five24Status([card(new Date(Date.now() - 86_400_000).toISOString())]).count).toBe(1);
  });
});

describe('five24Timeline', () => {
  it('projects the count down as cards drop off, merging same-day drops', () => {
    const t = five24Timeline([card('2025-01-10'), card('2025-04-02'), card('2025-04-02'), card('2026-06-01')], NOW);
    expect(t.map((p) => [p.event, p.date.toISOString().slice(0, 10), p.label])).toEqual([
      ['NOW', '2026-11-21', '4/24'],
      ['DROP', '2027-01-10', '3/24'],
      ['DROP', '2027-04-02', '1/24'],
      ['DROP', '2028-06-01', '0/24'],
    ]);
  });
  it('stops at the horizon', () => {
    const t = five24Timeline([card('2025-01-10'), card('2026-06-01')], NOW, 6);
    expect(t).toHaveLength(2);
  });
  it('uses the current time by default', () => {
    expect(five24Timeline([])[0].event).toBe('NOW');
  });
});

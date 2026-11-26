import {
  activeWindows,
  alertThresholds,
  annualValueCents,
  BenefitRuleError,
  benefitYearSummary,
  BenefitSchedule,
  daysRemaining,
  distributeUsage,
  dueThreshold,
  lastDay,
  monthsOf,
  parsePeriodText,
  periodContaining,
  periodsInBenefitYear,
  perPeriodFromAnnual,
  utilization,
} from '../../../src/domain/benefits';

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const win = (w: { start: Date; end: Date }) => [iso(w.start), iso(w.end)];

const monthly: BenefitSchedule = { period: 'MONTHLY', basis: 'CALENDAR', amountPerPeriodCents: 2500 };
const quarterly: BenefitSchedule = { period: 'QUARTERLY', basis: 'CALENDAR', amountPerPeriodCents: 10000 };
const semi: BenefitSchedule = { period: 'SEMIANNUAL', basis: 'CALENDAR', amountPerPeriodCents: 30000 };
const annual: BenefitSchedule = { period: 'ANNUAL', basis: 'CALENDAR', amountPerPeriodCents: 20000 };
const cmAnnual: BenefitSchedule = { period: 'ANNUAL', basis: 'CARDMEMBER_YEAR', amountPerPeriodCents: 30000 };
const ge: BenefitSchedule = { period: 'MULTI_YEAR', basis: 'CARDMEMBER_YEAR', periodMonths: 48, amountPerPeriodCents: 12000 };

describe('period sizes and values', () => {
  it('months per period', () => {
    expect([monthly, quarterly, semi, annual].map(monthsOf)).toEqual([1, 3, 6, 12]);
    expect(monthsOf(ge)).toBe(48);
    expect(() => monthsOf({ period: 'MULTI_YEAR' })).toThrow(BenefitRuleError);
  });
  it('annual face value and per-period amount', () => {
    expect(annualValueCents(monthly)).toBe(30000);
    expect(annualValueCents(quarterly)).toBe(40000);
    expect(annualValueCents(ge)).toBe(3000);
    expect(perPeriodFromAnnual(60000, semi)).toBe(30000);
    expect(perPeriodFromAnnual(30000, monthly)).toBe(2500);
  });
});

describe('periodContaining — calendar', () => {
  it('monthly / quarterly / semi-annual / annual windows', () => {
    const at = D('2026-11-21');
    expect(win(periodContaining(monthly, null, at))).toEqual(['2026-11-01', '2026-12-01']);
    expect(win(periodContaining(quarterly, null, at))).toEqual(['2026-10-01', '2027-01-01']);
    expect(win(periodContaining(semi, null, at))).toEqual(['2026-07-01', '2027-01-01']);
    expect(win(periodContaining(annual, null, at))).toEqual(['2026-01-01', '2027-01-01']);
  });
  it('ignores the anchor for calendar-basis benefits', () => {
    expect(win(periodContaining(annual, D('2024-05-10'), D('2026-02-01')))).toEqual(['2026-01-01', '2027-01-01']);
  });
  it('first and last instants of a period', () => {
    expect(win(periodContaining(quarterly, null, D('2026-01-01')))).toEqual(['2026-01-01', '2026-04-01']);
    expect(win(periodContaining(quarterly, null, new Date('2026-03-31T23:59:59Z')))).toEqual(['2026-01-01', '2026-04-01']);
  });
  it('multi-year without an anchor falls back to calendar multiples', () => {
    expect(win(periodContaining(ge, null, D('2026-11-21')))).toEqual(['2024-01-01', '2028-01-01']);
  });
});

describe('periodContaining — cardmember year / anchor', () => {
  const anchor = D('2024-05-10');
  it('annual cardmember year runs anniversary to anniversary', () => {
    expect(win(periodContaining(cmAnnual, anchor, D('2026-05-09')))).toEqual(['2025-05-10', '2026-05-10']);
    expect(win(periodContaining(cmAnnual, anchor, D('2026-05-10')))).toEqual(['2026-05-10', '2027-05-10']);
    expect(win(periodContaining(cmAnnual, anchor, D('2026-11-21')))).toEqual(['2026-05-10', '2027-05-10']);
  });
  it('before the anchor (negative periods)', () => {
    expect(win(periodContaining(cmAnnual, anchor, D('2024-01-01')))).toEqual(['2023-05-10', '2024-05-10']);
  });
  it('multi-year windows from the open date', () => {
    expect(win(periodContaining(ge, anchor, D('2026-11-21')))).toEqual(['2024-05-10', '2028-05-10']);
    expect(win(periodContaining(ge, anchor, D('2028-05-10')))).toEqual(['2028-05-10', '2032-05-10']);
  });
  it('month-end anchors clamp (Jan 31 monthly cardmember periods)', () => {
    const m: BenefitSchedule = { period: 'MONTHLY', basis: 'CARDMEMBER_YEAR', amountPerPeriodCents: 100 };
    expect(win(periodContaining(m, D('2026-01-31'), D('2026-02-28')))).toEqual(['2026-02-28', '2026-03-31']);
    expect(win(periodContaining(m, D('2026-01-31'), D('2026-02-27')))).toEqual(['2026-01-31', '2026-02-28']);
  });
  it('leap-day anchors', () => {
    expect(win(periodContaining(cmAnnual, D('2024-02-29'), D('2026-03-01')))).toEqual(['2026-02-28', '2027-02-28']);
  });
  it('falls back to calendar when a cardmember benefit has no anchor', () => {
    expect(win(periodContaining(cmAnnual, null, D('2026-11-21')))).toEqual(['2026-01-01', '2027-01-01']);
  });
});

describe('benefit year', () => {
  it('lists the periods of the calendar year', () => {
    expect(periodsInBenefitYear(quarterly, null, D('2026-11-21')).map(win)).toEqual([
      ['2026-01-01', '2026-04-01'],
      ['2026-04-01', '2026-07-01'],
      ['2026-07-01', '2026-10-01'],
      ['2026-10-01', '2027-01-01'],
    ]);
  });
  it('lists the periods of the cardmember year', () => {
    const m: BenefitSchedule = { period: 'SEMIANNUAL', basis: 'CARDMEMBER_YEAR', amountPerPeriodCents: 100 };
    expect(periodsInBenefitYear(m, D('2024-05-10'), D('2026-11-21')).map(win)).toEqual([
      ['2026-05-10', '2026-11-10'],
      ['2026-11-10', '2027-05-10'],
    ]);
  });
  it('multi-year: a single window', () => {
    expect(periodsInBenefitYear(ge, D('2024-05-10'), D('2026-11-21'))).toHaveLength(1);
  });
  it('lastDay and daysRemaining', () => {
    const w = periodContaining(monthly, null, D('2026-11-21'));
    expect(iso(lastDay(w))).toBe('2026-11-30');
    expect(daysRemaining(w, D('2026-11-30'))).toBe(1);
    expect(daysRemaining(w, new Date('2026-11-30T22:00:00Z'))).toBe(1);
    expect(daysRemaining(w, D('2026-12-05'))).toBe(0);
  });
});

describe('utilization status', () => {
  const w = { start: D('2026-01-01'), end: D('2027-01-01') };
  it('UNUSED / PARTIAL / COMPLETED', () => {
    expect(utilization(20000, 0, w, D('2026-03-01')).status).toBe('UNUSED');
    expect(utilization(20000, 5000, w, D('2026-03-01'))).toMatchObject({ status: 'PARTIAL', remainingCents: 15000, percentUsed: 25 });
    expect(utilization(20000, 25000, w, D('2026-03-01'))).toMatchObject({ status: 'COMPLETED', remainingCents: 0, percentUsed: 100 });
  });
  it('EXPIRING_SOON inside the window, EXPIRED after the end', () => {
    expect(utilization(20000, 5000, w, D('2026-12-15')).status).toBe('EXPIRING_SOON');
    expect(utilization(20000, 5000, w, D('2027-01-02'))).toMatchObject({ status: 'EXPIRED', daysLeft: 0 });
    expect(utilization(20000, 0, w, D('2026-12-15'), 10).status).toBe('UNUSED');
  });
  it('zero-value benefits (lounge access) count as complete; negative usage is clamped', () => {
    expect(utilization(0, 0, w, D('2026-03-01'))).toMatchObject({ status: 'COMPLETED', percentUsed: 100 });
    expect(utilization(1000, -50, w, D('2026-03-01')).usedCents).toBe(0);
  });
});

describe('alert thresholds', () => {
  it('scale with the period length', () => {
    expect(alertThresholds(monthly)).toEqual([7, 1]);
    expect(alertThresholds(quarterly)).toEqual([30, 7, 1]);
    expect(alertThresholds(semi)).toEqual([60, 30, 7, 1]);
    expect(alertThresholds(annual)).toEqual([90, 60, 30, 7, 1]);
    expect(alertThresholds(ge)).toEqual([90, 60, 30, 7, 1]);
  });
  it('dueThreshold picks the smallest crossed threshold', () => {
    const w = { start: D('2026-01-01'), end: D('2027-01-01') };
    expect(dueThreshold(annual, w, D('2026-09-01'), 100)).toBeNull(); // 122 days
    expect(dueThreshold(annual, w, D('2026-10-03'), 100)).toBe(90); // 90 days
    expect(dueThreshold(annual, w, D('2026-11-21'), 100)).toBe(60); // 41 days
    expect(dueThreshold(annual, w, D('2026-12-25'), 100)).toBe(7);
    expect(dueThreshold(annual, w, D('2026-12-31'), 100)).toBe(1);
  });
  it('no alert when used up or already ended', () => {
    const w = { start: D('2026-01-01'), end: D('2027-01-01') };
    expect(dueThreshold(annual, w, D('2026-12-31'), 0)).toBeNull();
    expect(dueThreshold(annual, w, D('2027-01-01'), 100)).toBeNull();
  });
});

describe('distributeUsage (year-to-date amounts from spreadsheets)', () => {
  it('fills periods earliest first, one allocation each', () => {
    const out = distributeUsage(monthly, null, D('2026-11-21'), 6000);
    expect(out.map((u) => [iso(u.periodStart), u.amountCents])).toEqual([
      ['2026-01-01', 2500],
      ['2026-02-01', 2500],
      ['2026-03-01', 1000],
    ]);
  });
  it('puts any excess on the last filled period', () => {
    const out = distributeUsage(semi, null, D('2026-11-21'), 70000);
    expect(out.map((u) => u.amountCents)).toEqual([30000, 40000]);
  });
  it('nothing used → no rows; zero-value benefit → single row', () => {
    expect(distributeUsage(monthly, null, D('2026-11-21'), 0)).toEqual([]);
    const zero = distributeUsage({ ...annual, amountPerPeriodCents: 0 }, null, D('2026-11-21'), 500);
    expect(zero).toEqual([{ periodStart: D('2026-01-01'), amountCents: 500 }]);
  });
});

describe('benefitYearSummary', () => {
  it('sums used, remaining and missed value for the year', () => {
    const usage = new Map<string, number>([
      [D('2026-01-01').toISOString(), 10000],
      [D('2026-04-01').toISOString(), 4000],
      [D('2026-10-01').toISOString(), 99999], // capped at the allocation
    ]);
    expect(benefitYearSummary(quarterly, null, D('2026-11-21'), usage)).toEqual({
      annualValueCents: 40000,
      usedThisYearCents: 24000,
      remainingThisYearCents: 0,
      missedCents: 16000, // Q2 6000 + Q3 10000
    });
  });
});

describe('periods before the card was opened', () => {
  it('are not counted as missed or remaining (card opened mid-year)', () => {
    // monthly $25 calendar credit, card opened 2026-06-10, today 2026-11-21:
    // usable periods Jun–Dec (7); Jun–Oct ended unused → 5 × $25 missed; Nov + Dec remain
    const r = benefitYearSummary(monthly, D('2026-06-10'), D('2026-11-21'), new Map());
    expect(r).toMatchObject({ missedCents: 12500, remainingThisYearCents: 5000, usedThisYearCents: 0 });
  });
  it('activeWindows keeps everything without an open date and at least one window otherwise', () => {
    const ws = periodsInBenefitYear(quarterly, null, D('2026-11-21'));
    expect(activeWindows(ws, null)).toHaveLength(4);
    expect(activeWindows(ws, D('2026-05-01'))).toHaveLength(3);
    expect(activeWindows(ws, D('2027-03-01'))).toEqual([ws[3]]);
  });
  it('year-to-date usage is spread from the first usable period', () => {
    const out = distributeUsage(monthly, D('2026-09-15'), D('2026-11-21'), 5000);
    expect(out.map((u) => iso(u.periodStart))).toEqual(['2026-09-01', '2026-10-01']);
  });
});

describe('parsePeriodText', () => {
  it.each([
    ['Monthly', 'MONTHLY', 'CALENDAR'],
    ['$25 per month', 'MONTHLY', 'CALENDAR'],
    ['Quarterly', 'QUARTERLY', 'CALENDAR'],
    ['Semi-annual', 'SEMIANNUAL', 'CALENDAR'],
    ['$300 Jan–Jun + $300 Jul–Dec (twice a year)', 'SEMIANNUAL', 'CALENDAR'],
    ['Annual', 'ANNUAL', 'CALENDAR'],
    ['Cardmember year', 'ANNUAL', 'CARDMEMBER_YEAR'],
    ['Each anniversary', 'ANNUAL', 'CARDMEMBER_YEAR'],
    ['Every 4 years', 'MULTI_YEAR', 'CARDMEMBER_YEAR'],
    ['Every 4-4.5 years', 'MULTI_YEAR', 'CARDMEMBER_YEAR'],
    ['', 'ANNUAL', 'CALENDAR'],
    [null, 'ANNUAL', 'CALENDAR'],
  ])('%s → %s / %s', (t, period, basis) => {
    expect(parsePeriodText(t)).toMatchObject({ period, basis });
  });
  it('every 1 year is plain annual', () => {
    expect(parsePeriodText('every 1 year').period).toBe('ANNUAL');
  });
});

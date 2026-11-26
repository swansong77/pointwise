import { adviseBalances, Balance, bonusActive, Currency, Partner, planAward, Program, transferOptions, transferRate } from '../../../src/domain/travel';

const NOW = new Date('2026-11-25T00:00:00Z');
const cur = (id: string, cpp: number, extra: Partial<Currency> = {}): Currency => ({ id, code: id.toUpperCase(), name: `${id} pts`, centsPerPoint: cpp, isCash: false, householdPooling: false, transferIncrement: 1000, ...extra });
const prog = (id: string, cpp: number, extra: Partial<Program> = {}): Program => ({ id, code: id.toUpperCase(), name: `${id} miles`, kind: 'AIRLINE', centsPerPoint: cpp, householdPooling: false, ...extra });
const partner = (currencyId: string, programId: string, extra: Partial<Partner> = {}): Partner => ({ currencyId, programId, ratioFrom: 1, ratioTo: 1, transferDays: 0, bonusPercent: 0, bonusEndsAt: null, ...extra });

const NW = cur('nw', 1.5, { householdPooling: true });
const CT = cur('ct', 1.25);
const CASH = cur('cash', 1, { isCash: true });
const SKY = prog('sky', 1.4);
const AERO = prog('aero', 1.3);
const HOTEL = prog('stay', 0.7, { kind: 'HOTEL', householdPooling: true });
const PARTNERS = [
  partner('nw', 'sky'),
  partner('ct', 'sky', { transferDays: 2 }),
  partner('ct', 'aero', { bonusPercent: 30, bonusEndsAt: new Date('2026-12-31T00:00:00Z') }),
  partner('nw', 'stay', { ratioTo: 2 }),
  partner('ct', 'stay', { bonusPercent: 50, bonusEndsAt: new Date('2026-01-01T00:00:00Z') }), // expired bonus
];
const CURRENCIES = [NW, CT, CASH];
const PROGRAMS = [SKY, AERO, HOTEL];

describe('transfer partners', () => {
  it('rates include only active bonuses', () => {
    expect(bonusActive(PARTNERS[2], NOW)).toBe(true);
    expect(bonusActive(PARTNERS[4], NOW)).toBe(false);
    expect(bonusActive(partner('a', 'b', { bonusPercent: 10 }), NOW)).toBe(true); // open-ended bonus
    expect(transferRate(PARTNERS[2], NOW)).toBeCloseTo(1.3);
    expect(transferRate(PARTNERS[3], NOW)).toBe(2);
  });

  it('lists options best value first with uplift vs the currency value', () => {
    const o = transferOptions(CT, PARTNERS, PROGRAMS, NOW);
    expect(o.map((x) => x.program.code)).toEqual(['AERO', 'SKY', 'STAY']);
    expect(o[0]).toMatchObject({ centsPerPoint: 1.69, programPointsPerPoint: 1.3, bonusPercent: 30, upliftVsCash: 1.35 });
    expect(o[2]).toMatchObject({ bonusPercent: 0, bonusEndsAt: null });
    expect(transferOptions(CT, [...PARTNERS, partner('ct', 'missing')], PROGRAMS, NOW)).toHaveLength(3);
    expect(transferOptions(cur('zero', 0), [partner('zero', 'sky')], PROGRAMS, NOW)[0].upliftVsCash).toBe(0);
  });

  it('advises each balance: best transfer, no partner, or redeem directly', () => {
    const balances: Balance[] = [
      { profileId: 'j', member: 'Jordan', currencyId: 'ct', programId: null, points: 80_000 },
      { profileId: 'j', member: 'Jordan', currencyId: 'cash', programId: null, points: 10_000 },
      { profileId: 'r', member: 'Riley', currencyId: 'nw', programId: null, points: 40_000 },
      { profileId: 'r', member: 'Riley', currencyId: null, programId: 'sky', points: 5_000 },
      { profileId: 'r', member: 'Riley', currencyId: 'ct', programId: null, points: 0 },
    ];
    const a = adviseBalances(balances, CURRENCIES, [...PARTNERS, partner('cash', 'stay', { ratioTo: 1 })], PROGRAMS, NOW);
    expect(a).toHaveLength(3);
    expect(a[0]).toMatchObject({ member: 'Jordan', cashValueCents: 1000_00, bestValueCents: 1352_00 });
    expect(a[0].advice).toMatch(/^Best use: aero miles at 1.69¢ per point \(1.35× the direct value\), including a 30 % transfer bonus until 2026-12-31\./);
    expect(a.find((x) => x.currency.id === 'cash')?.advice).toMatch(/don't beat 1¢ per point/);
    expect(adviseBalances([{ profileId: 'j', member: 'J', currencyId: 'cash', programId: null, points: 5 }], CURRENCIES, [], PROGRAMS, NOW)[0].advice).toMatch(/no transfer partners/);
    expect(adviseBalances([{ profileId: 'j', member: 'J', currencyId: 'ct', programId: null, points: 1 }], CURRENCIES, [partner('ct', 'sky', { bonusPercent: 10 })], PROGRAMS, NOW)[0].advice).toMatch(/10 % transfer bonus\. Transfer only/);
  });
});

describe('award planner', () => {
  const balances: Balance[] = [
    { profileId: 'j', member: 'Jordan', currencyId: null, programId: 'sky', points: 12_000 },
    { profileId: 'j', member: 'Jordan', currencyId: 'ct', programId: null, points: 30_000 },
    { profileId: 'j', member: 'Jordan', currencyId: 'nw', programId: null, points: 20_000 },
    { profileId: 'r', member: 'Riley', currencyId: 'nw', programId: null, points: 50_000 },
    { profileId: 'r', member: 'Riley', currencyId: 'ct', programId: null, points: 90_000 },
    { profileId: 'r', member: 'Riley', currencyId: null, programId: 'sky', points: 30_000 },
  ];

  it('uses the booker program balance, then the cheapest transfers, rounded to increments', () => {
    const p = planAward({ programId: 'sky', pointsNeeded: 57_500, bookerProfileId: 'j' }, balances, CURRENCIES, PARTNERS, PROGRAMS, NOW);
    // CT costs 1.25¢ per SKY point, NW 1.5¢ → CT first (Jordan only: CT is not pooled), then NW (pooled)
    expect(p.steps.map((s) => [s.kind, s.member, s.from, s.pointsUsed, s.programPoints])).toEqual([
      ['USE_BALANCE', 'Jordan', 'SKY', 12_000, 12_000],
      ['TRANSFER', 'Jordan', 'CT', 30_000, 30_000],
      ['TRANSFER', 'Jordan', 'NW', 16_000, 16_000],
    ]);
    expect(p).toMatchObject({ covered: 58_000, shortfall: 0, totalCostCents: 12_000 * 1.4 + 30_000 * 1.25 + 16_000 * 1.5, maxTransferDays: 2, awardValueCents: 80_500 });
    expect(p.costCentsPerProgramPoint).toBeCloseTo(1.35, 2);
    expect(p.warnings).toEqual(['Transfers are one-way: confirm award availability before moving points.', 'The slowest transfer takes up to 2 day(s) — the award may disappear meanwhile.']);
    expect(p.summary).toBe('Covered: use 12,000 SKY from Jordan, then transfer 30,000 CT from Jordan, then transfer 16,000 NW from Jordan.');
  });

  it('pools household currencies and programs only when allowed, and reports shortfalls', () => {
    const p = planAward({ programId: 'sky', pointsNeeded: 200_000, bookerProfileId: 'j' }, balances, CURRENCIES, PARTNERS, PROGRAMS, NOW);
    expect(p.steps.some((s) => s.member === 'Riley' && s.from === 'NW')).toBe(true); // NW pools
    expect(p.steps.some((s) => s.member === 'Riley' && s.from === 'CT')).toBe(false); // CT does not
    expect(p.steps.some((s) => s.member === 'Riley' && s.from === 'SKY')).toBe(false); // SKY program does not pool
    expect(p.shortfall).toBe(200_000 - 112_000);
    expect(p.warnings).toEqual(expect.arrayContaining(["Riley's nw pts are combined into Jordan's account first (household pooling).", 'Short by 88,000 sky miles points.']));
    expect(p.summary).toMatch(/^You can cover 112,000 of 200,000 sky miles points; 88,000 short\./);
    const hotel = planAward({ programId: 'stay', pointsNeeded: 10_000, bookerProfileId: 'r' }, [...balances, { profileId: 'j', member: 'Jordan', currencyId: null, programId: 'stay', points: 4_000 }], CURRENCIES, PARTNERS, PROGRAMS, NOW);
    expect(hotel.steps[0]).toMatchObject({ kind: 'USE_BALANCE', member: 'Jordan', pointsUsed: 4_000 }); // hotel program pools
    expect(hotel.steps[1]).toMatchObject({ kind: 'TRANSFER', member: 'Riley', from: 'NW', pointsUsed: 3_000, programPoints: 6_000 });
  });

  it('defaults the booker, skips balances below one increment, rejects unknown programs', () => {
    const p = planAward({ programId: 'aero', pointsNeeded: 1_000 }, [{ profileId: 'j', member: 'Jordan', currencyId: 'ct', programId: null, points: 500 }], CURRENCIES, PARTNERS, PROGRAMS, NOW);
    expect(p.steps).toEqual([]);
    expect(p.costCentsPerProgramPoint).toBeNull();
    expect(planAward({ programId: 'aero', pointsNeeded: 0 }, [], CURRENCIES, PARTNERS, PROGRAMS, NOW).summary).toBe('Covered: .');
    expect(() => planAward({ programId: 'nope', pointsNeeded: 1 }, [], CURRENCIES, PARTNERS, PROGRAMS, NOW)).toThrow(/Unknown loyalty program/);
    const tiny = planAward({ programId: 'sky', pointsNeeded: 100, bookerProfileId: 'j' }, [{ profileId: 'j', member: 'J', currencyId: 'ct', programId: null, points: 5_000 }], [{ ...CT, transferIncrement: 0 }], PARTNERS, PROGRAMS, NOW);
    expect(tiny.steps[0]).toMatchObject({ pointsUsed: 100, programPoints: 100 });
  });
});

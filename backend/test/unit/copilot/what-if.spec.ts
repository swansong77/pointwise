import { Dictionaries, understand } from '../../../src/domain/query-understanding';
import { applyOutcome, ApplyRow, cancelOutcome, changeOutcome, isWhatIf, parseSpan, parseWhatIf, transferOutcome, waitOutcome } from '../../../src/domain/what-if';

const NOW = new Date('2026-11-26T15:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const dict: Dictionaries = {
  merchants: [],
  cards: [
    { id: 'c-venture', name: 'Capital One Venture X', walletCardId: 'w-venture' },
    { id: 'c-flex', name: 'Chase Freedom Flex', walletCardId: 'w-flex' },
    { id: 'c-csp', name: 'Chase Sapphire Preferred', walletCardId: null },
  ],
  members: [
    { id: 'p1', nickname: 'Alex', relationship: 'SELF' },
    { id: 'p2', nickname: 'Riley', relationship: 'SPOUSE' },
  ],
  programs: [{ id: 'pr1', name: 'World of Hyatt', kind: 'HOTEL' }],
};
const parse = (q: string) => parseWhatIf(q, understand(q, dict, NOW));

describe('TC-WHATIF: reading the question', () => {
  it.each([
    ['What if my spouse applies instead?', 'APPLY'],
    ['What if I wait 3 months?', 'WAIT'],
    ['What if I transfer 60,000 points to World of Hyatt?', 'TRANSFER'],
    ['What if I cancel Venture X?', 'CANCEL'],
    ['What if I upgrade Chase Freedom Flex to Chase Sapphire Preferred?', 'CHANGE'],
  ])('%s → %s', (q, type) => expect(parse(q)?.request.type).toBe(type));

  it('is not triggered by ordinary questions', () => {
    for (const q of ['What should I do today?', 'How many points do I have?', 'What card should I use at Costco?', 'Show all Hilton offers']) {
      expect(isWhatIf(q)).toBe(false);
      expect(parse(q)).toBeNull();
    }
  });

  it('picks out who, which card, how long and how many points', () => {
    expect(parse('What if my spouse applies instead?')).toMatchObject({ request: { memberId: 'p2' }, needs: [] });
    const cancel = parse('What if I cancel Venture X?')!;
    expect(cancel.request).toMatchObject({ type: 'CANCEL', card: { walletCardId: 'w-venture' } });
    expect((parse('What if I wait 6 weeks?')!.request as { days: number }).days).toBe(42);
    expect((parse('what if i wait a month')!.request as { days: number }).days).toBe(30);
    expect(parse('What if I transfer 60k points to World of Hyatt?')!.request).toMatchObject({ type: 'TRANSFER', points: 60000, program: 'World of Hyatt' });
  });

  it('says what is missing instead of guessing', () => {
    expect(parse('What if I cancel it?')!.needs[0]).toMatch(/which card/);
    expect(parse('What if I transfer points?')!.needs.join(' ')).toMatch(/which program.*how many points|how many points.*which program/);
    expect(parse('What if I apply?')!.needs[0]).toMatch(/who would apply/);
    expect(parse('What if I upgrade Chase Freedom Flex?')!.needs[0]).toMatch(/which card to change it to/);
  });

  it('spans', () => {
    expect([parseSpan('3 months'), parseSpan('two weeks'), parseSpan('10 days'), parseSpan('a year'), parseSpan('soon'), parseSpan('900 days')]).toEqual([90, 14, 10, 365, null, null]);
  });
});

const row = (over: Partial<ApplyRow> = {}): ApplyRow => ({ profileId: 'p1', member: 'Alex', eligible: true, blockers: [], firstYearValueCents: 90000, longTermValueCents: 40000, benefitsCents: 20000, five24: { before: 4, after: 5, countsToward: true, slotCostCents: 15000 }, confidence: 80, ...over });

describe('TC-WHATIF: spouse applies', () => {
  const alex = row();
  const riley = row({ profileId: 'p2', member: 'Riley', firstYearValueCents: 120000, longTermValueCents: 50000, benefitsCents: 25000, five24: { before: 1, after: 2, countsToward: true, slotCostCents: 0 } });

  it('compares first-year value, 5/24 and who holds it', () => {
    const o = applyOutcome('Chase Sapphire Preferred', alex, riley, [alex, riley]);
    expect(o.scenario).toBe('APPLY');
    expect(o.netCents).toBe(30000);
    expect(o.verdict).toBe('FAVORABLE');
    expect(o.summary).toMatch(/Riley applies.*instead of Alex/);
    expect(o.deltas.map((d) => d.dimension)).toEqual(expect.arrayContaining(['FINANCIAL', 'BENEFITS', 'FIVE24', 'HOUSEHOLD']));
    expect(o.deltas.find((d) => d.label === "Riley's 5/24")).toMatchObject({ before: '1/24', after: '2/24' });
    expect(o.recommendation).toMatch(/Riley is the better applicant/);
  });

  it('says nothing changes when the person is already the best applicant', () => {
    const o = applyOutcome('Card', alex, alex);
    expect(o.verdict).toBe('NEUTRAL');
    expect(o.netCents).toBeNull();
  });

  it('an ineligible applicant is unfavorable and says why', () => {
    const o = applyOutcome('Card', alex, row({ profileId: 'p3', member: 'Sam', eligible: false, blockers: ['under 18'] }));
    expect(o.verdict).toBe('UNFAVORABLE');
    expect(o.summary).toMatch(/under 18/);
  });

  it('always carries assumptions, risks and a confidence', () => {
    const o = applyOutcome('Card', alex, riley);
    expect(o.assumptions.length).toBeGreaterThan(0);
    expect(o.risks.join(' ')).toMatch(/inquiry/);
    expect(o.confidence).toBe(80);
  });
});

describe('TC-WHATIF: wait', () => {
  const members = [
    { member: 'Alex', count: 5, drops: [day(40), day(200), day(300), day(400), day(500)] },
    { member: 'Riley', count: 1, drops: [day(30)] },
  ];

  it('opens a 5/24 slot and costs what lapses', () => {
    const o = waitOutcome({ days: 90, now: NOW, members, items: [{ label: 'Hilton $100', endsAt: day(10), valueCents: 10000 }, { label: 'Later', endsAt: day(200), valueCents: 5000 }], renewals: [{ card: 'Plat', renewsOn: day(60), feeCents: 69500 }] });
    expect(o.scenario).toBe('WAIT');
    expect(o.deltas.find((d) => d.label === "Alex's 5/24")).toMatchObject({ before: '5/24', after: '4/24' });
    expect(o.summary).toMatch(/gains a 5\/24 slot/);
    expect(o.summary).toMatch(/\$100 of offers/);
    expect(o.verdict).toBe('MIXED');
    expect(o.netCents).toBe(-10000 - 69500);
    expect(o.deltas.some((d) => /Annual fees/.test(d.label))).toBe(true);
  });

  it('is neutral when nothing changes', () => {
    const o = waitOutcome({ days: 14, now: NOW, members: [{ member: 'Alex', count: 2, drops: [day(300)] }], items: [], renewals: [] });
    expect(o.verdict).toBe('NEUTRAL');
    expect(o.summary).toMatch(/nothing important changes/);
  });

  it('names the span in months when it is round', () => {
    expect(waitOutcome({ days: 90, now: NOW, members: [], items: [], renewals: [] }).title).toBe('What if you wait 3 months?');
    expect(waitOutcome({ days: 10, now: NOW, members: [], items: [], renewals: [] }).title).toBe('What if you wait 10 days?');
  });
});

describe('TC-WHATIF: cancel, transfer, change', () => {
  const base = { card: 'Venture X', feeCents: 39500, rewardsLostCents: 12000, benefitsUsedCents: 30000, benefitsAnnualCents: 60000, daysToRenewal: 24, pointsOnCard: null, currency: 'MILES', categoryChanges: [{ category: 'Travel', before: 5, after: 2 }], openedWithinMonths: 30, hasSiblingNoFee: false };

  it('cancel: fee saved against rewards and benefits lost; 5/24 does not move', () => {
    const o = cancelOutcome(base);
    expect(o.netCents).toBe(39500 - 12000 - 30000);
    expect(o.verdict).toBe('NEUTRAL');
    expect(o.deltas.find((d) => d.dimension === 'FIVE24')).toMatchObject({ change: expect.stringMatching(/does not remove it/) });
    expect(o.deltas.find((d) => d.label.startsWith('Travel'))).toMatchObject({ before: '5¢/$', after: '2¢/$', direction: 'WORSE' });
    expect(o.alternatives[0]).toMatch(/retention offer/);
    expect(o.risks.join(' ')).toMatch(/credit/);
  });

  it('cancel: a fee that is not earned back is favorable, a card that pays for itself is not', () => {
    expect(cancelOutcome({ ...base, rewardsLostCents: 2000, benefitsUsedCents: 0 }).verdict).toBe('FAVORABLE');
    expect(cancelOutcome({ ...base, rewardsLostCents: 90000 }).verdict).toBe('UNFAVORABLE');
    expect(cancelOutcome({ ...base, hasSiblingNoFee: true }).alternatives.join(' ')).toMatch(/no-fee/);
    expect(cancelOutcome({ ...base, openedWithinMonths: 6 }).risks.join(' ')).toMatch(/welcome bonus/);
  });

  it('transfer: warns that it cannot be undone and reports the shortfall', () => {
    const o = transferOutcome({ program: { name: 'World of Hyatt' }, pointsNeeded: 60000, covered: 45000, shortfall: 15000, totalCostCents: 0, awardValueCents: 90000, maxTransferDays: 2, warnings: ['Check availability'], summary: 'You can cover 45,000 of 60,000.', steps: [] }, 0);
    expect(o.verdict).toBe('MIXED');
    expect(o.risks.join(' ')).toMatch(/cannot be undone/);
    expect(o.recommendation).toMatch(/never makes one/);
    expect(o.deltas.find((d) => d.dimension === 'POINTS')).toMatchObject({ direction: 'WORSE' });
  });

  it('change: fee, rewards and credits net out, and 5/24 is unaffected for a same-family change', () => {
    const o = changeOutcome({ from: 'Freedom Flex', to: 'Sapphire Preferred', feeBeforeCents: 0, feeAfterCents: 9500, rewardsBeforeCents: 40000, rewardsAfterCents: 52000, benefitsBeforeCents: 0, benefitsAfterCents: 5000, useRate: 0.5, sameFamily: true });
    expect(o.netCents).toBe(12000 + 2500 - 9500);
    expect(o.deltas.find((d) => d.dimension === 'FIVE24')!.after).toMatch(/same account/);
    expect(o.verdict).toBe('NEUTRAL');
  });

  it('every outcome carries the same explainable fields', () => {
    for (const o of [cancelOutcome(base), waitOutcome({ days: 30, now: NOW, members, items: [], renewals: [] })]) {
      expect(o.version).toBe('what-if/1');
      expect(o.title.length).toBeGreaterThan(5);
      expect(o.assumptions.length).toBeGreaterThan(0);
      expect(o.evidence.length).toBeGreaterThan(0);
      expect(o.confidence).toBeGreaterThanOrEqual(20);
    }
  });
  const members = [{ member: 'Alex', count: 2, drops: [day(300)] }];
});

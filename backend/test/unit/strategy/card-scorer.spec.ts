import {
  Applicant,
  approvalOdds,
  bonusValueCents,
  CandidateCard,
  categoryGains,
  countsTowardFive24,
  householdNextCards,
  rankCandidates,
  scoreCard,
  ScoreOptions,
  SpendLine,
  underLimitAgainAt,
  whoShouldApply,
} from '../../../src/domain/card-scorer';
import { CAT, CUR, card, rule, wc } from '../fixtures';

const NOW = new Date('2026-11-25T00:00:00Z');
const day = (s: string) => new Date(`${s}T00:00:00Z`);

const SPEND: SpendLine[] = [
  { categoryId: CAT.dining, name: 'Dining', monthlyCents: 500_00 },
  { categoryId: CAT.groceries, name: 'Groceries', monthlyCents: 600_00 },
  { categoryId: CAT.fallback, name: 'Everything else', monthlyCents: 1000_00 },
  { categoryId: CAT.gas, name: 'Gas', monthlyCents: 0 },
];

function candidate(partial: Partial<CandidateCard> & { id: string }): CandidateCard {
  return {
    ...card(partial),
    slug: partial.id,
    issuerName: 'Contoso Financial',
    enforcesFive24: false,
    benefitsAnnualCents: 0,
    ...partial,
  } as CandidateCard;
}

const gold = candidate({
  id: 'gold',
  name: 'Contoso Gold',
  annualFeeCents: 250_00,
  currency: CUR.points,
  bonusPoints: 60_000,
  bonusSpendCents: 6000_00,
  bonusMonths: 6,
  benefitsAnnualCents: 240_00,
  rewards: [rule({ categoryId: CAT.dining, multiplier: 4, description: '4X dining' }), rule({ categoryId: CAT.groceries, multiplier: 4 }), rule({ categoryId: CAT.fallback, multiplier: 1 })],
});
const voyager = candidate({
  id: 'voyager',
  name: 'Northwind Voyager',
  issuerName: 'Northwind Bank',
  enforcesFive24: true,
  productFamily: 'Voyager',
  annualFeeCents: 95_00,
  currency: CUR.miles,
  bonusPoints: 60_000,
  bonusSpendCents: 4000_00,
  bonusMonths: 3,
  rewards: [rule({ categoryId: CAT.dining, multiplier: 3 }), rule({ categoryId: CAT.fallback, multiplier: 1 })],
});
const bizInk = candidate({ id: 'ink', name: 'Litware Business Ink', type: 'BUSINESS', businessReportsToPersonal: false, rewards: [rule({ categoryId: CAT.fallback, multiplier: 1.5 })] });

const household = [wc({ id: 'w1', card: card({ id: 'double', currency: CUR.cash, rewards: [rule({ categoryId: CAT.fallback, multiplier: 2 })] }) })];

function applicant(partial: Partial<Applicant> = {}): Applicant {
  return {
    profileId: 'p-riley',
    nickname: 'Riley',
    canApply: true,
    five24: { count: 2, limit: 5, underLimit: true, dropOffs: [day('2027-06-01'), day('2028-01-01')], unknownCount: 0 },
    heldCardIds: [],
    heldFamilies: [],
    ...partial,
  };
}
const OPT: ScoreOptions = { fallbackCategoryId: CAT.fallback, spendSource: 'TRANSACTIONS', now: NOW };

describe('card scorer — value', () => {
  it('first-year and long-term value from bonus, extra earning, credits and fee', () => {
    const s = scoreCard(gold, applicant(), household, SPEND, OPT);
    // bonus 60,000 × 1.25¢ = $750; dining (5¢ vs 2¢) × $6,000 = $180; groceries (5 vs 2) × $7,200 = $216; fallback 1.25 < 2 → 0
    expect(s.components).toEqual({ bonusCents: 750_00, earnCents: 396_00, benefitsCents: 120_00, firstYearFeeCents: 250_00, annualFeeCents: 250_00 });
    expect(s.firstYearValueCents).toBe(750_00 + 396_00 + 120_00 - 250_00);
    expect(s.longTermValueCents).toBe(396_00 + 120_00 - 250_00);
    expect(s.feeReturn).toBe(2.06);
    expect(s.spendFeasible).toBe(true);
    expect(s.topCategories.map((c) => c.category)).toEqual(['Groceries', 'Dining']);
    expect(s.reasons[0]).toBe('Welcome bonus worth ~$750 (60,000 points × 1.25¢) after $6,000 in 6 months');
    expect(s.reasons.join(' ')).toMatch(/Credits worth ~\$120\/yr at 50 % expected use/);
    expect(s.five24).toMatchObject({ countsToward: true, before: 2, after: 3, usesLastSlot: false, slotCostCents: 150_00 });
    expect(s.score).toBe(s.firstYearValueCents + s.longTermValueCents - 150_00);
    expect(s.eligible).toBe(true);
    expect(s.confidence).toBe(0.85); // default valuation of the bonus
  });

  it('valuation overrides, curated bonus value, waived first-year fee, elevated offers and use rate', () => {
    const s = scoreCard({ ...gold, bonusValuationCents: 900_00, firstYearFeeWaived: true, offerElevated: true }, applicant(), household, SPEND, { ...OPT, benefitUseRate: 2, valuations: { [CUR.points.id]: 2 } });
    expect(s.components.bonusCents).toBe(900_00);
    expect(s.components.firstYearFeeCents).toBe(0);
    expect(s.components.benefitsCents).toBe(240_00); // use rate clamped to 100 %
    expect(s.reasons).toEqual(expect.arrayContaining(['Welcome bonus worth ~$900', 'The current welcome offer is elevated (≥ 20 % above its 24-month median)', 'Annual fee $250 (waived the first year)']));
    expect(bonusValueCents({ ...gold, bonusPoints: null })).toBe(0);
    expect(bonusValueCents(gold, { [CUR.points.id]: 2 })).toBe(1200_00);
  });

  it('drops the bonus when usual spend cannot reach the requirement', () => {
    const low: SpendLine[] = [{ categoryId: CAT.dining, name: 'Dining', monthlyCents: 300_00 }];
    const s = scoreCard(gold, applicant(), household, low, OPT);
    expect(s.spendFeasible).toBe(false);
    expect(s.components.bonusCents).toBe(0);
    expect(s.warnings[0]).toMatch(/does not reach the \$6,000 requirement/);
  });

  it('warns when the fee outweighs the ongoing value and explains no extra earning', () => {
    const pricey = candidate({ id: 'p', name: 'Pricey', annualFeeCents: 695_00, rewards: [rule({ categoryId: CAT.fallback, multiplier: 1 })] });
    const s = scoreCard(pricey, applicant(), household, SPEND, OPT);
    expect(s.reasons).toContain('Does not earn more than your current cards on your usual spend');
    expect(s.warnings.join(' ')).toMatch(/fee outweighs the value by \$695\/yr/);
    expect(s.score).toBe(-695_00 - 150_00);
  });

  it('compares against a 1.5 % baseline when the household has no cards; skips zero-spend lines', () => {
    const g = categoryGains(gold, [], SPEND, OPT);
    expect(g.find((x) => x.category === 'Dining')).toMatchObject({ currentCentsPerDollar: 1.5, newCentsPerDollar: 5 });
    expect(g.find((x) => x.category === 'Gas')).toBeUndefined();
    expect(categoryGains(gold, [wc({ id: 'x', status: 'CLOSED', card: card({ id: 'c' }) })], SPEND.slice(0, 1), OPT)[0].currentCentsPerDollar).toBe(1.5);
  });

  it('confidence reflects data quality', () => {
    expect(scoreCard(bizInk, applicant(), household, SPEND, { ...OPT, spendSource: 'DEFAULT' }).confidence).toBe(0.6);
    expect(scoreCard(bizInk, applicant(), household, SPEND, { ...OPT, spendSource: 'PROFILE' }).confidence).toBe(0.85);
    const unknown = scoreCard(bizInk, applicant({ five24: { ...applicant().five24, unknownCount: 2 } }), household, SPEND, OPT);
    expect(unknown.confidence).toBe(0.8);
    expect(unknown.confidenceNotes.join(' ')).toMatch(/2 card\(s\) without an open date/);
    const floor = scoreCard({ ...gold, productFamily: 'Gold' }, applicant({ heldFamilies: ['Gold'], five24: { ...applicant().five24, unknownCount: 1 } }), household, SPEND, { ...OPT, spendSource: 'DEFAULT' });
    expect(floor.confidence).toBe(0.25);
  });
});

describe('card scorer — eligibility and 5/24', () => {
  it('blocks enforcing issuers at 5/24 with the date the applicant is under the limit again', () => {
    const jordan = applicant({ profileId: 'p-j', nickname: 'Jordan', five24: { count: 5, limit: 5, underLimit: false, dropOffs: [day('2027-01-10'), day('2027-03-01'), day('2027-08-01'), day('2028-01-01'), day('2028-05-01')], unknownCount: 0 } });
    const s = scoreCard(voyager, jordan, household, SPEND, OPT);
    expect(s.eligible).toBe(false);
    expect(s.blockers[0]).toBe('Northwind Bank usually denies applicants at 5/24 — Jordan is 5/24 until 2027-01-10');
    expect(s.five24.blockedByRule).toBe(true);
    // a non-enforcing issuer costs Jordan no slot
    const g = scoreCard(gold, jordan, household, SPEND, OPT);
    expect(g.eligible).toBe(true);
    expect(g.five24.slotCostCents).toBe(0);
    expect(g.reasons.join(' ')).toMatch(/already over 5\/24, so this card costs no 5\/24 slot/);
  });

  it('using the last slot costs double and reports when enforcing issuers are reachable again', () => {
    const a = applicant({ five24: { count: 4, limit: 5, underLimit: true, dropOffs: [day('2027-02-01'), day('2027-09-01'), day('2028-01-01'), day('2028-06-01')], unknownCount: 0 } });
    const s = scoreCard(gold, a, household, SPEND, OPT);
    expect(s.five24).toMatchObject({ after: 5, usesLastSlot: true, slotCostCents: 300_00 });
    expect(s.five24.underLimitAgainAt?.toISOString().slice(0, 10)).toBe('2027-02-01');
    expect(s.warnings.join(' ')).toMatch(/out of reach until 2027-02-01/);
  });

  it('business cards that are not reported do not count; minors, held cards and same-family cards', () => {
    expect(countsTowardFive24(bizInk)).toBe(false);
    expect(countsTowardFive24({ type: 'BUSINESS', businessReportsToPersonal: true })).toBe(true);
    const s = scoreCard(bizInk, applicant(), household, SPEND, OPT);
    expect(s.five24).toMatchObject({ countsToward: false, after: 2, slotCostCents: 0, underLimitAgainAt: null });
    expect(s.reasons.join(' ')).toMatch(/Does not count toward 5\/24/);
    expect(scoreCard(gold, applicant({ canApply: false, cannotApplyReason: 'Sam is under 18' }), household, SPEND, OPT).blockers).toEqual(['Sam is under 18']);
    expect(scoreCard(gold, applicant({ canApply: false }), household, SPEND, OPT).blockers[0]).toMatch(/cannot apply/);
    expect(scoreCard(gold, applicant({ heldCardIds: ['gold'] }), household, SPEND, OPT).blockers).toEqual(['Riley already has this card']);
    const fam = scoreCard(voyager, applicant({ heldFamilies: ['Voyager'] }), household, SPEND, OPT);
    expect(fam.eligible).toBe(true);
    expect(fam.warnings[0]).toMatch(/Voyager-family card/);
  });

  it('underLimitAgainAt pads with "24 months from now" when not enough cards drop off', () => {
    expect(underLimitAgainAt({ count: 1, limit: 5, underLimit: true, dropOffs: [], unknownCount: 0 }, NOW)).toBeNull();
    expect(underLimitAgainAt({ count: 4, limit: 5, underLimit: true, dropOffs: [], unknownCount: 0 }, NOW)?.toISOString().slice(0, 10)).toBe('2028-11-25');
    expect(underLimitAgainAt({ count: 5, limit: 5, underLimit: false, dropOffs: [day('2020-01-01'), day('2027-05-01')], unknownCount: 0 }, NOW)?.toISOString().slice(0, 10)).toBe('2028-11-25');
  });
});

describe('ranking and household choice', () => {
  const jordan = applicant({ profileId: 'p-j', nickname: 'Jordan', five24: { count: 5, limit: 5, underLimit: false, dropOffs: [day('2027-01-10'), day('2027-03-01'), day('2027-08-01'), day('2028-01-01'), day('2028-05-01')], unknownCount: 0 } });
  const riley = applicant({ heldCardIds: ['voyager'], heldFamilies: ['Voyager'] });
  const sam = applicant({ profileId: 'p-s', nickname: 'Sam', canApply: false, cannotApplyReason: 'Sam is under 18', five24: { count: 1, limit: 5, underLimit: true, dropOffs: [], unknownCount: 0 } });
  const riley2 = applicant();

  it('ranks eligible cards by score, ineligible last', () => {
    const r = rankCandidates([bizInk, voyager, gold], jordan, household, SPEND, OPT);
    expect(r.map((x) => x.cardId)).toEqual(['gold', 'ink', 'voyager']);
    expect(r[2].eligible).toBe(false);
  });

  it('a 5/24-enforcing card goes to the member under the limit; others go to the member already over it', () => {
    const v = whoShouldApply(voyager, [jordan, riley2, sam], household, SPEND, OPT);
    expect(v.best?.member).toBe('Riley');
    expect(v.why).toMatch(/^Riley should apply for Northwind Voyager — uses one 5\/24 slot \(2\/24 → 3\/24\)\. Others: Jordan: Northwind Bank usually denies/);
    expect(v.why).toMatch(/Sam: Sam is under 18/);
    const g = whoShouldApply(gold, [jordan, riley2, sam], household, SPEND, OPT);
    expect(g.best?.member).toBe('Jordan');
    expect(g.why).toMatch(/Jordan is already over 5\/24, so no slot is used/);
    expect(whoShouldApply(bizInk, [riley2], household, SPEND, OPT).why).toMatch(/does not count toward 5\/24/);
    const none = whoShouldApply(voyager, [jordan, riley, sam], household, SPEND, OPT);
    expect(none.best).toBeNull();
    expect(none.why).toBe('No one in the household is a good fit for Northwind Voyager right now.');
  });

  it('household plan: top cards per member and the overall pick', () => {
    const plan = householdNextCards([gold, voyager, bizInk], [jordan, riley2, sam], household, SPEND, OPT, 2);
    expect(plan.members.find((m) => m.member === 'Sam')?.top).toEqual([]);
    expect(plan.members.find((m) => m.member === 'Riley')?.top).toHaveLength(2);
    expect(plan.pick).toMatchObject({ member: 'Jordan', cardId: 'gold' });
    expect(plan.why).toMatch(/^Jordan → Contoso Gold: first-year value ~\$1,016, then ~\$266\/yr\./);
    const neg = householdNextCards([candidate({ id: 'n', name: 'Neg', annualFeeCents: 500_00, bonusPoints: 100_000, currency: CUR.points })], [riley2], household, SPEND, OPT);
    expect(neg.why).toMatch(/then ~-\$500\/yr/);
    expect(householdNextCards([voyager], [jordan, sam], household, SPEND, OPT).why).toBe('No eligible cards for anyone in the household right now.');
  });
});

describe('approval odds from the self-reported credit band', () => {
  it('compares the member band with the card requirement', () => {
    expect(approvalOdds('EXCELLENT', 'EXCELLENT')).toBe('LIKELY');
    expect(approvalOdds('EXCELLENT', 'GOOD')).toBe('LIKELY');
    expect(approvalOdds('VERY_GOOD', 'EXCELLENT')).toBe('POSSIBLE');
    expect(approvalOdds('GOOD', 'EXCELLENT')).toBe('UNLIKELY');
    expect(approvalOdds(null, 'GOOD')).toBe('UNKNOWN');
    expect(approvalOdds('POOR', undefined)).toBe('UNKNOWN');
  });

  it('scales the score by the odds, warns when below, and suggests adding a band', () => {
    const premium = { ...gold, recommendedCredit: 'EXCELLENT' as const };
    const likely = scoreCard(premium, applicant({ creditBand: 'EXCELLENT' }), household, SPEND, OPT);
    const possible = scoreCard(premium, applicant({ creditBand: 'VERY_GOOD' }), household, SPEND, OPT);
    const unlikely = scoreCard(premium, applicant({ creditBand: 'FAIR' }), household, SPEND, OPT);
    const unknown = scoreCard(premium, applicant(), household, SPEND, OPT);
    expect([likely.approvalOdds, possible.approvalOdds, unlikely.approvalOdds, unknown.approvalOdds]).toEqual(['LIKELY', 'POSSIBLE', 'UNLIKELY', 'UNKNOWN']);
    expect(possible.score).toBe(Math.round(likely.score * 0.75));
    expect(unlikely.score).toBe(Math.round(likely.score * 0.4));
    expect(unknown.score).toBe(likely.score);
    expect(possible.warnings.join(' ')).toMatch(/Riley's credit \(very good\) is below what Contoso Gold usually needs \(excellent\) — approval is less certain/);
    expect(unlikely.warnings.join(' ')).toMatch(/approval is unlikely/);
    expect(unknown.confidenceNotes).toContain("Add Riley's credit band to estimate approval odds");
    expect(likely.eligible && unlikely.eligible).toBe(true); // odds never block, they rank
  });
});

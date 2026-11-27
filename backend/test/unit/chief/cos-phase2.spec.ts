import { boardReport } from '../../../src/domain/cos-board';
import { feeBoard, feeTotals, feeVerdict, FeeCardInput } from '../../../src/domain/cos-fees';
import { annualOutlook, gradeOf, householdScore, loyaltyScore, offerScore, portfolioScore, scoreCards, ScoreSignals, travelScore } from '../../../src/domain/cos-scores';

const NOW = new Date('2026-11-26T15:00:00Z');

describe('TC-COS: scores', () => {
  it('grades by 80 / 60 / 40', () => {
    expect([100, 80, 79, 60, 59, 40, 39, 0].map(gradeOf)).toEqual(['STRONG', 'STRONG', 'GOOD', 'GOOD', 'FAIR', 'FAIR', 'WEAK', 'WEAK']);
  });
  it('loyalty: starts from the health score, loses points for value at risk and what already expired, and says why', () => {
    const ok = loyaltyScore({ healthScore: 80, atRiskCents: 0, totalCents: 500_000, expiredCents: 0 });
    expect(ok).toMatchObject({ key: 'LOYALTY', score: 80, grade: 'STRONG' });
    const bad = loyaltyScore({ healthScore: 80, atRiskCents: 250_000, totalCents: 500_000, expiredCents: 50_000 });
    expect(bad.score).toBeLessThan(ok.score);
    expect(bad.reasons.join(' ')).toMatch(/\$2,500 of your \$5,000.*at risk/);
    expect(bad.reasons.join(' ')).toMatch(/\$500 has already expired/);
    expect(loyaltyScore({ healthScore: null, atRiskCents: 0, totalCents: 0, expiredCents: 0 }).score).toBe(60);
  });
  it('portfolio: fee coverage and cards that need a decision', () => {
    expect(portfolioScore({ cards: 0, feesCents: 0, valueCents: 0, toReview: 0 }).score).toBe(50);
    expect(portfolioScore({ cards: 3, feesCents: 0, valueCents: 0, toReview: 0 }).score).toBe(90);
    const covered = portfolioScore({ cards: 2, feesCents: 100_000, valueCents: 150_000, toReview: 0 });
    expect(covered.score).toBe(100);
    const short = portfolioScore({ cards: 2, feesCents: 100_000, valueCents: 50_000, toReview: 1 });
    expect(short.score).toBe(27);
    expect(short.reasons.join(' ')).toMatch(/50% covered/);
    expect(short.reasons.join(' ')).toMatch(/1 of 2 cards is worth a keep-or-cancel decision/);
  });
  it('offers: missed value, unactivated offers and a good hit rate', () => {
    expect(offerScore({ availableCount: 0, availableCents: 0, expiringUnactivated: 0, missedCents: 0, hitRate: null, savedCents: 0 }).score).toBe(60);
    const clean = offerScore({ availableCount: 5, availableCents: 20_000, expiringUnactivated: 0, missedCents: 0, hitRate: 0.8, savedCents: 30_000 });
    expect(clean.score).toBe(90);
    const messy = offerScore({ availableCount: 5, availableCents: 20_000, expiringUnactivated: 3, missedCents: 20_000, hitRate: null, savedCents: 0 });
    expect(messy.score).toBe(80 - 20 - 15);
    expect(messy.reasons.join(' ')).toMatch(/3 offers ending soon have not been activated/);
  });
  it('travel: certificates, memberships, points, bonuses and a trip goal', () => {
    const ready = travelScore({ membershipsValid: 2, membershipsExpiring: 0, certificatesUsable: 1, certificatesExpiring: 0, points: 120_000, activeBonus: true, tripGoalPct: 40 });
    expect(ready.score).toBe(50 + 15 + 15 + 10 + 5 + 4);
    const worried = travelScore({ membershipsValid: 0, membershipsExpiring: 1, certificatesUsable: 1, certificatesExpiring: 1, points: 0, activeBonus: false, tripGoalPct: null });
    expect(worried.score).toBe(50 - 15 - 10);
    expect(worried.grade).toBe('WEAK');
  });
  it('household: the other scores, urgent items, goals behind and 5/24', () => {
    const parts = [{ key: 'LOYALTY', score: 80 }, { key: 'PORTFOLIO', score: 60 }] as never;
    expect(householdScore(parts, { criticalItems: 0, goalsTotal: 0, goalsBehind: 0, membersOverLimit: 0, members: 2 }).score).toBe(Math.round(70 * 0.6 + 100 * 0.4));
    const worse = householdScore(parts, { criticalItems: 2, goalsTotal: 3, goalsBehind: 2, membersOverLimit: 1, members: 2 });
    expect(worse.score).toBe(Math.round(70 * 0.6 + 70 * 0.4 - 10 - 5));
    expect(worse.reasons.join(' ')).toMatch(/2 critical actions waiting/);
    expect(worse.reasons.join(' ')).toMatch(/2 of 3 goals are behind or at risk/);
  });
  it('gives five cards, household first, each with reasons and a link', () => {
    const sig: ScoreSignals = { loyalty: { healthScore: 70, atRiskCents: 0, totalCents: 0, expiredCents: 0 }, portfolio: { cards: 1, feesCents: 0, valueCents: 0, toReview: 0 }, offers: { availableCount: 1, availableCents: 1, expiringUnactivated: 0, missedCents: 0, hitRate: null, savedCents: 1 }, travel: { membershipsValid: 0, membershipsExpiring: 0, certificatesUsable: 0, certificatesExpiring: 0, points: 0, activeBonus: false, tripGoalPct: null }, household: { criticalItems: 0, goalsTotal: 0, goalsBehind: 0, membersOverLimit: 0, members: 1 } };
    const c = scoreCards(sig);
    expect(c.map((x) => x.key)).toEqual(['HOUSEHOLD', 'LOYALTY', 'PORTFOLIO', 'OFFERS', 'TRAVEL']);
    for (const x of c) {
      expect(x.score).toBeGreaterThanOrEqual(0);
      expect(x.score).toBeLessThanOrEqual(100);
      expect(x.reasons.length).toBeGreaterThan(0);
      expect(x.href.startsWith('/')).toBe(true);
    }
  });
});

describe('TC-COS: annual outlook', () => {
  const base = { now: NOW, realizedYtdCents: 120_000, recentMonthsCents: [10_000, 12_000, 8_000, 15_000, 9_000, 11_000], rewardsRunRate12mCents: 60_000, scheduledValueCents: 30_000, feesRemainingCents: 40_000 };
  it('adds the year so far to a projection of the rest, less fees, as a range with its assumptions', () => {
    const o = annualOutlook(base);
    expect(o.realizedYtdCents).toBe(120_000);
    expect(o.projectedAdditionalCents).toBeGreaterThan(0);
    expect(o.netCents).toBe(120_000 + o.projectedAdditionalCents - 40_000);
    expect(o.lowCents).toBeLessThan(o.netCents);
    expect(o.highCents).toBeGreaterThan(o.netCents);
    expect(o.confidence).toBe(70);
    expect(o.assumptions.join(' ')).toMatch(/estimate/);
  });
  it('projects less late in the year, and is less sure with little history', () => {
    const early = annualOutlook({ ...base, now: new Date('2026-02-01T00:00:00Z') });
    const late = annualOutlook({ ...base, now: new Date('2026-12-20T00:00:00Z') });
    expect(early.projectedAdditionalCents).toBeGreaterThan(late.projectedAdditionalCents);
    expect(annualOutlook({ ...base, recentMonthsCents: [0, 0, 5_000] }).confidence).toBe(35);
    expect(annualOutlook({ ...base, recentMonthsCents: [5_000, 6_000, 7_000, 0] }).confidence).toBe(55);
  });
  it('can come out negative when fees outweigh what is expected', () => {
    expect(annualOutlook({ now: NOW, realizedYtdCents: 0, recentMonthsCents: [], rewardsRunRate12mCents: 0, scheduledValueCents: 0, feesRemainingCents: 50_000 }).netCents).toBe(-50_000);
  });
});

const card = (over: Partial<FeeCardInput> = {}): FeeCardInput => ({ card: 'Card', member: 'Alex', feeCents: 39_500, valueCents: 82_500, daysToRenewal: 120, openedMonths: 30, sibling: null, retention: null, replacement: null, ...over });

describe('TC-COS: annual fee review board', () => {
  it('keep, with the margin in dollars', () => {
    const v = feeVerdict(card());
    expect(v).toMatchObject({ verdict: 'KEEP', netCents: 43_000, impactCents: 0 });
    expect(v.justification).toBe('Benefits and rewards exceed the annual fee by $430.');
    expect(feeVerdict(card({ feeCents: 0, valueCents: 0 })).justification).toMatch(/No annual fee/);
  });
  it('retention call when others report accepting an offer and the renewal is near', () => {
    const v = feeVerdict(card({ valueCents: 20_000, daysToRenewal: 40, retention: { reports: 12, accepted: 8, sample: '30,000 points' } }));
    expect(v.verdict).toBe('RETENTION_CALL');
    expect(v.justification).toMatch(/8 members who reported one accepted.*30,000 points.*Call before it renews\. It renews in 40 days/);
    expect(v.impactCents).toBe(19_500);
    expect(v.evidence.join(' ')).toMatch(/8 of 12/);
  });
  it('downgrade to a no-fee sibling, product change to a cheaper one, replace with a better card, cancel a dud', () => {
    expect(feeVerdict(card({ valueCents: 20_000, sibling: { name: 'Gold Plus', feeCents: 0 } })).verdict).toBe('DOWNGRADE');
    const pc = feeVerdict(card({ valueCents: 20_000, sibling: { name: 'Silver', feeCents: 9_500 } }));
    expect(pc).toMatchObject({ verdict: 'PRODUCT_CHANGE', impactCents: 30_000 });
    expect(feeVerdict(card({ valueCents: 20_000, replacement: { card: 'Sapphire', longTermCents: 60_000 } })).verdict).toBe('REPLACE');
    expect(feeVerdict(card({ valueCents: 20_000, replacement: { card: 'Meh', longTermCents: 0 } })).verdict).not.toBe('REPLACE');
    const cancel = feeVerdict(card({ valueCents: 10_000 }));
    expect(cancel.verdict).toBe('CANCEL');
    expect(cancel.justification).toMatch(/less than half its \$395 fee/);
    expect(cancel.alternatives[0]).toMatch(/retention offer/);
  });
  it('a close call is a retention call; a young card or a middling one is a review', () => {
    expect(feeVerdict(card({ valueCents: 25_000 })).verdict).toBe('RETENTION_CALL');
    expect(feeVerdict(card({ valueCents: 5_000, openedMonths: 6 })).verdict).toBe('REVIEW');
  });
  it('orders what needs doing first, soonest renewal first, with keeps last; totals add up', () => {
    const cards = [card({ card: 'Keep', valueCents: 99_000 }), card({ card: 'Dud', valueCents: 5_000, daysToRenewal: 20 }), card({ card: 'Close', valueCents: 25_000, daysToRenewal: 200 })];
    const b = feeBoard(cards);
    expect(b.map((x) => x.card)).toEqual(['Dud', 'Close', 'Keep']);
    const t = feeTotals(cards, b);
    expect(t).toMatchObject({ cards: 3, feesCents: 118_500, valueCents: 129_000 });
    expect(t.counts.KEEP).toBe(1);
    expect(t.impactCents).toBe(b[0].impactCents + b[1].impactCents);
  });
});

describe('TC-COS: board report', () => {
  const cards = [card({ card: 'Keep', valueCents: 99_000 }), card({ card: 'Dud', valueCents: 5_000, daysToRenewal: 20 })];
  const verdicts = feeBoard(cards);
  const scores = scoreCards({ loyalty: { healthScore: 70, atRiskCents: 0, totalCents: 0, expiredCents: 0 }, portfolio: { cards: 2, feesCents: 79_000, valueCents: 104_000, toReview: 1 }, offers: { availableCount: 2, availableCents: 5_000, expiringUnactivated: 0, missedCents: 4_000, hitRate: null, savedCents: 9_000 }, travel: { membershipsValid: 1, membershipsExpiring: 0, certificatesUsable: 1, certificatesExpiring: 0, points: 60_000, activeBonus: false, tripGoalPct: null }, household: { criticalItems: 1, goalsTotal: 2, goalsBehind: 1, membersOverLimit: 0, members: 2 } });
  const signals = { savedThisMonthCents: 35_000, savedLastMonthCents: 20_000, offersRedeemed: 4, pointsEarned: 18_500, pointsExpired: 0, certificatesUsed: 1, certificatesUsedCents: 25_000, creditsUtilizedCents: 62_000, missedCents: 4_000, statusChanges: ['Hyatt: statusLevel Explorist'], assetsCents: 400_000, cardNetCents: 25_000, household: { goalsTotal: 2, goalsBehind: 1, members: [{ member: 'Alex', count: 2, underLimit: true }] } };
  const outlook = annualOutlook({ now: NOW, realizedYtdCents: 120_000, recentMonthsCents: [10_000], rewardsRunRate12mCents: 60_000, scheduledValueCents: 0, feesRemainingCents: 0 });
  const b = boardReport({ signals, verdicts, totals: feeTotals(cards, verdicts), scores, outlook, now: NOW });
  const sec = (k: string) => b.sections.find((s) => s.key === k)!;

  it('is the executive summary of the month', () => {
    expect(b.kind).toBe('BOARD');
    expect(b.periodKey).toBe('2026-11');
    expect(b.headline).toBe('Board report for November 2026: $350 saved, $4,250 net portfolio value');
    expect(sec('savings').lines[0].detail).toBe('Up $150 from last month ($200).');
    expect(sec('value').lines.map((l) => l.text)).toEqual(expect.arrayContaining(['18,500 points earned', '1 certificate used, worth about $250', '0 points expired']));
    expect(sec('missed').lines[0].text).toMatch(/\$40 of recommended offers expired unused/);
    expect(sec('net').lines[0].detail).toMatch(/\$4,000 in points.*\$250 net from the cards/);
    expect(b.stats).toMatchObject({ savedCents: 35_000, netCents: 425_000, cardsToDecide: 1 });
  });
  it('carries the fee verdicts, the household scores and goals, and says nothing it was not given', () => {
    expect(sec('fees').lines[0].text).toBe('Cancel: Dud');
    expect(sec('household').lines.map((l) => l.text)).toEqual(expect.arrayContaining(['1 of 2 goals on track']));
    expect(sec('household').lines.some((l) => /^Household health: \d+\/100/.test(l.text))).toBe(true);
    expect(b.summary).toMatch(/1 card to decide on\. Outlook for the year/);
    expect(sec('status').lines[0].text).toBe('Hyatt: statusLevel Explorist');
    expect(JSON.stringify(b)).not.toMatch(/automatically (apply|cancel|transfer|book)/i);
    const quiet = boardReport({ signals: { ...signals, missedCents: 0, statusChanges: [] }, verdicts: [], totals: feeTotals([], []), scores, outlook, now: NOW });
    expect(quiet.sections.find((s) => s.key === 'missed')!.empty).toBe('Nothing slipped away this month.');
    expect(quiet.summary).toMatch(/Every card earns its place\./);
  });
});

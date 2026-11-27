import { NotificationType } from '@prisma/client';
import { executiveBrief, factLine, summarize } from '../../../src/domain/cos-brief';
import { membershipItems, statusItems } from '../../../src/domain/cos-extra';
import { recoveryOf } from '../../../src/domain/cos-recovery';
import { toExecItem } from '../../../src/domain/cos-score';
import { isCritical, NORMAL_TYPES, SEVERITY } from '../../../src/domain/notification-severity';
import type { PlanItem } from '../../../src/domain/copilot-plan';

const NOW = new Date('2026-11-26T15:00:00Z');
const item = (id: string, kind: string, over: Partial<PlanItem> = {}, facts: Partial<PlanItem['facts']> = {}): PlanItem => ({
  id, lens: 'OFFER', horizon: 'WEEK', priority: 10, title: id, recommendation: 'Do it', reason: 'Because', evidence: ['Expiring offers: x'], expectedValueCents: 10_000, assumptions: [], risks: [], confidence: 90, factors: [], href: '/x', facts: { kind, daysLeft: 1, amountCents: 10_000, ...facts }, calls: [], ...over,
});
const exec = (...p: PlanItem[]) => p.map((i) => toExecItem(i, NOW));

describe('TC-COS: value recovery', () => {
  const items = exec(item('o1', 'OFFER_EXPIRING', { title: 'Hilton $100 ends tomorrow' }), item('c1', 'CERTIFICATE_EXPIRING', { lens: 'LOYALTY', title: 'Hyatt night', expectedValueCents: 25_000 }, { daysLeft: 5 }), item('a1', 'OFFER_ACTIVATE', { expectedValueCents: 6_000 }, { daysLeft: 20 }));
  const r = recoveryOf({ expiredOffers: [{ label: 'Hilton', cents: 8_000 }, { label: 'Zero', cents: 0 }], missedCredits: [{ card: 'Platinum', cents: 7_000 }, { card: 'Gold', cents: 2_000 }], expiredAssetsCents: 25_000, recoveredCents: 4_000 }, items);

  it('adds up what is gone, biggest first, ignoring zeros', () => {
    expect(r.lostCents).toBe(8_000 + 7_000 + 2_000 + 25_000);
    expect(r.lines.map((l) => l.cents)).toEqual([25_000, 8_000, 7_000, 2_000]);
    expect(r.lines.map((l) => l.kind)).toEqual(['POINTS_AND_CERTIFICATES', 'OFFER', 'CREDIT', 'CREDIT']);
    expect(r.lines.some((l) => /Zero/.test(l.label))).toBe(false);
    expect(r.recoveredCents).toBe(4_000);
  });
  it('lists what can still be saved, most pressing first, and does not count mere opportunities as at risk', () => {
    expect(r.atRiskCents).toBe(10_000 + 25_000);
    expect(r.recoverable.map((x) => x.id)).toEqual(expect.arrayContaining(['o1', 'c1']));
    expect(r.recoverable.map((x) => x.id)).not.toContain('a1');
    expect(r.recoverable[0].score).toBeGreaterThanOrEqual(r.recoverable[1].score);
    expect(r.headline).toBe('$420 lost so far; $350 can still be saved.');
  });
  it('says so when nothing is lost or at risk', () => {
    const none = recoveryOf({ expiredOffers: [], missedCredits: [], expiredAssetsCents: 0, recoveredCents: 0 }, []);
    expect(none.headline).toBe('No value has been lost and none is at risk.');
    expect(none.lines).toEqual([]);
  });
});

describe('TC-COS: executive briefing', () => {
  const items = exec(
    item('o1', 'OFFER_EXPIRING', { title: 'Hilton $100 ends tomorrow', recommendation: 'Spend $500' }),
    item('c1', 'CERTIFICATE_EXPIRING', { lens: 'LOYALTY', title: 'Hyatt free night expires in 3 days', expectedValueCents: 25_000 }, { daysLeft: 3 }),
    item('l1', 'LOYALTY_AT_RISK', { lens: 'LOYALTY', title: 'Delta miles may expire', expectedValueCents: 30_000 }, { daysLeft: 10, points: 120_000 }),
    item('g1', 'GOAL', { lens: 'GOAL', title: 'Goal: Korea', expectedValueCents: null }, { daysLeft: undefined }),
  );
  const recovery = recoveryOf({ expiredOffers: [], missedCredits: [], expiredAssetsCents: 0, recoveredCents: 0 }, items);

  it('summarizes the numbers the spec asks for', () => {
    const s = summarize(items, 6);
    expect(s).toMatchObject({ valueAtRiskCents: 10_000 + 25_000 + 30_000, pointsAtRisk: 120_000, certificatesExpiring: 1, newHighValueOffers: 6, totalActions: 4 });
    expect(s.highPriority).toBeGreaterThanOrEqual(2);
  });

  it('greets by name and leads with the count, the money at risk, points, certificates and new offers', () => {
    const b = executiveBrief({ name: 'Hyun', items, summary: summarize(items, 6), recovery, held: null, confidence: 80, now: NOW });
    expect(b.greeting).toBe('Good morning Hyun.');
    expect(b.headline).toMatch(/^Good morning Hyun\. You have \d+ high-priority actions?\.$/);
    expect(b.summary).toBe('Potential value at risk: $650 · Points at risk: 120,000 · Certificates expiring: 1 · New high-value offers: 6');
    expect(b.kind).toBe('DAILY');
    expect(b.exec).toMatchObject({ newHighValueOffers: 6 });
  });

  it('numbers the top actions, each with value, time, risk and priority', () => {
    const b = executiveBrief({ name: null, items, summary: summarize(items, 0), recovery, held: null, confidence: 80, now: NOW });
    const lines = b.sections.find((s) => s.key === 'actions')!.lines;
    expect(lines.map((l) => l.text.slice(0, 3))).toEqual(['1. ', '2. ', '3. ', '4. ']);
    expect(lines[0].detail).toMatch(/Potential value \$\d+ · Time ~\d+ min · Risk (Low|Medium|High) · Priority (Critical|High|Medium|Low|Informational) \(\d+\)/);
    expect(lines.every((l) => l.itemId)).toBe(true);
    expect(b.greeting).toBe('Good morning.');
    expect(factLine(items[0])).toMatch(/Time ~/);
  });

  it('has a quiet day, shows what Quiet Mode holds, and never says it will act for you', () => {
    const quiet = executiveBrief({ name: 'Hyun', items: [], summary: summarize([], 0), recovery: recoveryOf({ expiredOffers: [], missedCredits: [], expiredAssetsCents: 0, recoveredCents: 0 }, []), held: { total: 12, byType: [{ type: 'OFFER_EXPIRING', count: 7 }, { type: 'TRANSFER_BONUS', count: 5 }] }, confidence: 90, now: NOW });
    expect(quiet.headline).toBe('Good morning Hyun. Nothing urgent today.');
    expect(quiet.sections.find((s) => s.key === 'actions')!.empty).toMatch(/Nothing needs/);
    const held = quiet.sections.find((s) => s.key === 'held')!.lines[0];
    expect(held.text).toBe('12 updates held for this briefing');
    expect(held.detail).toBe('7 expiring offers, 5 transfer bonuses');
    expect(JSON.stringify(quiet)).not.toMatch(/automatically (apply|cancel|transfer|book)/i);
  });
});

describe('TC-COS: quarterly and annual items', () => {
  it('memberships within a year become renewal items, with what they are worth', () => {
    const rows = [
      { id: 'm1', kind: 'GLOBAL_ENTRY', member: 'Alex', expiresAt: '2027-01-10', annualValueCents: 10_000, creditSuggestion: 'The Platinum credit can pay for it.', view: { daysLeft: 45, state: 'ACTIVE', renewalEligible: true, headline: 'Global Entry expires in 2 months.' } },
      { id: 'm2', kind: 'CLEAR', member: 'Alex', view: { daysLeft: 700, state: 'ACTIVE', renewalEligible: false, headline: 'x' } },
      { id: 'm3', kind: 'CLEAR', member: 'Alex', view: { daysLeft: null, state: 'NO_DATE', renewalEligible: false, headline: 'x' } },
    ];
    const out = membershipItems(rows, NOW);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'membership:m1', lens: 'LOYALTY', expectedValueCents: 10_000, facts: { kind: 'MEMBERSHIP_RENEWAL', daysLeft: 45 } });
    expect(out[0].recommendation).toMatch(/Renew now\. The Platinum credit/);
    expect(toExecItem(out[0], NOW).center).toBe('QUARTER');
  });
  it('status that is in progress or at risk becomes a requalification item; kept status does not', () => {
    const out = statusItems([
      { id: 's1', program: 'World of Hyatt', level: 'Globalist', member: 'Alex', current: true, maintained: false, valueCents: 90_000, view: { pct: 40, daysLeft: 120, risk: 'HIGH', headline: 'Globalist: 40% there', actions: ['Book 20 more nights.'] } },
      { id: 's2', program: 'Hilton', level: 'Gold', current: true, maintained: true, view: { risk: 'NONE', headline: 'kept' } },
      { id: 's3', program: 'Old', level: 'x', current: false, maintained: false, view: { risk: 'HIGH' } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'status:s1', recommendation: 'Book 20 more nights.', facts: { kind: 'STATUS_REQUAL', daysLeft: 120 } });
    expect(toExecItem(out[0], NOW).center).toBe('ANNUAL');
  });
});

describe('TC-QUIET: which notifications are held', () => {
  it('every notification type has been classified (the map is typed over the whole enum)', () => {
    const all = Object.values(NotificationType);
    expect(Object.keys(SEVERITY).sort()).toEqual([...all].sort());
  });
  it('deadlines, failures, reminders and briefings are never held; offers, stale balances and bonuses are', () => {
    for (const t of ['BENEFIT_EXPIRING', 'LOYALTY_EXPIRING', 'CARD_RENEWAL', 'BONUS_DEADLINE', 'OFFER_SYNC_FAILED', 'OFFER_ENROLL_FAILED', 'REMINDER', 'COPILOT', 'SYSTEM', 'BACKUP_FAILED'] as NotificationType[]) expect(isCritical(t)).toBe(true);
    for (const t of ['OFFER_EXPIRING', 'OFFER_ALERT', 'OFFER_NEW_HIGH_VALUE', 'OFFER_AUTO_ENROLLED', 'OFFER_SAVINGS_DIGEST', 'TRANSFER_BONUS', 'LOYALTY_STALE'] as NotificationType[]) expect(isCritical(t)).toBe(false);
    expect([...NORMAL_TYPES].sort()).toEqual(['LOYALTY_STALE', 'OFFER_ALERT', 'OFFER_AUTO_ENROLLED', 'OFFER_EXPIRING', 'OFFER_NEW_HIGH_VALUE', 'OFFER_SAVINGS_DIGEST', 'TRANSFER_BONUS']);
  });
});

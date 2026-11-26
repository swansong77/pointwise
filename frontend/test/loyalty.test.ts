import { describe, expect, it } from 'vitest';
import { barHeights, CERT_LABEL, daysLabel, effortLabel, EVENT_KINDS, FORECAST_TYPE_LABEL, KIND_LABEL, MEMBERSHIP_KINDS, MEMBERSHIP_LABEL, POLICY_LABEL, pointsLabel, RISK_LABEL, RISK_TONE, VERDICT_LABEL } from '../src/lib/loyalty';

describe('loyalty helpers', () => {
  it('words a number of days', () => {
    expect(daysLabel(null)).toBe('no date');
    expect(daysLabel(-3)).toBe('3 day(s) ago');
    expect(daysLabel(0)).toBe('today');
    expect(daysLabel(1)).toBe('tomorrow');
    expect(daysLabel(45)).toBe('45 days');
    expect(daysLabel(181)).toBe('6 months');
    expect(daysLabel(900)).toBe('2.5 years');
  });
  it('formats points with their unit', () => {
    expect(pointsLabel(120000, 'miles')).toBe('120,000 miles');
    expect(pointsLabel(5)).toBe('5 points');
  });
  it('scales chart bars to the largest balance and never divides by zero', () => {
    expect(barHeights([{ balance: 50 }, { balance: 100 }, { balance: 0 }])).toEqual([50, 100, 0]);
    expect(barHeights([{ balance: 0 }, { balance: 0 }])).toEqual([0, 0]);
    expect(barHeights([])).toEqual([]);
  });
  it('has a label for every risk level, policy, program kind, certificate, membership, event, forecast type and verdict', () => {
    for (const r of ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'EXPIRED'] as const) {
      expect(RISK_LABEL[r]).toBeTruthy();
      expect(RISK_TONE[r]).toBeTruthy();
    }
    for (const p of ['NEVER', 'ACTIVITY', 'FIXED', 'WHILE_CARD_OPEN', 'UNKNOWN']) expect(POLICY_LABEL[p]).toBeTruthy();
    for (const k of ['AIRLINE', 'HOTEL', 'SHOPPING', 'DINING', 'CRUISE', 'RENTAL_CAR', 'CASINO', 'RETAIL', 'OTHER']) expect(KIND_LABEL[k]).toBeTruthy();
    for (const c of ['FREE_NIGHT', 'COMPANION', 'UPGRADE']) expect(CERT_LABEL[c]).toBeTruthy();
    for (const m of MEMBERSHIP_KINDS) expect(MEMBERSHIP_LABEL[m]).toBeTruthy();
    for (const t of ['POINTS', 'FREE_NIGHT', 'COMPANION', 'UPGRADE', 'STATUS', 'MEMBERSHIP', 'CREDIT']) expect(FORECAST_TYPE_LABEL[t]).toBeTruthy();
    for (const v of ['TRANSFER_NOW', 'WAIT', 'NO_BONUS_EXPECTED', 'NO_DATA']) expect(VERDICT_LABEL[v].label).toBeTruthy();
    expect(EVENT_KINDS.map((e) => e.id)).toEqual(['EARN', 'BONUS', 'PURCHASE', 'REDEEM', 'EXPIRE', 'TRANSFER_OUT', 'TRANSFER_IN']);
    expect([effortLabel('LOW'), effortLabel('MEDIUM'), effortLabel('HIGH')]).toEqual(['Easy', 'Some effort', 'Significant effort']);
  });
});

import { describe, expect, it } from 'vitest';
import { ACTIVATION_LABEL, CAUSE_LABEL, confidenceLabel, EVENT_LABEL, FACTOR_LABEL, scoreTone, SOURCE_LABEL } from '../src/lib/offer-intel';

describe('offer intelligence helpers', () => {
  it('colours scores by band', () => {
    expect(scoreTone(85)).toBe('green');
    expect(scoreTone(70)).toBe('green');
    expect(scoreTone(55)).toBe('amber');
    expect(scoreTone(40)).toBe('amber');
    expect(scoreTone(10)).toBe('slate');
  });
  it('words confidence in three bands', () => {
    expect(confidenceLabel(100)).toBe('High');
    expect(confidenceLabel(80)).toBe('High');
    expect(confidenceLabel(60)).toBe('Medium');
    expect(confidenceLabel(49)).toBe('Low');
    expect(confidenceLabel(0)).toBe('Low');
  });
  it('has a label for every source, cause, activation status, event and score factor', () => {
    for (const s of ['ISSUER_OFFICIAL', 'ACCOUNT_DATA', 'EMAIL', 'PUBLIC_PAGE', 'AI_INFERRED', 'USER_ENTERED', 'ADMIN', 'PORTAL'] as const) expect(SOURCE_LABEL[s]).toBeTruthy();
    for (const c of ['NOT_ADDED', 'NOT_ACTIVATED', 'WRONG_CARD', 'BELOW_MIN_SPEND', 'EXPIRED_BEFORE_PURCHASE'] as const) expect(CAUSE_LABEL[c].label).toBeTruthy();
    for (const a of ['NOT_REQUIRED', 'PENDING', 'ACTIVATED', 'FAILED'] as const) expect(ACTIVATION_LABEL[a].label).toBeTruthy();
    for (const e of ['IMPORTED', 'ACTIVATED', 'ACTIVATION_FAILED', 'ACTIVATION_VERIFIED', 'RECOMMENDED', 'MISSED_DETECTED']) expect(EVENT_LABEL[e]).toBeTruthy();
    for (const f of ['urgency', 'expectedSavings', 'spendFrequency', 'merchantUsage', 'categoryPreference', 'simplicity', 'redemptionProbability', 'historicalUtilization', 'householdRelevance']) expect(FACTOR_LABEL[f]).toBeTruthy();
  });
});

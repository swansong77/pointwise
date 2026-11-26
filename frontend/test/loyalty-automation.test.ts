import { describe, expect, it } from 'vitest';
import { FIELD_LABEL, FRESH_LABEL, HEALTH_TONE, OUTCOME_LABEL, PRIORITY_TONE, showValue, SOURCE_LABEL } from '../src/lib/loyalty';

describe('loyalty automation helpers', () => {
  it('shows values readably', () => {
    expect(showValue(null)).toBe('—');
    expect(showValue(85400)).toBe('85,400');
    expect(showValue('2027-02-28T00:00:00.000Z')).toBe('2027-02-28');
    expect(showValue('Platinum Elite')).toBe('Platinum Elite');
    expect(showValue({ level: 'Gold' })).toBe('{"level":"Gold"}');
  });
  it('colours health by band', () => {
    expect([HEALTH_TONE(95), HEALTH_TONE(80), HEALTH_TONE(60), HEALTH_TONE(50), HEALTH_TONE(20)]).toEqual(['green', 'green', 'amber', 'amber', 'red']);
  });
  it('labels every source, freshness, priority, outcome and field', () => {
    for (const s of ['OFFICIAL_API', 'AGGREGATOR', 'EMAIL', 'STATEMENT', 'EXTENSION', 'AI_DETECTED', 'MANUAL'] as const) expect(SOURCE_LABEL[s]).toBeTruthy();
    for (const f of ['FRESH', 'AGING', 'STALE', 'NEVER']) expect(FRESH_LABEL[f].label).toBeTruthy();
    for (const p of ['CRITICAL', 'HIGH', 'NORMAL', 'LOW']) expect(PRIORITY_TONE[p]).toBeTruthy();
    for (const o of ['ACCEPTED', 'CONFIRMED', 'KEPT', 'CONFLICT', 'PENDING', 'REJECTED']) expect(OUTCOME_LABEL[o].label).toBeTruthy();
    for (const f of ['balance', 'statusLevel', 'expiresAt', 'certificate', 'activity']) expect(FIELD_LABEL[f]).toBeTruthy();
  });
});

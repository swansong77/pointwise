import { boundingBox, haversineMeters, isValidCoordinate, toRad } from '../../src/domain/geo';
import { PLAN_LIMITS, effectivePlan, limitsFor, periodEndFor } from '../../src/domain/entitlements';

describe('geo', () => {
  it('toRad', () => expect(toRad(180)).toBeCloseTo(Math.PI));
  it('validates coordinates', () => {
    expect(isValidCoordinate(37.7, -122.4)).toBe(true);
    expect(isValidCoordinate(91, 0)).toBe(false);
    expect(isValidCoordinate(0, -181)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 0)).toBe(false);
  });
  it('haversine: SF → LA ≈ 559 km', () => {
    expect(haversineMeters(37.7749, -122.4194, 34.0522, -118.2437) / 1000).toBeCloseTo(559, -1);
    expect(haversineMeters(10, 10, 10, 10)).toBe(0);
  });
  it('bounding box contains points within radius', () => {
    const b = boundingBox(37.7749, -122.4194, 1000);
    expect(b.maxLat - b.minLat).toBeCloseTo((2 * 1000) / 111_195, 3);
    expect(b.minLng).toBeLessThan(-122.4194);
  });
  it('bounding box at the pole spans all longitudes', () => {
    const b = boundingBox(90, 0, 1000);
    expect(b.maxLng - b.minLng).toBe(360);
  });
});

describe('entitlements', () => {
  const now = new Date('2026-06-01T00:00:00Z');
  const future = new Date('2026-07-01T00:00:00Z');
  const past = new Date('2026-05-01T00:00:00Z');
  it('defaults to FREE', () => {
    expect(effectivePlan(null, now)).toBe('FREE');
    expect(effectivePlan({ plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null }, now)).toBe('FREE');
  });
  it('PRO when active/trialing in period or lifetime', () => {
    expect(effectivePlan({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: future }, now)).toBe('PRO');
    expect(effectivePlan({ plan: 'PRO', status: 'TRIALING', currentPeriodEnd: future }, now)).toBe('PRO');
    expect(effectivePlan({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: null }, now)).toBe('PRO');
  });
  it('FREE when period ended or past due', () => {
    expect(effectivePlan({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: past }, now)).toBe('FREE');
    expect(effectivePlan({ plan: 'PRO', status: 'PAST_DUE', currentPeriodEnd: future }, now)).toBe('FREE');
  });
  it('canceled keeps PRO until period end', () => {
    expect(effectivePlan({ plan: 'PRO', status: 'CANCELED', currentPeriodEnd: future }, now)).toBe('PRO');
    expect(effectivePlan({ plan: 'PRO', status: 'CANCELED', currentPeriodEnd: past }, now)).toBe('FREE');
    expect(effectivePlan({ plan: 'PRO', status: 'CANCELED', currentPeriodEnd: null }, now)).toBe('FREE');
  });
  it('limitsFor', () => {
    expect(limitsFor(null).maxCards).toBe(PLAN_LIMITS.FREE.maxCards);
    expect(limitsFor({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: null }).offerAlerts).toBe(true);
  });
  it('periodEndFor', () => {
    expect(periodEndFor('month', new Date('2026-01-15T00:00:00Z'))?.toISOString()).toBe('2026-02-15T00:00:00.000Z');
    expect(periodEndFor('year', new Date('2026-01-15T00:00:00Z'))?.toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(periodEndFor('lifetime', now)).toBeNull();
  });
});

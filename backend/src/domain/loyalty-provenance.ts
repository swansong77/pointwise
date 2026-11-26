/**
 * Data provenance and conflict resolution for loyalty data (pure). Every value that enters Pointwise, from any
 * source, carries where it came from, how far to trust that source, and when it was observed. This module
 * decides what to do when a new observation meets a stored value (ADR-017, ADR-018):
 *
 *   - a lower-reliability observation NEVER overwrites a higher-reliability one;
 *   - the same value from another source confirms it;
 *   - different values from sources within 10 reliability points are a conflict for the user to settle;
 *   - a stored value that has gone stale is flagged, and the newer lower-reliability observation waits as pending
 *     (never silently applied);
 *   - an observation older than the stored value is kept as history only.
 */

export const PROVENANCE_VERSION = 'loyalty-provenance/1';

export type SourceType = 'OFFICIAL_API' | 'AGGREGATOR' | 'EMAIL' | 'STATEMENT' | 'EXTENSION' | 'AI_DETECTED' | 'MANUAL';

export const SOURCE_RELIABILITY: Record<SourceType, number> = {
  OFFICIAL_API: 100,
  AGGREGATOR: 90,
  EMAIL: 80,
  STATEMENT: 75,
  EXTENSION: 70,
  AI_DETECTED: 50,
  MANUAL: 25,
};

export const SOURCE_LABEL: Record<SourceType, string> = {
  OFFICIAL_API: 'Official API',
  AGGREGATOR: 'Aggregator',
  EMAIL: 'Email confirmation',
  STATEMENT: 'Statement import',
  EXTENSION: 'Browser extension',
  AI_DETECTED: 'AI detected',
  MANUAL: 'Manual entry',
};

/** Reliability gap within which two disagreeing sources are a conflict rather than a clear winner. */
export const CONFLICT_BAND = 10;

/** Days after which a stored value of this field is considered stale. */
export const STALE_DAYS: Record<string, number> = {
  balance: 45,
  pendingBalance: 45,
  statusLevel: 90,
  statusDeadline: 180,
  expiresAt: 180,
  lastActivityAt: 180,
  lifetimePoints: 90,
  certificate: 90,
  membership: 180,
};
export const DEFAULT_STALE_DAYS = 60;

const DAY = 86_400_000;
/** message dates have one-second precision, so observations within a second of each other are simultaneous */
export const TIME_TOLERANCE_MS = 1000;

export const reliabilityOf = (s: SourceType): number => SOURCE_RELIABILITY[s];

export interface FieldState {
  value: unknown;
  sourceType: SourceType;
  reliability: number;
  observedAt: Date;
}

export interface Incoming {
  value: unknown;
  sourceType: SourceType;
  /** defaults to the source's scale value */
  reliability?: number;
  observedAt: Date;
}

export type DecisionAction = 'ACCEPT' | 'CONFIRM' | 'KEEP' | 'CONFLICT' | 'PENDING';
export type Verification = 'UNVERIFIED' | 'CROSS_CONFIRMED';

export interface Decision {
  action: DecisionAction;
  reason: string;
  /** the stored value is past its freshness window */
  currentStale: boolean;
  verification: Verification;
  /** the field state after the decision */
  next: FieldState | null;
}

export const staleDaysFor = (field: string): number => STALE_DAYS[field] ?? DEFAULT_STALE_DAYS;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** Whether two values differ enough to matter: numbers by 1% (at least 1), text ignoring case and spacing, dates by day. */
export function isMaterial(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return a !== b;
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) >= Math.max(1, 0.01 * Math.max(Math.abs(a), Math.abs(b)));
  if (a instanceof Date && b instanceof Date) return dayKey(a) !== dayKey(b);
  if (typeof a === 'string' && typeof b === 'string') return a.trim().toLowerCase().replace(/\s+/g, ' ') !== b.trim().toLowerCase().replace(/\s+/g, ' ');
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function isStale(current: FieldState, field: string, now: Date): boolean {
  return (now.getTime() - current.observedAt.getTime()) / DAY > staleDaysFor(field);
}

/** Reliability decayed by age: halves every 90 days, never below a fifth of the source's reliability. */
export function refreshConfidence(reliability: number, observedAt: Date | null, now: Date): number {
  if (!observedAt) return 0;
  const age = Math.max(0, (now.getTime() - observedAt.getTime()) / DAY);
  return Math.round(reliability * Math.max(0.2, Math.pow(0.5, age / 90)));
}

/** What to do with one incoming observation of one field. */
export function decideUpdate(field: string, current: FieldState | null, incoming: Incoming, now: Date): Decision {
  const inRel = incoming.reliability ?? SOURCE_RELIABILITY[incoming.sourceType];
  const make = (action: DecisionAction, reason: string, extra: Partial<Decision> = {}): Decision => ({ action, reason, currentStale: false, verification: 'UNVERIFIED', next: current, ...extra });
  const asState = (): FieldState => ({ value: incoming.value, sourceType: incoming.sourceType, reliability: inRel, observedAt: incoming.observedAt });

  if (!current) return make('ACCEPT', 'First value for this field.', { next: asState() });
  const stale = isStale(current, field, now);

  // an observation older than what is stored cannot change the present value; it is history
  if (incoming.observedAt.getTime() < current.observedAt.getTime() - TIME_TOLERANCE_MS) {
    return make('KEEP', `Older than the stored value (${dayKey(incoming.observedAt)} < ${dayKey(current.observedAt)}); kept as history only.`, { currentStale: stale });
  }

  if (!isMaterial(current.value, incoming.value)) {
    const different = incoming.sourceType !== current.sourceType;
    return make('CONFIRM', different ? `Confirmed by a second source (${SOURCE_LABEL[incoming.sourceType]}).` : 'Same value observed again.', {
      currentStale: false,
      verification: different ? 'CROSS_CONFIRMED' : 'UNVERIFIED',
      next: { value: current.value, sourceType: inRel >= current.reliability ? incoming.sourceType : current.sourceType, reliability: Math.max(inRel, current.reliability), observedAt: incoming.observedAt },
    });
  }

  if (inRel >= current.reliability) return make('ACCEPT', inRel > current.reliability ? `Higher reliability (${inRel} > ${current.reliability}).` : 'Newer observation of equal reliability.', { currentStale: stale, next: asState() });

  // lower reliability from here on
  if (current.reliability - inRel <= CONFLICT_BAND) return make('CONFLICT', `Sources disagree (${SOURCE_LABEL[incoming.sourceType]} ${inRel} vs ${SOURCE_LABEL[current.sourceType]} ${current.reliability}); needs your decision.`, { currentStale: stale });
  if (stale) return make('PENDING', `The stored value is stale (older than ${staleDaysFor(field)} days) but this source is less reliable (${inRel} < ${current.reliability}); waiting for you to confirm.`, { currentStale: true });
  return make('KEEP', `Lower reliability (${inRel} < ${current.reliability}); the stored value is kept.`);
}

export interface BatchItem extends Incoming {
  field: string;
}

export interface BatchOutcome extends Decision {
  field: string;
  incoming: BatchItem;
}

/** Applies observations oldest first so a sequence of emails and statements settles deterministically. */
export function settle(current: Record<string, FieldState | null>, items: BatchItem[], now: Date): { state: Record<string, FieldState | null>; outcomes: BatchOutcome[] } {
  const state = { ...current };
  const outcomes: BatchOutcome[] = [];
  for (const it of [...items].sort((a, b) => a.observedAt.getTime() - b.observedAt.getTime())) {
    const d = decideUpdate(it.field, state[it.field] ?? null, it, now);
    state[it.field] = d.next;
    outcomes.push({ ...d, field: it.field, incoming: it });
  }
  return { state, outcomes };
}

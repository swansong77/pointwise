/**
 * Sync scheduling: when an offer account is due (daily at a local hour, weekly, monthly), retry and backoff, lock
 * after repeated login failures, and recovery of runs that never finished. Pure code.
 */
export type Cadence = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'MANUAL';

export const MAX_ATTEMPTS = 3;
export const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000, 2 * 3_600_000];
export const LOCK_AFTER_FAILED_LOGINS = 3;
export const STALE_RUN_MS = 30 * 60_000;
export const DAILY_RUN_CAP = 6;

export interface ScheduleAccount {
  cadence: Cadence;
  syncHour: number;
  timezone: string;
}

/** Offset (ms) of a time zone from UTC at an instant. */
export function tzOffsetMs(at: Date, timezone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

export function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The UTC instant at which the wall clock in the time zone reads y-m-d h:00. */
export function zonedToUtc(y: number, m: number, d: number, hour: number, timezone: string): Date {
  const guess = Date.UTC(y, m - 1, d, hour, 0, 0);
  let t = guess - tzOffsetMs(new Date(guess), timezone);
  t = guess - tzOffsetMs(new Date(t), timezone);
  return new Date(t);
}

function localParts(at: Date, timezone: string) {
  const local = new Date(at.getTime() + tzOffsetMs(at, timezone));
  return { y: local.getUTCFullYear(), m: local.getUTCMonth() + 1, d: local.getUTCDate(), dow: local.getUTCDay() };
}

const onScheduleDay = (cadence: Cadence, d: number, dow: number) => cadence === 'DAILY' || (cadence === 'WEEKLY' && dow === 1) || (cadence === 'MONTHLY' && d === 1);

/** The most recent scheduled run time at or before `now` (null for MANUAL). */
export function lastBoundary(a: ScheduleAccount, now: Date): Date | null {
  if (a.cadence === 'MANUAL') return null;
  for (let back = 0; back < 40; back++) {
    const { y, m, d, dow } = localParts(new Date(now.getTime() - back * 86_400_000), a.timezone);
    if (!onScheduleDay(a.cadence, d, dow)) continue;
    const t = zonedToUtc(y, m, d, a.syncHour, a.timezone);
    if (t.getTime() <= now.getTime()) return t;
  }
  return null;
}

/** The next scheduled run after `now` (null for MANUAL). */
export function nextRunAt(a: ScheduleAccount, now: Date): Date | null {
  if (a.cadence === 'MANUAL') return null;
  for (let fwd = 0; fwd < 40; fwd++) {
    const { y, m, d, dow } = localParts(new Date(now.getTime() + fwd * 86_400_000), a.timezone);
    if (!onScheduleDay(a.cadence, d, dow)) continue;
    const t = zonedToUtc(y, m, d, a.syncHour, a.timezone);
    if (t.getTime() > now.getTime()) return t;
  }
  return null;
}

/** An account is due when its last scheduled attempt is older than the most recent boundary. */
export function isDue(a: ScheduleAccount, lastScheduledAttemptAt: Date | null, now: Date): boolean {
  const b = lastBoundary(a, now);
  if (!b) return false;
  return !lastScheduledAttemptAt || lastScheduledAttemptAt.getTime() < b.getTime();
}

export type FailureKind = 'NETWORK' | 'SESSION_TIMEOUT' | 'SITE_CHANGED' | 'BAD_CREDENTIALS' | 'MFA_REQUIRED' | 'MFA_FAILED' | 'LOCKED' | 'DISABLED';

export const isTransient = (k: FailureKind): boolean => k === 'NETWORK' || k === 'SESSION_TIMEOUT';

/** Delay before the next attempt, or null when the failure should not be retried. `attempt` is the attempt that just failed (1-based). */
export function retryDelay(kind: FailureKind, attempt: number): number | null {
  if (!isTransient(kind) || attempt >= MAX_ATTEMPTS) return null;
  return RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
}

/** Account health after a failure. */
export function healthAfterFailure(kind: FailureKind, failedLogins: number): 'DEGRADED' | 'NEEDS_MFA' | 'NEEDS_LOGIN' | 'ERROR' | 'LOCKED' | 'DISABLED' {
  if (kind === 'LOCKED' || failedLogins >= LOCK_AFTER_FAILED_LOGINS) return 'LOCKED';
  if (kind === 'MFA_REQUIRED' || kind === 'MFA_FAILED') return 'NEEDS_MFA';
  if (kind === 'BAD_CREDENTIALS') return 'NEEDS_LOGIN';
  if (kind === 'DISABLED') return 'DISABLED';
  if (kind === 'SITE_CHANGED') return 'ERROR';
  return 'DEGRADED';
}

export const isStaleRun = (startedAt: Date | null, now: Date): boolean => !!startedAt && now.getTime() - startedAt.getTime() > STALE_RUN_MS;

/** Pacing between accounts so one login is made at a time, with jitter (random is 0 to 1). */
export function pacingDelayMs(random: number): number {
  return 20_000 + Math.round(random * 40_000);
}

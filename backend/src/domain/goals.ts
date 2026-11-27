/**
 * Goals (pure): what the member is working toward and how far along they are, computed from their own data. A goal is a kind, a title
 * and a target; progress is never typed in except for custom goals.
 */
export const GOALS_VERSION = 'goals/1';
export const GOAL_KINDS = ['STATUS', 'FIVE24', 'TRIP', 'CASHBACK', 'FEES', 'MILES', 'CUSTOM'] as const;
export type GoalKindName = (typeof GOAL_KINDS)[number];
export const MAX_ACTIVE_GOALS = 20;

export const GOAL_KIND_LABEL: Record<GoalKindName, string> = {
  STATUS: 'Earn elite status',
  FIVE24: 'Stay under 5/24',
  TRIP: 'Save points for a trip',
  CASHBACK: 'Earn cash back',
  FEES: 'Keep annual fees down',
  MILES: 'Build a points balance',
  CUSTOM: 'Something else',
};

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {});
const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const int = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : null);

export interface GoalInput {
  kind: unknown;
  title: unknown;
  target?: unknown;
  dueAt?: unknown;
  profileId?: unknown;
}
export interface GoalValue {
  kind: GoalKindName;
  title: string;
  target: Obj;
  dueAt: Date | null;
  profileId: string | null;
}
export type GoalCheck = { ok: true; value: GoalValue } | { ok: false; error: string };

export function checkGoal(i: GoalInput, now: Date): GoalCheck {
  const kind = GOAL_KINDS.find((k) => k === i.kind);
  if (!kind) return { ok: false, error: 'Unknown goal type' };
  const title = text(i.title, 120);
  if (title.length < 2) return { ok: false, error: 'A goal needs a title' };
  const t = obj(i.target);
  let target: Obj = {};
  const bad = (m: string): GoalCheck => ({ ok: false, error: m });
  switch (kind) {
    case 'STATUS': {
      const program = text(t.program, 60);
      const level = text(t.level, 40);
      if (!program || !level) return bad('Say which program and which level');
      target = { program, level };
      break;
    }
    case 'FIVE24': {
      const max = t.max == null ? 4 : int(t.max);
      if (max == null || max < 0 || max > 10) return bad('The 5/24 limit must be between 0 and 10');
      target = { max };
      break;
    }
    case 'TRIP': {
      const destination = text(t.destination, 80);
      const pointsNeeded = int(t.pointsNeeded);
      if (!destination) return bad('Say where you want to go');
      if (pointsNeeded == null || pointsNeeded < 1 || pointsNeeded > 5_000_000) return bad('Points needed must be between 1 and 5,000,000');
      target = { destination, pointsNeeded, ...(text(t.program, 60) ? { program: text(t.program, 60) } : {}) };
      break;
    }
    case 'CASHBACK': {
      const annualCents = int(t.annualCents);
      if (annualCents == null || annualCents < 1 || annualCents > 100_000_000) return bad('The yearly cash back target must be positive');
      target = { annualCents };
      break;
    }
    case 'FEES': {
      const maxCents = int(t.maxCents);
      if (maxCents == null || maxCents < 0 || maxCents > 10_000_000) return bad('The annual fee limit must be 0 or more');
      target = { maxCents };
      break;
    }
    case 'MILES': {
      const program = text(t.program, 60);
      const points = int(t.points);
      if (!program) return bad('Say which program');
      if (points == null || points < 1 || points > 50_000_000) return bad('The target balance must be positive');
      target = { program, points };
      break;
    }
    case 'CUSTOM':
      target = {};
      break;
  }
  let dueAt: Date | null = null;
  if (i.dueAt != null && i.dueAt !== '') {
    dueAt = typeof i.dueAt === 'string' || i.dueAt instanceof Date ? new Date(i.dueAt) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) return bad('That date is not valid');
    if (dueAt.getTime() < now.getTime() - 86_400_000) return bad('The date has already passed');
    if (dueAt.getTime() > now.getTime() + 3650 * 86_400_000) return bad('That date is too far ahead');
  }
  const profileId = typeof i.profileId === 'string' && /^[0-9a-f-]{36}$/i.test(i.profileId) ? i.profileId : null;
  return { ok: true, value: { kind, title, target, dueAt, profileId } };
}

// ───────────── progress ─────────────

export interface GoalSignals {
  five24: Array<{ profileId: string; member: string; count: number; limit: number; nextSlotAt: Date | null }>;
  annualFeesCents: number;
  rewards12mCents: number;
  balances: Array<{ program: string; member: string; balance: number }>;
  statuses: Array<{ program: string; level: string; member: string; progress: number; required: number; maintained: boolean; pct: number | null; headline: string; expiresAt: Date | null }>;
}

export type GoalState = 'ACHIEVED' | 'ON_TRACK' | 'AT_RISK' | 'BEHIND' | 'UNKNOWN';

export interface GoalProgress {
  /** 0–100 where it makes sense */
  pct: number | null;
  current: string;
  target: string;
  state: GoalState;
  detail: string;
  next: string[];
  confidence: number;
}

export interface GoalLike {
  kind: GoalKindName;
  title: string;
  target: unknown;
  manualProgress?: number | null;
  dueAt?: Date | null;
  profileId?: string | null;
}

const usd = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US');
const num = (n: number) => Math.round(n).toLocaleString('en-US');
const same = (a: string, b: string) => {
  const x = a.toLowerCase().trim();
  const y = b.toLowerCase().trim();
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};
const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const unknown = (target: string, detail: string, next: string[]): GoalProgress => ({ pct: null, current: 'not recorded', target, state: 'UNKNOWN', detail, next, confidence: 20 });

function pace(pct: number, dueAt: Date | null | undefined, now: Date): GoalState {
  if (pct >= 100) return 'ACHIEVED';
  if (!dueAt) return 'ON_TRACK';
  const days = Math.ceil((dueAt.getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return 'BEHIND';
  if (days <= 30 && pct < 75) return 'AT_RISK';
  if (days <= 60 && pct < 50) return 'AT_RISK';
  if (days <= 120 && pct < 25) return 'AT_RISK';
  return 'ON_TRACK';
}

export function goalProgress(g: GoalLike, s: GoalSignals, now: Date): GoalProgress {
  const t = obj(g.target);
  switch (g.kind) {
    case 'STATUS': {
      const program = text(t.program, 60);
      const level = text(t.level, 40);
      const label = `${program} ${level}`;
      const rows = s.statuses.filter((x) => same(x.program, program) && (!g.profileId || true));
      const hit = rows.find((x) => same(x.level, level)) ?? rows[0];
      if (!hit) return unknown(label, `No ${program} status is recorded yet.`, [`Record your ${program} status on the Loyalty page so progress can be tracked.`]);
      const exact = same(hit.level, level);
      if (exact && hit.maintained) return { pct: 100, current: `${hit.level} (kept)`, target: label, state: 'ACHIEVED', detail: hit.headline, next: [], confidence: 85 };
      if (!exact) return { pct: hit.pct ?? 0, current: `${hit.level}: ${hit.progress.toLocaleString('en-US')} of ${hit.required.toLocaleString('en-US')}`, target: label, state: pace(hit.pct ?? 0, g.dueAt, now), detail: `You are tracked at ${hit.level}; ${level} is a different tier, so this is the nearest progress.`, next: [`Record the requirements for ${label} to track it exactly.`], confidence: 40 };
      const pct = hit.pct ?? (hit.required > 0 ? clamp((hit.progress / hit.required) * 100) : 0);
      return { pct, current: `${num(hit.progress)} of ${num(hit.required)}`, target: label, state: pace(pct, g.dueAt ?? hit.expiresAt, now), detail: hit.headline, next: hit.required > hit.progress ? [`${num(hit.required - hit.progress)} more to qualify.`] : [], confidence: 80 };
    }
    case 'FIVE24': {
      const max = int(t.max) ?? 4;
      const rows = g.profileId ? s.five24.filter((r) => r.profileId === g.profileId) : s.five24;
      if (!rows.length) return unknown(`${max}/24 or fewer`, 'No 5/24 data yet.', ['Add your cards and their opening dates to track 5/24.']);
      const worst = [...rows].sort((a, b) => b.count - a.count)[0];
      const ok = worst.count <= max;
      return {
        pct: ok ? 100 : clamp((max / Math.max(1, worst.count)) * 100),
        current: `${worst.member}: ${worst.count}/24`,
        target: `${max}/24 or fewer`,
        state: ok ? 'ON_TRACK' : 'BEHIND',
        detail: ok ? `${worst.member} is at ${worst.count}/24. ${max - worst.count} more card${max - worst.count === 1 ? '' : 's'} would still keep you at the goal.` : `${worst.member} is at ${worst.count}/24, above your goal of ${max}.${worst.nextSlotAt ? ` The next card drops off ${worst.nextSlotAt.toISOString().slice(0, 10)}.` : ''}`,
        next: ok ? [] : ['Hold new personal-card applications until a card drops off.'],
        confidence: 85,
      };
    }
    case 'TRIP': {
      const need = int(t.pointsNeeded) ?? 0;
      const program = text(t.program, 60);
      const dest = text(t.destination, 80);
      const rows = program ? s.balances.filter((b) => same(b.program, program)) : s.balances;
      const have = rows.reduce((sum, b) => sum + b.balance, 0);
      const pct = need > 0 ? clamp((have / need) * 100) : 0;
      return {
        pct,
        current: `${num(have)} points${program ? ` in ${program}` : ''}`,
        target: `${num(need)} points for ${dest}`,
        state: pace(pct, g.dueAt, now),
        detail: pct >= 100 ? `You have enough points for ${dest}.` : `${num(Math.max(0, need - have))} more points needed for ${dest}.`,
        next: pct >= 100 ? ['Search award availability and decide whether to transfer.'] : ['Look at transfer bonuses and where your next spend earns the most points.'],
        confidence: rows.length ? 70 : 30,
      };
    }
    case 'CASHBACK': {
      const target = int(t.annualCents) ?? 0;
      const pct = target > 0 ? clamp((s.rewards12mCents / target) * 100) : 0;
      return { pct, current: `${usd(s.rewards12mCents)} in the last 12 months`, target: `${usd(target)} a year`, state: pace(pct, g.dueAt, now), detail: pct >= 100 ? 'You are earning at or above your target.' : `${usd(Math.max(0, target - s.rewards12mCents))} short of the target.`, next: pct >= 100 ? [] : ['Check the next-card recommendations for a better earner on your spend.'], confidence: 60 };
    }
    case 'FEES': {
      const max = int(t.maxCents) ?? 0;
      const ok = s.annualFeesCents <= max;
      return { pct: ok ? 100 : clamp((max / Math.max(1, s.annualFeesCents)) * 100), current: `${usd(s.annualFeesCents)} in annual fees`, target: `${usd(max)} or less`, state: ok ? 'ON_TRACK' : 'BEHIND', detail: ok ? 'Your annual fees are within your limit.' : `${usd(s.annualFeesCents - max)} over your limit.`, next: ok ? [] : ['Review which cards cover their fee and which could be downgraded.'], confidence: 85 };
    }
    case 'MILES': {
      const program = text(t.program, 60);
      const need = int(t.points) ?? 0;
      const rows = s.balances.filter((b) => same(b.program, program));
      const have = rows.reduce((sum, b) => sum + b.balance, 0);
      if (!rows.length) return unknown(`${num(need)} ${program}`, `No ${program} balance is recorded yet.`, [`Add your ${program} balance on the Loyalty page.`]);
      const pct = need > 0 ? clamp((have / need) * 100) : 0;
      return { pct, current: `${num(have)}`, target: `${num(need)} ${program}`, state: pace(pct, g.dueAt, now), detail: pct >= 100 ? 'You have reached the target balance.' : `${num(Math.max(0, need - have))} to go.`, next: [], confidence: 75 };
    }
    case 'CUSTOM': {
      const pct = g.manualProgress == null ? null : clamp(g.manualProgress);
      if (pct == null) return { pct: null, current: 'not tracked', target: g.title, state: 'UNKNOWN', detail: 'You track this one yourself.', next: ['Update your progress when it changes.'], confidence: 30 };
      return { pct, current: `${pct}%`, target: g.title, state: pace(pct, g.dueAt, now), detail: `You marked this ${pct}% done.`, next: [], confidence: 60 };
    }
  }
}

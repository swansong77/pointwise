/**
 * What Copilot remembers (pure): preferences the member set, decisions about plan items (snoozed, dismissed, done), and how both shape
 * a plan. It only reorders and hides items; it never invents one. None of it is ever sent to a model.
 */
import type { PlanItem } from './copilot-plan';

export const MEMORY_VERSION = 'copilot-memory/1';
export const MAX_MEMORY_ROWS = 300;
export const PRIORITIES = ['CASHBACK', 'TRAVEL', 'HOTEL', 'AIRLINE', 'LOW_FEE'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface Preferences {
  airlines: string[];
  hotels: string[];
  destinations: string[];
  merchants: string[];
  priorities: Priority[];
}
export const EMPTY_PREFS: Preferences = { airlines: [], hotels: [], destinations: [], merchants: [], priorities: [] };

const LIST_KEYS = ['airlines', 'hotels', 'destinations', 'merchants'] as const;

function cleanList(x: unknown): string[] | null {
  if (!Array.isArray(x)) return null;
  const out: string[] = [];
  for (const v of x) {
    if (typeof v !== 'string') return null;
    const t = v.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    if (t.length > 60) return null;
    if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.length > 12 ? null : out;
}

export type PrefsCheck = { ok: true; value: Partial<Preferences> } | { ok: false; error: string };

/** Only the keys given are changed. */
export function checkPreferences(input: unknown): PrefsCheck {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Preferences must be an object' };
  const i = input as Record<string, unknown>;
  const value: Partial<Preferences> = {};
  for (const k of LIST_KEYS) {
    if (i[k] === undefined) continue;
    const l = cleanList(i[k]);
    if (!l) return { ok: false, error: `${k} must be a list of up to 12 short names` };
    value[k] = l;
  }
  if (i.priorities !== undefined) {
    if (!Array.isArray(i.priorities) || i.priorities.some((p) => !(PRIORITIES as readonly string[]).includes(p as string))) return { ok: false, error: 'Unknown priority' };
    value.priorities = [...new Set(i.priorities as Priority[])];
  }
  return { ok: true, value };
}

// ───────────── decisions ─────────────

export type DecisionAction = 'DISMISS' | 'SNOOZE' | 'DONE';
export const DECISION_ACTIONS: DecisionAction[] = ['DISMISS', 'SNOOZE', 'DONE'];
export interface Decision {
  itemId: string;
  action: DecisionAction;
  /** hidden until this instant */
  until: string;
  at: string;
}

const DAY = 86_400_000;
export const DISMISS_DAYS = 90;
export const DONE_DAYS = 30;
export const DEFAULT_SNOOZE_DAYS = 7;

export type DecisionCheck = { ok: true; value: Decision } | { ok: false; error: string };

export function checkDecision(input: { itemId: unknown; action: unknown; days?: unknown }, now: Date): DecisionCheck {
  const itemId = typeof input.itemId === 'string' ? input.itemId.trim() : '';
  if (!itemId || itemId.length > 160) return { ok: false, error: 'Which item?' };
  const action = DECISION_ACTIONS.find((a) => a === input.action);
  if (!action) return { ok: false, error: 'Unknown action' };
  let days = action === 'DISMISS' ? DISMISS_DAYS : action === 'DONE' ? DONE_DAYS : DEFAULT_SNOOZE_DAYS;
  if (action === 'SNOOZE' && input.days != null) {
    if (typeof input.days !== 'number' || !Number.isInteger(input.days) || input.days < 1 || input.days > 90) return { ok: false, error: 'Snooze for 1 to 90 days' };
    days = input.days;
  }
  return { ok: true, value: { itemId, action, until: new Date(now.getTime() + days * DAY).toISOString(), at: now.toISOString() } };
}

export function isHidden(d: Pick<Decision, 'until'> | undefined, now: Date): boolean {
  return !!d && new Date(d.until).getTime() > now.getTime();
}

// ───────────── shaping a plan ─────────────

const norm = (s: string) => s.toLowerCase();

function matches(item: PlanItem, prefs: Preferences): string | null {
  const hay = [item.facts.subject, item.facts.program, item.facts.card].filter(Boolean).map((x) => norm(x as string)).join(' | ');
  if (!hay) return null;
  for (const p of [...prefs.airlines, ...prefs.hotels, ...prefs.merchants, ...prefs.destinations]) if (norm(p).length >= 3 && hay.includes(norm(p))) return p;
  return null;
}

const LENS_BOOST: Record<Priority, string[]> = {
  CASHBACK: ['OFFER', 'BENEFIT'],
  TRAVEL: ['TRAVEL', 'LOYALTY', 'GOAL'],
  HOTEL: ['LOYALTY'],
  AIRLINE: ['LOYALTY', 'TRAVEL'],
  LOW_FEE: ['CARD_STRATEGY'],
};

export interface MemoryEffect {
  items: PlanItem[];
  /** hidden because the member snoozed, dismissed or finished them */
  hidden: Array<{ id: string; title: string; action: DecisionAction; until: string }>;
  boosted: number;
}

const HORIZON_ORDER = { TODAY: 0, WEEK: 1, MONTH: 2, LATER: 3 } as const;

/** Hides what the member put aside, raises what matches what they care about, and keeps the order stable. */
export function applyMemory(items: PlanItem[], prefs: Preferences, decisions: Map<string, Decision>, now: Date): MemoryEffect {
  const hidden: MemoryEffect['hidden'] = [];
  const kept: PlanItem[] = [];
  let boosted = 0;
  for (const it of items) {
    const d = decisions.get(it.id);
    if (d && isHidden(d, now)) {
      hidden.push({ id: it.id, title: it.title, action: d.action, until: d.until });
      continue;
    }
    let mult = 1;
    const factors = [...it.factors];
    const m = matches(it, prefs);
    if (m) {
      mult *= 1.5;
      factors.push({ label: 'Matches your preferences', effect: 'UP', detail: m });
    }
    const lensBoost = prefs.priorities.some((p) => LENS_BOOST[p].includes(it.lens));
    if (lensBoost) {
      mult *= 1.2;
      factors.push({ label: 'Fits your priorities', effect: 'UP', detail: prefs.priorities.filter((p) => LENS_BOOST[p].includes(it.lens)).map((p) => p.toLowerCase().replace('_', ' ')).join(', ') });
    }
    if (mult !== 1) boosted++;
    kept.push(mult !== 1 ? { ...it, priority: Math.round(it.priority * mult), factors } : it);
  }
  kept.sort((a, b) => HORIZON_ORDER[a.horizon] - HORIZON_ORDER[b.horizon] || b.priority - a.priority || a.id.localeCompare(b.id));
  return { items: kept, hidden, boosted };
}

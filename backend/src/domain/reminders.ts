/**
 * Reminders (pure): the rules for what may be asked of the reminder feature. A reminder is a title, a due time and an optional link
 * back into the app; when it is due the member gets a PointWise notification.
 */
export const REMINDERS_VERSION = 'reminders/1';
export const MAX_PENDING_REMINDERS = 100;
export const MAX_TITLE = 120;
/** a reminder cannot be set further out than this */
export const MAX_DAYS_AHEAD = 800;

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** A link into this app only: a path, never another site, a protocol or a script. */
export function safeLink(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  if (!t || t.length > 200) return null;
  if (!t.startsWith('/') || t.startsWith('//') || t.includes('\\') || /[\u0000-\u001f]/.test(t)) return null;
  if (/^\/+(javascript|data|vbscript):/i.test(t)) return null;
  return t;
}

/**
 * When to remind about something that ends at `endsAt`: `daysBefore` days earlier at 14:00 UTC, or in an hour when that has
 * passed. Null when it has already ended (or ends within the hour), since there is nothing left to remind about.
 */
export function reminderDue(endsAt: Date, now: Date, daysBefore: number): Date | null {
  if (endsAt.getTime() - now.getTime() <= HOUR) return null;
  const day = new Date(Date.UTC(endsAt.getUTCFullYear(), endsAt.getUTCMonth(), endsAt.getUTCDate() - daysBefore, 14, 0, 0));
  const soon = new Date(now.getTime() + HOUR);
  const due = day.getTime() > soon.getTime() ? day : soon;
  return due.getTime() < endsAt.getTime() ? due : null;
}

export interface ReminderInput {
  title: unknown;
  dueAt: unknown;
  link?: unknown;
}

export type ReminderCheck = { ok: true; title: string; dueAt: Date; link: string | null } | { ok: false; error: string };

export function checkReminder(i: ReminderInput, now: Date): ReminderCheck {
  const title = typeof i.title === 'string' ? i.title.replace(/\s+/g, ' ').trim() : '';
  if (!title) return { ok: false, error: 'A reminder needs a title' };
  if (title.length > MAX_TITLE) return { ok: false, error: `The title can be at most ${MAX_TITLE} characters` };
  const dueAt = typeof i.dueAt === 'string' || i.dueAt instanceof Date ? new Date(i.dueAt) : null;
  if (!dueAt || Number.isNaN(dueAt.getTime())) return { ok: false, error: 'A reminder needs a valid date' };
  if (dueAt.getTime() < now.getTime() - 60_000) return { ok: false, error: 'That date has already passed' };
  if (dueAt.getTime() > now.getTime() + MAX_DAYS_AHEAD * DAY) return { ok: false, error: 'That date is too far ahead' };
  const link = i.link == null || i.link === '' ? null : safeLink(i.link);
  if (i.link != null && i.link !== '' && !link) return { ok: false, error: 'A reminder can only link to a page in PointWise' };
  return { ok: true, title, dueAt, link };
}

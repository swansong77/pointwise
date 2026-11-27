import type { NavItem } from './nav';

/** What the server sends back as you type. */
export interface Suggestion {
  type: 'ENTITY' | 'QUERY' | 'EXAMPLE' | 'PAGE' | 'SAVED' | 'RECENT';
  id: string;
  label: string;
  sublabel?: string;
  kind?: string;
  href?: string;
  query?: string;
}

export interface SuggestResponse {
  q: string;
  understood: { intent: string; confidence: number; title: string } | null;
  suggestions: Suggestion[];
  tookMs: number;
}

export interface AnswerRelated {
  type: 'CARD' | 'OFFER' | 'BENEFIT' | 'CERTIFICATE' | 'PROGRAM' | 'MERCHANT' | 'MEMBER';
  id: string;
  title: string;
  subtitle?: string;
  href: string;
}

export interface AnswerAction {
  type: 'OPEN';
  label: string;
  href: string;
}

/** A change the member can make from an answer; the browser runs it against the same endpoint the page uses, after a confirmation when `confirm` is set. */
export interface CallAction {
  type: 'CALL';
  id: string;
  kind: 'SAVE_PLAN' | 'SAVE_TRIP' | 'REMINDER' | 'ACTIVATE' | 'MARK_ADDED' | 'SYNC';
  label: string;
  method: 'POST';
  path: string;
  body: Record<string, unknown>;
  confirm: string | null;
  success: string;
}

/** The server only offers these endpoints; the browser checks again before sending anything. */
export const SAFE_CALL = /^\/(offers\/intel\/(plan|activation\/[0-9a-f-]{36})|loyalty\/award-trips|reminders|offer-automation\/(sync|items\/[0-9a-f-]{36}\/mark-enrolled))$/;
export const isSafeCall = (c: Pick<CallAction, 'method' | 'path'>) => c.method === 'POST' && SAFE_CALL.test(c.path);

export interface Reminder {
  id: string;
  title: string;
  dueAt: string;
  link: string | null;
  status: 'PENDING' | 'SENT' | 'DISMISSED';
}

export interface SearchAnswer {
  intent: string;
  kind: string;
  title: string;
  summary: string;
  sections: Array<{ heading: string | null; lines: string[] }>;
  reasoning: string[];
  evidence: string[];
  warnings: string[];
  confidence: number;
  actions: AnswerAction[];
  calls?: CallAction[];
  related: AnswerRelated[];
  followUps: string[];
  understood: Array<{ type: string; label: string }>;
  unanswered: boolean;
}

/** What the conversation remembers; sent back with the next question. Treated as opaque by the browser. */
export type Slots = Record<string, unknown>;

export interface AskResponse {
  /** the conversation; sent with the next question so the server knows what "it" is */
  sessionId: string;
  answer: SearchAnswer;
  slots: Slots;
  usedFollowUp: boolean;
  cached: boolean;
  tookMs: number;
}

/** Ctrl+K (Windows, Linux) or Cmd+K (Mac), and nothing else. */
export function isOpenShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
  return e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey;
}

/** Pages whose name starts with, or has a word that starts with, what was typed ("exp" finds Expirations). */
export function matchPages(q: string, pages: NavItem[], limit = 3): Suggestion[] {
  const t = q.trim().toLowerCase();
  if (t.length < 2) return [];
  return pages
    .map((p) => {
      const label = p.label.toLowerCase();
      const words = label.split(/[^a-z0-9]+/).filter(Boolean);
      const score = label === t ? 3 : label.startsWith(t) ? 2 : words.some((w) => w.startsWith(t)) ? 1 : 0;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.label.localeCompare(b.p.label))
    .slice(0, limit)
    .map(({ p }) => ({ type: 'PAGE' as const, id: `page:${p.href}`, label: p.label, kind: 'Page', href: p.href }));
}

/** The server's suggestions with matching pages added after the question and before the other things. */
export function mergeSuggestions(server: Suggestion[], pages: Suggestion[]): Suggestion[] {
  const i = server.findIndex((s) => s.type === 'ENTITY');
  if (i < 0) return [...server, ...pages];
  return [...server.slice(0, i), ...pages, ...server.slice(i)];
}

export function confidenceTone(c: number): 'green' | 'amber' | 'slate' {
  return c >= 75 ? 'green' : c >= 45 ? 'amber' : 'slate';
}

export function confidenceText(c: number): string {
  return c >= 75 ? 'High' : c >= 45 ? 'Medium' : 'Low';
}

/** Move the highlighted option, wrapping at both ends; -1 means nothing is highlighted. */
export function moveIndex(current: number, delta: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta === 1 ? 0 : count - 1;
  return (current + delta + count) % count;
}

/** A question the member asked or saved. */
export interface SearchEntry {
  id: string;
  query: string;
  intent: string | null;
  kind: 'HISTORY' | 'SAVED';
  name: string | null;
  uses: number;
  summary: string | null;
  lastUsedAt: string;
}

export interface SearchDashboard {
  mostCommon: SearchEntry[];
  recent: SearchEntry[];
  saved: SearchEntry[];
  favoriteMerchants: Array<{ name: string; slug: string | null; count: number }>;
  recentCards: Array<{ name: string; walletCardId: string | null }>;
  recentRecommendations: SearchEntry[];
  recentPlans: Array<{ id: string; merchantText: string; item: string | null; amountCents: number; status: string; plannedFor: string | null; createdAt: string }>;
  recentTrips: Array<{ id: string; destination: string; dateFrom: string; dateTo: string; cabin: string | null; createdAt: string }>;
  totals: { questions: number; saved: number };
}

/** Anything on the page can ask the search bar a question: it opens and runs it. */
export const ASK_EVENT = 'pointwise:ask';
export function askSearchBar(q: string): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<string>(ASK_EVENT, { detail: q }));
}

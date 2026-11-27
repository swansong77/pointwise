/**
 * What the search bar remembers about a person's questions (pure): the text with card numbers and e-mail addresses removed, what a
 * question named (merchants, cards, destination), and the dashboard built from it: most common, recent, saved, favourite merchants and
 * recent cards and recommendations.
 */
import { redactForModel } from '../ai/privacy';
import { Related } from './answer-compose';
import { norm } from './nicknames';
import { Understanding } from './query-understanding';

export const HISTORY_VERSION = 'search-history/1';
export const MAX_HISTORY = 200;
export const MAX_SAVED = 50;
export const MAX_TURNS = 10;
/** a conversation that has been quiet this long starts over */
export const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

export interface EntryRefs {
  merchants: Array<{ name: string; slug: string | null }>;
  cards: Array<{ name: string; walletCardId: string | null }>;
  programs: string[];
  destination: string | null;
}

export type EntryKind = 'HISTORY' | 'SAVED';

export interface EntryRow {
  id: string;
  query: string;
  normalized: string;
  intent: string | null;
  kind: EntryKind;
  name: string | null;
  uses: number;
  summary: string | null;
  entityRefs: EntryRefs | null;
  lastUsedAt: Date;
}

/** The question as it is stored: no card numbers, no e-mail addresses, bounded. */
export function redactQuery(text: string): string {
  return redactForModel(text).replace(/\s+/g, ' ').trim().slice(0, 300);
}

/** What is compared when the same question comes again. */
export const normalizeQuery = (text: string): string => norm(redactQuery(text)).slice(0, 300);

export function refsFrom(u: Understanding, related: Related[]): EntryRefs {
  const e = u.entities;
  const seen = new Set<string>();
  const cards: EntryRefs['cards'] = [];
  for (const r of related) {
    if (r.type !== 'CARD') continue;
    const id = r.href.startsWith('/wallet/') ? r.href.slice('/wallet/'.length) : null;
    const key = id ?? r.title;
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({ name: r.title, walletCardId: id });
  }
  for (const c of e.cards) {
    const key = c.walletCardId ?? c.name;
    if (!seen.has(key)) {
      seen.add(key);
      cards.push({ name: c.name, walletCardId: c.walletCardId });
    }
  }
  return {
    merchants: e.merchants.map((m) => ({ name: m.name, slug: m.slug ?? null })),
    cards: cards.slice(0, 4),
    programs: [...e.programs.map((p) => p.name), ...e.hotels, ...e.airlines].slice(0, 4),
    destination: e.destination,
  };
}

export interface HistoryDashboard {
  mostCommon: EntryRow[];
  recent: EntryRow[];
  saved: EntryRow[];
  favoriteMerchants: Array<{ name: string; slug: string | null; count: number }>;
  recentCards: Array<{ name: string; walletCardId: string | null }>;
  recentRecommendations: EntryRow[];
}

const RECOMMENDATION_INTENTS = new Set(['SHOPPING', 'TRAVEL', 'CARD_RECOMMENDATION', 'REDEMPTION']);

const byRecent = (a: EntryRow, b: EntryRow) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime() || a.id.localeCompare(b.id);

export function summarizeHistory(entries: EntryRow[]): HistoryDashboard {
  const history = entries.filter((e) => e.kind === 'HISTORY');
  const saved = entries.filter((e) => e.kind === 'SAVED').sort(byRecent);
  const fav = new Map<string, { name: string; slug: string | null; count: number }>();
  for (const e of history)
    for (const m of e.entityRefs?.merchants ?? []) {
      const cur = fav.get(m.name) ?? { name: m.name, slug: m.slug, count: 0 };
      cur.count += e.uses;
      fav.set(m.name, cur);
    }
  const cards: HistoryDashboard['recentCards'] = [];
  const seen = new Set<string>();
  for (const e of [...history].sort(byRecent))
    for (const c of e.entityRefs?.cards ?? []) {
      const key = c.walletCardId ?? c.name;
      if (seen.has(key)) continue;
      seen.add(key);
      cards.push(c);
    }
  return {
    // a question asked once is not "common"
    mostCommon: history.filter((e) => e.uses >= 2).sort((a, b) => b.uses - a.uses || byRecent(a, b)).slice(0, 8),
    recent: [...history].sort(byRecent).slice(0, 10),
    saved,
    favoriteMerchants: [...fav.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 6),
    recentCards: cards.slice(0, 6),
    recentRecommendations: history.filter((e) => e.intent && RECOMMENDATION_INTENTS.has(e.intent) && e.summary).sort(byRecent).slice(0, 6),
  };
}

export interface Turn {
  q: string;
  intent: string | null;
  summary: string;
  at: string;
}

/** Appends a turn and keeps the last few. */
export function pushTurn(turns: unknown, turn: Turn): Turn[] {
  const prev = Array.isArray(turns) ? (turns as Turn[]) : [];
  return [...prev, turn].slice(-MAX_TURNS);
}

export function isStale(updatedAt: Date, now: Date): boolean {
  return now.getTime() - updatedAt.getTime() > SESSION_IDLE_MS;
}

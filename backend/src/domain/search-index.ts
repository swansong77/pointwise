/**
 * The universal search index (pure): documents for everything a person might look for, and a forgiving ranker over them. Matching is
 * local and free: exact and prefix matches, typos within a letter or two, issuer nicknames ("amex"), and a small concept map
 * ("free night" finds certificates). No embeddings and no service.
 */
import { editDistance } from './benefit-detect';
import { expandConcepts } from './nicknames';

export const SEARCH_INDEX_VERSION = 'search-index/1';

export type DocType =
  | 'CARD'
  | 'WALLET_CARD'
  | 'OFFER'
  | 'BENEFIT'
  | 'CERTIFICATE'
  | 'LOYALTY'
  | 'MEMBERSHIP'
  | 'MERCHANT'
  | 'PROGRAM'
  | 'MEMBER'
  | 'PLAN'
  | 'TRIP'
  | 'NOTIFICATION'
  | 'TRANSACTION'
  | 'CATEGORY'
  | 'AUDIT'
  | 'PAGE';

export interface SearchDoc {
  type: DocType;
  id: string;
  title: string;
  subtitle?: string;
  /** extra words that should find it (aliases, issuer, program) */
  keywords?: string[];
  href: string;
  /** 0–1: how much this kind of thing should count (the user's own cards over the catalog) */
  weight?: number;
}

export interface Hit {
  doc: SearchDoc;
  score: number;
}

const tokens = (s: string): string[] => expandConcepts(s).split(' ').filter(Boolean);

/** how well one typed word matches one word of a document, 0–1 */
function wordScore(q: string, d: string): number {
  if (q === d) return 1;
  if (d.startsWith(q) && q.length >= 2) return 0.85;
  if (q.length >= 4 && d.includes(q)) return 0.55;
  if (q.length >= 4 && editDistance(q, d) <= 1) return 0.6;
  if (q.length >= 7 && editDistance(q, d) <= 2) return 0.45;
  return 0;
}

/** Whether a prepared document matches: every typed word has to find a home, titles count most. */
export function scoreDoc(qTokens: string[], doc: SearchDoc): number {
  if (!qTokens.length) return 0;
  const title = tokens(doc.title);
  const keys = tokens((doc.keywords ?? []).join(' '));
  const sub = tokens(doc.subtitle ?? '');
  let sum = 0;
  for (const q of qTokens) {
    const best = Math.max(
      ...title.map((d) => wordScore(q, d) * 1),
      ...keys.map((d) => wordScore(q, d) * 0.8),
      ...sub.map((d) => wordScore(q, d) * 0.6),
      0,
    );
    if (best < 0.4) return 0;
    sum += best;
  }
  let score = sum / qTokens.length;
  const t = title.join(' ');
  const q = qTokens.join(' ');
  if (t === q) score += 0.5;
  else if (t.startsWith(q)) score += 0.25;
  return score * (0.6 + 0.4 * (doc.weight ?? 0.7));
}

/** Best matches first. Ties go to the shorter title (the more specific thing), then alphabetically, so the order is stable. */
export function rankDocs(docs: SearchDoc[], query: string, limit = 8, types?: DocType[]): Hit[] {
  const q = tokens(query);
  if (!q.length) return [];
  return docs
    .filter((d) => !types || types.includes(d.type))
    .map((doc) => ({ doc, score: scoreDoc(q, doc) }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.title.length - b.doc.title.length || a.doc.title.localeCompare(b.doc.title) || a.doc.id.localeCompare(b.doc.id))
    .slice(0, limit);
}

export const TYPE_LABEL: Record<DocType, string> = {
  CARD: 'Card',
  WALLET_CARD: 'Your card',
  OFFER: 'Offer',
  BENEFIT: 'Benefit',
  CERTIFICATE: 'Certificate',
  LOYALTY: 'Loyalty account',
  MEMBERSHIP: 'Membership',
  MERCHANT: 'Merchant',
  PROGRAM: 'Program',
  MEMBER: 'Household member',
  PLAN: 'Shopping plan',
  TRIP: 'Travel plan',
  NOTIFICATION: 'Notification',
  TRANSACTION: 'Transaction',
  CATEGORY: 'Category',
  AUDIT: 'Audit history',
  PAGE: 'Page',
};

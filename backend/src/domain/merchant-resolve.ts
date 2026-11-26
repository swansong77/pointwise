/**
 * Merchant identity (pure): turns whatever a statement, email or offer calls a merchant ("AMZN MKTPLACE",
 * "UBR TECHNOLOGIES", "UBER*EATS") into one canonical merchant, with a confidence and the rule that matched.
 * Order of evidence: exact canonical name, alias, web host, then a conservative fuzzy fallback; an MCC, when
 * known, confirms or contradicts the match. Low confidence never drives a recommendation (ADR-011).
 */
import { editDistance } from './benefit-detect';
import { normalizeDescriptor } from './spend';

export const RESOLVE_ENGINE_VERSION = 'merchant-resolve/1';
export const MIN_RESOLVE_CONFIDENCE = 0.5;
/** confidence at or above which a match may drive recommendations without review */
export const TRUSTED_RESOLVE_CONFIDENCE = 0.8;

export interface MerchantIdentity {
  id: string;
  slug: string;
  name: string;
  hosts: string[];
  aliases?: string[];
  mcc?: string[];
  parentCompany?: string | null;
}

export type ResolveVia = 'EXACT_NAME' | 'NAME' | 'ALIAS' | 'HOST' | 'FUZZY';

export interface Resolution {
  merchantId: string;
  slug: string;
  name: string;
  parentCompany: string | null;
  confidence: number;
  via: ResolveVia;
  /** the term that matched */
  matched: string;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${esc(word)}([^a-z0-9]|$)`).test(text);

interface Candidate {
  merchant: MerchantIdentity;
  via: ResolveVia;
  term: string;
  base: number;
}

function candidates(d: string, m: MerchantIdentity): Candidate[] {
  const out: Candidate[] = [];
  const name = normalizeDescriptor(m.name);
  if (name.length >= 3) {
    if (d === name) out.push({ merchant: m, via: 'EXACT_NAME', term: name, base: 0.98 });
    else if (hasWord(d, name)) out.push({ merchant: m, via: 'NAME', term: name, base: 0.9 });
  }
  for (const a of m.aliases ?? []) {
    const t = normalizeDescriptor(a);
    if (t.length < 3) continue;
    if (d === t) out.push({ merchant: m, via: 'ALIAS', term: t, base: 0.97 });
    else if (hasWord(d, t)) out.push({ merchant: m, via: 'ALIAS', term: t, base: 0.92 });
  }
  for (const h of m.hosts) {
    const t = normalizeDescriptor(h.replace(/^www\./, '').split('.')[0]);
    if (t.length >= 4 && hasWord(d, t)) out.push({ merchant: m, via: 'HOST', term: t, base: 0.7 }); // a bare host word ("delta") is weak evidence
  }
  return out;
}

/**
 * Best merchant for a descriptor, or null when nothing reaches MIN_RESOLVE_CONFIDENCE.
 * `mcc` (from a transaction or an offer) adds 0.04 when it agrees with the merchant's codes and subtracts
 * 0.15 when the merchant has codes and this one is not among them.
 */
export function resolveMerchant(descriptor: string, merchants: MerchantIdentity[], opts: { mcc?: string | null } = {}): Resolution | null {
  const d = normalizeDescriptor(descriptor);
  if (!d) return null;
  let best: { c: Candidate; conf: number } | null = null;
  const consider = (c: Candidate, conf: number) => {
    // higher confidence wins; on a tie the longer (more specific) term wins
    if (!best || conf > best.conf || (conf === best.conf && c.term.length > best.c.term.length)) best = { c, conf };
  };
  for (const m of merchants)
    for (const c of candidates(d, m)) {
      let conf = c.base;
      if (opts.mcc && m.mcc?.length) conf += m.mcc.includes(opts.mcc) ? 0.04 : -0.15;
      consider(c, conf);
    }
  if (!best) {
    // conservative fuzzy fallback: a descriptor word within one edit of a merchant name word (≥ 5 letters)
    for (const m of merchants) {
      const words = normalizeDescriptor(m.name).split(' ').filter((w) => w.length >= 5);
      for (const w of words)
        for (const t of d.split(' ').filter((x) => x.length >= 5))
          if (editDistance(w, t) <= 1) consider({ merchant: m, via: 'FUZZY', term: w, base: 0.6 }, 0.6);
    }
  }
  if (!best) return null;
  const { c, conf } = best as { c: Candidate; conf: number };
  const confidence = Math.round(Math.min(0.99, Math.max(0, conf)) * 100) / 100;
  if (confidence < MIN_RESOLVE_CONFIDENCE) return null;
  return {
    merchantId: c.merchant.id,
    slug: c.merchant.slug,
    name: c.merchant.name,
    parentCompany: c.merchant.parentCompany ?? null,
    confidence,
    via: c.via,
    matched: c.term,
  };
}

/** Whether a resolution is strong enough to base a recommendation on. */
export const isTrusted = (r: Resolution | null): r is Resolution => !!r && r.confidence >= TRUSTED_RESOLVE_CONFIDENCE;

/**
 * Words people type for an issuer or a concept, read as what the data calls it (pure). Shared by offer search and universal search
 * so "amex", "cap one" and "bofa" mean the same thing everywhere.
 */
export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9+&]+/g, ' ').trim();

export const NICKNAMES: Array<[RegExp, string]> = [
  [/\bamex\b/g, 'american express'],
  [/\bcap ?one\b|\bc1\b/g, 'capital one'],
  [/\bb ?o ?f ?a\b|\bboa\b/g, 'bank of america'],
  [/\bwf\b/g, 'wells fargo'],
  [/\bciti ?bank\b/g, 'citi'],
  [/\bus ?bank\b|\busb\b/g, 'us bank'],
];

/** lower-cased, punctuation-free, with issuer nicknames spelled out */
export const expandNicknames = (s: string): string => NICKNAMES.reduce((t, [re, to]) => t.replace(re, to), norm(s));

/** Plain-language words for the same thing, so a search for one finds the other. */
export const CONCEPTS: Array<[RegExp, string]> = [
  [/\bfree nights?\b/g, 'free night certificate'],
  [/\bfive twenty[- ]?four\b|\b5 24\b/g, '5/24'],
  [/\bmiles\b|\bpts\b/g, 'points'],
  [/\bstatement credits?\b/g, 'credit'],
];

export const expandConcepts = (s: string): string => CONCEPTS.reduce((t, [re, to]) => t.replace(re, to), expandNicknames(s));

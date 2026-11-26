/**
 * Pure helpers for the Pointwise loyalty capture extension (no browser APIs, so they are unit-tested in Node).
 *
 * What the extension does, and does not do:
 *  - runs only when the member clicks "Capture this page" (activeTab), never in the background;
 *  - only on a program's own domain (a page on any other site is refused);
 *  - reads the page's visible text, never form fields, cookies, storage or passwords;
 *  - sends the text to the member's OWN Pointwise server with a revocable token that can only post loyalty
 *    snapshots; the server parses it and discards the text.
 */

export const MAX_TEXT = 30_000;
export const MIN_TEXT = 10;

export interface ProgramInfo {
  code: string;
  name: string;
  domains: string[];
}

export interface Payload {
  program: string;
  text: string;
  pageHash: string;
  capturedAt: string;
}

/** True when `host` is one of the program's domains or a subdomain of one. */
export function hostMatches(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return domains.some((d) => {
    const dd = d.toLowerCase().replace(/^www\./, '');
    return h === dd || h.endsWith(`.${dd}`);
  });
}

/** The program whose domain the page is on, or null. */
export function programForHost(host: string, programs: ProgramInfo[]): ProgramInfo | null {
  let best: { p: ProgramInfo; len: number } | null = null;
  for (const p of programs)
    for (const d of p.domains) if (hostMatches(host, [d]) && (!best || d.length > best.len)) best = { p, len: d.length };
  return best?.p ?? null;
}

/** Collapses whitespace and cuts the text to what the server accepts. */
export function trimText(text: string): string {
  return text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, MAX_TEXT);
}

/** The server base URL: https (or http for localhost only), no path, no trailing slash. Returns null when it is not acceptable. */
export function normalizeServer(input: string): string | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  return `${u.protocol}//${u.host}`;
}

/** A personal access token looks like pw_pat_… */
export const tokenLooksValid = (t: string): boolean => /^pw_pat_[A-Za-z0-9_-]{20,160}$/.test(t.trim());

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export type CaptureCheck = { ok: true; program: ProgramInfo } | { ok: false; reason: string };

/** Decides whether this tab may be captured for the chosen program. */
export function checkCapture(url: string, chosenCode: string, programs: ProgramInfo[]): CaptureCheck {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return { ok: false, reason: 'Only secure (https) pages can be captured.' };
    host = u.hostname;
  } catch {
    return { ok: false, reason: 'This page cannot be captured.' };
  }
  const program = programs.find((p) => p.code === chosenCode);
  if (!program) return { ok: false, reason: 'Choose a program first.' };
  if (!hostMatches(host, program.domains)) return { ok: false, reason: `This is not a ${program.name} page (${host}). Open your ${program.name} account page, then capture.` };
  return { ok: true, program };
}

export async function buildPayload(program: ProgramInfo, rawText: string, now: Date): Promise<Payload | { error: string }> {
  const text = trimText(rawText);
  if (text.length < MIN_TEXT) return { error: 'The page has no readable text yet. Wait for it to finish loading and try again.' };
  return { program: program.code, text, pageHash: (await sha256Hex(text)).slice(0, 32), capturedAt: now.toISOString() };
}

/** What the page-side script returns; runs inside the page, so it must be self-contained. */
export function pageTextScript(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script,style,noscript,input,textarea,select,[type=password],iframe').forEach((n) => n.remove());
  return clone.innerText || clone.textContent || '';
}

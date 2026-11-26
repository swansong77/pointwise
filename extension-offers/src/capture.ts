/**
 * Pure helpers for the PointWise offers extension (no browser APIs, so they are unit-tested in Node).
 *
 * What the extension does, and does not do:
 *  - it runs only when the member clicks a button in its popup (activeTab); never in the background;
 *  - it works only on an issuer's own domain;
 *  - it reads the page's visible text, never form fields, cookies, storage or passwords;
 *  - it sends that text to the member's OWN PointWise server with a revocable token that can only send offers;
 *    the server parses the text and discards it;
 *  - "Enroll selected" presses the issuer's own Add buttons on the page the member has open, only for offers the member
 *    approved in PointWise, and only after the member clicks. Page selectors are text heuristics and have not been
 *    verified against the real sites.
 */

export const MAX_TEXT = 60_000;
export const MIN_TEXT = 10;

export interface Issuer {
  name: string;
  domains: string[];
  /** terms note shown before first use */
  note: string;
}

export const ISSUERS: Issuer[] = [
  { name: 'American Express', domains: ['americanexpress.com'], note: 'American Express terms were not readable when PointWise last checked.' },
  { name: 'Chase', domains: ['chase.com'], note: 'Chase lists "agents, including AI agents or agentic AI, robots, spiders, scripts" as unauthorized use. Clicking buttons for you may breach its terms.' },
  { name: 'Citi', domains: ['citi.com'], note: 'Citi terms were not checked.' },
  { name: 'Bank of America', domains: ['bankofamerica.com'], note: 'Bank of America terms were not checked.' },
  { name: 'Capital One', domains: ['capitalone.com'], note: 'Capital One offers terms were not checked.' },
  { name: 'Wells Fargo', domains: ['wellsfargo.com'], note: 'Wells Fargo terms were not checked.' },
];

/** True when `host` is one of the domains or a subdomain of one. */
export function hostMatches(host: string, domains: string[]): boolean {
  const h = host.toLowerCase().replace(/^www\./, '');
  return domains.some((d) => h === d || h.endsWith(`.${d}`));
}

export function issuerForHost(host: string, issuers: Issuer[] = ISSUERS): Issuer | null {
  return issuers.find((i) => hostMatches(host, i.domains)) ?? null;
}

/** Collapses whitespace and cuts the text to what the server accepts. */
export function trimText(text: string): string {
  return text.replace(/ /g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, MAX_TEXT);
}

/** The server base URL: https (or http for localhost only), no path. Null when it is not acceptable. */
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

export const tokenLooksValid = (t: string): boolean => /^pw_pat_[A-Za-z0-9_-]{20,160}$/.test(t.trim());

export type CaptureCheck = { ok: true; issuer: Issuer } | { ok: false; reason: string };

/** Decides whether this tab may be read. */
export function checkPage(url: string, issuers: Issuer[] = ISSUERS): CaptureCheck {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { ok: false, reason: 'This page cannot be read.' };
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Only secure (https) pages can be read.' };
  const issuer = issuerForHost(u.hostname, issuers);
  if (!issuer) return { ok: false, reason: `This is not an issuer page PointWise supports (${u.hostname}). Open your issuer's offers page, then try again.` };
  return { ok: true, issuer };
}

export interface SnapshotPayload {
  accountId: string;
  text: string;
  pageHash: string;
  capturedAt: string;
  lastFour?: string;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function buildPayload(accountId: string, rawText: string, now: Date, lastFour?: string): Promise<SnapshotPayload | { error: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return { error: 'Choose the PointWise account this page belongs to.' };
  const text = trimText(rawText);
  if (text.length < MIN_TEXT) return { error: 'The page has no readable text yet. Wait for it to finish loading and try again.' };
  const four = lastFour?.trim();
  return { accountId, text, pageHash: (await sha256Hex(text)).slice(0, 32), capturedAt: now.toISOString(), ...(four && /^\d{4,5}$/.test(four) ? { lastFour: four } : {}) };
}

/** What the page-side script returns; it runs inside the page, so it must be self-contained. */
export function pageTextScript(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('script,style,noscript,input,textarea,select,[type=password],iframe').forEach((n) => n.remove());
  return clone.innerText || clone.textContent || '';
}

export interface AddRequest {
  externalId: string;
  cardKey: string;
  merchantText: string;
}

export interface AddResult {
  externalId: string;
  cardKey: string;
  outcome: 'SUCCESS' | 'FAILURE' | 'ALREADY_ADDED';
  message?: string;
}

/**
 * Runs inside the page: for each approved offer, finds the offer block that names the merchant and presses the button
 * whose text is Add (or Add to Card). Never touches anything else. Self-contained, so it can be injected.
 */
export function pageAddScript(requests: AddRequest[]): AddResult[] {
  const results: AddResult[] = [];
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role=button], a'));
  const label = (b: HTMLElement) => (b.innerText || b.textContent || '').trim().toLowerCase();
  for (const r of requests) {
    const base = { externalId: r.externalId, cardKey: r.cardKey };
    const name = r.merchantText.trim().toLowerCase();
    if (!name) {
      results.push({ ...base, outcome: 'FAILURE', message: 'No merchant name to look for.' });
      continue;
    }
    const isAddLabel = (l: string) => l === 'add' || l === 'add to card' || l === 'add offer' || l === 'added' || l === 'enrolled';
    // a button belongs to the offer when the smallest block around it that names the merchant holds only that one button
    const candidates = buttons.filter((b) => {
      if (!isAddLabel(label(b))) return false;
      let block: HTMLElement | null = b;
      for (let depth = 0; depth < 6 && block !== null; depth++) {
        const t = (block.innerText || block.textContent || '').toLowerCase();
        if (t.includes(name)) {
          if (t.length >= 600) return false;
          const found: HTMLElement = block;
          return buttons.filter((x) => isAddLabel(label(x)) && found.contains(x)).length === 1;
        }
        block = block.parentElement;
      }
      return false;
    });
    if (candidates.length === 0) results.push({ ...base, outcome: 'FAILURE', message: 'The offer was not found on this page.' });
    else if (candidates.length > 1) results.push({ ...base, outcome: 'FAILURE', message: 'More than one match; add this one yourself.' });
    else if (['added', 'enrolled'].includes(label(candidates[0]))) results.push({ ...base, outcome: 'ALREADY_ADDED' });
    else {
      candidates[0].click();
      results.push({ ...base, outcome: 'SUCCESS' });
    }
  }
  return results;
}

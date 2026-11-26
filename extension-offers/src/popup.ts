import { AddRequest, buildPayload, checkPage, ISSUERS, normalizeServer, pageAddScript, pageTextScript, tokenLooksValid } from './capture.js';

// Minimal typing for the browser extension API (no external type package needed).
declare const chrome: {
  storage: { local: { get(k: string[]): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> } };
  tabs: { query(q: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number; url?: string }>> };
  scripting: {
    executeScript<T>(o: { target: { tabId: number }; func: (...a: never[]) => T; args?: unknown[] }): Promise<Array<{ result?: T }>>;
  };
  permissions: { request(p: { origins: string[] }): Promise<boolean> };
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (text: string, kind: 'ok' | 'error' | 'info' = 'info') => {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
};

interface Queue { externalId: string; cardKey: string; merchantText: string }
let queue: Queue[] = [];

async function settings(): Promise<{ ok: false; error: string } | { ok: true; server: string; token: string; accountId: string; tabId: number }> {
  const server = normalizeServer($<HTMLInputElement>('server').value);
  const token = $<HTMLInputElement>('token').value.trim();
  const accountId = $<HTMLInputElement>('account').value.trim();
  if (!server) return { ok: false, error: 'Enter your PointWise address (https, or http://localhost).' };
  if (!tokenLooksValid(token)) return { ok: false, error: 'Paste the extension token from PointWise (it starts with pw_pat_).' };
  if (!$<HTMLInputElement>('ack').checked) return { ok: false, error: 'Tick the box to confirm you have read the note about issuer terms.' };
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return { ok: false, error: 'No page to read.' };
  const check = checkPage(tab.url);
  if (!check.ok) return { ok: false, error: check.reason };
  if (!(await chrome.permissions.request({ origins: [`${server}/*`] }))) return { ok: false, error: 'Permission to contact your PointWise server was declined.' };
  await chrome.storage.local.set({ server, token, accountId });
  return { ok: true, server, token, accountId, tabId: tab.id };
}

async function capture() {
  const s = await settings();
  if (!s.ok) return say(s.error, 'error');
  say('Reading the page…');
  const [res] = await chrome.scripting.executeScript<string>({ target: { tabId: s.tabId }, func: pageTextScript });
  const payload = await buildPayload(s.accountId, res?.result ?? '', new Date(), $<HTMLInputElement>('lastfour').value);
  if ('error' in payload) return say(payload.error, 'error');
  try {
    const r = await fetch(`${s.server}/api/v1/offer-automation/extension/snapshot`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` }, body: JSON.stringify(payload) });
    const body = (await r.json().catch(() => ({}))) as { accepted?: boolean; reason?: string; message?: string; found?: number; added?: number; updated?: number; removed?: number; toAdd?: Queue[] };
    if (r.status === 401) return say('PointWise did not accept the token. Create a new one in PointWise → Offer Automation → Accounts.', 'error');
    if (!r.ok) return say(body.message ?? `PointWise answered ${r.status}.`, 'error');
    if (body.accepted === false) return say(body.reason ?? 'No offers recognised on this page.', 'error');
    queue = body.toAdd ?? [];
    $('enroll').hidden = queue.length === 0;
    $('queue').textContent = queue.length ? `Approved in PointWise: ${queue.map((q) => q.merchantText).join(', ')}` : '';
    say(`Sent. ${body.found ?? 0} offer(s) read, ${body.added ?? 0} new, ${body.updated ?? 0} changed, ${body.removed ?? 0} gone.`, 'ok');
  } catch {
    say('Could not reach your PointWise server. Check the address.', 'error');
  }
}

async function enrollSelected() {
  const s = await settings();
  if (!s.ok) return say(s.error, 'error');
  if (!queue.length) return say('Nothing is approved for adding. Approve offers in PointWise first.', 'error');
  say('Adding the offers you approved…');
  const requests: AddRequest[] = queue.map((q) => ({ externalId: q.externalId, cardKey: q.cardKey, merchantText: q.merchantText }));
  const [res] = await chrome.scripting.executeScript({ target: { tabId: s.tabId }, func: pageAddScript as never, args: [requests] });
  const results = (res?.result ?? []) as Array<{ externalId: string; cardKey: string; outcome: string; message?: string }>;
  try {
    await fetch(`${s.server}/api/v1/offer-automation/extension/enroll-results`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${s.token}` }, body: JSON.stringify({ accountId: s.accountId, results }) });
    const ok = results.filter((r) => r.outcome !== 'FAILURE').length;
    say(`${ok} of ${results.length} added. PointWise will confirm the next time you capture this page.`, ok === results.length ? 'ok' : 'info');
    queue = [];
    $('enroll').hidden = true;
  } catch {
    say('The offers were pressed but PointWise could not be told. Capture the page again.', 'error');
  }
}

async function load() {
  const saved = await chrome.storage.local.get(['server', 'token', 'accountId']);
  $<HTMLInputElement>('server').value = (saved.server as string) ?? '';
  $<HTMLInputElement>('token').value = (saved.token as string) ?? '';
  $<HTMLInputElement>('account').value = (saved.accountId as string) ?? '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const check = tab?.url ? checkPage(tab.url) : null;
  $('issuer').textContent = check?.ok ? check.issuer.name : 'Open an issuer offers page';
  $('note').textContent = check?.ok ? check.issuer.note : ISSUERS.map((i) => i.name).join(', ');
}

$('capture').addEventListener('click', () => void capture());
$('enroll').addEventListener('click', () => void enrollSelected());
void load();

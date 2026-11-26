import { buildPayload, checkCapture, normalizeServer, pageTextScript, programForHost, tokenLooksValid } from './capture.js';
import { PROGRAMS } from './programs.generated.js';

// Minimal typing for the browser extension API (no external type package needed).
declare const chrome: {
  storage: { local: { get(k: string[]): Promise<Record<string, unknown>>; set(v: Record<string, unknown>): Promise<void> } };
  tabs: { query(q: { active: boolean; currentWindow: boolean }): Promise<Array<{ id?: number; url?: string }>> };
  scripting: { executeScript(o: { target: { tabId: number }; func: () => string }): Promise<Array<{ result?: string }>> };
  permissions: { request(p: { origins: string[] }): Promise<boolean> };
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const say = (text: string, kind: 'ok' | 'error' | 'info' = 'info') => {
  const el = $('status');
  el.textContent = text;
  el.className = kind;
};

async function load() {
  const saved = await chrome.storage.local.get(['server', 'token', 'program', 'acked']);
  $<HTMLInputElement>('server').value = (saved.server as string) ?? '';
  $<HTMLInputElement>('token').value = (saved.token as string) ?? '';
  const select = $<HTMLSelectElement>('program');
  select.innerHTML = '<option value="">Choose a program…</option>' + PROGRAMS.map((p) => `<option value="${p.code}">${p.name}</option>`).join('');
  // pre-select the program the current tab belongs to
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let guess = '';
  try {
    guess = tab?.url ? (programForHost(new URL(tab.url).hostname, PROGRAMS)?.code ?? '') : '';
  } catch {
    guess = '';
  }
  select.value = guess || ((saved.program as string) ?? '');
  $<HTMLInputElement>('ack').checked = Array.isArray(saved.acked) && (saved.acked as string[]).includes(select.value);
}

async function capture() {
  const server = normalizeServer($<HTMLInputElement>('server').value);
  const token = $<HTMLInputElement>('token').value.trim();
  const code = $<HTMLSelectElement>('program').value;
  if (!server) return say('Enter your PointWise address (https, or http://localhost).', 'error');
  if (!tokenLooksValid(token)) return say('Paste the extension token from PointWise (it starts with pw_pat_).', 'error');
  if (!$<HTMLInputElement>('ack').checked) return say('Tick the box to confirm you have read the note about program terms.', 'error');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return say('No page to capture.', 'error');
  const check = checkCapture(tab.url, code, PROGRAMS);
  if (!check.ok) return say(check.reason, 'error');
  if (!(await chrome.permissions.request({ origins: [`${server}/*`] }))) return say('Permission to contact your PointWise server was declined.', 'error');
  const saved = await chrome.storage.local.get(['acked']);
  const acked = new Set((saved.acked as string[]) ?? []);
  acked.add(code);
  await chrome.storage.local.set({ server, token, program: code, acked: [...acked] });
  say('Reading the page…');
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: pageTextScript });
  const payload = await buildPayload(check.program, res?.result ?? '', new Date());
  if ('error' in payload) return say(payload.error, 'error');
  try {
    const r = await fetch(`${server}/api/v1/loyalty/ingest/snapshot`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    const body = (await r.json().catch(() => ({}))) as { accepted?: boolean; reason?: string; message?: string; applied?: number; confirmed?: number; kept?: number; conflicts?: number; unmatched?: string | null };
    if (r.status === 401) return say('PointWise did not accept the token. Create a new one in PointWise → Loyalty → Imports.', 'error');
    if (!r.ok) return say(body.message ?? `PointWise answered ${r.status}.`, 'error');
    if (body.accepted === false) return say(body.reason ?? 'Nothing recognisable on this page.', 'error');
    if (body.unmatched) return say(body.unmatched, 'error');
    say(`Sent. ${body.applied ?? 0} updated, ${body.confirmed ?? 0} confirmed, ${body.kept ?? 0} kept as they were${body.conflicts ? `, ${body.conflicts} need your decision in PointWise` : ''}.`, 'ok');
  } catch {
    say('Could not reach your PointWise server. Check the address.', 'error');
  }
}

$('capture').addEventListener('click', () => void capture());
$('program').addEventListener('change', () => void load().catch(() => undefined));
void load();

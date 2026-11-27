/**
 * The redacted, pseudonymized view of a plan that may be shown to a model (ADR-004a). It is built field by field from the structured
 * facts (an allow-list: a field that is not copied here cannot appear), never from the prose, and then checked for leaks.
 *
 * Always absent: member names, e-mail addresses, card numbers and last four, account and login identifiers, statement lines,
 * addresses, birth years and free-text notes. Members become "Member A (spouse)"; amounts and balances are rounded; dates are days.
 */
import { redactForModel } from '../ai/privacy';
import { Style, STYLE_INSTRUCTION } from './copilot-modes';
import { CopilotPlan, Horizon, ItemFacts, PlanItem } from './copilot-plan';

export const VIEW_VERSION = 'copilot-view/1';
export const PROMPT_VERSION = 'copilot-narration/1';

export interface ViewMember {
  label: string;
  relationship: string;
}

export interface ViewItem {
  ref: string;
  lens: string;
  horizon: Horizon;
  kind: string;
  subject?: string;
  member?: string;
  card?: string;
  program?: string;
  /** rounded, e.g. "about $120" */
  amount?: string;
  points?: string;
  inDays?: number;
  count?: number;
  verdict?: string;
  confidence: number;
}

export interface RedactedView {
  version: string;
  mode: string;
  scope: Horizon;
  members: ViewMember[];
  items: ViewItem[];
}

export interface Household {
  /** real nicknames and relationships; they never leave the server, only labels do */
  members: Array<{ nickname: string; relationship?: string | null }>;
  /** other strings that must never appear in a view (e-mail, names of the account holder, the last four digits of each card) */
  secrets?: string[];
}

const LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const REL: Record<string, string> = { SELF: 'account holder', SPOUSE: 'spouse', PARTNER: 'partner', CHILD: 'child', PARENT: 'parent', OTHER: 'family member' };

/** nearest $5 under $100, nearest $10 above; "about $120" */
export function roundDollars(cents: number): string {
  const d = Math.abs(cents) / 100;
  const r = d < 100 ? Math.round(d / 5) * 5 : Math.round(d / 10) * 10;
  return `${cents < 0 ? '-' : ''}about $${r.toLocaleString('en-US')}`;
}
export function roundPoints(n: number): string {
  const r = n >= 1000 ? Math.round(n / 100) * 100 : Math.round(n / 10) * 10;
  return `about ${r.toLocaleString('en-US')}`;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** a public name (card, program, merchant) with anything personal taken out */
export function cleanName(raw: string | undefined, household: Household): string | undefined {
  if (!raw) return undefined;
  let t = redactForModel(raw);
  const labels = labelsOf(household);
  for (const [nick, label] of labels) t = t.replace(new RegExp(`\\b${esc(nick)}\\b`, 'gi'), label);
  t = t.replace(/\(\s*\)/g, '').replace(/\d{4,}/g, '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, 80) : undefined;
}

/** nickname → "Member A" in a stable order (longest nicknames first so a short one cannot cut a long one) */
function labelsOf(h: Household): Array<[string, string]> {
  const nicks = [...new Set(h.members.map((m) => m.nickname).filter((n) => n && n.trim().length > 0))].sort();
  const label = new Map(nicks.map((n, i) => [n, `Member ${LABELS[i % 26]}${i >= 26 ? Math.floor(i / 26) : ''}`] as [string, string]));
  return [...label.entries()].sort((a, b) => b[0].length - a[0].length);
}

function memberLabel(nick: string | undefined, h: Household): string | undefined {
  if (!nick) return undefined;
  return labelsOf(h).find(([n]) => n.toLowerCase() === nick.toLowerCase())?.[1] ?? 'Member ?';
}

function viewItem(i: PlanItem, n: number, h: Household): ViewItem {
  const f: ItemFacts = i.facts;
  const out: ViewItem = { ref: `item-${n}`, lens: i.lens.toLowerCase(), horizon: i.horizon, kind: f.kind.toLowerCase(), confidence: i.confidence };
  const subject = cleanName(f.subject, h);
  const card = cleanName(f.card, h);
  const program = cleanName(f.program, h);
  if (subject) out.subject = subject;
  if (f.member) out.member = memberLabel(f.member, h);
  if (card) out.card = card;
  if (program) out.program = program;
  if (f.amountCents != null) out.amount = roundDollars(f.amountCents);
  if (f.points != null) out.points = roundPoints(f.points);
  if (f.daysLeft != null) out.inDays = f.daysLeft;
  if (f.count != null && f.kind !== 'RENEWAL_REVIEW') out.count = f.count;
  if (f.verdict) out.verdict = cleanName(f.verdict, h);
  return out;
}

export function buildView(plan: CopilotPlan, h: Household): RedactedView {
  const used = new Set(plan.items.map((i) => i.facts.member?.toLowerCase()).filter(Boolean) as string[]);
  const members: ViewMember[] = labelsOf(h)
    .filter(([nick]) => used.has(nick.toLowerCase()))
    .map(([nick, label]) => ({ label, relationship: REL[String(h.members.find((m) => m.nickname === nick)?.relationship ?? 'OTHER')] ?? 'family member' }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return { version: VIEW_VERSION, mode: plan.mode.toLowerCase(), scope: plan.scope, members, items: plan.items.map((i, n) => viewItem(i, n + 1, h)) };
}

/**
 * Belt and braces: the strings that must never be in a view. Returns what leaked; the caller refuses to send when this is not empty.
 */
export function leaks(view: unknown, h: Household): string[] {
  const text = JSON.stringify(view);
  const lower = text.toLowerCase();
  const bad: string[] = [];
  for (const m of h.members) if (m.nickname && m.nickname.trim().length >= 2 && new RegExp(`\\b${esc(m.nickname.toLowerCase())}\\b`).test(lower)) bad.push('member name');
  for (const s of h.secrets ?? []) if (s && s.length >= 3 && lower.includes(s.toLowerCase())) bad.push('private value');
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) bad.push('e-mail address');
  if (/\d(?:[ -]?\d){11,18}/.test(text)) bad.push('card-number-like digits');
  return [...new Set(bad)];
}

/** the numbers a model's text may mention: those in the view, the item numbers and the item count */
export function allowedNumbers(view: RedactedView): Set<string> {
  const out = new Set<string>();
  const add = (s: string) => {
    for (const m of s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) out.add(m.replace(/,/g, ''));
  };
  add(JSON.stringify(view));
  for (let i = 1; i <= view.items.length; i++) out.add(String(i));
  out.add(String(view.items.length));
  return out;
}

/** every number in the text must come from the view; a model that invents a figure is not used */
export function grounded(text: string, view: RedactedView): { ok: boolean; extra: string[] } {
  const allowed = allowedNumbers(view);
  const extra = [...new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, '')))].filter((n) => !allowed.has(n));
  return { ok: extra.length === 0, extra };
}

/** "Member A" back to the real name, for the person reading it */
export function rehydrate(text: string, h: Household): string {
  let out = text;
  for (const [nick, label] of labelsOf(h)) out = out.replace(new RegExp(`\\b${esc(label)}\\b`, 'g'), nick);
  return out;
}

export function narrationPrompt(style: Style): string {
  return [
    'You are the writing assistant of a personal rewards planner. You receive a JSON summary of what a household should do, ranked by urgency.',
    'Write a short, friendly briefing about it. Use only the facts in the JSON; do not invent amounts, dates, card names, programs or people.',
    'Refer to people only as the labels given (for example "Member A"). Mention amounts exactly as written (for example "about $120"). Do not add numbers that are not in the JSON.',
    'Never tell the reader to apply for, transfer, book or cancel anything automatically; you may say what they could decide.',
    STYLE_INSTRUCTION[style],
    'Reply with plain text only.',
  ].join('\n');
}

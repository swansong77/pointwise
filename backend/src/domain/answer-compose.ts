/**
 * Builds the answer a person reads (pure): a one-line summary, the detail, why, how sure, what it rests on, the things it mentions and
 * what to do next. Everything shown comes from the engines' own results; nothing is generated. Unknown shapes are read defensively so a
 * change in one engine degrades to its plain-text summary instead of breaking the answer.
 */
import { Understanding } from './query-understanding';
import { Route } from './search-router';
import { actionsFor, CallAction } from './search-actions';

export const COMPOSE_VERSION = 'answer-compose/1';

export interface StepResult {
  tool: string;
  label: string;
  ok: boolean;
  summary: string;
  data: unknown;
  error?: string;
}

export type RelatedType = 'CARD' | 'OFFER' | 'BENEFIT' | 'CERTIFICATE' | 'PROGRAM' | 'MERCHANT' | 'MEMBER';

export interface Related {
  type: RelatedType;
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

export interface AnswerSection {
  heading: string | null;
  lines: string[];
}

export interface SearchAnswer {
  version: string;
  intent: string;
  kind: string;
  title: string;
  /** one line: the answer */
  summary: string;
  sections: AnswerSection[];
  reasoning: string[];
  evidence: string[];
  warnings: string[];
  /** 0–100 */
  confidence: number;
  actions: AnswerAction[];
  /** changes the member can make from here; each is confirmed in the browser before it runs */
  calls: CallAction[];
  related: Related[];
  followUps: string[];
  /** what was recognised in the question, for display */
  understood: Array<{ type: string; label: string }>;
  /** the question could not be answered; the person is offered next steps instead of a guess */
  unanswered: boolean;
}

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' ? (x as Obj) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const usd = (cents: number | null) => (cents == null ? 'n/a' : `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean);
const shortDate = (x: unknown) => (x ? new Date(x as string).toISOString().slice(0, 10) : '');

const PAGE: Record<string, AnswerAction[]> = {
  SHOPPING: [{ type: 'OPEN', label: 'Open the purchase planner', href: '/offers/plan' }],
  TRAVEL: [{ type: 'OPEN', label: 'Open the purchase planner', href: '/offers/plan' }, { type: 'OPEN', label: 'Travel and transfers', href: '/travel' }],
  OFFER_SEARCH: [{ type: 'OPEN', label: 'Open the offer inventory', href: '/offers/inventory' }],
  EXPIRATION_REVIEW: [{ type: 'OPEN', label: 'Open expirations', href: '/offers/expirations' }],
  POINTS_LOOKUP: [{ type: 'OPEN', label: 'Open loyalty assets', href: '/loyalty' }],
  CERTIFICATE_REVIEW: [{ type: 'OPEN', label: 'Open loyalty assets', href: '/loyalty' }],
  STATUS_REVIEW: [{ type: 'OPEN', label: 'Open 5/24', href: '/five24' }],
  CARD_RECOMMENDATION: [{ type: 'OPEN', label: 'Open next-card recommendations', href: '/next-card' }],
  BENEFIT_LOOKUP: [{ type: 'OPEN', label: 'Open benefits', href: '/benefits' }],
  ANNUAL_FEE_REVIEW: [{ type: 'OPEN', label: 'Open your wallet', href: '/wallet' }],
  PORTFOLIO_REVIEW: [{ type: 'OPEN', label: 'Open the portfolio', href: '/portfolio' }, { type: 'OPEN', label: 'Open the household', href: '/household' }],
  SPENDING: [{ type: 'OPEN', label: 'Open spending', href: '/spending' }],
  REDEMPTION: [{ type: 'OPEN', label: 'Open travel and transfers', href: '/travel' }, { type: 'OPEN', label: 'Open loyalty assets', href: '/loyalty' }],
  NEW_OFFERS: [{ type: 'OPEN', label: 'Open offer automation', href: '/offers/automation' }],
  SYNC_OFFERS: [{ type: 'OPEN', label: 'Open offer automation', href: '/offers/automation' }],
};

// ───────────── per-engine readers ─────────────

function planParts(data: unknown) {
  const d = obj(data);
  const best = obj(arr(d.plans)[0]);
  if (!Object.keys(best).length) return null;
  return { d, best, household: obj(d.household), strategies: arr(d.strategies), expiry: arr(d.expiryImpact), bestTime: obj(d.bestTimeToBuy) };
}

function relatedFrom(step: StepResult): Related[] {
  const d = obj(step.data);
  const out: Related[] = [];
  if (step.tool === 'plan_purchase') {
    const p = planParts(step.data);
    if (p) for (const l of arr(p.best.legs)) {
      const leg = obj(l);
      out.push({ type: 'CARD', id: str(leg.walletCardId), title: str(leg.cardName), subtitle: [str(leg.member), usd(num(leg.amountCents))].filter(Boolean).join(' · '), href: `/wallet/${str(leg.walletCardId)}` });
    }
    const merchant = obj(d.merchant);
    if (str(merchant.id)) out.push({ type: 'MERCHANT', id: str(merchant.id), title: str(merchant.name), href: '/offers/plan' });
  }
  if (step.tool === 'search_offer_inventory') {
    for (const it of arr(d.items).slice(0, 8)) {
      const o = obj(it);
      const m = obj(o.merchant);
      out.push({ type: 'OFFER', id: str(o.id), title: `${str(m.name) || str(o.merchantText)}: ${str(o.title)}`, subtitle: [str(o.cardholder), str(o.card), str(o.state).toLowerCase().replace(/_/g, ' '), o.endsAt ? `ends ${shortDate(o.endsAt)}` : ''].filter(Boolean).join(' · '), href: str(o.walletCardId) ? `/wallet/${str(o.walletCardId)}` : '/offers/inventory' });
    }
  }
  if (step.tool === 'get_certificates') {
    for (const c of arr(d.certificates).slice(0, 8)) {
      const x = obj(c);
      out.push({ type: 'CERTIFICATE', id: str(x.id), title: str(x.name), subtitle: [str(x.member), x.expiresAt ? `expires ${shortDate(x.expiresAt)}` : ''].filter(Boolean).join(' · '), href: '/loyalty' });
    }
  }
  if (step.tool === 'get_loyalty_summary') {
    for (const a of arr(d.accounts).slice(0, 8)) {
      const x = obj(a);
      out.push({ type: 'PROGRAM', id: str(x.id), title: str(x.programName), subtitle: [str(x.member), `${(num(x.balance) ?? 0).toLocaleString('en-US')} ${str(x.unit)}`].join(' · '), href: '/loyalty' });
    }
  }
  if (step.tool === 'get_expiring_offers') {
    for (const b of arr(d.buckets)) for (const i of arr(obj(b).items).slice(0, 4)) {
      const x = obj(i);
      out.push({ type: str(x.kind) === 'CERTIFICATE' ? 'CERTIFICATE' : str(x.kind) === 'CREDIT' ? 'BENEFIT' : 'OFFER', id: str(x.id), title: str(x.label), subtitle: [str(x.cardholder), `ends ${shortDate(x.endsAt)}`, usd(num(x.valueCents))].filter(Boolean).join(' · '), href: str(x.walletCardId) ? `/wallet/${str(x.walletCardId)}` : '/offers/expirations' });
    }
  }
  return out;
}

const GENERIC_BRAND_WORDS = new Set(['world', 'rewards', 'points', 'miles', 'airlines', 'honors', 'mileageplus', 'privileges', 'bonvoy', 'one']);
/** the words that identify the program a question names ("hyatt", "hilton"), without the words every program has */
const brandWords = (u: Understanding): string[] =>
  [...u.entities.programs.map((p) => p.name), ...u.entities.hotels, ...u.entities.airlines].flatMap((n) => n.toLowerCase().split(/\s+/)).filter((w) => w.length >= 4 && !GENERIC_BRAND_WORDS.has(w));

/** Points for one member ("my son needs a flight"): theirs first, then what the rest of the household holds, since points often can be used for family. */
function memberPointsLines(step: StepResult, u: Understanding): string[] | null {
  const m = u.entities.members.find((x) => x.id);
  if (!m) return null;
  const accts = arr(obj(step.data).accounts).map(obj);
  const mine = accts.filter((a) => str(a.member).toLowerCase() === m.name.toLowerCase());
  const rest = accts.filter((a) => str(a.member).toLowerCase() !== m.name.toLowerCase());
  const total = (xs: Obj[]) => xs.reduce((s, a) => s + (num(a.balance) ?? 0), 0);
  const out = [mine.length ? `${m.name} holds ${total(mine).toLocaleString('en-US')} points and miles.` : `${m.name} has no points or miles recorded.`];
  for (const a of mine.slice(0, 6)) out.push(`• ${str(a.programName)} ${(num(a.balance) ?? 0).toLocaleString('en-US')} ${str(a.unit)} (${usd(num(a.valueCents))})`);
  if (rest.length) {
    out.push(`The rest of the household holds ${total(rest).toLocaleString('en-US')}; some programs let family members book or pool, so check each program’s rules.`);
    for (const a of rest.slice(0, 5)) out.push(`• ${str(a.member)}: ${str(a.programName)} ${(num(a.balance) ?? 0).toLocaleString('en-US')} ${str(a.unit)}`);
  }
  return out;
}

/** Points: keep the accounts of the program the question is about. */
function pointsLines(step: StepResult, u: Understanding): string[] | null {
  const words = brandWords(u);
  if (!words.length) return memberPointsLines(step, u);
  const accts = arr(obj(step.data).accounts).map(obj).filter((a) => words.some((w) => str(a.programName).toLowerCase().includes(w)));
  if (!accts.length) return [`No ${[...u.entities.programs.map((p) => p.name), ...u.entities.hotels, ...u.entities.airlines][0] ?? 'matching'} points found in your accounts.`];
  const total = accts.reduce((s, a) => s + (num(a.balance) ?? 0), 0);
  return [
    `${total.toLocaleString('en-US')} ${str(accts[0].unit) || 'points'} across ${accts.length} account${accts.length === 1 ? '' : 's'} (${usd(accts.reduce((s, a) => s + (num(a.valueCents) ?? 0), 0))}).`,
    ...accts.map((a) => `• ${str(a.member)}: ${str(a.programName)} ${(num(a.balance) ?? 0).toLocaleString('en-US')} ${str(a.unit)} (${usd(num(a.valueCents))})`),
  ];
}

/** "this month" stays as is; "next 30 days" becomes "in the next 30 days"; a month name becomes "in January" */
const when = (label: string) => (/^(this|next week|next month|today|tomorrow)/.test(label) ? label : /^next \d/.test(label) ? `in the ${label}` : `in ${label}`);

/** Expiry questions with a window ("this month"): keep what ends inside it. */
function expiryLines(step: StepResult, u: Understanding): string[] | null {
  const w = u.entities.window;
  if (!w || step.tool !== 'get_expiring_offers') return null;
  const items = arr(obj(step.data).buckets).flatMap((b) => arr(obj(b).items)).map(obj).filter((i) => (num(i.daysLeft) ?? 999) <= w.days);
  const kinds = u.scope === 'OFFERS' ? ['OFFER'] : u.scope === 'BENEFITS' ? ['CREDIT'] : u.scope === 'CERTIFICATES' ? ['CERTIFICATE'] : ['OFFER', 'CREDIT', 'CERTIFICATE'];
  const shown = items.filter((i) => kinds.includes(str(i.kind)));
  if (!shown.length) return [`Nothing expires ${when(w.label)}.`];
  const total = shown.reduce((s, i) => s + (num(i.valueCents) ?? 0), 0);
  return [`${shown.length} item${shown.length === 1 ? ' expires' : 's expire'} ${when(w.label)}, ${usd(total)} at stake.`, ...shown.slice(0, 10).map((i) => `• ${str(i.label)}${str(i.cardholder) ? ` — ${str(i.cardholder)}` : ''}, ends ${shortDate(i.endsAt)}, ${usd(num(i.valueCents))}: ${str(i.action)}`)];
}

// ───────────── compose ─────────────

export function composeAnswer(u: Understanding, route: Route, results: StepResult[], now = new Date()): SearchAnswer {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const sections: AnswerSection[] = [];
  const reasoning: string[] = [];
  const evidence: string[] = [];
  const warnings: string[] = [];
  const related: Related[] = [];
  let confidence = Math.round(Math.min(0.95, u.confidence) * 90);
  let summary = '';

  for (const r of ok) {
    let body = lines(r.summary);
    const special = r.tool === 'get_loyalty_summary' ? pointsLines(r, u) : expiryLines(r, u);
    if (special) body = special;
    sections.push({ heading: results.length > 1 ? r.label : null, lines: body });
    if (!summary && body.length) summary = body[0];
    related.push(...relatedFrom(r));

    const plan = r.tool === 'plan_purchase' ? planParts(r.data) : null;
    if (plan) {
      reasoning.push(...arr(plan.best.justification).map(str));
      evidence.push(...arr(plan.best.evidence).map(str));
      warnings.push(...arr(plan.best.warnings).map(str));
      confidence = Math.round(num(plan.best.confidence) ?? confidence);
      for (const a of arr(plan.best.actions)) reasoning.push(`Do first: ${str(a)}`);
      if (str(plan.household.reason) && arr(plan.household.options).length > 1) reasoning.push(`Who should pay: ${str(plan.household.reason)}`);
      if (str(plan.bestTime.reason) && (num(plan.bestTime.gainCents) ?? 0) > 0) reasoning.push(`Best time: ${str(plan.bestTime.reason)}`);
      for (const e of plan.expiry.slice(0, 3)) reasoning.push(str(obj(e).message));
      for (const s of plan.strategies.filter((x) => str(obj(x).key) !== 'BEST')) reasoning.push(`${str(obj(s).label)}: ${str(obj(s).why)}`);
    } else {
      evidence.push(`${r.label}: from your ${r.tool.replace(/^get_|^search_/, '').replace(/_/g, ' ')} data`);
    }
  }
  for (const f of failed) warnings.push(`${f.label} could not be read: ${f.error ?? 'unknown error'}`);
  if (failed.length) confidence = Math.max(20, confidence - 25 * failed.length);
  for (const a of route.assumptions) warnings.push(a);
  if (route.needs.length) {
    warnings.push(`To be exact I also need: ${route.needs.join(' and ')}.`);
    confidence = Math.min(confidence, 70);
  }
  const unanswered = u.intent === 'UNKNOWN' || (route.steps.length === 0 && !summary);
  if (unanswered) {
    summary = 'I could not tell what you want. Try one of these, or ask the assistant.';
    confidence = 0;
  } else if (!summary) {
    summary = 'Nothing found.';
  }
  const e = u.entities;
  const understood: SearchAnswer['understood'] = [
    ...e.merchants.map((m) => ({ type: 'merchant', label: m.name })),
    ...e.cards.map((c) => ({ type: 'card', label: c.name })),
    ...e.members.filter((m) => m.id).map((m) => ({ type: 'member', label: m.name })),
    ...e.hotels.map((h) => ({ type: 'hotel', label: h })),
    ...e.airlines.map((a) => ({ type: 'airline', label: a })),
    ...(e.destination ? [{ type: 'destination', label: e.destination }] : []),
    ...(e.amountCents != null ? [{ type: 'amount', label: usd(e.amountCents) }] : []),
    ...(e.nights != null ? [{ type: 'nights', label: `${e.nights} night${e.nights === 1 ? '' : 's'}` }] : []),
    ...(e.window ? [{ type: 'when', label: e.window.label }] : []),
    ...(e.issuer ? [{ type: 'issuer', label: e.issuer }] : []),
  ];
  if (e.members.some((m) => !m.id)) warnings.push(`There is no ${e.members.find((m) => !m.id)!.name} in your household; add them on the Household page to include them.`);
  const seen = new Set<string>();
  const uniqueRelated = related.filter((x) => (seen.has(`${x.type}:${x.id}`) ? false : (seen.add(`${x.type}:${x.id}`), true))).slice(0, 12);
  return {
    version: COMPOSE_VERSION,
    intent: u.intent,
    kind: u.kind,
    title: route.title,
    summary,
    sections,
    reasoning: [...new Set(reasoning.filter(Boolean))],
    evidence: [...new Set(evidence.filter(Boolean))],
    warnings: [...new Set(warnings.filter(Boolean))],
    confidence,
    actions: unanswered ? [] : PAGE[u.intent] ?? [],
    calls: unanswered ? [] : actionsFor(u, route, results, now),
    related: uniqueRelated,
    followUps: route.followUps,
    understood,
    unanswered,
  };
}

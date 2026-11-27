/**
 * What can be done from an answer (pure). Actions are descriptions, not effects: the browser runs them against the same endpoints the
 * pages use, as the signed-in member, after a confirmation where the change matters. The server only offers paths from an allow-list,
 * and nothing here logs in to an issuer: activation stays assisted (you do it on the issuer's site, then record it here).
 */
import type { StepResult } from './answer-compose';
import { reminderDue } from './reminders';
import { Route } from './search-router';
import { Understanding } from './query-understanding';

export const ACTIONS_VERSION = 'search-actions/1';

export type CallKind = 'SAVE_PLAN' | 'SAVE_TRIP' | 'REMINDER' | 'ACTIVATE' | 'MARK_ADDED' | 'SYNC';

export interface CallAction {
  type: 'CALL';
  id: string;
  kind: CallKind;
  label: string;
  method: 'POST';
  path: string;
  body: Record<string, unknown>;
  /** shown before the change is made; null = one click */
  confirm: string | null;
  /** what to tell the member afterwards */
  success: string;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** The only endpoints an answer may point an action at. */
export const SAFE_PATHS: RegExp[] = [
  /^\/offers\/intel\/plan$/,
  /^\/loyalty\/award-trips$/,
  /^\/reminders$/,
  new RegExp(`^/offers/intel/activation/${UUID}$`),
  new RegExp(`^/offer-automation/items/${UUID}/mark-enrolled$`),
  /^\/offer-automation\/sync$/,
];

export const isSafeCall = (a: Pick<CallAction, 'method' | 'path'>): boolean => a.method === 'POST' && SAFE_PATHS.some((re) => re.test(a.path));

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' ? (x as Obj) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const iso = (d: Date) => d.toISOString();
const day = (d: Date) => d.toISOString().slice(0, 10);

const MAX_REMINDERS = 2;
const MAX_ROW_ACTIONS = 3;

export function reminderFor(label: string, endsAt: unknown, link: string, daysBefore: number, now: Date, id: string): CallAction | null {
  const end = typeof endsAt === 'string' || endsAt instanceof Date ? new Date(endsAt) : null;
  if (!end || Number.isNaN(end.getTime())) return null;
  const due = reminderDue(end, now, daysBefore);
  if (!due) return null;
  return {
    type: 'CALL',
    id,
    kind: 'REMINDER',
    label: `Remind me ${due.getTime() - now.getTime() < 2 * 3_600_000 ? 'soon' : 'on ' + day(due)}: ${label.length > 40 ? label.slice(0, 37) + '…' : label}`,
    method: 'POST',
    path: '/reminders',
    body: { title: `${label} ends ${day(end)}`.slice(0, 120), dueAt: iso(due), link },
    confirm: null,
    success: `Reminder set for ${day(due)}. You will get a notification.`,
  };
}

/** The things that can be done from this answer, in the order worth showing them. */
export function actionsFor(u: Understanding, route: Route, results: StepResult[], now: Date): CallAction[] {
  const out: CallAction[] = [];
  const ok = (tool: string) => results.find((r) => r.tool === tool && r.ok);
  const step = (tool: string) => route.steps.find((s) => s.tool === tool);

  // a purchase plan can be kept
  const plan = ok('plan_purchase');
  const planStep = step('plan_purchase');
  if (plan && planStep && num(obj(plan.data).amountCents) != null && arr(obj(plan.data).plans).length > 0) {
    const input = planStep.input;
    const single = u.entities.window?.single && u.entities.window.from.getTime() > 0 ? u.entities.window.from : null;
    out.push({
      type: 'CALL',
      id: 'save-plan',
      kind: 'SAVE_PLAN',
      label: 'Save as shopping plan',
      method: 'POST',
      path: '/offers/intel/plan',
      body: {
        ...(str(input.merchant) ? { merchantText: str(input.merchant) } : {}),
        ...(str(input.item) ? { item: str(input.item) } : {}),
        amountCents: num(obj(plan.data).amountCents),
        ...(single ? { plannedFor: iso(single) } : {}),
        save: true,
      },
      confirm: null,
      success: 'Saved to your planned purchases.',
    });
    for (const e of arr(obj(plan.data).expiryImpact).slice(0, 1).map(obj)) {
      const r = reminderFor(str(e.label), e.endsAt, '/offers/plan', 3, now, 'remind-plan');
      if (r) out.push(r);
    }
  }

  // an award search can be kept as a travel plan
  const trip = ok('plan_award_trip');
  const tripStep = step('plan_award_trip');
  if (trip && tripStep) {
    out.push({
      type: 'CALL',
      id: 'save-trip',
      kind: 'SAVE_TRIP',
      label: 'Save travel plan',
      method: 'POST',
      path: '/loyalty/award-trips',
      body: { ...tripStep.input, save: true },
      confirm: null,
      success: 'Saved to your travel plans.',
    });
  }

  // expiring things can be reminded about
  const expiring = ok('get_expiring_offers');
  if (expiring) {
    const items = arr(obj(expiring.data).buckets).flatMap((b) => arr(obj(b).items)).map(obj);
    const w = u.entities.window;
    const inWindow = items.filter((i) => (num(i.daysLeft) ?? 0) >= 2 && (!w || (num(i.daysLeft) ?? 999) <= w.days));
    for (const i of inWindow.slice(0, MAX_REMINDERS)) {
      const r = reminderFor(str(i.label), i.endsAt, str(i.walletCardId) ? `/wallet/${str(i.walletCardId)}` : '/offers/expirations', 3, now, 'remind-' + str(i.id));
      if (r) out.push(r);
    }
  }
  const certs = ok('get_certificates');
  if (certs && u.intent === 'CERTIFICATE_REVIEW') {
    const rows = arr(obj(certs.data).certificates).map(obj).filter((c) => c.expiresAt);
    const next = [...rows].sort((a, b) => new Date(str(a.expiresAt)).getTime() - new Date(str(b.expiresAt)).getTime())[0];
    if (next) {
      const r = reminderFor(str(next.name), next.expiresAt, '/loyalty', 14, now, 'remind-cert');
      if (r) out.push(r);
    }
  }

  // offers on a card that still need activating or recording (assisted: done on the issuer's site first)
  const inv = ok('search_offer_inventory');
  if (inv) {
    const items = arr(obj(inv.data).items).map(obj);
    for (const i of items.filter((x) => str(x.state) === 'ADDED' && x.enrollmentRequired === true && str(x.origin) === 'USER_OFFER').slice(0, MAX_ROW_ACTIONS)) {
      const name = str(obj(i.merchant).name) || str(i.merchantText) || 'offer';
      out.push({
        type: 'CALL',
        id: 'activate-' + str(i.id),
        kind: 'ACTIVATE',
        label: `Mark ${name} offer activated`,
        method: 'POST',
        path: `/offers/intel/activation/${str(i.id)}`,
        body: { status: 'ACTIVATED', note: 'Marked from search' },
        confirm: `Only do this after you have activated the ${name} offer on the issuer’s own website or app. PointWise does not log in for you. Mark it activated?`,
        success: 'Marked as activated.',
      });
    }
    for (const i of items.filter((x) => str(x.state) === 'AVAILABLE' && str(x.origin) === 'SYNC').slice(0, MAX_ROW_ACTIONS)) {
      const name = str(obj(i.merchant).name) || str(i.merchantText) || 'offer';
      out.push({
        type: 'CALL',
        id: 'added-' + str(i.id),
        kind: 'MARK_ADDED',
        label: `I added the ${name} offer`,
        method: 'POST',
        path: `/offer-automation/items/${str(i.id)}/mark-enrolled`,
        body: {},
        confirm: `Only do this after you have added the ${name} offer to your card on the issuer’s own website or app. Record it as added?`,
        success: 'Recorded as added.',
      });
    }
  }
  const inbox = ok('get_offer_inbox');
  if (inbox) {
    for (const i of arr(inbox.data).map(obj).filter((x) => str(x.id)).slice(0, MAX_ROW_ACTIONS)) {
      const name = str(i.merchant) || 'offer';
      out.push({
        type: 'CALL',
        id: 'added-' + str(i.id),
        kind: 'MARK_ADDED',
        label: `I added the ${name} offer`,
        method: 'POST',
        path: `/offer-automation/items/${str(i.id)}/mark-enrolled`,
        body: {},
        confirm: `Only do this after you have added the ${name} offer to your card on the issuer’s own website or app. Record it as added?`,
        success: 'Recorded as added.',
      });
    }
  }

  // the existing, user-started sync, when an account is connected
  const sync = ok('get_offer_sync_status');
  if (sync && u.intent === 'SYNC_OFFERS' && arr(obj(sync.data).accounts).length > 0) {
    out.push({
      type: 'CALL',
      id: 'sync',
      kind: 'SYNC',
      label: 'Run offer sync now',
      method: 'POST',
      path: '/offer-automation/sync',
      body: {},
      confirm: 'Run an offer sync now for your connected accounts? It follows the opt-in and schedule settings you chose on the Offer Automation page.',
      success: 'Sync started. Results appear on the Offer Automation page.',
    });
  }
  return out.filter(isSafeCall);
}

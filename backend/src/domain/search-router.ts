/**
 * From an understood question to the work that answers it (pure): which existing engines to run, with what arguments, and what the
 * conversation remembers for a follow-up ("It will cost $1,200", "What if my spouse pays?"). The steps name assistant tools that already
 * exist; they run server-side and their results never go to a model.
 */
import { Entities, Intent, Ref, Understanding } from './query-understanding';

export const ROUTER_VERSION = 'search-router/1';

export interface ToolStep {
  tool: string;
  input: Record<string, unknown>;
  /** heading for this step's part of the answer */
  label: string;
}

export interface Route {
  intent: Intent;
  title: string;
  steps: ToolStep[];
  /** what the question needs that it did not say */
  needs: string[];
  /** things the answer assumed because the question did not say */
  assumptions: string[];
  /** questions worth asking next */
  followUps: string[];
}

/** What a conversation carries from one question to the next. */
export interface Slots {
  intent: Intent | null;
  merchant: Ref | null;
  item: string | null;
  amountCents: number | null;
  windowDays: number | null;
  /** the dates the person gave, as YYYY-MM-DD, so "it's for January" survives to the next question */
  windowFrom: string | null;
  windowTo: string | null;
  windowSingle: boolean;
  windowLabel: string | null;
  member: Ref | null;
  destination: string | null;
  nights: number | null;
  program: string | null;
  card: string | null;
  issuer: string | null;
}

export const emptySlots = (): Slots => ({ intent: null, merchant: null, item: null, amountCents: null, windowDays: null, windowFrom: null, windowTo: null, windowSingle: false, windowLabel: null, member: null, destination: null, nights: null, program: null, card: null, issuer: null });

const iso = (d: Date) => d.toISOString().slice(0, 10);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const day = (x: unknown): string | null => (typeof x === 'string' && ISO_DAY.test(x) ? x : null);

export function slotsFrom(u: Understanding): Slots {
  const e = u.entities;
  return {
    intent: u.intent === 'UNKNOWN' ? null : u.intent,
    merchant: e.merchants[0] ?? null,
    item: e.item,
    amountCents: e.amountCents,
    windowDays: e.window?.days ?? null,
    windowFrom: e.window ? iso(e.window.from) : null,
    windowTo: e.window ? iso(e.window.to) : null,
    windowSingle: e.window?.single ?? false,
    windowLabel: e.window?.label ?? null,
    member: e.members.find((m) => m.id) ?? null,
    destination: e.destination,
    nights: e.nights,
    program: e.programs[0]?.name ?? e.hotels[0] ?? e.airlines[0] ?? null,
    card: e.cards[0]?.name ?? null,
    issuer: e.issuer,
  };
}

const INTENTS = new Set<string>(['SHOPPING', 'OFFER_SEARCH', 'EXPIRATION_REVIEW', 'POINTS_LOOKUP', 'CERTIFICATE_REVIEW', 'STATUS_REVIEW', 'CARD_RECOMMENDATION', 'BENEFIT_LOOKUP', 'ANNUAL_FEE_REVIEW', 'PORTFOLIO_REVIEW', 'SPENDING', 'TRAVEL', 'REDEMPTION', 'SYNC_OFFERS', 'NEW_OFFERS']);
const text = (x: unknown, max = 120): string | null => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : null);
const int = (x: unknown, max: number): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max ? Math.round(x) : null);
const refOf = (x: unknown): Ref | null => {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const name = text(o.name, 80);
  const slug = text(o.slug, 80);
  return name ? { id: text(o.id, 64) ?? '', name, confidence: typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0.7, ...(slug ? { slug } : {}) } : null;
};

/** Slots come back from the browser, so they are checked field by field and anything unexpected is dropped. */
export function sanitizeSlots(x: unknown): Slots | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  const intent = typeof o.intent === 'string' && INTENTS.has(o.intent) ? (o.intent as Intent) : null;
  if (!intent) return null;
  return {
    intent,
    merchant: refOf(o.merchant),
    item: text(o.item),
    amountCents: int(o.amountCents, 1_000_000_000),
    windowDays: int(o.windowDays, 3650),
    windowFrom: day(o.windowFrom),
    windowTo: day(o.windowTo),
    windowSingle: o.windowSingle === true,
    windowLabel: text(o.windowLabel, 40),
    member: refOf(o.member),
    destination: text(o.destination, 80),
    nights: int(o.nights, 365),
    program: text(o.program, 80),
    card: text(o.card, 120),
    issuer: text(o.issuer, 60),
  };
}

const FOLLOW_UP = /^(it|that|this|they|those)\b|^(what|how) (if|about)\b|^(and|also|then|but|now)\b|^(it'?ll|it will|it would)\b/;

/** A fragment that only makes sense after the previous question. */
export function isFollowUp(u: Understanding, prev: Slots | null): boolean {
  if (!prev?.intent) return false;
  const t = u.text.toLowerCase().trim();
  if (FOLLOW_UP.test(t)) return true;
  if (u.intent === 'UNKNOWN') return true;
  // "$1,200" or "Riley pays" with nothing else to go on
  return u.confidence < 0.6 && u.intent === 'SHOPPING' && u.missing.includes('merchant or item');
}

/**
 * Fills a follow-up from what the conversation already knows: the new words win, the rest carries over, and the intent stays unless the
 * new text clearly asks something else.
 */
export function applyFollowUp(u: Understanding, prev: Slots | null): { understanding: Understanding; usedFollowUp: boolean } {
  if (!prev || !isFollowUp(u, prev)) return { understanding: u, usedFollowUp: false };
  const e = u.entities;
  const own = u.intent !== 'UNKNOWN' && u.confidence >= 0.6 && !FOLLOW_UP.test(u.text.toLowerCase().trim());
  const merged: Entities = {
    ...e,
    merchants: e.merchants.length ? e.merchants : prev.merchant ? [prev.merchant] : [],
    item: e.item ?? prev.item,
    amountCents: e.amountCents ?? prev.amountCents,
    members: e.members.length ? e.members : prev.member ? [{ ...prev.member, via: 'NAME', relationship: null }] : [],
    destination: e.destination ?? prev.destination,
    nights: e.nights ?? prev.nights,
    issuer: e.issuer ?? prev.issuer,
    window:
      e.window ??
      (prev.windowFrom && prev.windowTo
        ? { from: new Date(prev.windowFrom + 'T00:00:00Z'), to: new Date(prev.windowTo + 'T23:59:59Z'), days: prev.windowDays ?? 0, label: prev.windowLabel ?? 'then', single: prev.windowSingle }
        : prev.windowDays != null
          ? { from: new Date(0), to: new Date(0), days: prev.windowDays, label: `next ${prev.windowDays} days`, single: false }
          : null),
  };
  const intent = own ? u.intent : (prev.intent as Intent);
  const missing = u.missing.filter((m) => !(m === 'merchant or item' && (merged.merchants.length || merged.item)) && !(m === 'amount' && merged.amountCents != null));
  return { understanding: { ...u, intent, entities: merged, confidence: Math.max(u.confidence, 0.7), missing }, usedFollowUp: true };
}

const dollars = (cents: number) => Math.round(cents) / 100;
const usd = (cents: number) => `$${dollars(cents).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

const brandOf = (e: Entities): string | null => e.merchants[0]?.name ?? e.hotels[0] ?? e.airlines[0] ?? e.programs[0]?.name ?? null;

/** the category a trip is paid in */
const tripCategory = (e: Entities): string => (e.hotels.length ? 'hotels' : e.airlines.length || e.cabin ? 'airlines' : 'travel');

export function routeFor(u: Understanding): Route {
  const e = u.entities;
  const brand = brandOf(e);
  const member = e.members.find((m) => m.id)?.name;
  const steps: ToolStep[] = [];
  const needs = [...u.missing];
  const followUps: string[] = [];
  const assumptions: string[] = [];
  let title = 'Answer';

  switch (u.intent) {
    case 'SHOPPING': {
      const target = e.merchants[0]?.name ?? e.item ?? e.cards[0]?.name ?? null;
      title = target ? `Best way to pay${target ? ` for ${target}` : ''}` : 'Best card';
      if (target && e.amountCents != null) {
        steps.push({ tool: 'plan_purchase', label: 'Best way to pay', input: { ...(e.merchants[0] ? { merchant: e.merchants[0].name } : {}), ...(e.item ? { item: e.item } : e.merchants[0] ? {} : { item: target }), amountDollars: dollars(e.amountCents), ...(member ? { member } : {}) } });
      } else if (target) {
        steps.push({ tool: 'best_card_for', label: 'Best card', input: { query: e.merchants[0]?.name ?? e.item ?? target } });
        if (e.merchants[0]) steps.push({ tool: 'search_offer_inventory', label: 'Your offers here', input: { query: e.merchants[0].name } });
        followUps.push(`${target} $1,500`);
      } else {
        title = 'Best card';
        followUps.push('What card should I use at Costco?', 'Best card for dining');
      }
      break;
    }
    case 'TRAVEL': {
      const head = [brand, e.destination, e.nights ? `${e.nights} night${e.nights === 1 ? '' : 's'}` : null].filter(Boolean).join(' · ');
      title = head ? `Trip: ${head}` : 'Trip';
      const hasDates = !!e.window && e.window.from.getTime() > 0;
      const flight = !e.hotels.length && (e.airlines.length > 0 || e.cabin != null || /\b(flight|flights|fly|flying|airfare)\b/.test(u.normalized));
      if (brand && e.amountCents != null && (e.hotels.length || e.airlines.length || e.merchants.length)) {
        // a stay or a fare with a price is a purchase: card, offers, credits, certificates, who should pay
        steps.push({ tool: 'plan_purchase', label: 'Best way to pay', input: { merchant: brand, item: e.item ?? undefined, amountDollars: dollars(e.amountCents), ...(member ? { member } : {}) } });
      } else if (flight && e.destination) {
        title = `Flight to ${e.destination}${e.cabin ? ` · ${e.cabin.toLowerCase().replace('_', ' ')}` : ''}`;
        if (hasDates) {
          const from = e.window!.from;
          const to = e.window!.single || !e.window!.to ? new Date(from.getTime() + (e.nights ?? 7) * 86_400_000) : e.nights ? new Date(from.getTime() + e.nights * 86_400_000) : new Date(from.getTime() + 7 * 86_400_000);
          if (!e.window!.single && !e.nights) assumptions.push(`Assumed a 7-day trip starting ${iso(from)}; give exact dates for an exact answer.`);
          if (e.window!.single && !e.nights) assumptions.push('Assumed a 7-day trip.');
          if (!e.cabin) assumptions.push('Assumed economy; say "business class" or "first class" to change it.');
          steps.push({ tool: 'plan_award_trip', label: 'Award options', input: { destination: e.destination, dateFrom: iso(from), dateTo: iso(to), cabin: e.cabin ?? 'ECONOMY', ...(e.points != null ? { pointsNeeded: e.points } : {}) } });
        } else {
          needs.push('dates');
          followUps.push(`${e.destination} next month${e.cabin ? '' : ' business class'}`, `${e.destination} in January`);
        }
        steps.push({ tool: 'best_card_for', label: 'Best card for flights', input: { query: 'airlines' } });
        if (brand) steps.push({ tool: 'search_offer_inventory', label: `${brand} offers`, input: { query: brand } });
        steps.push({ tool: 'get_loyalty_summary', label: member ? `${member}’s points and the household’s` : 'Your points and miles', input: {} });
        steps.push({ tool: 'get_transfer_bonuses', label: 'Transfer bonuses', input: {} });
      } else {
        steps.push({ tool: 'best_card_for', label: 'Best card for this trip', input: { query: tripCategory(e) } });
        if (brand) steps.push({ tool: 'search_offer_inventory', label: `${brand} offers`, input: { query: brand } });
        if (e.hotels.length || e.certificateKind) steps.push({ tool: 'get_certificates', label: 'Certificates', input: {} });
        steps.push({ tool: 'get_loyalty_summary', label: 'Your points and miles', input: {} });
        steps.push({ tool: 'get_transfer_bonuses', label: 'Transfer bonuses', input: {} });
        if (e.amountCents == null) {
          if (!needs.includes('amount')) needs.push('amount');
          followUps.push(`${brand ?? e.destination ?? 'Trip'} $1,200`);
        }
      }
      break;
    }
    case 'OFFER_SEARCH': {
      title = brand ? `${brand} offers` : e.issuer ? `${e.issuer} offers` : 'Your offers';
      steps.push({
        tool: 'search_offer_inventory',
        label: title,
        input: { query: brand ?? e.issuer ?? '', ...(e.window ? { expiresWithinDays: e.window.days } : {}), ...(e.amountCents != null ? { minValueDollars: dollars(e.amountCents) } : {}) },
      });
      followUps.push('What offers expire this month?');
      break;
    }
    case 'EXPIRATION_REVIEW': {
      title = u.scope === 'POINTS' ? 'Points at risk' : u.scope === 'CERTIFICATES' ? 'Certificates expiring' : u.scope === 'BENEFITS' ? 'Credits expiring' : 'What is expiring';
      if (u.scope === 'POINTS') steps.push({ tool: 'get_expiring_loyalty', label: 'Points and miles at risk', input: {} });
      else if (u.scope === 'CERTIFICATES') steps.push({ tool: 'get_certificates', label: 'Certificates', input: {} });
      else if (u.scope === 'BENEFITS') steps.push({ tool: 'get_benefit_summary', label: 'Credits', input: { status: 'expiring', withinDays: e.window?.days ?? 30 } });
      else {
        steps.push({ tool: 'get_expiring_offers', label: 'Offers, credits and certificates', input: {} });
        if (u.scope === 'ALL') steps.push({ tool: 'get_expiring_loyalty', label: 'Points and miles at risk', input: {} });
      }
      break;
    }
    case 'POINTS_LOOKUP': {
      title = brand ? `${brand} points` : 'Your points and miles';
      steps.push({ tool: 'get_loyalty_summary', label: title, input: {} });
      if (/most valuable|valuation|worth/.test(u.normalized)) steps.push({ tool: 'get_point_valuations', label: 'What a point is worth', input: {} });
      followUps.push('What loyalty assets are expiring?');
      break;
    }
    case 'CERTIFICATE_REVIEW': {
      title = e.certificateKind === 'FREE_NIGHT' ? 'Free night certificates' : 'Certificates';
      steps.push({ tool: 'get_certificates', label: title, input: e.certificateKind ? { category: e.certificateKind } : {} });
      break;
    }
    case 'STATUS_REVIEW': {
      const fiveTwentyFour = /\b5 24\b|\b24 months\b|\bopened\b/.test(u.normalized) || /5\/24/.test(u.text);
      title = fiveTwentyFour ? '5/24 status' : 'Elite status';
      steps.push(fiveTwentyFour ? { tool: 'get_five24_status', label: '5/24 status', input: member ? { member } : {} } : { tool: 'get_status_progress', label: 'Elite status', input: {} });
      break;
    }
    case 'CARD_RECOMMENDATION': {
      title = 'What to apply for next';
      steps.push({ tool: 'recommend_next_card', label: 'Recommendation', input: member ? { member } : {} });
      followUps.push('What is my current 5/24 status?');
      break;
    }
    case 'BENEFIT_LOOKUP': {
      title = 'Benefits and credits';
      const status = /expir/.test(u.normalized) ? 'expiring' : /missed/.test(u.normalized) ? 'missed' : 'available';
      steps.push({ tool: 'get_benefit_summary', label: title, input: { status, ...(status === 'expiring' ? { withinDays: e.window?.days ?? 30 } : {}) } });
      break;
    }
    case 'ANNUAL_FEE_REVIEW': {
      title = e.cards[0] ? `Keep or cancel: ${e.cards[0].name}` : 'Annual fees';
      steps.push({ tool: 'get_renewals', label: 'Annual fees and renewals', input: { withinDays: 366 } });
      if (e.cards[0]) steps.push({ tool: 'get_card_details', label: e.cards[0].name, input: { card: e.cards[0].name } });
      break;
    }
    case 'PORTFOLIO_REVIEW': {
      title = 'Household portfolio';
      steps.push({ tool: 'get_household', label: 'Household', input: {} });
      steps.push({ tool: 'get_portfolio_value', label: 'Value of your cards', input: member ? { member } : {} });
      break;
    }
    case 'SPENDING': {
      title = 'Spending';
      steps.push({ tool: 'get_spend_summary', label: 'Monthly spending', input: {} });
      break;
    }
    case 'REDEMPTION': {
      title = 'Redemption options';
      steps.push({ tool: 'get_loyalty_summary', label: 'Your points and miles', input: {} });
      steps.push({ tool: 'get_transfer_bonuses', label: 'Transfer bonuses', input: {} });
      steps.push({ tool: 'get_certificates', label: 'Certificates', input: {} });
      break;
    }
    case 'NEW_OFFERS': {
      title = 'New offers';
      steps.push({ tool: 'get_offer_inbox', label: 'New offers', input: { tab: 'new' } });
      break;
    }
    case 'SYNC_OFFERS': {
      title = 'Sync offers';
      steps.push({ tool: 'get_offer_sync_status', label: 'Sync status', input: {} });
      break;
    }
    default:
      title = 'Not sure what you mean';
      followUps.push('What card should I use at Costco?', 'What offers expire this month?', 'How many points do I have?', 'What is my 5/24 status?');
  }
  return { intent: u.intent, title, steps, needs, assumptions, followUps };
}

export { usd };

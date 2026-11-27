/**
 * Life events (pure): the rules for what may be saved, and the shape of an estimate. An event is something coming up that the member's
 * cards, points and offers can help with. The title and notes are the member's own words and never leave the server.
 */
export const LIFE_VERSION = 'life/1';
export const LIFE_KINDS = ['FAMILY_VACATION', 'COLLEGE_VISIT', 'MISSION_TRIP', 'INTERNATIONAL', 'BUSINESS_TRAVEL', 'MAJOR_PURCHASE', 'MOVING', 'HOME_PROJECT', 'OTHER'] as const;
export type LifeKindName = (typeof LIFE_KINDS)[number];
export const LIFE_STATUSES = ['PLANNING', 'BOOKED', 'DONE', 'CANCELLED'] as const;
export const MAX_ACTIVE_EVENTS = 40;

export const LIFE_KIND_LABEL: Record<LifeKindName, string> = {
  FAMILY_VACATION: 'Family vacation',
  COLLEGE_VISIT: 'College visit',
  MISSION_TRIP: 'Mission trip',
  INTERNATIONAL: 'International travel',
  BUSINESS_TRAVEL: 'Business travel',
  MAJOR_PURCHASE: 'Major purchase',
  MOVING: 'Moving',
  HOME_PROJECT: 'Home project',
  OTHER: 'Something else',
};
export const isTravel = (k: LifeKindName): boolean => ['FAMILY_VACATION', 'COLLEGE_VISIT', 'MISSION_TRIP', 'INTERNATIONAL', 'BUSINESS_TRAVEL'].includes(k);

const text = (x: unknown, max: number): string => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim().slice(0, max) : '');

export interface LifeInput {
  kind: unknown;
  title: unknown;
  destination?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  travelers?: unknown;
  budgetCents?: unknown;
  status?: unknown;
}
export interface LifeValue {
  kind: LifeKindName;
  title: string;
  destination: string | null;
  startsOn: Date | null;
  endsOn: Date | null;
  travelers: number;
  budgetCents: number | null;
  status: (typeof LIFE_STATUSES)[number];
}
export type LifeCheck = { ok: true; value: LifeValue } | { ok: false; error: string };

const date = (x: unknown): Date | null | 'bad' => {
  if (x == null || x === '') return null;
  if (typeof x !== 'string' && !(x instanceof Date)) return 'bad';
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? 'bad' : d;
};

/** `allowPast`: an edit that does not touch the dates may keep a start date that has since passed */
export function checkLifeEvent(i: LifeInput, now: Date, opts: { allowPast?: boolean } = {}): LifeCheck {
  const kind = LIFE_KINDS.find((k) => k === i.kind);
  if (!kind) return { ok: false, error: 'Unknown event type' };
  const title = text(i.title, 120);
  if (title.length < 2) return { ok: false, error: 'An event needs a title' };
  const startsOn = date(i.startsOn);
  const endsOn = date(i.endsOn);
  if (startsOn === 'bad' || endsOn === 'bad') return { ok: false, error: 'That date is not valid' };
  const status = LIFE_STATUSES.find((s) => s === (i.status ?? 'PLANNING'));
  if (!status) return { ok: false, error: 'Unknown status' };
  if (startsOn && endsOn && endsOn.getTime() < startsOn.getTime()) return { ok: false, error: 'The end date cannot be before the start' };
  if (!opts.allowPast && startsOn && (status === 'PLANNING' || status === 'BOOKED') && startsOn.getTime() < now.getTime() - 86_400_000) return { ok: false, error: 'The start date has already passed' };
  if (startsOn && startsOn.getTime() > now.getTime() + 3650 * 86_400_000) return { ok: false, error: 'That date is too far ahead' };
  const travelers = i.travelers == null ? 1 : Number(i.travelers);
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 20) return { ok: false, error: 'Travelers is 1 to 20' };
  let budgetCents: number | null = null;
  if (i.budgetCents != null && i.budgetCents !== '') {
    budgetCents = Number(i.budgetCents);
    if (!Number.isInteger(budgetCents) || budgetCents < 0 || budgetCents > 100_000_000) return { ok: false, error: 'The budget must be between $0 and $1,000,000' };
  }
  const destination = text(i.destination, 80) || null;
  if (isTravel(kind) && !destination) return { ok: false, error: 'Say where you are going' };
  return { ok: true, value: { kind, title, destination, startsOn, endsOn, travelers, budgetCents, status } };
}

export interface LifeEstimate {
  version: string;
  kind: LifeKindName;
  /** the dates, budget or party size were assumed, not given */
  assumed: string[];
  bestCards: Array<{ use: string; card: string; member: string | null; expectedCents: number; netCostCents: number; why: string }>;
  offers: string[];
  pointsUse: { program: string; pointsNeeded: number; covered: number; shortfall: number; summary: string } | null;
  travelCredits: { cents: number; items: Array<{ benefit: string; card: string; cents: number }> };
  certificates: Array<{ name: string; cents: number; expiresOn: string; usable: boolean }>;
  transferBonuses: string[];
  /** rewards at the best card, plus usable credits and certificates; points are shown separately, not added */
  expectedValueCents: number;
  assumptions: string[];
  risks: string[];
  confidence: number;
}

/** The expected value of an estimate, from its parts, so the total can always be explained. */
export function expectedValue(e: Pick<LifeEstimate, 'bestCards' | 'travelCredits' | 'certificates'>): number {
  return e.bestCards.reduce((s, c) => s + Math.max(0, c.expectedCents), 0) + e.travelCredits.cents + e.certificates.filter((c) => c.usable).reduce((s, c) => s + c.cents, 0);
}

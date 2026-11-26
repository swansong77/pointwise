/**
 * Certificate condition engine (pure): turns the restriction text a program prints on a certificate into structured
 * conditions that can be explained to the member and checked against a booking. Examples it understands:
 *   "Valid up to 40,000 points."            "Valid only on award bookings."
 *   "Valid for Category 1-4 hotels."        "Requires paid companion ticket."
 *   "Must originate in the United States."  "Blackout: 2026-12-18..2027-01-02."
 * Sentences it cannot classify are returned as `unparsed` so nothing is silently dropped. Wording is generic and
 * unverified against any program's real terms.
 */
import { parseOfferDate } from './offer-import';

export const CONDITIONS_VERSION = 'loyalty-conditions/1';

export type ConditionType =
  | 'POINT_CAP'
  | 'AWARD_ONLY'
  | 'CATEGORY_RANGE'
  | 'REQUIRES_PAID_FARE'
  | 'ORIGIN_COUNTRY'
  | 'BLACKOUT'
  | 'TRANSFER_RULE'
  | 'USAGE_RULE'
  | 'CANCELLATION_RULE'
  | 'EXPIRATION_RULE';

/** The groups the member sees: conditions, restrictions, blackout, transfer, usage, cancellation, expiration. */
export type ConditionGroup = 'CONDITION' | 'RESTRICTION' | 'BLACKOUT' | 'TRANSFER' | 'USAGE' | 'CANCELLATION' | 'EXPIRATION';

export interface Condition {
  type: ConditionType;
  group: ConditionGroup;
  /** the sentence it came from */
  text: string;
  params: Record<string, unknown>;
}

const GROUP: Record<ConditionType, ConditionGroup> = {
  POINT_CAP: 'CONDITION',
  AWARD_ONLY: 'CONDITION',
  CATEGORY_RANGE: 'CONDITION',
  REQUIRES_PAID_FARE: 'CONDITION',
  ORIGIN_COUNTRY: 'RESTRICTION',
  BLACKOUT: 'BLACKOUT',
  TRANSFER_RULE: 'TRANSFER',
  USAGE_RULE: 'USAGE',
  CANCELLATION_RULE: 'CANCELLATION',
  EXPIRATION_RULE: 'EXPIRATION',
};

const toInt = (s: string) => Number(s.replace(/,/g, ''));
const DATE = '(\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|[A-Z][a-z]{2,8}\\.?\\s+\\d{1,2},?\\s+\\d{4})';

const COUNTRY: Record<string, string> = { 'united states': 'US', 'u.s.': 'US', us: 'US', usa: 'US', canada: 'CA', 'united kingdom': 'GB', uk: 'GB', mexico: 'MX' };

type Rule = [ConditionType, RegExp, (m: RegExpExecArray, s: string) => Record<string, unknown>];
const RULES: Rule[] = [
  ['POINT_CAP', /(?:up to|maximum of|max(?:imum)?(?: of)?|capped at)\s*([\d,]{3,9})\s*(?:points|pts)/i, (m) => ({ cap: toInt(m[1]) })],
  ['AWARD_ONLY', /(?:only\s+(?:valid\s+)?(?:on|for)\s+award\s+(?:bookings?|flights?|stays?|travel|reservations?)|award\s+(?:bookings?|travel|stays?)\s+only|(?:valid|redeemable|usable)\s+(?:only\s+)?(?:on|for)\s+award\s+(?:bookings?|flights?|stays?))/i, () => ({ awardOnly: true })],
  ['CATEGORY_RANGE', /categor(?:y|ies)\s*(\d)\s*(?:-|–|to|through)\s*(\d)/i, (m) => ({ min: Number(m[1]), max: Number(m[2]) })],
  ['CATEGORY_RANGE', /categor(?:y|ies)\s*(\d)\s*(?:or (?:lower|below))/i, (m) => ({ min: 1, max: Number(m[1]) })],
  ['REQUIRES_PAID_FARE', /(?:requires?|needs?|must (?:be )?(?:booked )?with|companion must (?:travel|be) on)\s+(?:a\s+)?(?:paid|purchased|full[- ]fare|revenue)\s+(?:companion\s+)?(?:ticket|fare|booking)/i, () => ({ paidFare: true })],
  ['ORIGIN_COUNTRY', /(?:must|has to|needs to)\s+(?:originate|depart|start|begin)\s+(?:in|from)\s+(?:the\s+)?([A-Za-z.\s]{2,20}?)(?=[.,;]|$)/i, (m) => ({ country: COUNTRY[m[1].trim().toLowerCase()] ?? m[1].trim() })],
  ['BLACKOUT', /blackout/i, (_m, s) => ({ ranges: blackoutRanges(s), none: /no blackout/i.test(s) })],
  ['TRANSFER_RULE', /(?:non[- ]?transferable|not transferable|may not be transferred|cannot be transferred|can be transferred|transferable to)/i, (_m, s) => ({ transferable: !/(?:non[- ]?transferable|not transferable|may not be transferred|cannot be transferred)/i.test(s) })],
  ['CANCELLATION_RULE', /\bcancel\w*/i, () => ({})],
  ['EXPIRATION_RULE', new RegExp(`(?:expires?|expiration|valid (?:through|until|thru)|use (?:it )?by)\\s*(?:on|:)?\\s*${DATE}`, 'i'), (m) => ({ date: parseOfferDate(m[1].replace(/\./g, '')) })],
  ['USAGE_RULE', /\b(?:weekends? only|weekdays? only|one (?:night|certificate|use)|per (?:stay|booking|member)|limited to|one per|only (?:valid|usable|redeemable)|must be (?:used|redeemed|booked))\b/i, () => ({})],
];

/** "2026-12-18..2027-01-02; 2027-03-01 to 2027-03-10" → ranges. */
export function blackoutRanges(text: string): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  for (const part of text.split(/[;\n]/)) {
    const m = /(\d{4}-\d{2}-\d{2})\s*(?:\.\.|to|–|-)\s*(\d{4}-\d{2}-\d{2})/i.exec(part);
    if (m) out.push({ from: new Date(`${m[1]}T00:00:00Z`), to: new Date(`${m[2]}T23:59:59Z`) });
  }
  return out;
}

const sentences = (text: string) =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

export interface ParsedConditions {
  conditions: Condition[];
  unparsed: string[];
  version: string;
}

export function parseConditions(text: string | null | undefined): ParsedConditions {
  const conditions: Condition[] = [];
  const unparsed: string[] = [];
  for (const s of sentences(text ?? '')) {
    let hit = false;
    for (const [type, re, params] of RULES) {
      const m = re.exec(s);
      if (!m) continue;
      // a sentence about a cap is also often an expiry sentence: keep every distinct type it matches
      if (conditions.some((c) => c.type === type && c.text === s)) continue;
      conditions.push({ type, group: GROUP[type], text: s, params: params(m, s) });
      hit = true;
    }
    if (!hit) unparsed.push(s);
  }
  return { conditions, unparsed, version: CONDITIONS_VERSION };
}

const usd = (n: number) => n.toLocaleString('en-US');

/** A plain-language line for one condition. */
export function explainCondition(c: Condition): string {
  const p = c.params;
  switch (c.type) {
    case 'POINT_CAP':
      return `Valid up to ${usd(p.cap as number)} points.`;
    case 'AWARD_ONLY':
      return 'Valid only on award bookings.';
    case 'CATEGORY_RANGE':
      return p.min === p.max ? `Valid for Category ${p.min} hotels.` : `Valid for Category ${p.min}-${p.max} hotels.`;
    case 'REQUIRES_PAID_FARE':
      return 'Requires paid companion ticket.';
    case 'ORIGIN_COUNTRY':
      return `Must originate in ${p.country === 'US' ? 'the United States' : String(p.country)}.`;
    case 'BLACKOUT': {
      const r = p.ranges as Array<{ from: Date; to: Date }>;
      return p.none ? 'No blackout dates.' : r.length ? `Blackout: ${r.map((x) => `${x.from.toISOString().slice(0, 10)} to ${x.to.toISOString().slice(0, 10)}`).join('; ')}.` : `Blackout rule: ${c.text}`;
    }
    case 'TRANSFER_RULE':
      return p.transferable ? 'Can be transferred to another member.' : 'Not transferable.';
    case 'EXPIRATION_RULE':
      return p.date instanceof Date ? `Expires ${p.date.toISOString().slice(0, 10)}.` : c.text;
    default:
      return c.text;
  }
}

export interface BookingContext {
  /** award price per night in points */
  pointsPerNight?: number;
  /** hotel category 1–9 */
  category?: number;
  bookingType?: 'AWARD' | 'CASH';
  /** ISO country code the trip starts in */
  originCountry?: string;
  /** check-in / travel date */
  date?: Date;
}

export interface ConditionCheck {
  violations: string[];
  warnings: string[];
}

/** Checks a booking against the conditions; what cannot be checked becomes a warning, never a silent pass. */
export function evaluateConditions(conditions: Condition[], b: BookingContext): ConditionCheck {
  const violations: string[] = [];
  const warnings: string[] = [];
  for (const c of conditions) {
    const p = c.params;
    switch (c.type) {
      case 'POINT_CAP':
        if (b.pointsPerNight != null && b.pointsPerNight > (p.cap as number)) violations.push(`The room costs ${usd(b.pointsPerNight)} points; ${explainCondition(c).toLowerCase()}`);
        break;
      case 'AWARD_ONLY':
        if (b.bookingType === 'CASH') violations.push(explainCondition(c));
        else if (!b.bookingType) warnings.push(explainCondition(c));
        break;
      case 'CATEGORY_RANGE':
        if (b.category == null) warnings.push(`${explainCondition(c)} Check the hotel's category.`);
        else if (b.category < (p.min as number) || b.category > (p.max as number)) violations.push(`The hotel is Category ${b.category}. ${explainCondition(c)}`);
        break;
      case 'REQUIRES_PAID_FARE':
        warnings.push(explainCondition(c));
        break;
      case 'ORIGIN_COUNTRY':
        if (!b.originCountry) warnings.push(explainCondition(c));
        else if (b.originCountry.toUpperCase() !== String(p.country).toUpperCase()) violations.push(`The trip starts in ${b.originCountry}. ${explainCondition(c)}`);
        break;
      case 'BLACKOUT': {
        const ranges = p.ranges as Array<{ from: Date; to: Date }>;
        if (b.date && ranges.some((r) => b.date! >= r.from && b.date! <= r.to)) violations.push('The date falls in a blackout period.');
        else if (!ranges.length && !p.none) warnings.push(`Blackout rule could not be read automatically: "${c.text}". Check it before booking.`);
        break;
      }
      case 'EXPIRATION_RULE':
        if (b.date && p.date instanceof Date && b.date > p.date) violations.push(`The date is after the certificate expires (${p.date.toISOString().slice(0, 10)}).`);
        break;
      default:
        warnings.push(explainCondition(c));
    }
  }
  return { violations, warnings };
}

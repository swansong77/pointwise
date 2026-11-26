/**
 * Loyalty text parser (pure, deterministic): turns the text of a program email, a statement excerpt or a page
 * the member captured with the extension into typed observations. Rules are DATA (a program table plus a generic
 * pattern library), not code per program, so they can be extended from real samples.
 *
 * Honesty: the patterns are generic wording written against synthetic fixtures. They have NOT been checked
 * against real program emails or pages, so every rule carries `verified: false`, the output says so, and a
 * rule that does not match produces nothing rather than a guess. Message bodies are never stored.
 */
import { parseOfferDate } from './offer-import';

export const LOYALTY_PARSER_VERSION = 'loyalty-email/1';

export type ObservationEntity = 'ACCOUNT' | 'CERTIFICATE' | 'STATUS' | 'MEMBERSHIP';

export interface ParsedObservation {
  entity: ObservationEntity;
  /** ACCOUNT: balance, pendingBalance, statusLevel, statusDeadline, expiresAt, lastActivityAt, lifetimePoints, activity */
  field: string;
  value: unknown;
  /** the rule that produced it */
  rule: string;
  /** 0–100: how sure the rule is, separate from the source's reliability */
  ruleConfidence: number;
  observedAt: Date;
}

export interface ProgramRule {
  programCode: string;
  name: string;
  unit: 'miles' | 'points';
  /** sender domains (and their subdomains) the program mails from */
  domains: string[];
  /** status tiers, longest first, used to read a status out of free text */
  tiers: string[];
  /** where this rule set came from; all are unverified until a real sample confirms them */
  verified: false;
}

const T = (...t: string[]) => t;
export const PROGRAM_RULES: ProgramRule[] = [
  { programCode: 'AA_AADVANTAGE', name: 'American Airlines AAdvantage', unit: 'miles', domains: ['aa.com', 'info.email.aa.com'], tiers: T('Executive Platinum', 'Platinum Pro', 'Platinum', 'Gold'), verified: false },
  { programCode: 'UA_MILEAGEPLUS', name: 'United MileagePlus', unit: 'miles', domains: ['united.com', 'unitedairlines.com'], tiers: T('Premier 1K', '1K', 'Premier Platinum', 'Platinum', 'Premier Gold', 'Gold', 'Premier Silver', 'Silver'), verified: false },
  { programCode: 'DL_SKYMILES', name: 'Delta SkyMiles', unit: 'miles', domains: ['delta.com'], tiers: T('Diamond Medallion', 'Platinum Medallion', 'Gold Medallion', 'Silver Medallion', 'Diamond', 'Platinum', 'Gold', 'Silver'), verified: false },
  { programCode: 'WN_RAPIDREWARDS', name: 'Southwest Rapid Rewards', unit: 'points', domains: ['southwest.com', 'iluv.southwest.com'], tiers: T('A-List Preferred', 'A-List'), verified: false },
  { programCode: 'AS_MILEAGEPLAN', name: 'Alaska Mileage Plan', unit: 'miles', domains: ['alaskaair.com', 'alaskasworld.com'], tiers: T('MVP Gold 100K', 'MVP Gold 75K', 'MVP Gold', 'MVP'), verified: false },
  { programCode: 'B6_TRUEBLUE', name: 'JetBlue TrueBlue', unit: 'points', domains: ['jetblue.com'], tiers: T('Mosaic'), verified: false },
  { programCode: 'AC_AEROPLAN', name: 'Air Canada Aeroplan', unit: 'points', domains: ['aircanada.com', 'aeroplan.com'], tiers: T('Super Elite', 'Elite 75K', 'Elite 50K', 'Elite 35K', 'Elite 25K', '75K', '50K', '35K', '25K'), verified: false },
  { programCode: 'BA_AVIOS', name: 'British Airways Executive Club', unit: 'points', domains: ['ba.com', 'britishairways.com'], tiers: T('Gold Guest List', 'Gold', 'Silver', 'Bronze', 'Blue'), verified: false },
  { programCode: 'VS_FLYINGCLUB', name: 'Virgin Atlantic Flying Club', unit: 'points', domains: ['virginatlantic.com'], tiers: T('Gold', 'Silver', 'Red'), verified: false },
  { programCode: 'AF_FLYINGBLUE', name: 'Flying Blue', unit: 'miles', domains: ['flyingblue.com', 'airfrance.com', 'klm.com'], tiers: T('Platinum for Life', 'Ultimate', 'Platinum', 'Gold', 'Silver', 'Explorer'), verified: false },
  { programCode: 'SQ_KRISFLYER', name: 'Singapore KrisFlyer', unit: 'miles', domains: ['singaporeair.com'], tiers: T('Solitaire PPS', 'PPS Club', 'KrisFlyer Gold', 'KrisFlyer Elite Gold', 'KrisFlyer Elite Silver', 'Gold', 'Silver'), verified: false },
  { programCode: 'QR_PRIVILEGE', name: 'Qatar Privilege Club', unit: 'points', domains: ['qatarairways.com'], tiers: T('Platinum', 'Gold', 'Silver', 'Burgundy'), verified: false },
  { programCode: 'EK_SKYWARDS', name: 'Emirates Skywards', unit: 'miles', domains: ['emirates.com'], tiers: T('Platinum', 'Gold', 'Silver', 'Blue'), verified: false },
  { programCode: 'EY_GUEST', name: 'Etihad Guest', unit: 'miles', domains: ['etihad.com'], tiers: T('Platinum', 'Gold', 'Silver', 'Bronze'), verified: false },
  { programCode: 'HA_HAWAIIANMILES', name: 'HawaiianMiles', unit: 'miles', domains: ['hawaiianairlines.com'], tiers: T('Pualani Platinum', 'Pualani Gold', 'Pualani'), verified: false },
  { programCode: 'MAR_BONVOY', name: 'Marriott Bonvoy', unit: 'points', domains: ['marriott.com', 'marriottbonvoy.com', 'e.marriott.com'], tiers: T('Ambassador Elite', 'Titanium Elite', 'Platinum Elite', 'Gold Elite', 'Silver Elite', 'Titanium', 'Platinum', 'Gold', 'Silver'), verified: false },
  { programCode: 'HH_HONORS', name: 'Hilton Honors', unit: 'points', domains: ['hilton.com', 'hiltonhonors.com', 'h1.hilton.com'], tiers: T('Diamond', 'Gold', 'Silver'), verified: false },
  { programCode: 'WOH_HYATT', name: 'World of Hyatt', unit: 'points', domains: ['hyatt.com', 'worldofhyatt.com'], tiers: T('Globalist', 'Explorist', 'Discoverist'), verified: false },
  { programCode: 'IHG_ONE', name: 'IHG One Rewards', unit: 'points', domains: ['ihg.com', 'ihgrewardsclub.com'], tiers: T('Diamond Elite', 'Platinum Elite', 'Gold Elite', 'Silver Elite', 'Diamond', 'Platinum', 'Gold', 'Silver', 'Club'), verified: false },
  { programCode: 'WYN_REWARDS', name: 'Wyndham Rewards', unit: 'points', domains: ['wyndhamhotels.com', 'wyndhamrewards.com'], tiers: T('Diamond', 'Platinum', 'Gold', 'Blue'), verified: false },
  { programCode: 'CHOICE_PRIV', name: 'Choice Privileges', unit: 'points', domains: ['choicehotels.com', 'choiceprivileges.com'], tiers: T('Diamond', 'Platinum', 'Gold', 'Member'), verified: false },
  { programCode: 'BW_REWARDS', name: 'Best Western Rewards', unit: 'points', domains: ['bestwestern.com'], tiers: T('Diamond Select', 'Diamond', 'Platinum', 'Gold', 'Blue'), verified: false },
  { programCode: 'ACCOR_ALL', name: 'Accor Live Limitless', unit: 'points', domains: ['accor.com', 'all.accor.com'], tiers: T('Diamond', 'Platinum', 'Gold', 'Silver', 'Classic'), verified: false },
  { programCode: 'AMEX_MR', name: 'American Express Membership Rewards', unit: 'points', domains: ['americanexpress.com', 'aexp.com'], tiers: T(), verified: false },
  { programCode: 'CHASE_UR', name: 'Chase Ultimate Rewards', unit: 'points', domains: ['chase.com', 'jpmorgan.com'], tiers: T(), verified: false },
  { programCode: 'C1_MILES', name: 'Capital One Miles', unit: 'miles', domains: ['capitalone.com'], tiers: T(), verified: false },
  { programCode: 'CITI_TYP', name: 'Citi ThankYou Rewards', unit: 'points', domains: ['citi.com', 'citibank.com', 'thankyou.com'], tiers: T(), verified: false },
  { programCode: 'BILT_POINTS', name: 'Bilt Rewards', unit: 'points', domains: ['biltrewards.com', 'bilt.com'], tiers: T('Platinum', 'Gold', 'Silver', 'Blue'), verified: false },
  { programCode: 'WF_REWARDS', name: 'Wells Fargo Rewards', unit: 'points', domains: ['wellsfargo.com'], tiers: T(), verified: false },
  { programCode: 'BOA_POINTS', name: 'Bank of America Rewards', unit: 'points', domains: ['bankofamerica.com', 'ealerts.bankofamerica.com'], tiers: T(), verified: false },
  { programCode: 'USB_REWARDS', name: 'US Bank Rewards', unit: 'points', domains: ['usbank.com'], tiers: T(), verified: false },
  { programCode: 'RAKUTEN', name: 'Rakuten', unit: 'points', domains: ['rakuten.com'], tiers: T(), verified: false },
  { programCode: 'TOPCASHBACK', name: 'TopCashback', unit: 'points', domains: ['topcashback.com'], tiers: T(), verified: false },
];

const norm = (d: string) => d.toLowerCase().replace(/^www\./, '');

/** Every sender domain the loyalty parsers know, for the inbound allow-list. */
export function loyaltySenderDomains(): string[] {
  return [...new Set(PROGRAM_RULES.flatMap((r) => r.domains.map(norm)))];
}

/** The program whose domain (or a parent domain) the sender matches. */
export function programForDomain(domain: string): ProgramRule | null {
  const d = norm(domain);
  let best: { rule: ProgramRule; len: number } | null = null;
  for (const r of PROGRAM_RULES)
    for (const rd of r.domains.map(norm))
      if ((d === rd || d.endsWith(`.${rd}`)) && (!best || rd.length > best.len)) best = { rule: r, len: rd.length };
  return best?.rule ?? null;
}

export const programByCode = (code: string): ProgramRule | null => PROGRAM_RULES.find((r) => r.programCode === code) ?? null;

// ───────────── patterns ─────────────

const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d{1,9})';
const UNIT = '(?:award\\s+)?(?:bonvoy\\s+)?(?:points?|pts|miles?|avios|aeroplan points?|skymiles)';
const DATE = '((?:\\d{1,2}\\/\\d{1,2}\\/\\d{2,4})|(?:\\d{4}-\\d{2}-\\d{2})|(?:[A-Z][a-z]{2,8}\\.?\\s+\\d{1,2},?\\s+\\d{4}))';
const toInt = (s: string) => Number(s.replace(/,/g, ''));

const BALANCE_RES: Array<[string, RegExp, number]> = [
  ['balance.label', new RegExp(`(?:current|total|available|account)?\\s*(?:points?|miles?)?\\s*balance(?:\\s+as of\\s+[^:\\d]{0,20}\\d[\\d/,\\- A-Za-z]{0,14})?\\s*(?:is|:|of)?\\s*${NUM}`, 'i'), 85],
  ['balance.have', new RegExp(`you (?:now |currently )?have\\s+${NUM}\\s*${UNIT}`, 'i'), 80],
  ['balance.available', new RegExp(`${NUM}\\s*${UNIT}\\s*(?:are |is )?(?:now )?(?:available|in your account)`, 'i'), 75],
];
const PENDING_RE = new RegExp(`pending\\s*(?:${UNIT})?\\s*(?:balance)?\\s*(?::|of|is)?\\s*${NUM}`, 'i');
const LIFETIME_RE = new RegExp(`lifetime\\s*(?:${UNIT})?\\s*(?::|of|is)?\\s*${NUM}`, 'i');
const EXPIRE_RES: Array<[string, RegExp]> = [
  ['expiry.amount-date', new RegExp(`${NUM}\\s*${UNIT}[^.]{0,80}?(?:will\\s+)?expire[sd]?[^.]{0,30}?(?:on|by|after|:)\\s*${DATE}`, 'i')],
  ['expiry.date-amount', new RegExp(`expir(?:e|es|ing|ation)[^.]{0,30}?(?:on|by|:)\\s*${DATE}[^.]{0,80}?${NUM}\\s*${UNIT}`, 'i')],
];
const EXPIRY_DATE_ONLY = new RegExp(`(?:your\\s+)?(?:${UNIT})?\\s*(?:will\\s+)?expire[s]?\\s*(?:on|by|:)\\s*${DATE}`, 'i');
const MEMBER_DIGITS = /(?:member(?:ship)?|account|rewards?|number|#)[^0-9A-Za-z]{0,12}(?:ending in|ending|\*{2,}|x{2,}|•{2,}|\.{3})\s*([A-Z0-9]{3,6})\b/i;
const CERT_RES: Array<[string, 'FREE_NIGHT' | 'COMPANION' | 'UPGRADE', RegExp]> = [
  ['cert.free-night', 'FREE_NIGHT', /\b(free night(?: award| certificate| reward)?s?)\b/i],
  ['cert.companion', 'COMPANION', /\b(companion (?:certificate|voucher|fare|ticket|pass)s?)\b/i],
  ['cert.upgrade', 'UPGRADE', /\b((?:global|regional|systemwide|suite|confirmed)?\s*upgrade (?:award|certificate|voucher|credit)s?)\b/i],
];
const CERT_ISSUE = /\b(?:earned|received|added|issued|credited|awarded|now (?:has|have)|you have|available)\b/i;
const CAP_RE = new RegExp(`(?:valid\\s+)?(?:for\\s+)?(?:stays?\\s+)?(?:up to|worth up to|up-to)\\s*${NUM}\\s*points?`, 'i');
const CERT_EXPIRES = new RegExp(`(?:expires?|valid\\s+(?:through|until|thru)|use (?:it )?by)\\s*(?:on|:)?\\s*${DATE}`, 'i');
const CERT_COUNT = /\b(\d{1,2})\s*(?:x\s*)?(?:free night|companion|upgrade)/i;
const EARN_RE = new RegExp(`(?:you )?(?:earned|received|were credited with)\\s+${NUM}\\s*${UNIT}`, 'i');
const REDEEM_RE = new RegExp(`(?:you )?(?:redeemed|used|spent)\\s+${NUM}\\s*${UNIT}`, 'i');
const EXPIRED_RE = new RegExp(`${NUM}\\s*${UNIT}\\s*(?:have |has |were |was )?expired`, 'i');
const TRANSFER_RE = new RegExp(`(?:you )?transferred\\s+${NUM}\\s*${UNIT}`, 'i');
const STATUS_INTRO = /(?:\byour\b[^.\n]{0,50}?\b(?:status|tier|membership level|level)\b(?: is|:)?|congratulations[^.]{0,40}?(?:reached|achieved|earned|are now|have been (?:promoted|upgraded) to)|welcome to|renewed (?:your )?(?:status|tier)?\s*(?:as|at|to)?|status (?:renewed|extended)[^.]{0,20}?)/i;
const STATUS_THROUGH = new RegExp(`(?:through|until|valid through|expires?(?: on)?)\\s*${DATE}`, 'i');

const parseDate = (s: string | undefined | null): Date | null => (s ? parseOfferDate(s.replace(/\./g, '')) : null);
const snippet = (t: string, i: number, len = 160) => t.slice(Math.max(0, i - 40), i + len);

function tierIn(text: string, tiers: string[]): string | null {
  for (const t of tiers) {
    const re = new RegExp(`(?:^|[^A-Za-z0-9])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Za-z0-9]|$)`, 'i');
    if (re.test(text)) return t;
  }
  return null;
}

export type LoyaltyMailKind = 'BALANCE' | 'STATUS' | 'CERTIFICATE' | 'EXPIRY' | 'ACTIVITY' | 'SUMMARY' | 'NONE';

export interface ParsedLoyaltyText {
  program: ProgramRule | null;
  kind: LoyaltyMailKind;
  /** the member / account digits mentioned, to pick between several accounts */
  memberDigits: string | null;
  observations: ParsedObservation[];
  /** every rule that matched, for the audit trail */
  rules: string[];
  parserVersion: string;
}

/**
 * Parses one message or page capture. `program` comes from the sender's domain (email) or the member's choice
 * (extension); without a program nothing is parsed, so unrelated mail never produces observations.
 */
export function parseLoyaltyText(program: ProgramRule | null, subject: string, text: string, observedAt: Date): ParsedLoyaltyText {
  const none = (): ParsedLoyaltyText => ({ program, kind: 'NONE', memberDigits: null, observations: [], rules: [], parserVersion: LOYALTY_PARSER_VERSION });
  if (!program) return none();
  const body = `${subject}\n${text}`.replace(/ /g, ' ').slice(0, 20_000);
  const obs: ParsedObservation[] = [];
  const rules: string[] = [];
  const add = (field: string, value: unknown, rule: string, conf: number, entity: ObservationEntity = 'ACCOUNT') => {
    obs.push({ entity, field, value, rule, ruleConfidence: conf, observedAt });
    if (!rules.includes(rule)) rules.push(rule);
  };

  // balance
  for (const [rule, re, conf] of BALANCE_RES) {
    const m = re.exec(body);
    if (m) {
      add('balance', toInt(m[1]), rule, conf);
      break;
    }
  }
  const pend = PENDING_RE.exec(body);
  if (pend) add('pendingBalance', toInt(pend[1]), 'balance.pending', 70);
  const life = LIFETIME_RE.exec(body);
  if (life) add('lifetimePoints', toInt(life[1]), 'balance.lifetime', 70);

  // expiration notices
  let expiryAdded = false;
  for (const [rule, re] of EXPIRE_RES) {
    const m = re.exec(body);
    if (!m) continue;
    const [amount, dateText] = rule === 'expiry.amount-date' ? [m[1], m[2]] : [m[2], m[1]];
    const when = parseDate(dateText);
    if (when) {
      add('expiresAt', when, rule, 85);
      add('expiringPoints', toInt(amount), rule, 85);
      expiryAdded = true;
      break;
    }
  }
  if (!expiryAdded) {
    const m = EXPIRY_DATE_ONLY.exec(body);
    const when = m ? parseDate(m[1]) : null;
    if (when && !CERT_RES.some(([, , re]) => re.test(body))) add('expiresAt', when, 'expiry.date', 65);
  }

  // activity
  const act = (re: RegExp, kind: string, rule: string) => {
    const m = re.exec(body);
    if (m) add('activity', { kind, points: toInt(m[1]), occurredAt: observedAt }, rule, 75);
  };
  act(EARN_RE, 'EARN', 'activity.earn');
  act(REDEEM_RE, 'REDEEM', 'activity.redeem');
  act(EXPIRED_RE, 'EXPIRE', 'activity.expired');
  act(TRANSFER_RE, 'TRANSFER_IN', 'activity.transfer');

  // status
  if (program.tiers.length) {
    const intro = STATUS_INTRO.exec(body);
    const scope = intro ? body.slice(intro.index, intro.index + 160) : '';
    const tier = intro ? tierIn(scope, program.tiers) : null;
    if (tier) {
      add('statusLevel', tier, 'status.intro', 75);
      const through = STATUS_THROUGH.exec(body.slice(intro!.index, intro!.index + 400));
      const until = through ? parseDate(through[1]) : null;
      if (until) add('statusDeadline', until, 'status.through', 70);
      add('status', { level: tier, expiresAt: until }, 'status.intro', 75, 'STATUS');
    }
  }

  // certificates and awards
  for (const [rule, category, re] of CERT_RES) {
    const m = re.exec(body);
    if (!m) continue;
    const near = snippet(body, m.index, 320);
    if (!CERT_ISSUE.test(near) && !CERT_EXPIRES.test(near)) continue;
    const exp = CERT_EXPIRES.exec(near);
    const cap = CAP_RE.exec(near);
    const count = CERT_COUNT.exec(near);
    const value = {
      category,
      name: `${program.name.split(' ')[0]} ${m[1].replace(/\s+/g, ' ').trim()}`.replace(/\b\w/, (c) => c.toUpperCase()),
      expiresAt: exp ? parseDate(exp[1]) : null,
      pointCap: cap ? toInt(cap[1]) : null,
      quantity: count ? Math.max(1, Number(count[1])) : 1,
      conditionsText: near.replace(/\s+/g, ' ').trim().slice(0, 300),
    };
    add('certificate', value, rule, exp ? 80 : 60, 'CERTIFICATE');
    break;
  }

  const digits = MEMBER_DIGITS.exec(body);
  const hasStatus = obs.some((o) => o.entity === 'STATUS');
  const hasCert = obs.some((o) => o.entity === 'CERTIFICATE');
  const has = (f: string) => obs.some((o) => o.field === f);
  const kind: LoyaltyMailKind = hasCert ? 'CERTIFICATE' : has('expiringPoints') ? 'EXPIRY' : hasStatus ? 'STATUS' : has('activity') && has('balance') ? 'SUMMARY' : has('activity') ? 'ACTIVITY' : has('balance') ? 'BALANCE' : obs.length ? 'ACTIVITY' : 'NONE';
  return { program, kind, memberDigits: digits ? digits[1].toUpperCase() : null, observations: obs, rules, parserVersion: LOYALTY_PARSER_VERSION };
}

/** Parses a message from its sender domain. */
export function parseLoyaltyEmail(fromDomain: string, subject: string, text: string, observedAt: Date): ParsedLoyaltyText {
  return parseLoyaltyText(programForDomain(fromDomain), subject, text, observedAt);
}

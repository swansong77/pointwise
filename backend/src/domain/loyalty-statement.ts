/**
 * Loyalty program statement parser (pure). Works on the text lines the existing sandboxed PDF extractor produces
 * (see spend/ statement import) or on pasted statement text. Finds the program, the period, opening and closing
 * balance, printed totals and dated activity lines, then RECONCILES them: opening + activity must equal closing
 * (and printed totals must equal the sums), otherwise the result carries a WARNING instead of being trusted blindly.
 * Also reuses the email parser for status, expiry notices and certificates printed on the statement.
 *
 * Formats are generic and unverified against real program statements (synthetic fixtures only).
 */
import { LoyaltyMailKind, ParsedObservation, parseLoyaltyText, PROGRAM_RULES, ProgramRule } from './loyalty-email';
import { parseOfferDate } from './offer-import';

export const STATEMENT_PARSER_VERSION = 'loyalty-statement/1';

const NAMES: Array<[string, RegExp]> = [
  ['AA_AADVANTAGE', /aadvantage/i], ['UA_MILEAGEPLUS', /mileageplus/i], ['DL_SKYMILES', /skymiles/i], ['WN_RAPIDREWARDS', /rapid rewards/i],
  ['AS_MILEAGEPLAN', /mileage plan/i], ['B6_TRUEBLUE', /trueblue/i], ['AC_AEROPLAN', /aeroplan/i], ['BA_AVIOS', /executive club|avios/i],
  ['VS_FLYINGCLUB', /flying club/i], ['AF_FLYINGBLUE', /flying blue/i], ['SQ_KRISFLYER', /krisflyer/i], ['QR_PRIVILEGE', /privilege club/i],
  ['EK_SKYWARDS', /skywards/i], ['EY_GUEST', /etihad guest/i], ['HA_HAWAIIANMILES', /hawaiianmiles/i], ['MAR_BONVOY', /bonvoy/i],
  ['HH_HONORS', /hilton honors/i], ['WOH_HYATT', /world of hyatt/i], ['IHG_ONE', /ihg one rewards|ihg rewards/i], ['WYN_REWARDS', /wyndham rewards/i],
  ['CHOICE_PRIV', /choice privileges/i], ['BW_REWARDS', /best western rewards/i], ['ACCOR_ALL', /accor live limitless|all - accor/i],
  ['AMEX_MR', /membership rewards/i], ['CHASE_UR', /ultimate rewards/i], ['C1_MILES', /capital one miles/i], ['CITI_TYP', /thankyou/i],
  ['BILT_POINTS', /bilt rewards/i], ['WF_REWARDS', /wells fargo rewards/i], ['BOA_POINTS', /bank of america.{0,20}rewards/i], ['USB_REWARDS', /u\.?s\.? bank.{0,20}rewards/i],
];

export interface StatementActivity {
  occurredAt: Date;
  description: string;
  kind: 'EARN' | 'BONUS' | 'PURCHASE' | 'REDEEM' | 'EXPIRE' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'ADJUST';
  /** signed */
  points: number;
  balanceAfter: number;
}

export type StatementValidation = 'PASS' | 'WARNING' | 'FAILED';

export interface ParsedStatement {
  program: ProgramRule | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  opening: number | null;
  closing: number | null;
  totals: { earned: number | null; redeemed: number | null; expired: number | null };
  activity: StatementActivity[];
  validation: { status: StatementValidation; reasons: string[] };
  /** status, expiry and certificate observations printed on the statement */
  extras: ParsedObservation[];
  kind: LoyaltyMailKind;
  parserVersion: string;
}

const NUM = '(\\d{1,3}(?:,\\d{3})+|\\d{1,9})';
const DATE_RE = '(\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}|\\d{4}-\\d{2}-\\d{2}|[A-Z][a-z]{2,8}\\.?\\s+\\d{1,2},?\\s+\\d{4})';
const toInt = (s: string) => Number(s.replace(/,/g, ''));
const date = (s: string) => parseOfferDate(s.replace(/\./g, ''));

// a '$' between the label and the number means money (a card statement), never points
const OPENING = new RegExp(`(?:beginning|opening|previous|starting)\\s+(?:award\\s+)?(?:balance|miles|points)[^0-9$\\n]{0,20}${NUM}`, 'i');
const CLOSING = new RegExp(`(?:ending|closing|new|current)\\s+(?:award\\s+)?(?:balance|miles|points)[^0-9$\\n]{0,20}${NUM}`, 'i');
const PERIOD = new RegExp(`(?:statement\\s+)?period[:\\s]*${DATE_RE}\\s*(?:-|–|to|through)\\s*${DATE_RE}`, 'i');
const TOTAL = (word: string) => new RegExp(`total\\s+(?:miles|points)?\\s*${word}[^0-9\\n]{0,20}${NUM}`, 'i');
const LINE = new RegExp(`^${DATE_RE}\\s+(.{3,70}?)\\s+([+-]?\\s?\\d{1,3}(?:,\\d{3})*|[+-]?\\d+)\\s*(?:miles|points|pts)?\\s*$`, 'i');

function classify(desc: string, signed: number): StatementActivity['kind'] {
  if (/expire/i.test(desc)) return 'EXPIRE';
  if (/transfer/i.test(desc)) return signed < 0 ? 'TRANSFER_OUT' : 'TRANSFER_IN';
  if (/redeem|award (?:ticket|flight|stay)|redemption|reward night|ticket/i.test(desc) && signed < 0) return 'REDEEM';
  if (/bonus|promotion|welcome|offer/i.test(desc)) return signed < 0 ? 'ADJUST' : 'BONUS';
  if (/purchase of|buy|bought/i.test(desc)) return 'PURCHASE';
  if (/adjust|correction/i.test(desc)) return 'ADJUST';
  return signed < 0 ? 'REDEEM' : 'EARN';
}

export function detectProgram(text: string): ProgramRule | null {
  for (const [code, re] of NAMES) if (re.test(text)) return PROGRAM_RULES.find((r) => r.programCode === code) ?? null;
  return null;
}

/** Parses statement text; never throws. FAILED means nothing usable was found. */
export function parseLoyaltyStatement(lines: string[], fallbackDate: Date): ParsedStatement {
  const text = lines.join('\n');
  const program = detectProgram(text);
  const per = PERIOD.exec(text);
  const periodStart = per ? date(per[1]) : null;
  const periodEnd = per ? date(per[2]) : null;
  const opening = OPENING.exec(text);
  const closing = CLOSING.exec(text);
  const tot = (w: string) => {
    const m = TOTAL(w).exec(text);
    return m ? toInt(m[1]) : null;
  };
  const totals = { earned: tot('earned'), redeemed: tot('redeemed'), expired: tot('expired') };
  const open = opening ? toInt(opening[1]) : null;
  const close = closing ? toInt(closing[1]) : null;

  const activity: StatementActivity[] = [];
  let running = open ?? 0;
  for (const raw of lines) {
    const m = LINE.exec(raw.trim());
    if (!m) continue;
    const when = date(m[1]);
    if (!when) continue;
    const signed = Number(m[3].replace(/[\s,]/g, ''));
    if (!Number.isFinite(signed) || signed === 0) continue;
    const desc = m[2].trim();
    const kind = classify(desc, signed);
    // negative kinds are always stored as negative
    const points = ['REDEEM', 'EXPIRE', 'TRANSFER_OUT'].includes(kind) ? -Math.abs(signed) : kind === 'ADJUST' ? signed : Math.abs(signed);
    running = Math.max(0, running + points);
    activity.push({ occurredAt: when, description: desc, kind, points, balanceAfter: running });
  }

  const reasons: string[] = [];
  let status: StatementValidation = 'PASS';
  const warn = (r: string) => {
    status = 'WARNING';
    reasons.push(r);
  };
  if (!program) warn('The program could not be identified from the statement.');
  if (open == null && close == null && !activity.length) {
    status = 'FAILED';
    reasons.push('No balances or activity were found in this statement.');
  } else {
    if (close == null) warn('No closing balance was found, so the balance cannot be taken from this statement.');
    if (open == null) warn('No opening balance was found, so activity cannot be reconciled.');
    if (open != null && close != null && activity.length) {
      const sum = activity.reduce((s, a) => s + a.points, 0);
      if (open + sum !== close) warn(`Opening ${open.toLocaleString('en-US')} plus activity ${sum.toLocaleString('en-US')} is ${(open + sum).toLocaleString('en-US')}, not the printed closing balance ${close.toLocaleString('en-US')}; some lines may not have been read.`);
    }
    const sumOf = (k: StatementActivity['kind'][]) => activity.filter((a) => k.includes(a.kind)).reduce((s, a) => s + Math.abs(a.points), 0);
    if (totals.earned != null && activity.length && sumOf(['EARN', 'BONUS', 'PURCHASE']) !== totals.earned) warn(`Printed total earned ${totals.earned.toLocaleString('en-US')} differs from the lines read (${sumOf(['EARN', 'BONUS', 'PURCHASE']).toLocaleString('en-US')}).`);
    if (totals.redeemed != null && activity.length && sumOf(['REDEEM']) !== totals.redeemed) warn(`Printed total redeemed ${totals.redeemed.toLocaleString('en-US')} differs from the lines read (${sumOf(['REDEEM']).toLocaleString('en-US')}).`);
    if (totals.expired != null && activity.length && sumOf(['EXPIRE']) !== totals.expired) warn(`Printed total expired ${totals.expired.toLocaleString('en-US')} differs from the lines read (${sumOf(['EXPIRE']).toLocaleString('en-US')}).`);
  }

  const when = periodEnd ?? fallbackDate;
  const extras = parseLoyaltyText(program, '', text, when).observations.filter((o) => ['STATUS', 'CERTIFICATE'].includes(o.entity) || ['statusLevel', 'statusDeadline', 'expiresAt', 'expiringPoints'].includes(o.field));
  return {
    program,
    periodStart,
    periodEnd,
    opening: open,
    closing: close,
    totals,
    activity,
    validation: { status, reasons },
    extras,
    kind: status === 'FAILED' ? 'NONE' : 'SUMMARY',
    parserVersion: STATEMENT_PARSER_VERSION,
  };
}

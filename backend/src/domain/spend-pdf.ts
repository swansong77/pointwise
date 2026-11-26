/**
 * Card statement PDFs → transactions (pure; the text lines come from the sandboxed extractor in
 * spend/pdf-text.mjs). Deterministic rules only — statements are user card data and are never sent
 * to an AI provider.
 *
 * Handles the usual U.S. issuer layouts:
 *   11/02 UBER *TRIP HELP.UBER.COM CA 23.45                    (one date, amount last)
 *   11/02 11/03 UBER *TRIP 24692163 1234 $23.45                 (transaction + post date, reference / account columns)
 *   11/02/26* UBER TRIP HELP.UBER.COM CA $23.45                 (full date, pay-over-time marker)
 *   Nov 2 Nov 3 UBER* TRIP $23.45                               (month names)
 * Credits: "-$10.00", "($10.00)", "10.00 CR", "10.00-", or any line in a "Payments and credits" section.
 * Years come from the statement period / closing date (transactions after the closing month belong to
 * the previous year), else from the upload date.
 */
import { createHash } from "crypto";
import {
  classify,
  normalizeDescriptor,
  StatementParse,
  StatementRow,
} from "./spend";

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const NUM_DATE = String.raw`\d{1,2}/\d{1,2}(?:/\d{2,4})?`;
const NAME_DATE = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.? \d{1,2}(?:,? \d{4})?`;
const DATE = `(?:${NUM_DATE}|${NAME_DATE})`;
// the integer part is optional: Chase prints amounts under a dollar as ".79"
const AMOUNT = String.raw`(?:-\s?\$?|\(\$?|\$)?(?:\d{1,3}(?:,\d{3})*)?\.\d{2}\)?(?:\s?(?:CR|cr|-))?`;
const TX_LINE = new RegExp(
  `^(${DATE})\\*?\\s+(?:(${DATE})\\*?\\s+)?(.+?)\\s+(${AMOUNT})$`,
  "i",
);

/**
 * Two-column statements (Citi) print sidebar text on the same line, after the amount:
 *   01/18 SPLURGE CREDIT ==== AA Rebate MO -$200.00 6X, otherwise 3X) +672
 * Used only when the strict rule fails: the amount must carry a "$" and the text after it must
 * contain no other amount, so a description's own numbers are never mistaken for the amount.
 */
const DOLLAR_AMOUNT = String.raw`(?:-\s?\$|\(\$|\$)\d{1,3}(?:,\d{3})*\.\d{2}\)?`;
const TX_LINE_TRAILING = new RegExp(
  `^(${DATE})\\*?\\s+(?:(${DATE})\\*?\\s+)?(.+?)\\s+(${DOLLAR_AMOUNT})\\s+([^$]*)$`,
  "i",
);
const NO_DECIMAL_AMOUNT = /\d\.\d{2}/;

/** The transaction line as [date, post date, description, amount], tolerating trailing sidebar text. */
export function matchTxLine(line: string): RegExpExecArray | null {
  const strict = TX_LINE.exec(line);
  if (strict) return strict;
  const m = TX_LINE_TRAILING.exec(line);
  return m && !NO_DECIMAL_AMOUNT.test(m[5]) && !NO_DECIMAL_AMOUNT.test(m[3]) ? m : null;
}

const SKIP_DESC =
  /^(new balance|previous balance|payment due|minimum payment|total|statement (closing|period)|opening\/closing|closing date|credit limit|available credit|cash advance limit|interest charge calculation|annual percentage|balance (subject|transfer))/i;
const CREDIT_SECTION =
  /^(?:(?:payments?(?:,| and)? (?:other )?credits|payments? and credits|other credits|returns? and credits|payments, credits and adjustments)\b|(?:credits|payments)(?:\s+amount)?\s*$)/i;
const DEBIT_SECTION =
  /^(standard purchases?|purchases?|purchases? and adjustments|new charges|transactions|fees( charged)?|interest charged|purchase activity|charges|other charges)\b/i;

/** A section heading is a short line; legal text that merely starts with "Payments:" or "Credits" is not one. */
const STRONG_HEADING =
  /^(standard purchases?|payments, credits and adjustments|payments and other credits|payments and credits|purchases and adjustments|new charges)\b/i;
const isHeading = (line: string, re: RegExp) =>
  re.test(line) &&
  !matchTxLine(line) &&
  ((line.length <= 48 && line.split(/\s+/).length <= 7 && !/[.:]\s/.test(line)) ||
    // two-column pages append sidebar text to a real heading: "Standard Purchases changes may affect…"
    (STRONG_HEADING.test(line) && !/\$\s?\d/.test(line)));

export interface PdfPeriod {
  start: Date | null;
  end: Date | null;
}

const utc = (y: number, m: number, d: number) => {
  const x = new Date(Date.UTC(y, m, d));
  return x.getUTCMonth() === m && x.getUTCDate() === d ? x : null;
};
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/** "11/14/26", "11/14/2026", "Nov 14, 2026", "November 14 2026" → Date */
export function parseFullDate(s: string): Date | null {
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s.trim());
  if (m) return utc(fullYear(+m[3]), +m[1] - 1, +m[2]);
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s.trim());
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    return mi >= 0 ? utc(+m[3], mi, +m[2]) : null;
  }
  return null;
}

const FULL = String.raw`(\d{1,2}/\d{1,2}/\d{2,4}|[a-z]{3,9}\.? \d{1,2},? \d{4})`;

/** Statement period / closing date from the first pages. */
export function findPeriod(lines: string[]): PdfPeriod {
  const text = lines.slice(0, 200).join("\n");
  const range = new RegExp(
    `(?:opening\\/closing date|statement period|billing period|billing cycle|account period)[:\\s]*${FULL}\\s*(?:-|–|to|through|thru)\\s*${FULL}`,
    "i",
  ).exec(text);
  if (range)
    return { start: parseFullDate(range[1]), end: parseFullDate(range[2]) };
  const closing = new RegExp(
    `(?:closing date|statement closing date|statement date|closing date of billing cycle)[:\\s]*${FULL}`,
    "i",
  ).exec(text);
  if (closing) return { start: null, end: parseFullDate(closing[1]) };
  return { start: null, end: null };
}

/** A transaction date: full dates as written; "MM/DD" / "Nov 2" get the year of the statement period. */
export function resolveDate(
  raw: string,
  period: PdfPeriod,
  now: Date,
): Date | null {
  const s = raw.trim().replace(/\*$/, "");
  const full = parseFullDate(s);
  if (full) return full;
  let month: number;
  let day: number;
  const m = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) {
    month = +m[1] - 1;
    day = +m[2];
  } else {
    const n = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})$/i.exec(s);
    if (!n || MONTHS.indexOf(n[1].toLowerCase()) < 0) return null;
    month = MONTHS.indexOf(n[1].toLowerCase());
    day = +n[2];
  }
  const ref = period.end ?? now;
  // a December purchase on a January statement belongs to the previous year
  const year = ref.getUTCFullYear() - (month > ref.getUTCMonth() ? 1 : 0);
  return utc(year, month, day);
}

/** "$1,234.56" / "-$10.00" / "($10.00)" / "10.00 CR" / "10.00-" → signed cents (credits negative). */
export function parseAmountToken(s: string): number | null {
  const t = s.trim();
  const credit = /^-|^\(|\)$|\s?(cr|-)$/i.test(t);
  const digits = t.replace(/[^0-9.]/g, "");
  if (!/^\d*\.\d{2}$/.test(digits)) return null;
  const cents = Math.round(Number(digits) * 100);
  return credit ? -cents : cents;
}

/** Reference numbers, account-number columns and long digit runs are not part of the description. */
export function cleanDescription(desc: string): string {
  return desc
    .replace(/\s+\d{4}$/, "") // account last-4 column
    .replace(/\s+(?=[A-Z0-9]*\d)[A-Z0-9]{10,}$/, "") // reference number column
    .replace(/\d{8,}/g, "…") // never keep long numbers (card / account / reference)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

const JOIN_STOP = /^(total|totals|new balance|previous balance|\d{4} totals|year-to-date|interest|fees?\b|payment due|minimum payment)/i;
const DOLLAR_THEN_TEXT = /\$\d[\d,]*\.\d{2}\s+[^$]*$/;
const LEADING_NUMBER = /^\d{4,10}?\s*(?=(?:0[1-9]|1[0-2])\/\d{2}\s+(?:0[1-9]|1[0-2])\/\d{2}\s)|^\d{4,10}\s+(?=\d{1,2}\/\d{1,2}\s)/;
const TRAILING_MARK = /\s*[⧫◆♦◊†‡]+\s*$/;
const STARTS_WITH_DATE = new RegExp(`^(${DATE})\\*?\\s`, "i");
const ENDS_WITH_AMOUNT = new RegExp(`(?:^|\\s)(${AMOUNT})$`, "i");

/**
 * Statements that print a transaction over two or three lines (date + merchant, then city, then the
 * amount) become one line each. Only joins a dated line that lacks an amount with the following
 * undated lines up to the first one that ends in an amount.
 */
export function joinSplitLines(raw: string[]): string[] {
  // Amex marks Pay Over Time activity with a trailing diamond (⧫) after the amount; it is not part of the line
  // two-column layouts can put a sidebar number before the date ("963700 12/22 12/24 SHOP … $44.76")
  const lines = raw.map((l) => l.replace(TRAILING_MARK, "").replace(LEADING_NUMBER, ""));
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (
      STARTS_WITH_DATE.test(line) &&
      !ENDS_WITH_AMOUNT.test(line) &&
      !matchTxLine(line) &&
      !CREDIT_SECTION.test(line)
    ) {
      let joined = line;
      let ok = false;
      for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
        const next = lines[j].trim();
        // a joined line never runs into a summary / totals line, or a foreign-currency note
        if (!next || STARTS_WITH_DATE.test(next) || next.length > 70 || JOIN_STOP.test(next)) break;
        joined += ` ${next}`;
        if (ENDS_WITH_AMOUNT.test(next) || DOLLAR_THEN_TEXT.test(next)) {
          ok = true;
          i = j;
          break;
        }
      }
      if (ok) {
        out.push(joined);
        continue;
      }
    }
    out.push(lines[i]);
  }
  return out;
}

export interface StatementScan {
  /** dated lines that carry an amount (anywhere on the line) */
  count: number;
  /** sum of their absolute amounts, in cents */
  cents: number;
}

const LOOSE_AMOUNT = new RegExp(AMOUNT, "gi");

/**
 * Independent, deliberately looser count of the transactions printed on the statement: every dated
 * line (after joining split lines) with a money amount anywhere on it, minus summary lines. The
 * strict parser is compared against this to find transactions it failed to read.
 */
export function scanStatementPdf(pages: string[][]): StatementScan {
  let count = 0;
  let cents = 0;
  for (const page of pages) {
    for (const line of joinSplitLines(page)) {
      const t = line.trim();
      const m = STARTS_WITH_DATE.exec(t);
      if (!m) continue;
      const amounts = t.slice(m[0].length).match(LOOSE_AMOUNT);
      if (!amounts) continue;
      const rest = t.slice(m[0].length).replace(/^(\S+\s+)?/, "");
      if (SKIP_DESC.test(rest.trim()) || SKIP_DESC.test(t.slice(m[0].length).trim())) continue;
      const v = parseAmountToken(amounts[amounts.length - 1]);
      if (v == null || v === 0) continue;
      count++;
      cents += Math.abs(v);
    }
  }
  return { count, cents };
}

export interface PrintedTotals {
  /** every total the statement could mean by "money in" (payments, credits, both) in cents, plus 0 */
  credits: number[];
  /** every total it could mean by "money out" (charges, fees, interest, cash advances in any combination) */
  charges: number[];
}

const PRINTED_AMT = String.raw`\s*[-+]?\s?\$([\d,]*\.\d{2})`;
const sumsOf = (lists: number[][]) => lists.reduce((acc, x) => acc.flatMap((s) => x.map((y) => s + y)), [0]);

/**
 * The totals a statement prints in its account summary ("Payments", "Credits", "Purchases", "New Charges",
 * "Fees", "Interest"…). They are an independent check on the rows read from the transaction list: a
 * statement is explained when the rows' credits and charges each equal some combination of printed totals.
 * Null when the statement prints no recognisable summary.
 */
export function printedTotals(pages: string[][]): PrintedTotals | null {
  const txt = pages.flat().slice(0, 170).join("\n");
  const val = (label: string) => [...new Set([...txt.matchAll(new RegExp(label + PRINTED_AMT, "gi"))].map((m) => Math.round(Number(m[1].replace(/,/g, "")) * 100)))];
  const both = val("(?:payments?[,/]? ?(?:and )?(?:other )?credits?|total payments and credits)");
  const pay = val("\\bpayments(?: for this period)?(?: N/A)?");
  const cred = val("\\bcredits(?: for this period)?(?: N/A)?");
  const chg = val("(?:\\bnew charges|\\bpurchases|\\bnew pay over time charges|total new charges)");
  if (!both.length && !pay.length && !chg.length) return null;
  const fee = val("\\bfees(?: charged)?");
  const int = val("\\binterest(?: charged)?");
  const cash = val("(?:cash advances|balance transfers)");
  return {
    credits: [...new Set([0, ...both, ...pay, ...cred, ...sumsOf([[0, ...pay], [0, ...cred]])])],
    charges: [...new Set(sumsOf([[0, ...chg], [0, ...fee], [0, ...int], [0, ...cash]]))],
  };
}

/**
 * A statement for a period with nothing on it: new balance $0.00 and no previous balance carried,
 * shown by the account summary. Used so an empty month is recorded as covered instead of failing.
 */
export function showsNoActivity(pages: string[][]): boolean {
  const head = pages.flat().slice(0, 80).join("\n");
  const zeroBalance =
    /(?:new|statement) balance[^\n$]{0,40}\$\s?0\.00/i.test(head) ||
    /no transaction activity/i.test(pages.flat().join("\n"));
  const nothingBefore = !/previous balance[^\n$]{0,12}\$\s?(?!0\.00)\d/i.test(head);
  if (zeroBalance && nothingBefore) return true;
  // a balance may be carried in (e.g. a credit balance) while the period itself had no payments, credits or charges
  const t = printedTotals(pages);
  return !!t && t.credits.every((c) => c === 0) && t.charges.every((c) => c === 0);
}

/** A letter or notice that carries the statement's header but no statement ("important notice regarding the account…"). */
export function looksLikeNotice(pages: string[][]): boolean {
  const text = pages.flat().join("\n");
  return /important notice regarding the account|end of important notices/i.test(text) && !/new balance|previous balance/i.test(text);
}

/** Parses the text lines of a statement PDF (one array per page). */
export function parseStatementPdf(
  pages: string[][],
  walletCardId: string,
  now = new Date(),
): StatementParse & { period: PdfPeriod } {
  pages = pages.map(joinSplitLines);
  const all = pages.flat();
  const period = findPeriod(all);
  const rows: StatementRow[] = [];
  const errors: StatementParse["errors"] = [];
  const seen = new Map<string, number>();
  let section: "credit" | "debit" | null = null;
  let lineNo = 0;
  for (const page of pages) {
    for (const raw of page) {
      lineNo++;
      const line = raw.trim();
      if (!line) continue;
      if (isHeading(line, CREDIT_SECTION)) {
        section = "credit";
        continue;
      }
      if (isHeading(line, DEBIT_SECTION)) {
        section = "debit";
        continue;
      }
      const m = matchTxLine(line);
      if (!m) continue;
      const desc = cleanDescription(m[3]);
      if (!desc || SKIP_DESC.test(desc) || /^\$?[\d,.]+$/.test(desc)) continue;
      const date = resolveDate(m[1], period, now);
      const value = parseAmountToken(m[4]);
      if (value === 0) continue; // a $0.00 line (e.g. a waived membership fee) is not a transaction
      if (!date || value == null) {
        errors.push({
          line: lineNo,
          message: `could not read "${line.slice(0, 60)}"`,
        });
        continue;
      }
      // in a payments/credits section every amount is a credit, however it is printed
      const signed = section === "credit" ? -Math.abs(value) : value;
      const base = `${walletCardId}|${date.toISOString().slice(0, 10)}|${signed}|${normalizeDescriptor(desc)}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      rows.push({
        occurredAt: date,
        description: desc,
        signedCents: signed,
        kind: classify(desc, signed),
        amountCents: Math.abs(signed),
        bankCategory: null,
        externalId: `pdf:${createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 40)}`,
      });
    }
  }
  return {
    rows,
    errors,
    columns: {
      date: "statement date",
      description: "description",
      amount: "amount",
      category: null,
    },
    purchasesAre: "positive",
    period,
  };
}

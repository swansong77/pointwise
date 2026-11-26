/**
 * Credit reports from the three bureaus — Experian, Equifax, TransUnion — whether downloaded from
 * annualcreditreport.com / the bureau's own site or viewed on Credit Karma (TransUnion, Equifax) →
 * card tradelines (pure, deterministic; credit report data is never sent to an AI provider).
 *
 * None of these offer an API for consumers, and automated access is not allowed, so the user
 * downloads / prints the report to PDF (or copies its text); this module reads the text lines.
 * Reports from several bureaus are merged per account (mergeReports).
 *
 * Accepted shapes (labels are matched case-insensitively; the value may follow on the same line —
 * after ":" or 2+ spaces — or on the next line):
 *   CAPITAL ONE                       ← creditor heading (line before the first field)
 * (a value may also follow its label after a single space — PDF text extraction joins cells that way)
 *   Account type      Credit card     ← or "Revolving", "Charge card"
 *   Date opened       03/15/2019      ← or "Mar 15, 2019", "Mar 2019", "03/2019"
 *   Account status    Open / Closed / Paid, closed
 *   Date closed       …
 *   Account number    ****1234 / XXXXXXXXXXXX1234
 *   Responsibility    Individual / Authorized user / Joint
 *   Credit limit      $5,000
 * and summary rows: "CAPITAL ONE  03/15/2019  Open  $5,000".
 * Bureau specifics: TransUnion prints the creditor with a masked number ("JPMCB CARD #426684******")
 * and both "Account Type" (Revolving) and "Loan Type" (Credit Card), plus "Pay Status"; Equifax uses
 * "Owner"/"Account Status"/"Loan Type"; Experian "Responsibility"/"Status". Masks that show the FIRST
 * digits ("426684XXXXXX") are not last digits and are ignored. Other fields (balance, payment history,
 * date reported …) are recognised and ignored so they never split an account.
 */
import { parseOpenDate } from "./import";

export type Precision = "DAY" | "MONTH";

export type BureauName = "TRANSUNION" | "EQUIFAX" | "EXPERIAN" | "OTHER";

export interface Tradeline {
  creditorName: string;
  issuer: string | null;
  accountType: string | null;
  openedOn: Date;
  precision: Precision;
  status: "OPEN" | "CLOSED";
  closedOn: Date | null;
  lastDigits: string | null;
  creditLimitCents: number | null;
  isAuthorizedUser: boolean;
  /** bureaus that reported the account (merged reports) */
  bureaus?: BureauName[];
  /** open date per bureau when they disagree on the month */
  dateConflict?: Partial<Record<BureauName, string>> | null;
}

export interface ReportParse {
  bureau: BureauName;
  /** who produced the file: Credit Karma or the bureau / annualcreditreport.com */
  provider: "CREDIT_KARMA" | "BUREAU";
  accounts: Tradeline[];
  skipped: Array<{ creditorName: string; reason: string }>;
}

/** Bureau creditor names → card issuer (as named in the catalog). */
const CREDITORS: Array<[RegExp, string]> = [
  [/\b(jpmcb|chase|jp ?morgan)\b/i, "Chase"],
  [/\b(amex|american express|amer ?exp)\b/i, "American Express"],
  [/\b(citi|citibank|cbna|citicards)\b/i, "Citi"],
  [/\b(capital one|cap one|capone)\b/i, "Capital One"],
  [/\b(discover|discovercard|dfs)\b/i, "Discover"],
  [/\b(bk of amer|bank of america|boa|bofa)\b/i, "Bank of America"],
  [/\b(wells fargo|wf crd|wfbna|wf bank)\b/i, "Wells Fargo"],
  [/\b(us bank|usbank|u\.s\. bank|us bk)\b/i, "U.S. Bank"],
  [/\b(barclays|brclysbankde|barclaycard)\b/i, "Barclays"],
  [/\b(syncb|synchrony)\b/i, "Synchrony"],
  [/\b(gs bank|goldman|apple card)\b/i, "Goldman Sachs"],
  [/\b(comenity|comenitybank|bread)\b/i, "Comenity"],
  [/\b(td bank|tdbank|td rcs)\b/i, "TD Bank"],
  [/\b(navy ?fcu|navy federal)\b/i, "Navy Federal"],
  [/\b(penfed|pentagon fcu)\b/i, "PenFed"],
  [/\b(fnbo|first national bank of omaha)\b/i, "FNBO"],
  [/\b(elan|elan financial)\b/i, "Elan"],
];

export function issuerFor(creditor: string): string | null {
  for (const [re, name] of CREDITORS) if (re.test(creditor)) return name;
  return null;
}

type Key =
  | "name"
  | "type"
  | "loanType"
  | "opened"
  | "status"
  | "payStatus"
  | "remarks"
  | "closed"
  | "number"
  | "responsibility"
  | "limit"
  | "ignore";
const KEYS: Array<[Key, RegExp]> = [
  [
    "name",
    /^(account name|creditor|creditor name|lender|company|company name|furnisher)$/i,
  ],
  [
    "type",
    /^(account type|type|type of account|account category|classification)$/i,
  ],
  ["loanType", /^(loan type|kind of account|account kind|credit type)$/i],
  ["opened", /^(date opened|opened|open date|opened on|date open)$/i],
  [
    "status",
    /^(account status|status|current status|condition|account condition)$/i,
  ],
  ["payStatus", /^(pay status|payment status|payment rating|account rating)$/i],
  ["remarks", /^(remarks|remark|comments?|narrative|additional information)$/i],
  ["closed", /^(date closed|closed|closed date|closed on)$/i],
  ["number", /^(account number|account #|acct #|account no\.?|account)$/i],
  [
    "responsibility",
    /^(responsibility|ownership|account designator|borrower|account owner|owner)$/i,
  ],
  [
    "limit",
    /^(credit limit|limit|high credit|credit line|credit limit \/ high credit)$/i,
  ],
  [
    "ignore",
    /^(date reported|date updated|last reported|reported|balance|current balance|recent balance|high balance|highest balance|original amount|monthly payment|scheduled payment|recent payment|last payment|last payment made|date of last payment|payment received|date of last activity|last activity|terms|term duration|past due|amount past due|payment history|months reviewed|estimated month and year this item will be removed|on record until|removal date|date first delinquent|dispute status|creditor classification|activity designator|address|phone|phone number|credit usage|balance updated|paid off|date paid)$/i,
  ],
];
const LABELS = KEYS.map(([, re]) => re.source.slice(2, -2).split("|")).flat();
const LABEL_RE = new RegExp(
  `^(${LABELS.sort((a, b) => b.length - a.length).join("|")})(?:\\s*:\\s*|\\s+|\\s*$)(.*)$`,
  "i",
);

const keyOf = (label: string): Key | null =>
  KEYS.find(([, re]) => re.test(label.trim()))?.[0] ?? null;

const REVOLVING =
  /credit card|revolving|charge card|charge account|flexible spending/i;
const NOT_CARD =
  /mortgage|auto|vehicle|student|installment|personal loan|home equity|heloc|lease|collection|medical|utility|line of credit/i;
const SECTION =
  /^(accounts?|open accounts|closed accounts|credit cards?|revolving accounts|installment accounts|loans|mortgages?|other|other accounts|account details|account information|account history|summary|credit report|personal information|inquiries|hard inquiries|soft inquiries|public records|collections|transunion|equifax|experian|page \d+.*|\d+ of \d+|adverse accounts|satisfactory accounts|accounts in good standing|potentially negative items|positive accounts)$/i;

function cents(v: string): number | null {
  const m = /\$?\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.\d{2})?/.exec(v);
  return m ? Number(m[1].replace(/,/g, "")) * 100 : null;
}

function date(v: string): { date: Date; precision: Precision } | null {
  const s = v.trim().replace(/\s+/g, " ");
  // "Mar 15, 2019"
  const long = /^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/i.exec(s);
  if (long) {
    const mo = [
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
    ].indexOf(long[1].toLowerCase());
    if (mo >= 0) {
      const d = new Date(Date.UTC(+long[3], mo, +long[2]));
      if (d.getUTCDate() === +long[2]) return { date: d, precision: "DAY" };
    }
  }
  const p = parseOpenDate(s);
  return p ? { date: p.date, precision: p.precision } : null;
}

/** Creditor headings: bureau creditor names are printed in capitals ("JPMCB CARD", "SYNCB/AMAZON"). */
const looksLikeName = (l: string) => {
  if (
    !/[a-z]{2}/i.test(l) ||
    l.length > 60 ||
    LABEL_RE.test(l) ||
    SECTION.test(l) ||
    /^\$|^\d|^(yes|no|n\/a|open|closed|individual|joint|current|revolving|credit card)$/i.test(
      l,
    ) ||
    /\d{1,2}\/\d{1,2}|\$\s?\d|:/.test(l)
  )
    return false;
  const letters = l.replace(/[^a-z]/gi, "");
  return letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.6;
};

/** Parses the text lines of a printed / copied credit report. */
export function parseCreditReport(
  lines: string[],
  now = new Date(),
): ReportParse {
  const text = lines.join("\n");
  // the bureau named most often (reports mention the others in their disclosures)
  const counts = (["TRANSUNION", "EQUIFAX", "EXPERIAN"] as const).map(
    (b) =>
      [
        b,
        (
          text.match(
            new RegExp(
              b === "TRANSUNION" ? "transunion" : b.toLowerCase(),
              "gi",
            ),
          ) ?? []
        ).length,
      ] as const,
  );
  const top = counts.sort((a, b) => b[1] - a[1])[0];
  const bureau: BureauName = top[1] > 0 ? top[0] : "OTHER";
  const provider = /credit karma/i.test(text) ? "CREDIT_KARMA" : "BUREAU";
  const clean = lines.map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  type Rec = Partial<Record<Key, string>> & { heading?: string };
  const recs: Rec[] = [];
  let cur: Rec | null = null;
  let lastName: string | null = null;

  for (let i = 0; i < clean.length; i++) {
    const line = clean[i];
    // summary row: NAME  date  Open|Closed  [$limit]
    const row =
      /^([A-Z0-9][A-Z0-9 &/.,'*-]{2,50}?)\s+(\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\/\d{4}|[A-Z][a-z]{2} \d{4})\s+(Open|Closed|Paid,? closed)\b\s*(\$[\d,]+)?/i.exec(
        line,
      );
    if (row && !LABEL_RE.test(line)) {
      recs.push({
        heading: row[1].trim(),
        opened: row[2],
        status: row[3],
        ...(row[4] && { limit: row[4] }),
      });
      cur = null;
      lastName = null;
      continue;
    }
    if (SECTION.test(line)) continue;
    const m = LABEL_RE.exec(line);
    const key = m ? keyOf(m[1]) : null;
    if (!m || !key) {
      if (looksLikeName(line)) lastName = line;
      continue;
    }
    // ignored fields never take the next line: it may be a grid (payment history) or the next creditor
    if (key === "ignore") continue;
    let value = m[2].trim();
    if (!value && i + 1 < clean.length && !LABEL_RE.test(clean[i + 1]))
      value = clean[++i];
    // a new creditor heading, or a field we already have, starts the next account
    if (
      !cur ||
      lastName !== null ||
      cur[key] !== undefined ||
      (key === "name" && cur.name)
    ) {
      cur = { heading: lastName ?? undefined };
      recs.push(cur);
      lastName = null;
    }
    cur[key] = value;
  }

  const accounts: Tradeline[] = [];
  const skipped: ReportParse["skipped"] = [];
  const seen = new Set<string>();
  for (const r of recs) {
    // TransUnion headings carry the masked account number: "JPMCB CARD #426684******"
    const rawName = (r.name || r.heading || "").replace(/\s+/g, " ").trim();
    const hash = /^(.*?)\s*#\s*(\S+)$/.exec(rawName);
    const creditorName = (hash ? hash[1] : rawName).slice(0, 80);
    const number = r.number ?? hash?.[2] ?? null;
    if (!creditorName || !r.opened) {
      if (creditorName) skipped.push({ creditorName, reason: "no open date" });
      continue;
    }
    const type = [r.loanType, r.type].filter(Boolean).join(" / ") || null;
    if (type && NOT_CARD.test(type) && !REVOLVING.test(type)) {
      skipped.push({ creditorName, reason: `not a credit card (${type})` });
      continue;
    }
    if (!type && !r.limit && !issuerFor(creditorName)) {
      skipped.push({ creditorName, reason: "account type unknown" });
      continue;
    }
    const opened = date(r.opened);
    if (!opened || opened.date.getTime() > now.getTime()) {
      skipped.push({
        creditorName,
        reason: `unreadable open date "${r.opened}"`,
      });
      continue;
    }
    const closed = r.closed ? date(r.closed) : null;
    // last digits only when the number ENDS with them ("XXXX1234"); "426684XXXXXX" shows the first digits
    const digits = number
      ? (/(?:^|[^\d])(\d{4,5})$/.exec(number.replace(/\s+/g, ""))?.[1] ?? null)
      : null;
    const key = `${creditorName.toLowerCase()}|${opened.date.toISOString().slice(0, 7)}|${digits ?? ""}`;
    if (seen.has(key)) continue; // the same account listed twice (summary + details)
    seen.add(key);
    accounts.push({
      creditorName,
      issuer: issuerFor(creditorName),
      accountType: type,
      openedOn: opened.date,
      precision: opened.precision,
      status:
        closed ||
        /closed|paid/i.test(r.status ?? "") ||
        /closed/i.test(`${r.payStatus ?? ""} ${r.remarks ?? ""}`)
          ? "CLOSED"
          : "OPEN",
      closedOn: closed?.date ?? null,
      lastDigits: digits,
      creditLimitCents: r.limit ? cents(r.limit) : null,
      isAuthorizedUser: /authori[sz]ed/i.test(r.responsibility ?? ""),
    });
  }
  return { bureau, provider, accounts, skipped };
}

const DAY_MS = 86_400_000;
const nameKey = (t: Tradeline) =>
  t.issuer ??
  t.creditorName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * One list of card accounts from several reports: the same account (same issuer — or creditor name
 * when the issuer is unknown —, open dates within 45 days, last digits compatible) reported by
 * several bureaus becomes one entry. The most precise and earliest open date wins; bureaus that
 * disagree on the month are listed in dateConflict. Closed if any bureau says closed.
 */
export function mergeReports(reports: ReportParse[]): {
  accounts: Tradeline[];
  skipped: ReportParse["skipped"];
  bureaus: BureauName[];
} {
  const merged: Array<
    Tradeline & { _dates: Partial<Record<BureauName, Date>> }
  > = [];
  for (const r of reports) {
    for (const t of r.accounts) {
      const hit = merged.find(
        (m) =>
          nameKey(m) === nameKey(t) &&
          Math.abs(m.openedOn.getTime() - t.openedOn.getTime()) <=
            45 * DAY_MS &&
          (!m.lastDigits ||
            !t.lastDigits ||
            m.lastDigits.slice(-4) === t.lastDigits.slice(-4)) &&
          !m.bureaus!.includes(r.bureau),
      );
      if (!hit) {
        merged.push({
          ...t,
          bureaus: [r.bureau],
          dateConflict: null,
          _dates: { [r.bureau]: t.openedOn },
        });
        continue;
      }
      hit.bureaus!.push(r.bureau);
      hit._dates[r.bureau] = t.openedOn;
      const better =
        (t.precision === "DAY" && hit.precision === "MONTH") ||
        (t.precision === hit.precision && t.openedOn < hit.openedOn);
      if (better) {
        hit.openedOn = t.openedOn;
        hit.precision = t.precision;
      }
      hit.lastDigits ??= t.lastDigits;
      hit.issuer ??= t.issuer;
      hit.accountType ??= t.accountType;
      hit.creditLimitCents =
        Math.max(hit.creditLimitCents ?? 0, t.creditLimitCents ?? 0) || null;
      hit.isAuthorizedUser ||= t.isAuthorizedUser;
      if (t.status === "CLOSED") {
        hit.status = "CLOSED";
        hit.closedOn ??= t.closedOn;
      }
    }
  }
  const skipped = reports
    .flatMap((r) => r.skipped)
    .filter(
      (s, i, all) =>
        all.findIndex(
          (x) => x.creditorName === s.creditorName && x.reason === s.reason,
        ) === i,
    );
  return {
    bureaus: [...new Set(reports.map((r) => r.bureau))],
    skipped,
    accounts: merged.map(({ _dates, ...t }) => {
      const months = new Set(
        Object.values(_dates).map((d) => d!.toISOString().slice(0, 7)),
      );
      return {
        ...t,
        dateConflict:
          months.size > 1
            ? Object.fromEntries(
                Object.entries(_dates).map(([b, d]) => [
                  b,
                  d!.toISOString().slice(0, 10),
                ]),
              )
            : null,
      };
    }),
  };
}

/**
 * Spend tracking and automatic benefit tracking — pure helpers (no I/O).
 *
 * Transactions arrive from bank sync, statement CSV files or manual entry. Each is classified
 * (purchase / statement credit / refund / payment / fee), categorised, and matched against the card's
 * tracked benefits by rules (merchant keywords, categories, credit descriptors). Rules are suggested
 * from the benefit's name and category and can be edited per benefit. Deterministic — no AI.
 */
import { ISSUER_CREDIT_RES } from "./benefit-aliases";
import { createHash } from "crypto";
import { Cell, parseCsv, parseMoney, parseOpenDate } from "./import";

export type TxKind = "PURCHASE" | "CREDIT" | "REFUND" | "PAYMENT" | "FEE";

// ───────────── descriptors ─────────────

/** "UBER   *TRIP HELP.UBER.COM CA 1234567" → "uber trip help uber com ca" */
export function normalizeDescriptor(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\b(sq|tst|pp|paypal|sp|dd|py)\s*\*/g, " ") // payment-processor prefixes (Square, Toast, PayPal, Shopify…)
    .replace(/\d{4,}/g, " ") // store / reference numbers
    .replace(/[^a-z0-9&+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PAYMENT_RE =
  /\b(payment|autopay|auto pay|thank you|pymt|online transfer|ach credit)\b/;
const CREDIT_RE =
  /\b(credit|cash back|cashback|reward|rewards|statement credit|reimburs\w*|rebate|bonus|offer|uber cash)\b/;
const FEE_RE =
  /\b((annual )?membership fee|annual fee|late fee|interest charge|finance charge|foreign transaction fee|returned payment fee|cash advance fee)\b/;

/**
 * Kind from the signed amount (positive = money spent) and the descriptor. Credits to the account
 * are payments, issuer statement credits, or refunds.
 */
export function classify(description: string, signedCents: number): TxKind {
  const d = normalizeDescriptor(description);
  if (signedCents < 0) {
    if (PAYMENT_RE.test(d)) return "PAYMENT";
    if (CREDIT_RE.test(d)) return "CREDIT";
    // issuer credits printed without the word "credit" ("SAKS FIFTH AVENUE CR", "AIRLINE FEE REIMB")
    if (ISSUER_CREDIT_RES.some((re) => re.test(d))) return "CREDIT";
    return "REFUND";
  }
  if (FEE_RE.test(d)) return "FEE";
  return "PURCHASE";
}

// ───────────── categories ─────────────

/** Bank category labels (statement CSVs, Plaid personal_finance_category) → PointWise category slug. */
const CATEGORY_MAP: Array<[RegExp, string]> = [
  [
    /ride ?share|taxi|uber|lyft|transit|parking|tolls|public transport|transportation_taxis/i,
    "transit",
  ],
  [/airline|flight|air travel|travel_flights/i, "airlines"],
  [/hotel|lodging|motel|travel_lodging/i, "hotels"],
  [/car rental|rental car|travel_rental_cars/i, "car-rental"],
  [
    /restaurant|dining|food ?& ?drink|fast food|coffee|bar|food_and_drink_(restaurant|fast_food|coffee|beer)/i,
    "dining",
  ],
  [/grocer|supermarket|food_and_drink_groceries/i, "groceries"],
  [/gas|fuel|ev charging|transportation_gas/i, "gas"],
  [/warehouse|wholesale club/i, "wholesale-clubs"],
  [/pharmac|drugstore|medical_pharmacies/i, "drugstores"],
  [/stream|tv and movies|entertainment_tv|music/i, "streaming"],
  [/entertainment|recreation|event|movie|concert/i, "entertainment"],
  [/home improvement|hardware|home_improvement/i, "home-improvement"],
  [
    /phone|internet|cable|telecom|utilities_(internet|telephone)/i,
    "phone-internet",
  ],
  [/online|e-?commerce|general_merchandise_online/i, "online-shopping"],
  [/travel/i, "travel"],
];

export function mapBankCategory(
  label: string | null | undefined,
): string | null {
  if (!label) return null;
  for (const [re, slug] of CATEGORY_MAP) if (re.test(label)) return slug;
  return null;
}

// ───────────── statement CSV ─────────────

export interface StatementRow {
  occurredAt: Date;
  description: string;
  /** positive = purchase / fee; negative = payment / credit / refund */
  signedCents: number;
  kind: TxKind;
  amountCents: number;
  bankCategory: string | null;
  /** stable dedupe key: same statement imported twice → same keys */
  externalId: string;
}

export interface StatementParse {
  rows: StatementRow[];
  errors: Array<{ line: number; message: string }>;
  columns: {
    date: string;
    description: string;
    amount: string;
    category: string | null;
  };
  purchasesAre: "positive" | "negative";
}

const H = {
  date: /^(transaction date|trans\.? date|date|posted date|post date|posting date)$/i,
  description:
    /^(description|merchant|payee|name|details|transaction description|memo)$/i,
  amount: /^(amount|transaction amount|amount \(usd\)|amt)$/i,
  debit: /^(debit|charges?|withdrawals?)$/i,
  credit: /^(credit|credits|payments?|deposits?)$/i,
  category:
    /^(category|type of spend|merchant category|transaction category)$/i,
};

const cellText = (c: Cell) =>
  c instanceof Date
    ? c.toISOString().slice(0, 10)
    : c == null
      ? ""
      : String(c).trim();

/**
 * Parses a card statement export (Chase, Amex, Citi, Capital One, Discover, …). Finds the header row,
 * the date/description/amount(or debit+credit)/category columns, and the sign convention: purchases
 * are positive or negative depending on the bank; payments always move the other way.
 */
export function parseStatement(
  text: string,
  walletCardId: string,
  opts: { purchasesAre?: "positive" | "negative"; maxRows?: number } = {},
): StatementParse {
  const grid = parseCsv(text, (opts.maxRows ?? 5000) + 20);
  const headerIdx = grid.findIndex(
    (r) =>
      r.some((c) => H.date.test(cellText(c))) &&
      r.some((c) => H.description.test(cellText(c))),
  );
  if (headerIdx < 0)
    throw new StatementError(
      "No header row with a date and a description column was found",
    );
  const header = grid[headerIdx].map(cellText);
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const iDate = col(H.date);
  const iDesc = col(H.description);
  const iAmount = col(H.amount);
  const iDebit = col(H.debit);
  const iCredit = col(H.credit);
  const iCat = col(H.category);
  if (iAmount < 0 && (iDebit < 0 || iCredit < 0))
    throw new StatementError(
      "No amount column (or debit + credit columns) was found",
    );

  const raw: Array<{
    line: number;
    date: Date;
    desc: string;
    value: number;
    cat: string | null;
  }> = [];
  const errors: StatementParse["errors"] = [];
  for (
    let i = headerIdx + 1;
    i < grid.length && raw.length < (opts.maxRows ?? 5000);
    i++
  ) {
    const r = grid[i];
    if (!r || r.every((c) => cellText(c) === "")) continue;
    const date = parseOpenDate(r[iDate] ?? null);
    const desc = cellText(r[iDesc]);
    let value: number | null;
    if (iAmount >= 0) value = parseMoney(r[iAmount] ?? null);
    else {
      const d = parseMoney(r[iDebit] ?? null);
      const c = parseMoney(r[iCredit] ?? null);
      value = d ? Math.abs(d) : c ? -Math.abs(c) : null; // debit/credit columns: debit = spend
    }
    if (!date || date.precision !== "DAY") {
      errors.push({
        line: i + 1,
        message: `unreadable date "${cellText(r[iDate])}"`,
      });
      continue;
    }
    if (value == null || value === 0 || !desc) {
      errors.push({ line: i + 1, message: "missing amount or description" });
      continue;
    }
    raw.push({
      line: i + 1,
      date: date.date,
      desc: desc.slice(0, 200),
      value,
      cat: iCat >= 0 ? cellText(r[iCat]).slice(0, 80) || null : null,
    });
  }

  // sign convention: single amount column → payments move opposite to purchases
  let purchasesAre: "positive" | "negative" = opts.purchasesAre ?? "positive";
  if (!opts.purchasesAre && iAmount >= 0) {
    const pay = raw.filter((x) => PAYMENT_RE.test(normalizeDescriptor(x.desc)));
    if (pay.length)
      purchasesAre =
        pay.filter((x) => x.value < 0).length >= pay.length / 2
          ? "positive"
          : "negative";
    else
      purchasesAre =
        raw.filter((x) => x.value > 0).length >= raw.length / 2
          ? "positive"
          : "negative";
  }
  const flip = iAmount >= 0 && purchasesAre === "negative" ? -1 : 1;

  const seen = new Map<string, number>();
  const rows: StatementRow[] = raw.map((x) => {
    const signed = x.value * flip;
    const base = `${walletCardId}|${x.date.toISOString().slice(0, 10)}|${signed}|${normalizeDescriptor(x.desc)}`;
    const n = (seen.get(base) ?? 0) + 1; // two identical coffees on one day are two transactions
    seen.set(base, n);
    return {
      occurredAt: x.date,
      description: x.desc,
      signedCents: signed,
      kind: classify(x.desc, signed),
      amountCents: Math.abs(signed),
      bankCategory: x.cat,
      externalId: `csv:${createHash("sha256").update(`${base}|${n}`).digest("hex").slice(0, 40)}`,
    };
  });
  return {
    rows,
    errors,
    columns: {
      date: header[iDate],
      description: header[iDesc],
      amount:
        iAmount >= 0
          ? header[iAmount]
          : `${header[iDebit]} / ${header[iCredit]}`,
      category: iCat >= 0 ? header[iCat] : null,
    },
    purchasesAre,
  };
}

export class StatementError extends Error {}

// ───────────── benefit rules ─────────────

export interface BenefitRules {
  /** merchant / brand words matched in purchase descriptors */
  keywords: string[];
  /** purchases in these PointWise categories match (used when no keyword is set) */
  categories: string[];
  /** words that identify the issuer's statement credit for this benefit */
  creditKeywords: string[];
}

/** Brands commonly named in card benefits (descriptor word → canonical keyword). */
const BRANDS = [
  "uber",
  "lyft",
  "doordash",
  "grubhub",
  "instacart",
  "caviar",
  "seamless",
  "resy",
  "opentable",
  "dunkin",
  "starbucks",
  "chipotle",
  "cheesecake factory",
  "goldbelly",
  "five guys",
  "netflix",
  "hulu",
  "disney",
  "espn",
  "spotify",
  "peacock",
  "paramount",
  "youtube",
  "apple",
  "audible",
  "siriusxm",
  "new york times",
  "wall street journal",
  "walmart",
  "amazon",
  "whole foods",
  "saks",
  "lululemon",
  "dell",
  "adobe",
  "stubhub",
  "shoprunner",
  "equinox",
  "soulcycle",
  "peloton",
  "oura",
  "clear",
  "global entry",
  "tsa",
  "nexus",
  "cbp",
  "delta",
  "united",
  "american airlines",
  "southwest",
  "alaska airlines",
  "jetblue",
  "marriott",
  "hilton",
  "hyatt",
  "ihg",
  "airbnb",
  "expedia",
  "hotels com",
  "vrbo",
];

const CATEGORY_RULES: Record<string, Partial<BenefitRules>> = {
  rideshare: { keywords: ["uber", "lyft"] },
  clear: { keywords: ["clear"] },
  "trusted-traveler": {
    keywords: ["global entry", "tsa", "cbp", "nexus", "precheck"],
  },
  dining: { categories: ["dining"] },
  airline: { categories: ["airlines"] },
  hotel: { categories: ["hotels"] },
  entertainment: { categories: ["streaming"] },
};

const NAME_STOP = new Set([
  "credit",
  "credits",
  "annual",
  "monthly",
  "quarterly",
  "semi",
  "semiannual",
  "statement",
  "per",
  "year",
  "month",
  "up",
  "to",
  "the",
  "and",
  "of",
  "for",
  "a",
  "an",
  "on",
  "in",
  "with",
  "fee",
  "cash",
  "benefit",
  "card",
  "membership",
  "subscription",
]);

const hasWord = (text: string, word: string) =>
  new RegExp(
    `(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`,
  ).test(text);

/**
 * Rules suggested from the benefit's name, how it is issued and its category:
 * "Rideshare credit" → uber, lyft; "Uber Cash" → uber; "Dining credit" → dining purchases;
 * "Global Entry / TSA PreCheck credit" → global entry, tsa, cbp, nexus, precheck.
 */
export function suggestRules(b: {
  name: string;
  howIssued?: string | null;
  categorySlug?: string | null;
}): BenefitRules {
  const text = normalizeDescriptor(`${b.name} ${b.howIssued ?? ""}`);
  const fromCat = CATEGORY_RULES[b.categorySlug ?? ""] ?? {};
  const brands = BRANDS.filter((w) => hasWord(text, w));
  const keywords = [...new Set([...(fromCat.keywords ?? []), ...brands])];
  const nameWords = normalizeDescriptor(b.name)
    .split(" ")
    .filter((w) => w.length > 2 && !NAME_STOP.has(w));
  return {
    keywords,
    categories: keywords.length ? [] : [...(fromCat.categories ?? [])],
    creditKeywords: [...new Set([...keywords, ...nameWords])],
  };
}

/** Stored rules (validated) or the suggestion when none are stored. */
export function effectiveRules(
  stored: unknown,
  b: { name: string; howIssued?: string | null; categorySlug?: string | null },
): BenefitRules & { suggested: boolean } {
  const r = sanitizeRules(stored);
  return r
    ? { ...r, suggested: false }
    : { ...suggestRules(b), suggested: true };
}

export function sanitizeRules(v: unknown): BenefitRules | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const list = (x: unknown) =>
    (Array.isArray(x) ? x : [])
      .filter((s): s is string => typeof s === "string")
      .map((s) => normalizeDescriptor(s))
      .filter((s) => s.length >= 2)
      .slice(0, 20);
  return {
    keywords: [...new Set(list(o.keywords))],
    categories: [
      ...new Set(list(o.categories).map((s) => s.replace(/ /g, "-"))),
    ],
    creditKeywords: [...new Set(list(o.creditKeywords))],
  };
}

// ───────────── matching ─────────────

export interface MatchTx {
  kind: TxKind;
  description: string | null;
  categorySlug: string | null;
  merchantName?: string | null;
}

export interface MatchBenefit {
  id: string;
  rules: BenefitRules;
}

/**
 * The benefit a transaction belongs to, with how strong the match is. Purchases: a merchant keyword
 * beats a category rule. Statement credits: a credit keyword in the issuer's descriptor.
 * Payments, refunds and fees never match.
 */
export function matchBenefit(
  tx: MatchTx,
  benefits: MatchBenefit[],
): {
  benefitId: string;
  by: "keyword" | "category" | "credit";
  term: string;
} | null {
  const d = normalizeDescriptor(
    `${tx.description ?? ""} ${tx.merchantName ?? ""}`,
  );
  if (tx.kind === "PURCHASE") {
    for (const b of benefits) {
      const k = b.rules.keywords.find((w) => hasWord(d, w));
      if (k) return { benefitId: b.id, by: "keyword", term: k };
    }
    if (tx.categorySlug) {
      for (const b of benefits)
        if (
          !b.rules.keywords.length &&
          b.rules.categories.includes(tx.categorySlug)
        )
          return { benefitId: b.id, by: "category", term: tx.categorySlug };
    }
    return null;
  }
  if (tx.kind === "CREDIT") {
    let best: { benefitId: string; term: string } | null = null;
    for (const b of benefits) {
      const k = b.rules.creditKeywords
        .filter((w) => hasWord(d, w))
        .sort((x, y) => y.length - x.length)[0];
      if (k && (!best || k.length > best.term.length))
        best = { benefitId: b.id, term: k };
    }
    return best ? { ...best, by: "credit" } : null;
  }
  return null;
}


/** Common words that are also the first label of a big company's web host ("united" of united.com). */
export const GENERIC_HOST_WORDS = new Set([
  "united", "american", "national", "first", "general", "global", "pacific", "southern", "northern", "western", "eastern", "central",
  "premier", "express", "direct", "star", "best", "smart", "online", "home", "city", "international", "federal", "state",
]);

const DOMAIN_RE = /\b([a-z0-9][a-z0-9-]*\.(?:com|net|org|edu|gov|io|co|us|app|shop|store))\b/gi;

/**
 * The web-host evidence a merchant gets from a descriptor, or null. The host's first label alone ("united" from united.com) is
 * only a weak hint, so it is ignored when the label is an ordinary word and when the descriptor names a different website
 * ("UNITED STATES TENNIS A USTA.COM" is usta.com, not united.com). The whole host in the descriptor is always evidence.
 */
export function hostTerm(rawDescriptor: string, host: string): string | null {
  const bare = host.toLowerCase().replace(/^www\./, "");
  const label = normalizeDescriptor(bare.split(".")[0]);
  if (!label) return null;
  const raw = rawDescriptor.toLowerCase();
  if (raw.includes(bare)) return label; // united.com written out: strong enough
  const others = [...raw.matchAll(DOMAIN_RE)].map((m) => m[1]).filter((dm) => dm !== bare);
  if (others.length > 0) return null; // the descriptor names another website
  if (GENERIC_HOST_WORDS.has(label)) return null;
  return label;
}

/** Merchant from a descriptor: a known merchant whose name or web host appears in it. */
export function matchMerchant<M extends { name: string; hosts: string[]; aliases?: string[] }>(
  description: string,
  merchants: M[],
): M | null {
  const d = normalizeDescriptor(description);
  let best: { m: M; len: number } | null = null;
  for (const m of merchants) {
    const terms = [
      normalizeDescriptor(m.name),
      ...(m.aliases ?? []).map(normalizeDescriptor),
      ...m.hosts.map((h) => hostTerm(description, h)).filter((t): t is string => !!t),
    ].filter((t) => t.length >= 3);
    for (const t of terms)
      if (hasWord(d, t) && (!best || t.length > best.len))
        best = { m, len: t.length };
  }
  return best?.m ?? null;
}

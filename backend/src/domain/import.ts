import { annualValueCents, BenefitPeriod, parsePeriodText, PeriodBasis, perPeriodFromAnnual } from './benefits';
import { OpenDatePrecision } from './five24';

/**
 * Card-portfolio importer (pure). Works on plain cell grids so it is independent of the file
 * format: the service turns .xlsx (exceljs) or .csv into `Sheet[]`. See docs/excel-import-design.md.
 *
 * Columns are found by header name (aliases, case/punctuation-insensitive), never by position, and
 * the header row may be preceded by a summary block (the tracker workbook has 7 summary rows).
 */

export type Cell = string | number | boolean | Date | null | undefined;
export interface Sheet {
  name: string;
  rows: Cell[][];
}

export interface ImportIssue {
  sheet: string;
  row: number; // 1-based, as shown in Excel
  message: string;
  severity: 'ERROR' | 'WARNING';
}

export interface ParsedCard {
  sheet: string;
  rowNumber: number;
  owner: string;
  cardName: string;
  lastDigits: string | null;
  issuer: string | null;
  annualFeeCents: number | null;
  openedAt: Date | null;
  openDatePrecision: OpenDatePrecision;
  closed: boolean;
  isAuthorizedUser: boolean;
  isBusiness: boolean | null;
  creditLimitCents: number | null;
  notes: string | null;
  key: string;
  duplicateOfRow: number | null;
}

export interface ParsedBenefit {
  sheet: string;
  rowNumber: number;
  cardName: string;
  name: string;
  annualValueCents: number;
  usedCents: number;
  period: BenefitPeriod;
  periodMonths: number;
  basis: PeriodBasis;
  amountPerPeriodCents: number;
  howIssued: string | null;
  resetsText: string | null;
  actionNeeded: string | null;
  notes: string | null;
  issuer: string | null;
  /** cards per owner, e.g. { Me: 1, Spouse: 0 } — null when the sheet has no owner split */
  owners: Record<string, number> | null;
  categorySlug: string;
  kind: 'CREDIT' | 'CERTIFICATE' | 'MEMBERSHIP' | 'ACCESS';
}

export interface ParsedWorkbook {
  cards: ParsedCard[];
  benefits: ParsedBenefit[];
  owners: string[];
  issues: ImportIssue[];
  sheetsRead: string[];
}

// ───────────── helpers ─────────────

export function norm(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const text = (v: Cell): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return s === '' ? null : s;
};

/** Dollars (number or "$1,234.50") → cents. Returns null for blank / unparseable. */
export function parseMoney(v: Cell): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== 'string') return null;
  const neg = /^\s*\(.*\)\s*$/.test(v) || /^\s*-/.test(v);
  const cleaned = v.replace(/[^0-9.]/g, '');
  if (cleaned === '' || cleaned.split('.').length > 2) return null;
  const n = Math.round(Number(cleaned) * 100);
  return neg ? -n : n;
}

export class FullCardNumberError extends Error {}

/** Keep only the last 4–5 digits. Refuses anything that looks like a full card number. */
export function parseLastDigits(v: Cell): string | null {
  if (v == null || v === '') return null;
  const digits = String(typeof v === 'number' ? Math.trunc(v) : v).replace(/\D/g, '');
  if (digits === '') return null;
  if (digits.length > 5) throw new FullCardNumberError('looks like a full card number — only the last 4–5 digits are stored');
  return digits.length < 4 ? digits.padStart(4, '0') : digits;
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30);

/** Date cell → { date, precision }. Accepts Date, Excel serials, ISO, US m/d/yyyy, "yyyy-mm", "mm/yyyy", "Mar 2024". */
export function parseOpenDate(v: Cell): { date: Date; precision: OpenDatePrecision } | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : { date: new Date(Date.UTC(v.getUTCFullYear(), v.getUTCMonth(), v.getUTCDate())), precision: 'DAY' };
  if (typeof v === 'number') {
    if (v < 20_000 || v > 80_000) return null;
    return { date: new Date(EXCEL_EPOCH + Math.round(v) * 86_400_000), precision: 'DAY' };
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return valid(+m[1], +m[2], +m[3], 'DAY');
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) return valid(year(+m[3]), +m[1], +m[2], 'DAY');
  m = /^(\d{4})-(\d{1,2})$/.exec(s);
  if (m) return valid(+m[1], +m[2], 1, 'MONTH');
  m = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) return valid(year(+m[2]), +m[1], 1, 'MONTH');
  m = /^([a-z]{3})[a-z]*\.?\s+(\d{4})$/i.exec(s);
  if (m) {
    const idx = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase());
    if (idx >= 0) return valid(+m[2], idx + 1, 1, 'MONTH');
  }
  return null;
}
const year = (y: number) => (y < 100 ? 2000 + y : y);
function valid(y: number, mo: number, d: number, precision: OpenDatePrecision) {
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d || y < 1950 || y > 2100) return null;
  return { date, precision };
}

const CLOSED_RE = /\b(closed|cancell?ed|canceled|downgraded|product[- ]changed|pc'?d|deleted)\b/i;
/** Notes such as "Closed to new applicants" describe the product, not the account. */
const PRODUCT_NOTE_RE = /\bclosed\s+to\s+(?:new|all)\b[^.;]*/gi;
export const isClosed = (status: string, notes: string | null) =>
  CLOSED_RE.test(status) || (!!notes && CLOSED_RE.test(notes.replace(PRODUCT_NOTE_RE, ' ')));
const AU_RE = /\b(authori[sz]ed user|au)\b/i;
const BUSINESS_RE = /\b(business|biz)\b/i;

// ───────────── header detection ─────────────

type Field =
  | 'owner' | 'card' | 'lastDigits' | 'issuer' | 'annualFee' | 'openDate' | 'status' | 'type' | 'creditLimit' | 'notes' | 'au'
  | 'benefit' | 'value' | 'used' | 'howIssued' | 'resets' | 'action' | 'owners';

const ALIASES: Record<Field, string[]> = {
  owner: ['owner', 'cardholder', 'card holder', 'holder', 'person', 'who', 'member'],
  card: ['card', 'card name', 'product', 'account', 'account name'],
  lastDigits: ['last digits', 'last 4', 'last four', 'last 5', 'last 4 digits', 'digits', 'ending in', 'mask'],
  issuer: ['issuer', 'bank', 'institution'],
  annualFee: ['annual fee', 'af', 'fee'],
  openDate: ['open date', 'opened', 'date opened', 'opened on', 'approval date', 'approved', 'approved on', 'account open date'],
  status: ['status', 'account status', 'active status', 'card status'],
  type: ['type', 'card type', 'personal business', 'personal or business'],
  creditLimit: ['credit limit', 'limit', 'cl'],
  notes: ['notes', 'note', 'comments'],
  au: ['authorized user', 'au', 'is au'],
  benefit: ['benefit', 'benefit name', 'credit name', 'perk'],
  value: ['credit value per card yr', 'credit value per card', 'annual value', 'value per year', 'value', 'amount'],
  used: ['used so far', 'used', 'used ytd', 'amount used'],
  howIssued: ['how it s issued', 'how issued', 'how it is issued', 'issued as'],
  resets: ['resets', 'reset', 'frequency', 'period', 'renews'],
  action: ['action needed', 'action', 'to do', 'todo'],
  owners: ['mine spouse s', 'mine spouses', 'owners', 'whose', 'held by'],
};

export function findHeader(rows: Cell[][], required: Field[], optional: Field[], scanRows = 25): { row: number; cols: Partial<Record<Field, number>> } | null {
  for (let r = 0; r < Math.min(rows.length, scanRows); r++) {
    const cells = (rows[r] ?? []).map(norm);
    const cols: Partial<Record<Field, number>> = {};
    const taken = new Set<number>();
    for (const f of [...required, ...optional]) {
      for (const alias of ALIASES[f]) {
        const idx = cells.findIndex((c, i) => c === alias && !taken.has(i));
        if (idx >= 0) {
          cols[f] = idx;
          taken.add(idx);
          break;
        }
      }
    }
    if (required.every((f) => cols[f] !== undefined)) return { row: r, cols };
  }
  return null;
}

const CARD_OPTIONAL: Field[] = ['owner', 'lastDigits', 'issuer', 'annualFee', 'openDate', 'status', 'type', 'creditLimit', 'notes', 'au'];
const BENEFIT_OPTIONAL: Field[] = ['value', 'used', 'howIssued', 'resets', 'action', 'notes', 'issuer', 'owners'];

// ───────────── benefit categorisation ─────────────

const CATEGORY_RULES: Array<[RegExp, string, ParsedBenefit['kind']]> = [
  [/free night|night cert|anniversary night/i, 'free-night', 'CERTIFICATE'],
  [/global entry|tsa|precheck|nexus|trusted traveler/i, 'trusted-traveler', 'CREDIT'],
  [/\bclear\b/i, 'clear', 'CREDIT'],
  [/lounge|priority pass|centurion|admirals|sky ?club/i, 'lounge', 'ACCESS'],
  [/uber|lyft|rideshare/i, 'rideshare', 'CREDIT'],
  [/airline|flight|incidental|travel credit/i, 'airline', 'CREDIT'],
  [/hotel|resort|fhr|the edit|stay/i, 'hotel', 'CREDIT'],
  [/dining|resy|restaurant|grubhub|doordash|dash ?pass|food/i, 'dining', 'CREDIT'],
  [/stream|entertainment|digital|disney|hulu|netflix|peacock|spotify/i, 'entertainment', 'CREDIT'],
  [/membership|walmart\+|instacart|equinox|soulcycle|gym|fitness|wellness/i, 'membership', 'MEMBERSHIP'],
  [/saks|shopping|lululemon|retail|dell|adobe|indeed|wireless|cell phone/i, 'shopping', 'CREDIT'],
];

export function categorizeBenefit(name: string): { categorySlug: string; kind: ParsedBenefit['kind'] } {
  for (const [re, slug, kind] of CATEGORY_RULES) if (re.test(name)) return { categorySlug: slug, kind };
  return { categorySlug: 'other', kind: 'CREDIT' };
}

// ───────────── sheet parsers ─────────────

export function ownerList(sheets: Sheet[], cards: ParsedCard[]): string[] {
  const lists = sheets.find((s) => /dropdown|options|lists?|lookup/i.test(s.name));
  // the dropdown sheet has one list per column (status, owner, type…): use the column that names the card owners
  const owners = new Set(cards.map((c) => norm(c.owner)));
  let fromList: string[] = [];
  if (lists) {
    const width = Math.max(0, ...lists.rows.map((r) => r.length));
    let best = 0;
    for (let col = 0; col < width; col++) {
      const values = lists.rows.map((r) => text(r[col])).filter((x): x is string => !!x && !SUMMARY_OWNER_RE.test(x));
      const score = values.filter((v) => owners.has(norm(v))).length;
      if (score > best) {
        best = score;
        fromList = values;
      }
    }
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of [...fromList, ...cards.map((c) => c.owner)]) {
    if (!seen.has(norm(o))) {
      seen.add(norm(o));
      out.push(o);
    }
  }
  return out;
}

export function cardKey(owner: string, issuer: string | null, cardName: string, lastDigits: string | null): string {
  return lastDigits ? `${norm(owner)}|${norm(canonicalIssuer(issuer ?? ''))}|${lastDigits}` : `${norm(owner)}|${norm(cardName)}`;
}

/** Owner labels of a spreadsheet's totals block ("Total", "Personal", "Business"…): never a cardholder. */
export const SUMMARY_OWNER_RE = /^(totals?|grand total|subtotals?|sum|overall|all|personal|business)$/i;
/** The card cell of a totals row: "52 active cards", "7 cards". */
export const SUMMARY_CARD_RE = /^\d+\s+(?:(?:active|open|closed)\s+)?cards?\s*$/i;

export function parseCardsSheet(sheet: Sheet, defaultOwner = 'Me'): { cards: ParsedCard[]; issues: ImportIssue[] } | null {
  const h = findHeader(sheet.rows, ['card'], CARD_OPTIONAL);
  if (!h || h.cols.lastDigits === undefined && h.cols.annualFee === undefined && h.cols.owner === undefined && h.cols.openDate === undefined) return null;
  const c = h.cols;
  const get = (row: Cell[], f: Field) => (c[f] === undefined ? null : row[c[f] as number]);
  const cards: ParsedCard[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Map<string, number>();
  for (let r = h.row + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const rowNumber = r + 1;
    const cardName = text(get(row, 'card'));
    if (!cardName) continue;
    if (/^(total|totals|sum)\b/i.test(cardName)) continue;
    // the totals block under the card list (Total / Me / Spouse / Personal / Business rows) is not card data
    if (SUMMARY_CARD_RE.test(cardName) || SUMMARY_OWNER_RE.test(text(get(row, 'owner')) ?? '')) continue;
    const ownerRaw = text(get(row, 'owner')) ?? defaultOwner;
    const notes = text(get(row, 'notes'));
    let lastDigits: string | null = null;
    try {
      lastDigits = parseLastDigits(get(row, 'lastDigits'));
    } catch (e) {
      issues.push({ sheet: sheet.name, row: rowNumber, message: (e as Error).message, severity: 'ERROR' });
    }
    const openRaw = get(row, 'openDate');
    const open = parseOpenDate(openRaw);
    if (openRaw != null && openRaw !== '' && !open) {
      issues.push({ sheet: sheet.name, row: rowNumber, message: `unrecognised open date "${String(openRaw)}"`, severity: 'WARNING' });
    }
    const statusText = text(get(row, 'status')) ?? '';
    const typeText = text(get(row, 'type')) ?? '';
    const auCell = get(row, 'au');
    const isAuthorizedUser =
      auCell === true || /^(y|yes|true|1|x)$/i.test(String(auCell ?? '')) || AU_RE.test(ownerRaw) || AU_RE.test(statusText) || (!!notes && /authori[sz]ed user/i.test(notes));
    const owner = ownerRaw.replace(/\s*\((?:au|authori[sz]ed user)\)\s*/i, '').replace(/\s+-?\s*au$/i, '').trim() || defaultOwner;
    const issuer = text(get(row, 'issuer'));
    const key = cardKey(owner, issuer, cardName, lastDigits);
    const dupOf = seen.get(key) ?? null;
    if (dupOf != null) issues.push({ sheet: sheet.name, row: rowNumber, message: `duplicate of row ${dupOf}`, severity: 'WARNING' });
    else seen.set(key, rowNumber);
    const fee = parseMoney(get(row, 'annualFee'));
    cards.push({
      sheet: sheet.name,
      rowNumber,
      owner,
      cardName,
      lastDigits,
      issuer,
      annualFeeCents: fee == null ? null : Math.max(0, fee),
      openedAt: open?.date ?? null,
      openDatePrecision: open?.precision ?? 'DAY',
      closed: isClosed(statusText, notes),
      isAuthorizedUser,
      isBusiness: typeText ? BUSINESS_RE.test(typeText) : BUSINESS_RE.test(cardName) ? true : null,
      creditLimitCents: parseMoney(get(row, 'creditLimit')),
      notes,
      key,
      duplicateOfRow: dupOf,
    });
  }
  return { cards, issues };
}

/** Parse "1 / 0" (cards per owner, in owner-list order). */
export function parseOwnerSplit(v: Cell, owners: string[]): Record<string, number> | null {
  const s = text(v);
  if (!s || owners.length === 0) return null;
  const nums = s.split('/').map((x) => Number(x.trim()));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const out: Record<string, number> = {};
  owners.forEach((o, i) => {
    if (i < nums.length) out[o] = nums[i];
  });
  return out;
}

export function parseBenefitsSheet(sheet: Sheet, owners: string[]): { benefits: ParsedBenefit[]; issues: ImportIssue[] } | null {
  const h = findHeader(sheet.rows, ['card', 'benefit'], BENEFIT_OPTIONAL);
  if (!h) return null;
  const c = h.cols;
  const get = (row: Cell[], f: Field) => (c[f] === undefined ? null : row[c[f] as number]);
  const benefits: ParsedBenefit[] = [];
  const issues: ImportIssue[] = [];
  for (let r = h.row + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] ?? [];
    const rowNumber = r + 1;
    const cardName = text(get(row, 'card'));
    const name = text(get(row, 'benefit'));
    if (!cardName || !name) continue;
    const annual = parseMoney(get(row, 'value'));
    if (annual == null || annual < 0) {
      issues.push({ sheet: sheet.name, row: rowNumber, message: `benefit "${name}" has no annual value — skipped`, severity: 'WARNING' });
      continue;
    }
    const resetsText = text(get(row, 'resets'));
    const howIssued = text(get(row, 'howIssued'));
    const p = parsePeriodText(resetsText ?? howIssued);
    const amountPerPeriodCents = perPeriodFromAnnual(annual, p);
    const cat = categorizeBenefit(name);
    benefits.push({
      sheet: sheet.name,
      rowNumber,
      cardName,
      name,
      annualValueCents: annualValueCents({ ...p, amountPerPeriodCents }),
      usedCents: Math.max(0, parseMoney(get(row, 'used')) ?? 0),
      ...p,
      amountPerPeriodCents,
      howIssued,
      resetsText,
      actionNeeded: text(get(row, 'action')),
      notes: text(get(row, 'notes')),
      issuer: text(get(row, 'issuer')),
      owners: parseOwnerSplit(get(row, 'owners'), owners),
      ...cat,
    });
  }
  return { benefits, issues };
}

/** Parse every sheet; sheets that are neither a card list nor a benefit list are ignored. */
export function parseWorkbook(sheets: Sheet[]): ParsedWorkbook {
  const issues: ImportIssue[] = [];
  const cards: ParsedCard[] = [];
  const sheetsRead: string[] = [];
  const benefitSheets: Sheet[] = [];
  for (const s of sheets) {
    if (findHeader(s.rows, ['card', 'benefit'], [])) {
      benefitSheets.push(s);
      continue;
    }
    const parsed = parseCardsSheet(s);
    if (parsed) {
      cards.push(...parsed.cards);
      issues.push(...parsed.issues);
      sheetsRead.push(s.name);
    }
  }
  const owners = ownerList(sheets, cards);
  const benefits: ParsedBenefit[] = [];
  for (const s of benefitSheets) {
    const parsed = parseBenefitsSheet(s, owners);
    if (parsed) {
      benefits.push(...parsed.benefits);
      issues.push(...parsed.issues);
      sheetsRead.push(s.name);
    }
  }
  // Benefit rows whose card is missing from the card list become card rows for the first owner.
  for (const b of benefits) {
    if (!cards.some((c) => norm(c.cardName) === norm(b.cardName))) {
      issues.push({ sheet: b.sheet, row: b.rowNumber, message: `card "${b.cardName}" is not on the card list — benefit attached to a new card`, severity: 'WARNING' });
      const owner = (b.owners && Object.entries(b.owners).find(([, n]) => n > 0)?.[0]) || owners[0] || 'Me';
      cards.push({
        sheet: b.sheet, rowNumber: b.rowNumber, owner, cardName: b.cardName, lastDigits: null, issuer: b.issuer, annualFeeCents: null,
        openedAt: null, openDatePrecision: 'DAY', closed: false, isAuthorizedUser: false, isBusiness: null, creditLimitCents: null,
        notes: null, key: cardKey(owner, b.issuer, b.cardName, null), duplicateOfRow: null,
      });
    }
  }
  if (sheetsRead.length === 0) issues.push({ sheet: '*', row: 0, message: 'no sheet with a "Card" column was found', severity: 'ERROR' });
  return { cards, benefits, owners: ownerList(sheets, cards), issues, sheetsRead };
}

/** Which parsed cards a benefit row applies to (by card name and the per-owner split). */
export function cardsForBenefit(b: ParsedBenefit, cards: ParsedCard[]): ParsedCard[] {
  const same = cards.filter((c) => c.duplicateOfRow == null && norm(c.cardName) === norm(b.cardName));
  if (!b.owners) return same;
  return same.filter((c) => (b.owners as Record<string, number>)[c.owner] === undefined || (b.owners as Record<string, number>)[c.owner] > 0);
}

// ───────────── matching ─────────────

const ISSUER_ALIASES: Record<string, string> = {
  amex: 'american express',
  'american express': 'american express',
  chase: 'chase',
  'jpmorgan chase': 'chase',
  'jp morgan chase': 'chase',
  citi: 'citi',
  citibank: 'citi',
  boa: 'bank of america',
  bofa: 'bank of america',
  'bank of america': 'bank of america',
  'cap one': 'capital one',
  capitalone: 'capital one',
  'capital one': 'capital one',
  'us bank': 'u s bank',
  usbank: 'u s bank',
  'u s bank': 'u s bank',
  'wells fargo': 'wells fargo',
  wf: 'wells fargo',
  penfed: 'penfed',
  'penfed credit union': 'penfed',
  'navy federal': 'navy federal',
  nfcu: 'navy federal',
  'goldman sachs': 'goldman sachs',
  gs: 'goldman sachs',
  'elan financial': 'elan',
  elan: 'elan',
};

export function canonicalIssuer(name: string): string {
  const n = norm(name);
  return ISSUER_ALIASES[n] ?? n;
}

/** Issuers known to report business cards to personal credit bureaus (count toward 5/24). */
export const BUSINESS_REPORTS_TO_PERSONAL = new Set(['capital one', 'discover', 'td bank']);

export function tokenSimilarity(a: string, b: string): number {
  const ta = new Set(norm(a).split(' ').filter(Boolean));
  const tb = new Set(norm(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export interface CatalogEntry {
  id: string;
  name: string;
  issuerName: string;
  /** PERSONAL / BUSINESS, when known */
  type?: string | null;
}

/**
 * Best catalog card for a spreadsheet row. When the row says whether the card is business or personal
 * (`isBusiness`), an entry of the same type is preferred and one of the other type is heavily penalised,
 * so a personal "Venture X" never lands on "Venture X Business".
 */
export function matchCatalog(cardName: string, issuer: string | null, catalog: CatalogEntry[], threshold = 0.5, isBusiness: boolean | null = null): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const e of catalog) {
    let score = tokenSimilarity(cardName, e.name);
    if (issuer && canonicalIssuer(issuer) === canonicalIssuer(e.issuerName)) score += 0.2;
    if (isBusiness != null && e.type) score += (e.type === 'BUSINESS') === isBusiness ? 0.15 : -0.6;
    if (!best || score > best.score) best = { id: e.id, score: Math.round(score * 1000) / 1000 };
  }
  return best && best.score >= threshold ? best : null;
}

export interface ExistingCard {
  id: string;
  cardName: string;
  issuer: string;
  lastDigits: string | null;
  owner: string | null;
}

/** Find the wallet card a parsed row refers to (re-import / bank sync dedupe). */
export function matchExisting(p: Pick<ParsedCard, 'cardName' | 'issuer' | 'lastDigits' | 'owner'>, existing: ExistingCard[]): ExistingCard | null {
  if (p.lastDigits) {
    const byDigits = existing.filter((e) => e.lastDigits === p.lastDigits);
    const hit = byDigits.find(
      (e) => (p.issuer && canonicalIssuer(p.issuer) === canonicalIssuer(e.issuer)) || tokenSimilarity(p.cardName, e.cardName) >= 0.5,
    );
    if (hit) return hit;
  }
  return (
    existing.find(
      (e) =>
        (!p.lastDigits || !e.lastDigits) &&
        norm(e.owner ?? '') === norm(p.owner) &&
        tokenSimilarity(p.cardName, e.cardName) >= 0.8,
    ) ?? null
  );
}

// ───────────── CSV ─────────────

/** RFC 4180 CSV → rows (quoted fields, escaped quotes, CRLF/LF, optional BOM). Cells stay strings. */
export function parseCsv(input: string, maxRows = 10_000): Cell[][] {
  const src = input.replace(/^﻿/, '');
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      if (rows.length > maxRows) throw new Error(`more than ${maxRows} rows`);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export const CSV_TEMPLATE = [
  'Owner,Card,Last digits,Issuer,Annual fee,Open date,Status,Type,Credit limit,Authorized user,Notes',
  'Me,Example Travel Card,1234,Example Bank,95,2025-03-14,Open,Personal,10000,no,',
  'Spouse,Example Travel Card,5678,Example Bank,0,2025-04,Open,Personal,,yes,AU on my account',
].join('\n');

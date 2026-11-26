/**
 * Benefit detection (pure): which tracked benefit — on that one card account — a transaction belongs
 * to, how it was matched, and how sure we are. Statements are card data; this never calls a model.
 * The optional AI tier lives in ai/benefit-classify.ts and only ever sees a cleaned merchant string.
 *
 * Pipeline: normalize → exact (benefit's own keywords / credit words) → alias table → regex → fuzzy
 * → score → assign. Candidates are the benefits passed in, which callers load for ONE wallet card,
 * so two cards of the same product can never share a match.
 */
import { ALIAS_GROUPS } from "./benefit-aliases";
import { BenefitRules, normalizeDescriptor, TxKind } from "./spend";

export type DetectMethod =
  | "MANUAL"
  | "EXACT"
  | "ALIAS"
  | "REGEX"
  | "FUZZY"
  | "AI";

export const AUTO_ASSIGN_MIN = 85;
export const REVIEW_MIN = 60;
export const AI_CONFIDENCE_CAP = 75;

export interface DetectTx {
  kind: TxKind;
  description: string | null;
  categorySlug: string | null;
  merchantName?: string | null;
}

export interface DetectBenefit {
  id: string;
  name: string;
  rules: BenefitRules;
}

export interface Detection {
  benefitId: string;
  method: DetectMethod;
  /** 0–100 */
  confidence: number;
  /** the rule term that fired */
  rule: string;
  /** normalized merchant string that was matched */
  merchant: string;
  /** ASSIGN (≥85), REVIEW (60–84) */
  tier: "ASSIGN" | "REVIEW";
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const hasWord = (text: string, word: string) =>
  new RegExp(`(^|[^a-z0-9])${esc(word)}([^a-z0-9]|$)`).test(text);

/** Levenshtein distance (small strings). */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length];
}

/** 0–1 similarity of two words. */
export const similarity = (a: string, b: string) =>
  1 - editDistance(a, b) / Math.max(a.length, b.length, 1);

const tier = (c: number): Detection["tier"] | null =>
  c >= AUTO_ASSIGN_MIN ? "ASSIGN" : c >= REVIEW_MIN ? "REVIEW" : null;

function make(
  benefitId: string,
  method: DetectMethod,
  confidence: number,
  rule: string,
  merchant: string,
): Detection | null {
  const t = tier(confidence);
  return t ? { benefitId, method, confidence, rule, merchant, tier: t } : null;
}

/** Detections for one transaction, strongest first; empty when nothing reaches review confidence. */
export function detectBenefits(
  tx: DetectTx,
  benefits: DetectBenefit[],
): Detection[] {
  if (tx.kind !== "PURCHASE" && tx.kind !== "CREDIT") return [];
  const d = normalizeDescriptor(
    `${tx.description ?? ""} ${tx.merchantName ?? ""}`,
  );
  if (!d) return [];
  const out: Detection[] = [];
  const push = (x: Detection | null) => x && out.push(x);

  for (const b of benefits) {
    const best: Detection[] = [];
    const add = (x: Detection | null) => x && best.push(x);

    // 1 exact: the benefit's own rules
    if (tx.kind === "PURCHASE") {
      const k = b.rules.keywords.find((w) => hasWord(d, w));
      if (k) add(make(b.id, "EXACT", 92, k, d));
      else if (
        !b.rules.keywords.length &&
        tx.categorySlug &&
        b.rules.categories.includes(tx.categorySlug)
      )
        add(make(b.id, "ALIAS", 70, `category:${tx.categorySlug}`, d));
    } else {
      const k = b.rules.creditKeywords
        .filter((w) => hasWord(d, w))
        .sort((x, y) => y.length - x.length)[0];
      if (k) add(make(b.id, "EXACT", 95, k, d));
    }

    // 2 alias / 3 regex: alias groups that apply to this benefit
    for (const g of ALIAS_GROUPS) {
      if (!g.benefit.test(b.name)) continue;
      if (tx.kind === "CREDIT") {
        const c = g.credit.find((re) => re.test(d));
        if (c) add(make(b.id, "REGEX", 90, `credit:${g.key}`, d));
      }
      const a = g.aliases.find((w) => hasWord(d, normalizeDescriptor(w)));
      if (a) add(make(b.id, "ALIAS", tx.kind === "CREDIT" ? 86 : 85, a, d));
      const p = g.patterns.find((re) => re.test(d));
      if (p) add(make(b.id, "REGEX", 80, `pattern:${g.key}`, d));
    }

    // 4 fuzzy: a descriptor word close to a keyword / alias word
    if (!best.length) {
      const terms = new Set<string>(
        tx.kind === "CREDIT"
          ? b.rules.creditKeywords
          : [
              ...b.rules.keywords,
              ...ALIAS_GROUPS.filter((g) => g.benefit.test(b.name)).flatMap(
                (g) => g.aliases.map(normalizeDescriptor),
              ),
            ],
      );
      let top = { ratio: 0, term: "" };
      for (const w of d.split(" ").filter((x) => x.length >= 4))
        for (const t of terms) {
          if (t.includes(" ") || t.length < 4) continue;
          const r = similarity(w, t);
          if (r > top.ratio) top = { ratio: r, term: t };
        }
      if (top.ratio >= 0.8)
        add(make(b.id, "FUZZY", Math.round(50 + 30 * top.ratio), top.term, d));
    }
    best.sort((x, y) => y.confidence - x.confidence);
    push(best[0] ?? null);
  }
  return out.sort((x, y) => y.confidence - x.confidence);
}

/** The single benefit to assign: the strongest detection when it is unambiguous. */
export function pickDetection(list: Detection[]): Detection | null {
  const [a, b] = list;
  if (!a) return null;
  // two benefits tied on confidence from the same rule family are ambiguous → manual review
  if (b && b.confidence === a.confidence && b.rule !== a.rule) return null;
  return a;
}

/** Cleaned merchant string — the only thing an AI classifier may see (no digits, amounts, names). */
export function merchantForAi(description: string): string {
  return normalizeDescriptor(description)
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

/** An AI classification becomes a detection; its confidence never exceeds AI_CONFIDENCE_CAP. */
export function aiDetection(
  benefitId: string,
  claimed: number,
  merchant: string,
): Detection | null {
  const c = Math.max(0, Math.min(AI_CONFIDENCE_CAP, Math.round(claimed)));
  return make(benefitId, "AI", c, "ai", merchant);
}

/** Verification a fresh detection starts with: statement credits matched on strong signals count as evidenced. */
export function initialVerification(
  d: Detection,
  kind: TxKind,
): "VERIFIED" | "UNVERIFIED" {
  return kind === "CREDIT" && d.tier === "ASSIGN" && d.method !== "AI"
    ? "VERIFIED"
    : "UNVERIFIED";
}

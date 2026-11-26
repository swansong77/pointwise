/**
 * Benefit utilization at four levels (card product, card account, cardholder, household) and the
 * reconciliation view (expected / detected / missing / expired / unused). Pure.
 *
 * Every figure is computed per tracked benefit, which belongs to exactly ONE card account. Higher
 * levels only add those rows up; nothing is ever looked up by product name, so two cards of the same
 * product (e.g. three Amex Golds across two cardholders) never share usage, credits or renewals.
 */
import {
  activeWindows,
  BenefitPeriod,
  BenefitStatus,
  PeriodBasis,
  periodContaining,
  periodsInBenefitYear,
  PeriodWindow,
  utilization,
} from "./benefits";

export type Frequency =
  | "Monthly"
  | "Quarterly"
  | "Semi-Annual"
  | "Annual"
  | "Anniversary Year"
  | "One-Time"
  | "Custom Period";

export interface RollUsage {
  periodStart: Date;
  amountCents: number;
  status: "CONFIRMED" | "EXPECTED" | "DISMISSED";
  verification?: "UNVERIFIED" | "VERIFIED" | "REJECTED";
  detectionMethod?: string | null;
  confidence?: number | null;
  evidenceCount?: number;
  updatedAt?: Date;
}

export interface RollBenefit {
  benefitId: string;
  walletCardId: string;
  /** catalog product the account is an instance of */
  productId: string;
  productName: string;
  lastFour?: string | null;
  profileId: string | null;
  profileName: string | null;
  name: string;
  category: string | null;
  period: BenefitPeriod;
  periodMonths: number;
  basis: PeriodBasis;
  amountPerPeriodCents: number;
  expiresOn?: Date | null;
  windowStart?: Date | null;
  windowEnd?: Date | null;
  /** account opening date: the anchor for anniversary / custom / multi-year periods */
  anchor: Date | null;
  enabled: boolean;
  usages: RollUsage[];
}

export function frequencyLabel(
  b: Pick<RollBenefit, "period" | "basis">,
): Frequency {
  if (b.period === "ONE_TIME") return "One-Time";
  if (b.period === "CUSTOM" || b.period === "MULTI_YEAR")
    return "Custom Period";
  if (b.basis === "CARDMEMBER_YEAR" && b.period === "ANNUAL")
    return "Anniversary Year";
  const labels: Record<string, Frequency> = {
    MONTHLY: "Monthly",
    QUARTERLY: "Quarterly",
    SEMIANNUAL: "Semi-Annual",
    ANNUAL: "Annual",
  };
  return labels[b.period];
}

export function resetSchedule(b: RollBenefit): string {
  const f = frequencyLabel(b);
  if (f === "One-Time")
    return b.expiresOn
      ? `Expires ${b.expiresOn.toISOString().slice(0, 10)}`
      : "Does not reset";
  if (f === "Anniversary Year") return "Resets on the account anniversary";
  if (f === "Custom Period") return `Every ${b.periodMonths} months from opening`;
  const labels: Record<string, string> = {
    Monthly: "1st of each month",
    Quarterly: "Jan / Apr / Jul / Oct",
    "Semi-Annual": "Jan / Jul",
    Annual: "Jan 1",
  };
  return labels[f];
}

/** Dismissed and rejected usage never counts. */
const counts = (u: RollUsage) =>
  u.status !== "DISMISSED" && u.verification !== "REJECTED";

export interface BenefitRecord {
  benefitId: string;
  cardAccountId: string;
  cardholderId: string | null;
  cardholder: string | null;
  productId: string;
  card: string;
  lastFour: string | null;
  benefitName: string;
  category: string | null;
  frequency: Frequency;
  resetSchedule: string;
  periodStart: Date;
  periodEnd: Date;
  allocatedCents: number;
  usedCents: number;
  remainingCents: number;
  utilizationPct: number;
  expirationDate: Date | null;
  detectionMethod: string;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "REJECTED" | "NONE";
  statementEvidence: number;
  status: BenefitStatus;
  lastUpdated: Date | null;
}

const inside = (u: RollUsage, w: PeriodWindow) =>
  u.periodStart.getTime() >= w.start.getTime() &&
  u.periodStart.getTime() < w.end.getTime();

/** The current-period record of one tracked benefit (the spec's benefit utilization model). */
export function benefitRecord(b: RollBenefit, now: Date): BenefitRecord {
  const w = periodContaining(b, b.anchor, now);
  const live = b.usages.filter(counts);
  const here = live.filter((u) => inside(u, w));
  const used = here.reduce((n, u) => n + u.amountCents, 0);
  const u = utilization(b.amountPerPeriodCents, used, w, now);
  const methods = [...new Set(here.map((x) => x.detectionMethod ?? "MANUAL"))];
  const verification: BenefitRecord["verificationStatus"] = !here.length
    ? "NONE"
    : here.every((x) => x.verification === "VERIFIED")
      ? "VERIFIED"
      : "UNVERIFIED";
  const stamps = b.usages
    .map((x) => x.updatedAt?.getTime() ?? 0)
    .filter((n) => n > 0);
  const expiry = b.expiresOn ?? (b.period === "ONE_TIME" ? w.end : null);
  return {
    benefitId: b.benefitId,
    cardAccountId: b.walletCardId,
    cardholderId: b.profileId,
    cardholder: b.profileName,
    productId: b.productId,
    card: b.productName,
    lastFour: b.lastFour ?? null,
    benefitName: b.name,
    category: b.category,
    frequency: frequencyLabel(b),
    resetSchedule: resetSchedule(b),
    periodStart: w.start,
    periodEnd: w.end,
    allocatedCents: b.amountPerPeriodCents,
    usedCents: used,
    remainingCents: u.remainingCents,
    utilizationPct: u.percentUsed,
    expirationDate: expiry,
    detectionMethod: methods.join("+") || "NONE",
    verificationStatus: verification,
    statementEvidence: here.reduce((n, x) => n + (x.evidenceCount ?? 0), 0),
    status:
      expiry && expiry.getTime() <= now.getTime() && u.remainingCents > 0
        ? "EXPIRED"
        : u.status,
    lastUpdated: stamps.length ? new Date(Math.max(...stamps)) : null,
  };
}

export type RollLevel = "product" | "account" | "cardholder" | "household";

export interface RollGroup {
  key: string;
  label: string;
  /** number of distinct card accounts in the group */
  accounts: number;
  benefits: number;
  allocatedCents: number;
  usedCents: number;
  remainingCents: number;
  utilizationPct: number;
}

/** Adds records up to a level. `account` keeps every card account separate, whatever its product. */
export function rollup(
  records: BenefitRecord[],
  level: RollLevel,
): RollGroup[] {
  const keyOf = (r: BenefitRecord): [string, string] => {
    if (level === "product") return [r.productId, r.card];
    if (level === "account")
      return [
        r.cardAccountId,
        `${r.card}${r.lastFour ? ` ·${r.lastFour}` : ""}${r.cardholder ? ` (${r.cardholder})` : ""}`,
      ];
    if (level === "cardholder")
      return [r.cardholderId ?? "none", r.cardholder ?? "Unassigned"];
    return ["household", "Household"];
  };
  const m = new Map<string, RollGroup & { ids: Set<string> }>();
  for (const r of records) {
    const [key, label] = keyOf(r);
    const g = m.get(key) ?? {
      key,
      label,
      accounts: 0,
      benefits: 0,
      allocatedCents: 0,
      usedCents: 0,
      remainingCents: 0,
      utilizationPct: 0,
      ids: new Set<string>(),
    };
    g.ids.add(r.cardAccountId);
    g.benefits++;
    g.allocatedCents += r.allocatedCents;
    g.usedCents += r.usedCents;
    g.remainingCents += r.remainingCents;
    m.set(key, g);
  }
  return [...m.values()]
    .map(({ ids, ...g }) => ({
      ...g,
      accounts: ids.size,
      utilizationPct: g.allocatedCents
        ? Math.min(100, Math.round((g.usedCents / g.allocatedCents) * 100))
        : 0,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

// ───────────── reconciliation ─────────────

export interface ReconcileRow {
  benefitId: string;
  cardAccountId: string;
  cardholder: string | null;
  card: string;
  lastFour: string | null;
  benefitName: string;
  frequency: Frequency;
  /** value the benefit year has made available so far (periods started up to now) */
  expectedCents: number;
  /** credits confirmed by a statement */
  detectedCents: number;
  /** spent on a matching purchase, statement credit not yet seen */
  pendingCents: number;
  /** periods that have ended with value left on the table */
  missingCents: number;
  expiredCents: number;
  unusedCents: number;
  /** current period almost over with nothing used, or past periods missed entirely */
  potentialMissed: boolean;
  suggestion: string;
}

const money = (c: number) => `$${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const DAY = 86_400_000;

/** Expected vs detected for the benefit year containing `now`, and what to do about the gap. */
export function reconcileBenefit(
  b: RollBenefit,
  now: Date,
  soonDays = b.periodMonths <= 1 ? 7 : b.periodMonths <= 3 ? 14 : 30,
): ReconcileRow {
  const windows = activeWindows(
    periodsInBenefitYear(b, b.anchor, now),
    b.anchor,
  ).filter((w) => w.start.getTime() <= now.getTime());
  const live = b.usages.filter(counts);
  let expected = 0;
  let detected = 0;
  let pending = 0;
  let missing = 0;
  let unused = 0;
  let current: { w: PeriodWindow; used: number } | null = null;
  for (const w of windows) {
    const here = live.filter((u) => inside(u, w));
    const sum = (status: RollUsage["status"]) =>
      here.filter((u) => u.status === status).reduce((n, u) => n + u.amountCents, 0);
    const conf = Math.min(b.amountPerPeriodCents, sum("CONFIRMED"));
    const pend = Math.min(b.amountPerPeriodCents - conf, sum("EXPECTED"));
    expected += b.amountPerPeriodCents;
    detected += conf;
    pending += pend;
    const left = b.amountPerPeriodCents - conf - pend;
    if (w.end.getTime() <= now.getTime()) missing += left;
    else {
      unused += left;
      current = { w, used: conf + pend };
    }
  }
  const expiry = b.expiresOn ?? null;
  const expired =
    expiry && expiry.getTime() <= now.getTime() ? unused + missing : 0;
  const soon =
    !!current &&
    current.used === 0 &&
    current.w.end.getTime() - now.getTime() <= soonDays * DAY;
  const potential = soon || (missing > 0 && pending === 0 && detected === 0);
  let suggestion = "On track.";
  if (expired > 0)
    suggestion = `Expired with ${money(expired)} unused. Check whether it can be reinstated.`;
  else if (soon && current)
    suggestion = `Use ${money(b.amountPerPeriodCents)} before ${new Date(current.w.end.getTime() - DAY).toISOString().slice(0, 10)}.`;
  else if (missing > 0)
    suggestion = `${money(missing)} of past periods went unused. Plan to use this period's credit.`;
  else if (pending > 0)
    suggestion = `${money(pending)} spent; wait for the statement credit or check it posted.`;
  else if (unused > 0 && current && current.used === 0)
    suggestion = "Not used yet this period.";
  return {
    benefitId: b.benefitId,
    cardAccountId: b.walletCardId,
    cardholder: b.profileName,
    card: b.productName,
    lastFour: b.lastFour ?? null,
    benefitName: b.name,
    frequency: frequencyLabel(b),
    expectedCents: expected,
    detectedCents: detected,
    pendingCents: pending,
    missingCents: missing,
    expiredCents: expired,
    unusedCents: unused,
    potentialMissed: potential,
    suggestion,
  };
}

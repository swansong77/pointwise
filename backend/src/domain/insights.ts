import { annualFee } from './calculator';
import { addMonths, daysBetween, startOfUtcDay } from './dates';
import { five24Status, Five24Card } from './five24';
import { DomainWalletCard } from './types';

export { addMonths, daysBetween, startOfUtcDay };

// ───────────── 5/24 ─────────────

export interface FiveTwentyFour {
  count: number;
  /** when the count next decreases, or null if count is 0 */
  nextDropAt: Date | null;
  underLimit: boolean;
  countedWalletCardIds: string[];
}

export function toFive24Card(wc: DomainWalletCard): Five24Card {
  return {
    id: wc.id,
    name: wc.nickname || wc.card.name,
    issuer: wc.card.issuerName ?? '',
    type: wc.card.type,
    cardholder: wc.cardholder ?? 'PRIMARY',
    status: wc.status,
    openedAt: wc.approvedAt,
    precision: wc.openDatePrecision ?? 'DAY',
    businessReportsToPersonal: wc.card.businessReportsToPersonal ?? false,
    excludeFrom524: wc.excludeFrom524 ?? false,
    excludeReason: wc.excludeReason ?? null,
  };
}

/** Dashboard summary — delegates to the full engine in five24.ts. */
export function fiveTwentyFour(walletCards: DomainWalletCard[], now: Date = new Date(), limit = 5): FiveTwentyFour {
  const s = five24Status(walletCards.map(toFive24Card), now, limit);
  return {
    count: s.count,
    nextDropAt: s.nextDropAt,
    underLimit: s.underLimit,
    countedWalletCardIds: s.contributing.map((c) => c.cardId),
  };
}

// ───────────── Renewals ─────────────

export interface Renewal {
  walletCardId: string;
  name: string;
  renewsAt: Date;
  daysUntil: number;
  annualFeeCents: number;
}

/** Next anniversary of approval date (strictly today or later). */
export function nextAnniversary(approvedAt: Date, now: Date): Date {
  // First renewal is one year after approval; then yearly. Always computed from the original
  // approval date so Feb-29 approvals don't drift.
  const today = startOfUtcDay(now).getTime();
  let years = Math.max(1, now.getUTCFullYear() - approvedAt.getUTCFullYear());
  let candidate = addMonths(approvedAt, years * 12);
  while (candidate.getTime() < today) {
    years += 1;
    candidate = addMonths(approvedAt, years * 12);
  }
  return candidate;
}

export function upcomingRenewals(
  walletCards: DomainWalletCard[],
  now: Date = new Date(),
  withinDays = 60,
  includeNoFee = false,
): Renewal[] {
  return walletCards
    .filter((wc) => wc.status === 'APPROVED' && wc.approvedAt)
    .map((wc) => {
      const renewsAt = nextAnniversary(wc.approvedAt as Date, now);
      return {
        walletCardId: wc.id,
        name: wc.nickname || wc.card.name,
        renewsAt,
        daysUntil: daysBetween(startOfUtcDay(now), renewsAt),
        annualFeeCents: annualFee(wc),
      };
    })
    .filter((r) => r.daysUntil >= 0 && r.daysUntil <= withinDays && (includeNoFee || r.annualFeeCents > 0))
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

// ───────────── Welcome bonus ─────────────

export interface BonusProgress {
  walletCardId: string;
  name: string;
  requiredSpendCents: number;
  spentCents: number;
  percent: number;
  deadline: Date;
  daysLeft: number;
  earned: boolean;
  atRisk: boolean;
}

export function bonusProgress(walletCards: DomainWalletCard[], now: Date = new Date()): BonusProgress[] {
  return walletCards
    .filter(
      (wc) =>
        wc.status === 'APPROVED' &&
        wc.approvedAt &&
        wc.card.bonusSpendCents &&
        wc.card.bonusMonths,
    )
    .map((wc) => {
      const required = wc.card.bonusSpendCents as number;
      const deadline = addMonths(wc.approvedAt as Date, wc.card.bonusMonths as number);
      const daysLeft = daysBetween(startOfUtcDay(now), deadline);
      const spent = Math.max(0, wc.bonusSpendCents);
      const earned = wc.bonusEarned || spent >= required;
      const percent = Math.min(100, Math.round((spent / required) * 100));
      // At risk: not earned, deadline within 30 days, and less than 75% of spend done.
      const atRisk = !earned && daysLeft >= 0 && daysLeft <= 30 && percent < 75;
      return {
        walletCardId: wc.id,
        name: wc.nickname || wc.card.name,
        requiredSpendCents: required,
        spentCents: spent,
        percent,
        deadline,
        daysLeft,
        earned,
        atRisk,
      };
    })
    .filter((b) => !b.earned && b.daysLeft >= 0)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

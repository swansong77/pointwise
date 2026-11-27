import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { BenefitsService } from '../portfolio/benefits';
import { bucketExpirations, ExpiringItem, EXPIRATION_VERSION } from '../domain/expiration-buckets';
import { householdOffers, HOUSEHOLD_OFFERS_VERSION } from '../domain/household-offers';
import { daysLeft, InventoryRow, LIVE_STATES } from '../domain/offer-lifecycle';
import { certificateMatches, offerLabel } from '../domain/plan-insights';
import { summarizeSavings, SAVINGS_VERSION } from '../domain/savings-summary';
import { OfferAnalysisService } from './offer-analysis.service';
import { OfferCoreService } from './offer-core.service';
import { OfferInventoryService } from './offer-inventory.service';

const DAY = 86_400_000;
const REFERENCE_AMOUNT_CENTS = 50_000;

const actionFor = (r: InventoryRow): string => {
  if (r.state === 'AVAILABLE') return 'Add it to a card before it ends.';
  if (r.state === 'ADDED' && r.enrollmentRequired) return 'Activate it on the issuer’s offers page.';
  if (r.minSpendCents) return `Spend ${(r.minSpendCents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} with it before it ends.`;
  return 'Use it before it ends.';
};

/** The savings-and-planning dashboards: what is about to expire, what has been saved, how offers line up across the household, and one merchant in depth. */
@Injectable()
export class OfferDashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: OfferInventoryService,
    private readonly benefits: BenefitsService,
    private readonly core: OfferCoreService,
    private readonly analysis: OfferAnalysisService,
    private readonly recs: RecommendationsService,
  ) {}

  private async members(userId: string) {
    return this.prisma.profile.findMany({ where: { userId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: { id: true, nickname: true, isPrimary: true } });
  }

  /** Offers, benefit credits and certificates that lapse in the next 60 days, in buckets, with what is lost if each is missed. */
  async expirations(userId: string, now = new Date()) {
    const [rows, views, certs, members] = await Promise.all([
      this.inventory.rows(userId, now),
      this.benefits.list(userId, {}, now),
      this.prisma.loyaltyCertificate.findMany({
        where: { userId, status: 'AVAILABLE', potentialValueCents: { gt: 0 }, expiresAt: { gte: new Date(now.getTime() - DAY), lte: new Date(now.getTime() + 61 * DAY) } },
        include: { profile: { select: { id: true, nickname: true } } },
      }),
      this.members(userId),
    ]);
    const nick = new Map(members.map((m) => [m.id, m.nickname]));
    const primary = members.find((m) => m.isPrimary)?.nickname ?? null;
    const items: ExpiringItem[] = [];
    for (const r of rows) {
      if (!LIVE_STATES.includes(r.state) || !r.endsAt) continue;
      items.push({
        kind: 'OFFER',
        id: r.id,
        label: offerLabel(r.merchant?.name ?? r.merchantText, r),
        cardholder: r.cardholder,
        card: r.card,
        walletCardId: r.walletCardId,
        merchant: r.merchant?.name ?? r.merchantText,
        endsAt: r.endsAt,
        valueCents: Math.max(0, r.valueCents - r.actualSavingsCents),
        action: actionFor(r),
      });
    }
    for (const v of views) {
      if (!v.enabled || v.walletCard.status === 'CLOSED' || v.currentPeriod.remainingCents <= 0) continue;
      items.push({
        kind: 'CREDIT',
        id: v.id,
        label: v.name,
        cardholder: v.walletCard.profileId ? nick.get(v.walletCard.profileId) ?? null : primary,
        card: v.walletCard.name,
        walletCardId: v.walletCard.id,
        merchant: null,
        endsAt: new Date(v.currentPeriod.lastDay),
        valueCents: v.currentPeriod.remainingCents,
        action: v.actionNeeded ?? 'Use it before the period ends.',
      });
    }
    for (const c of certs) {
      if (!c.expiresAt) continue;
      items.push({ kind: 'CERTIFICATE', id: c.id, label: c.name, cardholder: c.profile.nickname, card: null, walletCardId: null, merchant: null, endsAt: c.expiresAt, valueCents: c.potentialValueCents, action: 'Book it before it expires.' });
    }
    return { version: EXPIRATION_VERSION, asOf: now, ...bucketExpirations(items, now) };
  }

  /** Savings generated and expected, by card, member, merchant and month, and how finished plans compared with what they expected. */
  async savings(userId: string, now = new Date()) {
    const [rows, views, planned, missed, members] = await Promise.all([
      this.inventory.rows(userId, now),
      this.benefits.list(userId, {}, now),
      this.prisma.plannedPurchase.findMany({ where: { userId }, select: { status: true, expectedCents: true, actualCents: true } }),
      this.core.missed(userId, now),
      this.members(userId),
    ]);
    const nick = new Map(members.map((m) => [m.id, m.nickname]));
    const primary = members.find((m) => m.isPrimary) ?? null;
    const credits = views
      .filter((v) => v.walletCard.status !== 'CLOSED')
      .map((v) => ({ walletCardId: v.walletCard.id, card: v.walletCard.name, cardholder: v.walletCard.profileId ? nick.get(v.walletCard.profileId) ?? null : primary?.nickname ?? null, profileId: v.walletCard.profileId ?? primary?.id ?? null, usedThisYearCents: v.year.usedThisYearCents }));
    return { version: SAVINGS_VERSION, asOf: now, ...summarizeSavings(rows, planned, credits, missed.totalLostCents, now) };
  }

  /** Each member's offers and value, the same offer on several cards, and who should pay at each merchant. */
  async household(userId: string, now = new Date()) {
    const [rows, members] = await Promise.all([this.inventory.rows(userId, now), this.members(userId)]);
    return { version: HOUSEHOLD_OFFERS_VERSION, asOf: now, ...householdOffers(rows, members, now) };
  }

  /** One merchant in depth: the household's offers there (active and past), portal rates, card multipliers, certificates, transfer routes, history and the best way to pay. */
  async merchant(userId: string, slug: string, now = new Date()) {
    const merchant = await this.prisma.merchant.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, parentCompany: true, category: { select: { slug: true, name: true } } } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    const [rows, ranking, rates, certs, partners, timeline, purchases, members] = await Promise.all([
      this.inventory.rows(userId, now).then((r) => r.filter((x) => x.merchant?.id === merchant.id)),
      this.recs.forMerchant(userId, merchant.id),
      this.prisma.portalRate.findMany({ where: { merchantId: merchant.id, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.loyaltyCertificate.findMany({
        where: { userId, status: 'AVAILABLE', OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        include: { profile: { select: { nickname: true } }, program: { select: { name: true } } },
      }),
      this.prisma.transferPartner.findMany({ include: { currency: { select: { name: true } }, program: { select: { name: true, kind: true } } } }),
      this.core.timeline(merchant.slug, now),
      this.core.purchases(userId, 12, now).then((t) => t.filter((x) => x.merchantId === merchant.id)),
      this.members(userId),
    ]);
    const wcIds = ranking.ranked.map((r) => r.walletCardId);
    const wcs = await this.prisma.walletCard.findMany({ where: { id: { in: wcIds } }, select: { id: true, profileId: true } });
    const nick = new Map(members.map((m) => [m.id, m.nickname]));
    const primary = members.find((m) => m.isPrimary)?.nickname ?? null;
    const memberOf = new Map(wcs.map((w) => [w.id, w.profileId ? nick.get(w.profileId) ?? null : primary]));

    const spendCents = purchases.reduce((s, t) => s + t.amountCents, 0);
    const reference = purchases.length ? Math.max(1_000, Math.round(spendCents / purchases.length / 1_000) * 1_000) : REFERENCE_AMOUNT_CENTS;
    const plan = await this.analysis.plan(userId, { merchantId: merchant.id, amountCents: reference, record: false }, now);
    const best = plan.plans[0] ?? null;

    const programMatch = (name: string) => certificateMatches({ programName: name, eligible: [] }, { name: merchant.name, parentCompany: merchant.parentCompany });
    const active = rows.filter((r) => LIVE_STATES.includes(r.state)).sort((a, b) => (a.endsAt?.getTime() ?? Infinity) - (b.endsAt?.getTime() ?? Infinity));
    const past = rows.filter((r) => !LIVE_STATES.includes(r.state)).sort((a, b) => (b.endsAt?.getTime() ?? 0) - (a.endsAt?.getTime() ?? 0));
    return {
      merchant: { id: merchant.id, slug: merchant.slug, name: merchant.name, parentCompany: merchant.parentCompany, category: merchant.category },
      offers: { active, past },
      expectedCents: active.reduce((s, r) => s + r.expectedSavingsCents, 0),
      receivedCents: rows.reduce((s, r) => s + r.actualSavingsCents, 0),
      multipliers: ranking.ranked.slice(0, 6).map((r) => ({ walletCardId: r.walletCardId, card: r.name, member: memberOf.get(r.walletCardId) ?? null, multiplier: r.multiplier, centsPerDollar: r.centsPerDollar, reason: r.reason, pinned: r.pinned })),
      portalRates: rates.map((r) => ({ portal: r.portal, ratePercent: r.ratePercent == null ? null : Number(r.ratePercent), pointsPerDollar: r.pointsPerDollar == null ? null : Number(r.pointsPerDollar), source: r.source, expiresAt: r.expiresAt })),
      certificates: certs
        .filter((c) => certificateMatches({ programName: c.program?.name ?? null, eligible: c.eligible }, { name: merchant.name, parentCompany: merchant.parentCompany }))
        .map((c) => ({ id: c.id, name: c.name, member: c.profile.nickname, valueCents: c.potentialValueCents, expiresAt: c.expiresAt })),
      transferRoutes: partners
        .filter((p) => programMatch(p.program.name))
        .map((p) => ({ currency: p.currency.name, program: p.program.name, ratio: `${p.ratioFrom}:${p.ratioTo}`, bonusPercent: p.bonusEndsAt && p.bonusEndsAt < now ? 0 : p.bonusPercent, bonusEndsAt: p.bonusEndsAt })),
      history: timeline,
      spend: { last12MonthsCents: spendCents, purchases: purchases.length },
      cashback: plan.cashback,
      bestWayToPay: best
        ? {
            referenceAmountCents: reference,
            basedOn: purchases.length ? 'your average purchase here' : 'a $500 reference purchase',
            legs: best.legs.map((l) => ({ card: l.cardName, member: l.member, amountCents: l.amountCents })),
            expectedCents: best.expectedCents,
            confidence: best.confidence,
            actions: best.actions,
            warnings: best.warnings,
            member: plan.household.best,
            memberReason: plan.household.reason,
          }
        : null,
      daysToNextExpiry: active.length && active[0].endsAt ? daysLeft(active[0].endsAt, now) : null,
    };
  }
}

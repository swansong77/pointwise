import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { BenefitsService } from '../portfolio/benefits';
import { OfferSourceKind, VerificationKind } from '../domain/offer-import';
import { daysLeft, expectedSavingsCents, InventoryQuery, InventoryRow, lifecycleState, LIVE_STATES, matchesQuery, sortRows, summarize } from '../domain/offer-lifecycle';
import { OfferCoreService } from './offer-core.service';

const MAX_PAGE = 200;

/** A source the lifecycle's confidence cap knows: connector (account data) rows count as account data. */
const sourceKind = (s: string): OfferSourceKind => (s === 'CONNECTOR' || s === 'EXTENSION' ? 'ACCOUNT_DATA' : (s as OfferSourceKind));

/**
 * The household's complete offer inventory: offers on cards (UserOffer) and offers an account sync found that are not on a card yet
 * (OfferSnapshotItem), merged into one row type with one derived lifecycle, plus the per-card detail view.
 */
@Injectable()
export class OfferInventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly benefits: BenefitsService,
    private readonly core: OfferCoreService,
  ) {}

  /** Every row, unfiltered. Per-user volumes are small, so filtering and paging happen on the derived lifecycle. */
  async rows(userId: string, now = new Date()): Promise<InventoryRow[]> {
    const walletId = (await this.prisma.wallet.findUnique({ where: { userId }, select: { id: true } }))?.id;
    if (!walletId) return [];
    const [wcs, primary] = await Promise.all([
      this.prisma.walletCard.findMany({
        where: { walletId },
        select: { id: true, nickname: true, profileId: true, profile: { select: { id: true, nickname: true } }, card: { select: { name: true, issuer: { select: { name: true } } } } },
      }),
      this.prisma.profile.findFirst({ where: { userId, isPrimary: true }, select: { id: true, nickname: true } }),
    ]);
    const cardInfo = new Map(
      wcs.map((w) => [
        w.id,
        { card: w.nickname || w.card.name, issuer: w.card.issuer.name, profileId: (w.profile ?? primary)?.id ?? null, cardholder: (w.profile ?? primary)?.nickname ?? null },
      ]),
    );

    const [userOffers, snaps] = await Promise.all([
      this.prisma.userOffer.findMany({
        where: { walletCard: { walletId } },
        include: { offer: { include: { merchant: { select: { id: true, name: true, slug: true, category: { select: { id: true, name: true } } } }, issuer: { select: { name: true } } } } },
      }),
      this.prisma.offerSnapshotItem.findMany({ where: { userId, userOfferId: null } }),
    ]);

    const merchantIds = [...new Set(snaps.map((s) => s.merchantId).filter((x): x is string => !!x))];
    const snapMerchants = new Map(
      (await this.prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, name: true, slug: true, category: { select: { id: true, name: true } } } })).map((m) => [m.id, m]),
    );

    const out: InventoryRow[] = [];
    for (const u of userOffers) {
      const o = u.offer;
      const info = cardInfo.get(u.walletCardId);
      const state = lifecycleState({ offer: { endsAt: o.endsAt, enrollmentRequired: o.enrollmentRequired }, userOffer: u }, now);
      out.push({
        id: u.id,
        origin: 'USER_OFFER',
        offerId: o.id,
        title: o.title,
        merchant: o.merchant ? { id: o.merchant.id, name: o.merchant.name, slug: o.merchant.slug } : null,
        merchantText: o.merchant?.name ?? o.title,
        categoryId: o.merchant?.category.id ?? null,
        categoryName: o.merchant?.category.name ?? null,
        walletCardId: u.walletCardId,
        card: info?.card ?? null,
        issuer: o.issuer?.name ?? info?.issuer ?? null,
        profileId: info?.profileId ?? null,
        cardholder: info?.cardholder ?? null,
        offerType: o.offerType,
        valueCents: o.valueCents,
        percent: o.percent == null ? null : Number(o.percent),
        points: o.points,
        minSpendCents: o.minSpendCents,
        endsAt: o.endsAt,
        daysLeft: daysLeft(o.endsAt, now),
        state,
        enrollmentRequired: o.enrollmentRequired,
        activationStatus: u.activationStatus,
        addedAt: u.addedAt,
        activatedAt: u.activatedAt,
        redeemedAt: u.redeemedAt,
        actualSavingsCents: u.amountUsedCents,
        expectedSavingsCents: expectedSavingsCents({ state, valueCents: o.valueCents, source: sourceKind(o.source), verification: o.verification as VerificationKind }),
        source: o.source,
        reliability: o.reliability,
        verification: o.verification,
        lastVerified: o.lastValidatedAt ?? u.activatedAt ?? u.addedAt,
      });
    }
    for (const s of snaps) {
      const info = s.walletCardId ? cardInfo.get(s.walletCardId) : undefined;
      const m = s.merchantId ? snapMerchants.get(s.merchantId) : undefined;
      const state = lifecycleState({ offer: { endsAt: s.endsAt, enrollmentRequired: true }, snapshot: s }, now);
      out.push({
        id: s.id,
        origin: 'SYNC',
        offerId: null,
        title: s.title,
        merchant: m ? { id: m.id, name: m.name, slug: m.slug } : null,
        merchantText: m?.name ?? s.merchantText,
        categoryId: m?.category.id ?? null,
        categoryName: m?.category.name ?? s.category ?? null,
        walletCardId: s.walletCardId,
        card: info?.card ?? null,
        issuer: info?.issuer ?? null,
        profileId: info?.profileId ?? null,
        cardholder: info?.cardholder ?? null,
        offerType: s.offerType,
        valueCents: s.valueCents,
        percent: s.percent == null ? null : Number(s.percent),
        points: s.points,
        minSpendCents: s.minSpendCents,
        endsAt: s.endsAt,
        daysLeft: daysLeft(s.endsAt, now),
        state,
        enrollmentRequired: true,
        activationStatus: null,
        addedAt: s.enrolledAt ?? s.firstSeenAt,
        activatedAt: s.enrolledAt,
        redeemedAt: null,
        actualSavingsCents: s.savedCents,
        expectedSavingsCents: expectedSavingsCents({ state, valueCents: s.valueCents, source: 'ACCOUNT_DATA', verification: 'UNVERIFIED' }),
        source: 'CONNECTOR',
        reliability: 90,
        verification: 'UNVERIFIED',
        lastVerified: s.lastSeenAt,
      });
    }
    return out;
  }

  async list(userId: string, q: InventoryQuery = {}, now = new Date()) {
    if (q.walletCardId) await this.wallet.assertOwned(userId, q.walletCardId);
    const all = await this.rows(userId, now);
    const matched = all.filter((r) => matchesQuery(r, q, now));
    const sorted = sortRows(matched, q.sort);
    const pageSize = Math.min(Math.max(q.pageSize ?? 50, 1), MAX_PAGE);
    const page = Math.max(q.page ?? 1, 1);
    return {
      summary: summarize(matched, now),
      total: matched.length,
      page,
      pageSize,
      items: sorted.slice((page - 1) * pageSize, page * pageSize),
    };
  }

  /** Everything about one card: details, benefits and credits, certificates, offers by lifecycle, missed offers and savings. */
  async cardDetail(userId: string, walletCardId: string, now = new Date()) {
    await this.wallet.assertOwned(userId, walletCardId);
    const wc = await this.prisma.walletCard.findUniqueOrThrow({
      where: { id: walletCardId },
      include: { card: { include: { issuer: { select: { name: true } }, currency: true, rewards: true } }, profile: { select: { id: true, nickname: true } } },
    });
    const primary = wc.profile ? null : await this.prisma.profile.findFirst({ where: { userId, isPrimary: true }, select: { id: true, nickname: true } });
    const owner = wc.profile ?? primary;
    const [rows, benefits, missed, certificates] = await Promise.all([
      this.rows(userId, now).then((r) => r.filter((x) => x.walletCardId === walletCardId)),
      this.benefits.list(userId, { walletCardId }, now),
      this.core.missed(userId, now).then((m) => ({ totalLostCents: m.items.filter((i) => i.walletCardId === walletCardId && i.cause !== 'BELOW_MIN_SPEND').reduce((s, i) => s + i.lostCents, 0), items: m.items.filter((i) => i.walletCardId === walletCardId) })),
      owner
        ? this.prisma.loyaltyCertificate.findMany({
            where: { userId, profileId: owner.id, status: 'AVAILABLE' },
            orderBy: [{ expiresAt: 'asc' }],
            select: { id: true, name: true, category: true, subtype: true, expiresAt: true, quantity: true, potentialValueCents: true },
          })
        : Promise.resolve([]),
    ]);
    const by = (states: string[]) => sortRows(rows.filter((r) => states.includes(r.state)));
    const offerSavings = rows.reduce((s, r) => s + r.actualSavingsCents, 0);
    const benefitUsedThisYear = benefits.reduce((s, b) => s + b.year.usedThisYearCents, 0);
    const upcoming = rows
      .filter((r) => LIVE_STATES.includes(r.state) && r.endsAt && (r.daysLeft ?? 0) >= 0)
      .sort((a, b) => (a.endsAt as Date).getTime() - (b.endsAt as Date).getTime())
      .slice(0, 10);
    return {
      card: {
        walletCardId: wc.id,
        name: wc.nickname || wc.card.name,
        catalogName: wc.card.name,
        issuer: wc.card.issuer.name,
        network: wc.card.network,
        color: wc.card.color,
        lastFour: wc.lastFour,
        status: wc.status,
        cardholder: owner?.nickname ?? null,
        profileId: owner?.id ?? null,
        isAuthorizedUser: wc.cardholder === 'AUTHORIZED_USER',
        approvedAt: wc.approvedAt,
        annualFeeCents: wc.annualFeeOverrideCents ?? wc.card.annualFeeCents,
        currency: { name: wc.card.currency.name, centsPerPoint: Number(wc.card.currency.centsPerPoint) },
        bonus: { spendCents: wc.bonusSpendCents, earned: wc.bonusEarned, requiredCents: wc.card.bonusSpendCents, months: wc.card.bonusMonths, points: wc.card.bonusPoints },
      },
      rewards: wc.card.rewards.map((r) => ({ id: r.id, categoryId: r.categoryId, merchantId: r.merchantId, multiplier: Number(r.multiplier), description: r.description, isRotating: r.isRotating, conditional: r.conditional, capCents: r.capCents, capPeriod: r.capPeriod })),
      selectedCategoryIds: wc.selectedCategoryIds,
      benefits,
      certificates,
      offers: {
        active: by(['ACTIVATED', 'PARTIALLY_USED']),
        pending: by(['AVAILABLE', 'ADDED']),
        expired: by(['EXPIRED']),
        redeemed: by(['REDEEMED']),
        removed: by(['REMOVED', 'REJECTED']),
        missed,
      },
      upcomingExpirations: upcoming,
      savings: {
        offersCents: offerSavings,
        creditsThisYearCents: benefitUsedThisYear,
        totalCents: offerSavings + benefitUsedThisYear,
        expectedOffersCents: rows.reduce((s, r) => s + r.expectedSavingsCents, 0),
        annualFeeCents: wc.annualFeeOverrideCents ?? wc.card.annualFeeCents,
      },
      summary: summarize(rows, now),
    };
  }
}

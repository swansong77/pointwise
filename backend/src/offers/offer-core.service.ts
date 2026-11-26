import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { MerchantIdentity, resolveMerchant } from '../domain/merchant-resolve';
import { OfferSourceKind } from '../domain/offer-import';
import { detectMissed, OfferHolding, OfferTerms, Txn } from '../domain/offer-engine';
import { analyzeBehavior, BehaviorTxn } from '../domain/spend-behavior';
import { scoreOpportunity } from '../domain/opportunity-score';
import { buildTimeline } from '../domain/merchant-timeline';

const DAY = 86_400_000;

export type OfferRow = Prisma.OfferGetPayload<{ include: { merchant: { select: { id: true; name: true; slug: true } }; issuer: { select: { name: true; offersUrl: true } } } }>;

export const toTerms = (o: OfferRow): OfferTerms => ({
  id: o.id,
  merchantId: o.merchantId,
  startsAt: o.startsAt,
  endsAt: o.endsAt,
  minSpendCents: o.minSpendCents,
  valueCents: o.valueCents,
  percent: o.percent == null ? null : Number(o.percent),
  enrollmentRequired: o.enrollmentRequired,
  source: o.source as OfferSourceKind,
  verification: o.verification,
});

/** Detection, scoring and timeline over the user's own offers, transactions and cards. All numbers come from the pure engines. */
@Injectable()
export class OfferCoreService {
  constructor(private readonly prisma: PrismaService) {}

  async merchants(): Promise<MerchantIdentity[]> {
    return this.prisma.merchant.findMany({ select: { id: true, slug: true, name: true, hosts: true, aliases: true, mcc: true, parentCompany: true } });
  }

  async purchases(userId: string, months: number, now: Date) {
    return this.prisma.transaction.findMany({
      where: { userId, kind: 'PURCHASE', occurredAt: { gte: new Date(now.getTime() - months * 30.4375 * DAY), lte: now } },
      select: { id: true, merchantId: true, categoryId: true, walletCardId: true, amountCents: true, occurredAt: true, walletCard: { select: { profileId: true } } },
    });
  }

  /** Offers on, or addable to, the user's cards, with the wallet cards each could sit on. */
  async holdings(userId: string, now: Date): Promise<Array<OfferHolding & { row: OfferRow }>> {
    const walletId = (await this.prisma.wallet.findUnique({ where: { userId }, select: { id: true } }))?.id;
    if (!walletId) return [];
    const wcs = await this.prisma.walletCard.findMany({ where: { walletId, status: 'APPROVED', closedAt: null }, select: { id: true, cardId: true, card: { select: { issuerId: true } } } });
    if (!wcs.length) return [];
    const offers = await this.prisma.offer.findMany({
      where: {
        isActive: true,
        merchantId: { not: null },
        OR: [{ isCustom: false }, { createdById: userId }],
        AND: [{ OR: [{ cardId: { in: wcs.map((w) => w.cardId) } }, { cardId: null, issuerId: { in: wcs.map((w) => w.card.issuerId) } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: new Date(now.getTime() - 45 * DAY) } }] }],
      },
      include: { merchant: { select: { id: true, name: true, slug: true } }, issuer: { select: { name: true, offersUrl: true } } },
    });
    const uos = await this.prisma.userOffer.findMany({ where: { walletCard: { wallet: { userId } }, offerId: { in: offers.map((o) => o.id) } }, select: { offerId: true, walletCardId: true, status: true, activationStatus: true } });
    return offers.map((o) => ({
      row: o,
      offer: toTerms(o),
      eligibleWalletCardIds: wcs.filter((w) => (o.cardId ? o.cardId === w.cardId : o.issuerId === w.card.issuerId)).map((w) => w.id),
      userOffers: uos.filter((u) => u.offerId === o.id).map((u) => ({ walletCardId: u.walletCardId, status: u.status, activationStatus: u.activationStatus })),
    }));
  }

  /** Purchases that an offer could have covered but did not, with the root cause, lost value and evidence. */
  async missed(userId: string, now = new Date()) {
    const [h, tx] = await Promise.all([this.holdings(userId, now), this.purchases(userId, 12, now)]);
    const txns: Txn[] = tx.map((t) => ({ id: t.id, merchantId: t.merchantId, walletCardId: t.walletCardId, date: t.occurredAt, amountCents: t.amountCents }));
    const byId = new Map(h.map((x) => [x.offer.id, x.row]));
    const found = detectMissed(h, txns, now);
    return {
      totalLostCents: found.filter((m) => m.cause !== 'BELOW_MIN_SPEND').reduce((s, m) => s + m.lostCents, 0),
      items: found.map((m) => ({ ...m, offer: { id: m.offerId, title: byId.get(m.offerId)?.title ?? '', merchant: byId.get(m.offerId)?.merchant?.name ?? null, endsAt: byId.get(m.offerId)?.endsAt ?? null, source: byId.get(m.offerId)?.source ?? null } })),
    };
  }

  /** Offers ranked by opportunity score, each with per-factor reasons and a confidence. */
  async opportunities(userId: string, now = new Date()) {
    const [h, tx, profiles, past] = await Promise.all([
      this.holdings(userId, now),
      this.purchases(userId, 12, now),
      this.prisma.profile.count({ where: { userId } }),
      this.prisma.userOffer.groupBy({ by: ['status'], where: { walletCard: { wallet: { userId } } }, _count: true }),
    ]);
    const behavior = analyzeBehavior(tx.map<BehaviorTxn>((t) => ({ merchantId: t.merchantId, categoryId: t.categoryId, profileId: t.walletCard.profileId, date: t.occurredAt, amountCents: t.amountCents })), now);
    const redeemed = past.find((p) => p.status === 'REDEEMED')?._count ?? 0;
    const total = past.reduce((s, p) => s + p._count, 0);
    const utilization = total >= 3 ? redeemed / total : null;
    const merchantCategory = new Map((await this.prisma.merchant.findMany({ where: { id: { in: h.map((x) => x.row.merchantId!).filter(Boolean) } }, select: { id: true, categoryId: true } })).map((m) => [m.id, m.categoryId]));
    const items = h
      .filter((x) => !x.row.endsAt || x.row.endsAt >= now)
      .map((x) => {
        const o = x.row;
        const activated = x.userOffers.some((u) => u.activationStatus === 'ACTIVATED' || u.activationStatus === 'NOT_REQUIRED');
        const daysLeft = o.endsAt ? Math.max(0, Math.ceil((o.endsAt.getTime() - now.getTime()) / DAY)) : null;
        const result = scoreOpportunity({
          daysLeft,
          valueCents: o.valueCents,
          percent: o.percent == null ? null : Number(o.percent),
          maxRewardCents: null,
          minSpendCents: o.minSpendCents,
          enrollmentRequired: o.enrollmentRequired,
          alreadyActivated: activated,
          source: o.source as OfferSourceKind,
          verification: o.verification,
          behavior: behavior.merchants.get(o.merchantId!) ?? null,
          categoryShare: behavior.categoryShare.get(merchantCategory.get(o.merchantId!) ?? '') ?? 0,
          utilization,
          householdMembers: Math.max(profiles, 1),
        });
        return {
          offerId: o.id,
          title: o.title,
          merchant: o.merchant?.name ?? null,
          endsAt: o.endsAt,
          daysLeft,
          added: x.userOffers.length > 0,
          activated,
          offersUrl: o.issuer?.offersUrl ?? null,
          source: o.source,
          verification: o.verification,
          ...result,
        };
      })
      .sort((a, b) => b.score - a.score);
    return { generatedAt: now, items };
  }

  /** What a merchant's offers have looked like over time. */
  async timeline(slug: string, now = new Date()) {
    const merchant = await this.prisma.merchant.findUnique({ where: { slug }, select: { id: true, name: true, slug: true, parentCompany: true } });
    if (!merchant) throw new NotFoundException('Merchant not found');
    const offers = await this.prisma.offer.findMany({ where: { merchantId: merchant.id, isCustom: false }, include: { issuer: { select: { name: true } } } });
    const t = buildTimeline(offers.map((o) => ({ id: o.id, issuer: o.issuer?.name ?? null, startsAt: o.startsAt, endsAt: o.endsAt, createdAt: o.createdAt, valueCents: o.valueCents, percent: o.percent == null ? null : Number(o.percent) })), now);
    return { merchant, ...t };
  }
}

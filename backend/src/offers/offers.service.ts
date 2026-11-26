import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { paginate } from '../common/pagination';
import { WalletService } from '../wallet/wallet.service';
import { limitsFor } from '../domain/entitlements';
import { applyUsage, daysLeft, effectiveStatus, isExpired, isSnoozed, remainingCents, snooze, sortOffers } from '../domain/offers';
import { AddOfferToCardDto, CustomOfferDto, MyOffersQuery, OfferCatalogQuery, UpdateUserOfferDto } from './offers.dto';

const userOfferInclude = {
  offer: { include: { merchant: { select: { id: true, name: true, slug: true } }, issuer: { select: { id: true, name: true } } } },
  walletCard: { select: { id: true, nickname: true, card: { select: { id: true, name: true, color: true } } } },
} satisfies Prisma.UserOfferInclude;

@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  async catalog(q: OfferCatalogQuery) {
    const now = new Date();
    const where: Prisma.OfferWhereInput = {
      isActive: true,
      isCustom: false,
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      ...(q.merchantId && { merchantId: q.merchantId }),
      ...(q.cardId && { cardId: q.cardId }),
      ...(q.issuerId && { issuerId: q.issuerId }),
      ...(q.q && { title: { contains: q.q, mode: 'insensitive' } }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.offer.findMany({
        where,
        include: { merchant: { select: { id: true, name: true } }, issuer: { select: { id: true, name: true } }, card: { select: { id: true, name: true } } },
        orderBy: [{ endsAt: 'asc' }, { valueCents: 'desc' }],
        ...paginate(q),
      }),
      this.prisma.offer.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /** Catalog offers the user could add: matching a card in their wallet or the card's issuer, not yet added. */
  async eligible(userId: string) {
    const walletId = await this.wallet.walletId(userId);
    const wcs = await this.prisma.walletCard.findMany({
      where: { walletId, status: 'APPROVED' },
      include: { card: { select: { id: true, issuerId: true, name: true } }, userOffers: { select: { offerId: true } } },
    });
    const now = new Date();
    const cardIds = wcs.map((w) => w.card.id);
    const issuerIds = [...new Set(wcs.map((w) => w.card.issuerId))];
    const offers = await this.prisma.offer.findMany({
      where: {
        isActive: true, isCustom: false,
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
          { OR: [{ cardId: { in: cardIds } }, { cardId: null, issuerId: { in: issuerIds } }] },
        ],
      },
      include: { merchant: { select: { id: true, name: true } }, issuer: { select: { id: true, name: true } } },
      orderBy: { endsAt: 'asc' },
    });
    return offers.flatMap((o) =>
      wcs
        .filter((w) => (o.cardId ? o.cardId === w.card.id : o.issuerId === w.card.issuerId))
        .filter((w) => !w.userOffers.some((uo) => uo.offerId === o.id))
        .map((w) => ({ offer: o, walletCardId: w.id, cardName: w.nickname || w.card.name })),
    );
  }

  async mine(userId: string, q: MyOffersQuery) {
    const now = new Date();
    if (q.walletCardId) await this.wallet.assertOwned(userId, q.walletCardId);
    const rows = await this.prisma.userOffer.findMany({
      where: {
        walletCard: { wallet: { userId } },
        ...(q.walletCardId && { walletCardId: q.walletCardId }),
        ...(q.favoritesOnly && { isFavorite: true }),
        ...(q.q && { offer: { title: { contains: q.q, mode: 'insensitive' } } }),
      },
      include: userOfferInclude,
    });
    const enriched = rows
      .map((uo) => ({
        ...uo,
        effectiveStatus: effectiveStatus(uo.offer, uo, now),
        remainingCents: remainingCents(uo.offer, uo),
        daysLeft: daysLeft(uo.offer, now),
        snoozed: isSnoozed(uo, now),
        // sortable fields
        title: uo.offer.title,
        endsAt: uo.offer.endsAt,
        valueCents: uo.offer.valueCents,
      }))
      .filter((uo) => q.status === 'ALL' || uo.effectiveStatus === q.status)
      .filter((uo) => q.includeSnoozed || !uo.snoozed || q.status !== 'ACTIVE');
    return sortOffers(enriched, q.sort);
  }

  private async assertTrackLimit(userId: string): Promise<void> {
    const [sub, count] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { userId } }),
      this.prisma.userOffer.count({ where: { walletCard: { wallet: { userId } }, status: 'ACTIVE' } }),
    ]);
    if (count >= limitsFor(sub).maxTrackedOffers) {
      throw new ForbiddenException('Free plan offer limit reached. Upgrade to Pro to track unlimited offers.');
    }
  }

  async addToCard(userId: string, dto: AddOfferToCardDto) {
    const wc = await this.wallet.assertOwned(userId, dto.walletCardId);
    const offer = await this.prisma.offer.findUnique({ where: { id: dto.offerId } });
    if (!offer || !offer.isActive || (offer.isCustom && offer.createdById !== userId)) throw new NotFoundException('Offer not found');
    if (isExpired(offer, new Date())) throw new BadRequestException('Offer has expired');
    await this.assertTrackLimit(userId);
    await this.track(userId, 'offer_added', { offerId: offer.id, cardId: wc.cardId });
    return this.prisma.userOffer.create({ data: { walletCardId: dto.walletCardId, offerId: dto.offerId }, include: userOfferInclude });
  }

  async createCustom(userId: string, dto: CustomOfferDto) {
    await this.wallet.assertOwned(userId, dto.walletCardId);
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (startsAt && endsAt && endsAt < startsAt) throw new BadRequestException('endsAt must be after startsAt');
    if (dto.kind === 'PERCENT' && dto.percent == null) throw new BadRequestException('percent is required for PERCENT offers');
    if (dto.kind === 'POINTS' && dto.points == null) throw new BadRequestException('points is required for POINTS offers');
    await this.assertTrackLimit(userId);
    const offer = await this.prisma.offer.create({
      data: {
        title: dto.title, description: dto.description, kind: dto.kind, valueCents: dto.valueCents,
        points: dto.points, percent: dto.percent, minSpendCents: dto.minSpendCents, startsAt, endsAt,
        isRepeatable: dto.isRepeatable ?? false, maxTimes: dto.maxTimes, merchantId: dto.merchantId, url: dto.url,
        isCustom: true, createdById: userId,
      },
    });
    return this.prisma.userOffer.create({ data: { walletCardId: dto.walletCardId, offerId: offer.id }, include: userOfferInclude });
  }

  private async ownedUserOffer(userId: string, id: string) {
    const uo = await this.prisma.userOffer.findUnique({ where: { id }, include: { offer: true, walletCard: { include: { wallet: true } } } });
    if (!uo) throw new NotFoundException('Offer not found');
    if (uo.walletCard.wallet.userId !== userId) throw new ForbiddenException('Not your offer');
    return uo;
  }

  async update(userId: string, id: string, dto: UpdateUserOfferDto) {
    const uo = await this.ownedUserOffer(userId, id);
    const now = new Date();
    let next = { status: uo.status, amountUsedCents: uo.amountUsedCents, timesUsed: uo.timesUsed, snoozedUntil: uo.snoozedUntil, redeemedAt: uo.redeemedAt };
    if (dto.amountUsedCents !== undefined || dto.timesUsed !== undefined || dto.redeemed !== undefined) {
      next = applyUsage(uo.offer, next, { amountUsedCents: dto.amountUsedCents, timesUsed: dto.timesUsed, redeemed: dto.redeemed }, now);
    }
    if (dto.snoozedUntil !== undefined) {
      next = dto.snoozedUntil === null ? { ...next, snoozedUntil: null } : snooze(next, new Date(dto.snoozedUntil), now);
    }
    if (next.status === 'REDEEMED' && uo.status !== 'REDEEMED') await this.track(userId, 'offer_redeemed', { userOfferId: id });
    return this.prisma.userOffer.update({
      where: { id },
      data: { ...next, isFavorite: dto.isFavorite ?? uo.isFavorite },
      include: userOfferInclude,
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const uo = await this.ownedUserOffer(userId, id);
    await this.prisma.userOffer.delete({ where: { id } });
    if (uo.offer.isCustom) await this.prisma.offer.delete({ where: { id: uo.offerId } }).catch(() => undefined);
  }

  private async track(userId: string, name: string, properties: Record<string, unknown>) {
    await this.prisma.analyticsEvent.create({ data: { userId, name, properties: properties as object } }).catch(() => undefined);
  }
}

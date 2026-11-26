import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OfferEventType, OfferKind, OfferSource, OfferType, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { limitsFor } from '../domain/entitlements';
import { MerchantIdentity, resolveMerchant, isTrusted } from '../domain/merchant-resolve';
import { confidenceCap, offerKey, OfferSourceKind, parseOfferText, reliabilityOf } from '../domain/offer-import';

const KIND: Record<string, OfferKind> = { CASHBACK_PERCENT: 'PERCENT', POINTS_BONUS: 'POINTS' };

/** Merchant-offer inventory: import, source/reliability, activation, and the OfferEvent audit trail. */
@Injectable()
export class OfferIntelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
  ) {}

  /** Append to the user's audit trail. detail holds evidence and confidence, never card numbers. */
  async event(userId: string, type: OfferEventType, actor: 'USER' | 'SYSTEM' | 'AGENT', detail: Record<string, unknown>, ids: { offerId?: string | null; userOfferId?: string | null } = {}) {
    return this.prisma.offerEvent.create({ data: { userId, type, actor, detail: detail as Prisma.InputJsonValue, offerId: ids.offerId ?? null, userOfferId: ids.userOfferId ?? null } });
  }

  private async merchants(): Promise<MerchantIdentity[]> {
    return this.prisma.merchant.findMany({ select: { id: true, slug: true, name: true, hosts: true, aliases: true, mcc: true, parentCompany: true } });
  }

  /** Parse pasted offers, resolve merchants, create them on the card and log an IMPORTED event for each. */
  async importText(userId: string, walletCardId: string, text: string) {
    const wc = await this.wallet.assertOwned(userId, walletCardId);
    const parsed = parseOfferText(text);
    const issuerId = (await this.prisma.creditCard.findUnique({ where: { id: wc.cardId }, select: { issuerId: true } }))?.issuerId ?? null;
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    let tracked = await this.prisma.userOffer.count({ where: { walletCard: { wallet: { userId } }, status: 'ACTIVE' } });
    const limit = limitsFor(sub).maxTrackedOffers;
    const merchants = await this.merchants();
    const existing = await this.prisma.userOffer.findMany({ where: { walletCardId }, select: { offer: { select: { merchantId: true, offerType: true, valueCents: true, percent: true, points: true, minSpendCents: true, endsAt: true } } } });
    const seen = new Set(existing.map((e) => offerKey({ merchantKey: e.offer.merchantId ?? '', offerType: e.offer.offerType, valueCents: e.offer.valueCents, percent: e.offer.percent == null ? null : Number(e.offer.percent), points: e.offer.points, minSpendCents: e.offer.minSpendCents, endsAt: e.offer.endsAt })));
    const created: Array<{ userOfferId: string; offerId: string; merchant: string | null; merchantConfidence: number | null }> = [];
    const skipped: Array<{ merchant: string; reason: string }> = [];
    for (const p of parsed.offers) {
      const res = resolveMerchant(p.merchantText, merchants);
      const trusted = isTrusted(res) ? res : null;
      const key = offerKey({ merchantKey: trusted?.merchantId ?? p.merchantText.toLowerCase(), offerType: p.offerType, valueCents: p.valueCents, percent: p.percent, points: p.points, minSpendCents: p.minSpendCents, endsAt: p.endsAt });
      if (seen.has(key)) {
        skipped.push({ merchant: p.merchantText, reason: 'already on this card' });
        continue;
      }
      if (tracked >= limit) {
        skipped.push({ merchant: p.merchantText, reason: 'plan limit reached' });
        continue;
      }
      seen.add(key);
      const source: OfferSourceKind = 'USER_ENTERED';
      const offer = await this.prisma.offer.create({
        data: {
          title: `${trusted?.name ?? p.merchantText}: ${p.raw.slice(0, 100)}`.slice(0, 140),
          description: p.raw.slice(0, 500),
          kind: KIND[p.offerType] ?? 'CASH',
          valueCents: p.valueCents,
          percent: p.percent,
          points: p.points,
          minSpendCents: p.minSpendCents,
          endsAt: p.endsAt,
          merchantId: trusted?.merchantId ?? null,
          issuerId,
          cardId: wc.cardId,
          isCustom: true,
          createdById: userId,
          source: source as OfferSource,
          reliability: reliabilityOf(source),
          offerType: p.offerType as OfferType,
          verification: 'UNVERIFIED',
        },
      });
      const uo = await this.prisma.userOffer.create({ data: { walletCardId, offerId: offer.id, activationStatus: 'PENDING' } });
      tracked++;
      await this.event(userId, 'IMPORTED', 'USER', { source, reliability: reliabilityOf(source), line: p.raw.slice(0, 200), merchantMatch: res ? { name: res.name, via: res.via, confidence: res.confidence, trusted: !!trusted } : null, issues: p.issues }, { offerId: offer.id, userOfferId: uo.id });
      created.push({ userOfferId: uo.id, offerId: offer.id, merchant: trusted?.name ?? null, merchantConfidence: res?.confidence ?? null });
    }
    return { created, skipped, rejected: parsed.rejected };
  }

  /** Every offer on the user's cards with source, reliability, verification, activation and the confidence ceiling. */
  async inventory(userId: string, q: { walletCardId?: string; source?: OfferSource; activation?: string } = {}) {
    if (q.walletCardId) await this.wallet.assertOwned(userId, q.walletCardId);
    const rows = await this.prisma.userOffer.findMany({
      where: {
        walletCard: { wallet: { userId } },
        ...(q.walletCardId && { walletCardId: q.walletCardId }),
        ...(q.source && { offer: { source: q.source } }),
        ...(q.activation && { activationStatus: q.activation as never }),
      },
      include: {
        offer: { include: { merchant: { select: { id: true, name: true, slug: true, parentCompany: true } }, issuer: { select: { id: true, name: true, offersUrl: true } } } },
        walletCard: { select: { id: true, nickname: true, card: { select: { name: true } } } },
      },
      orderBy: { addedAt: 'desc' },
      take: 500,
    });
    return rows.map((r) => ({
      id: r.id,
      offerId: r.offerId,
      title: r.offer.title,
      merchant: r.offer.merchant,
      card: r.walletCard.nickname || r.walletCard.card.name,
      walletCardId: r.walletCardId,
      offerType: r.offer.offerType,
      valueCents: r.offer.valueCents,
      percent: r.offer.percent,
      points: r.offer.points,
      minSpendCents: r.offer.minSpendCents,
      endsAt: r.offer.endsAt,
      source: r.offer.source,
      reliability: r.offer.reliability,
      verification: r.offer.verification,
      confidenceCap: confidenceCap(r.offer.source as OfferSourceKind, r.offer.verification),
      enrollmentRequired: r.offer.enrollmentRequired,
      activationStatus: r.activationStatus,
      activatedAt: r.activatedAt,
      activationVerifiedBy: r.activationVerifiedBy,
      status: r.status,
      offersUrl: r.offer.issuer?.offersUrl ?? null,
    }));
  }

  async events(userId: string, q: { offerId?: string; limit?: number } = {}) {
    return this.prisma.offerEvent.findMany({ where: { userId, ...(q.offerId && { offerId: q.offerId }) }, orderBy: { createdAt: 'desc' }, take: Math.min(q.limit ?? 100, 500) });
  }

  /** Assisted activation: the user adds the offer on the issuer's own page, then records it here. */
  async setActivation(userId: string, userOfferId: string, status: 'ACTIVATED' | 'FAILED' | 'PENDING', note?: string) {
    const uo = await this.prisma.userOffer.findUnique({ where: { id: userOfferId }, include: { walletCard: { include: { wallet: true } }, offer: true } });
    if (!uo) throw new NotFoundException('Offer not found');
    if (uo.walletCard.wallet.userId !== userId) throw new ForbiddenException('Not your offer');
    if (!uo.offer.enrollmentRequired) throw new BadRequestException('This offer needs no activation');
    const activated = status === 'ACTIVATED';
    const row = await this.prisma.userOffer.update({
      where: { id: userOfferId },
      data: { activationStatus: status, activatedAt: activated ? new Date() : null, activationVerifiedBy: activated ? 'MANUAL' : null },
    });
    await this.event(userId, status === 'FAILED' ? 'ACTIVATION_FAILED' : 'ACTIVATED', 'USER', { status, note: note?.slice(0, 300) ?? null, verifiedBy: activated ? 'MANUAL' : null }, { offerId: uo.offerId, userOfferId });
    return row;
  }

  /** Offers still to activate, with the issuer's public offers page (opened in the user's own browser). Highest value first. */
  async activationQueue(userId: string) {
    const now = new Date();
    const rows = await this.prisma.userOffer.findMany({
      where: { walletCard: { wallet: { userId } }, status: 'ACTIVE', activationStatus: { in: ['PENDING', 'FAILED'] }, offer: { enrollmentRequired: true, isActive: true, OR: [{ endsAt: null }, { endsAt: { gte: now } }] } },
      include: { offer: { include: { merchant: { select: { name: true } }, issuer: { select: { name: true, offersUrl: true } } } }, walletCard: { select: { id: true, nickname: true, card: { select: { name: true } } } } },
    });
    const items = rows.map((r) => ({
      userOfferId: r.id,
      title: r.offer.title,
      merchant: r.offer.merchant?.name ?? null,
      card: r.walletCard.nickname || r.walletCard.card.name,
      walletCardId: r.walletCardId,
      valueCents: r.offer.valueCents,
      endsAt: r.offer.endsAt,
      daysLeft: r.offer.endsAt ? Math.max(0, Math.ceil((r.offer.endsAt.getTime() - now.getTime()) / 86_400_000)) : null,
      activationStatus: r.activationStatus,
      offersUrl: r.offer.issuer?.offersUrl ?? null,
      issuer: r.offer.issuer?.name ?? null,
    }));
    // soonest to expire first, then largest value
    items.sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999) || b.valueCents - a.valueCents);
    return items;
  }
}

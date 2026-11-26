import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { WalletService } from '../wallet/wallet.service';
import { resolveMerchant } from '../domain/merchant-resolve';
import { rankCards } from '../domain/recommendation.engine';
import { Plan, planPurchase, PlanCard, PlanOffer } from '../domain/purchase-plan';
import { OfferIntelService } from './offer-intel.service';
import { OfferCoreService } from './offer-core.service';

/** Detection, scoring, timeline and planning over the user's own offers, transactions and cards. All numbers come from the pure engines. */
@Injectable()
export class OfferAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly recs: RecommendationsService,
    private readonly intel: OfferIntelService,
    private readonly core: OfferCoreService,
  ) {}

  missed(userId: string, now = new Date()) {
    return this.core.missed(userId, now);
  }

  opportunities(userId: string, now = new Date()) {
    return this.core.opportunities(userId, now);
  }

  timeline(slug: string, now = new Date()) {
    return this.core.timeline(slug, now);
  }

  /** "I am about to spend $X at Y": ranked plans over every card in the household, with evidence. */
  async plan(userId: string, dto: { merchantId?: string; merchantText?: string; amountCents: number; plannedFor?: string; save?: boolean }, now = new Date()) {
    let merchant: { id: string; name: string; categoryId: string; category: { parentId: string | null } } | null = null;
    let merchantConfidence = 1;
    if (dto.merchantId) {
      merchant = await this.prisma.merchant.findUnique({ where: { id: dto.merchantId }, select: { id: true, name: true, categoryId: true, category: { select: { parentId: true } } } });
      if (!merchant) throw new NotFoundException('Merchant not found');
    } else if (dto.merchantText) {
      const res = resolveMerchant(dto.merchantText, await this.core.merchants());
      if (res) {
        merchantConfidence = res.confidence;
        merchant = await this.prisma.merchant.findUnique({ where: { id: res.merchantId }, select: { id: true, name: true, categoryId: true, category: { select: { parentId: true } } } });
      }
    }
    const name = merchant?.name ?? dto.merchantText ?? 'merchant';
    const ctx = await this.recs.context(userId);
    const ranked = rankCards(
      ctx.cards,
      merchant ? { categoryId: merchant.categoryId, parentCategoryId: merchant.category.parentId, merchantId: merchant.id, fallbackCategoryId: ctx.fallbackCategoryId } : { categoryId: ctx.fallbackCategoryId, fallbackCategoryId: ctx.fallbackCategoryId },
      { valuations: ctx.valuations },
    );
    const profiles = new Map((await this.prisma.profile.findMany({ where: { userId }, select: { id: true, nickname: true } })).map((p) => [p.id, p.nickname]));
    const dc = new Map(ctx.cards.map((c) => [c.id, c]));
    const cards: PlanCard[] = ranked.map((r) => {
      const c = dc.get(r.walletCardId);
      return { walletCardId: r.walletCardId, cardName: r.name, member: c?.profileId ? profiles.get(c.profileId) ?? null : null, isAuthorizedUser: c?.cardholder === 'AUTHORIZED_USER', centsPerDollar: r.centsPerDollar, earnReason: r.reason };
    });
    const at = dto.plannedFor ? new Date(dto.plannedFor) : now;
    const offers: PlanOffer[] = merchant ? (await this.core.holdings(userId, at)).filter((x) => x.row.merchantId === merchant!.id).map((x) => ({ terms: x.offer, title: x.row.title, eligibleWalletCardIds: x.eligibleWalletCardIds, userOffers: x.userOffers, offersUrl: x.row.issuer?.offersUrl ?? null })) : [];
    const rates = merchant ? await this.prisma.portalRate.findMany({ where: { merchantId: merchant.id, OR: [{ expiresAt: null }, { expiresAt: { gte: at } }], ratePercent: { not: null } } }) : [];
    const plans: Plan[] = planPurchase({ merchant: { id: merchant?.id ?? null, name }, amountCents: dto.amountCents, now: at, cards, offers, portalRates: rates.map((r) => ({ portal: r.portal, ratePercent: Number(r.ratePercent), source: r.source, reliability: 50 })), merchantConfidence });
    // no recommendation without evidence: a plan with nothing to cite is dropped
    const supported = plans.filter((p) => p.evidence.length > 0);
    const best = supported[0] ?? null;
    if (best) {
      await this.intel.event(userId, 'RECOMMENDED', 'SYSTEM', { merchant: name, merchantConfidence, amountCents: dto.amountCents, kind: best.kind, legs: best.legs.map((l) => ({ walletCardId: l.walletCardId, amountCents: l.amountCents, earnCents: l.earnCents, offerCents: l.offerCents })), expectedCents: best.expectedCents, confidence: best.confidence, evidence: best.evidence, stackRules: best.stack.version, engine: 'purchase-plan/1' });
    }
    let plannedId: string | null = null;
    if (dto.save) {
      const row = await this.prisma.plannedPurchase.create({ data: { userId, merchantId: merchant?.id ?? null, merchantText: name, amountCents: dto.amountCents, plannedFor: dto.plannedFor ? new Date(dto.plannedFor) : null, result: (best ? JSON.parse(JSON.stringify(best)) : null) as Prisma.InputJsonValue } });
      plannedId = row.id;
    }
    return { merchant: merchant ? { id: merchant.id, name: merchant.name } : { id: null, name }, merchantConfidence, amountCents: dto.amountCents, plans: supported.slice(0, 5), plannedPurchaseId: plannedId };
  }

  async planned(userId: string) {
    return this.prisma.plannedPurchase.findMany({ where: { userId }, orderBy: [{ plannedFor: 'asc' }, { createdAt: 'desc' }], take: 100 });
  }

  async removePlanned(userId: string, id: string) {
    const r = await this.prisma.plannedPurchase.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Planned purchase not found');
  }
}

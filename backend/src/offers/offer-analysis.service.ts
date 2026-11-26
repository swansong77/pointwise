import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { WalletService } from '../wallet/wallet.service';
import { BenefitsService } from '../portfolio/benefits';
import { addMonths } from '../domain/dates';
import { hintForItem } from '../domain/item-category';
import { resolveMerchant } from '../domain/merchant-resolve';
import { offerValueCents } from '../domain/offer-engine';
import { bestTimeToBuy, certificateMatches, creditMatches, DatedValue, expiryImpact, memberAdvice, offerLabel, strategiesFor } from '../domain/plan-insights';
import { Plan, PLAN_VERSION, planPurchase, PlanBonus, PlanCard, PlanCertificate, PlanCredit, PlanOffer, PlanTransfer } from '../domain/purchase-plan';
import { rankCards } from '../domain/recommendation.engine';
import { OfferIntelService } from './offer-intel.service';
import { OfferCoreService } from './offer-core.service';
import { UpdatePlannedDto } from './offers.dto';

const DAY = 86_400_000;

export interface PlanRequest {
  merchantId?: string;
  merchantText?: string;
  amountCents: number;
  plannedFor?: string;
  save?: boolean;
  item?: string;
  category?: string;
  priority?: 'LOW' | 'MEDIUM' | 'HIGH';
  preferMember?: string;
  excludeCardIds?: string[];
  /** write the RECOMMENDED audit event (default true); dashboards that only look pass false */
  record?: boolean;
}

type MerchantRow = { id: string; name: string; parentCompany: string | null; categoryId: string; category: { slug: string; parentId: string | null } };
const merchantSelect = { id: true, name: true, parentCompany: true, categoryId: true, category: { select: { slug: true, parentId: true } } } as const;

/** Detection, scoring, timeline and planning over the user's own offers, transactions and cards. All numbers come from the pure engines. */
@Injectable()
export class OfferAnalysisService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly recs: RecommendationsService,
    private readonly intel: OfferIntelService,
    private readonly core: OfferCoreService,
    private readonly benefits: BenefitsService,
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

  /**
   * "I am about to buy X at Y for $Z": ranked plans over every card in the household with the offers, credits, certificates,
   * welcome-bonus progress and portal rates that apply, named strategies, what expires and when to buy, and who should pay.
   */
  async plan(userId: string, dto: PlanRequest, now = new Date()) {
    const itemHint = hintForItem(dto.item);
    let merchant: MerchantRow | null = null;
    let merchantConfidence = 1;
    let merchantGuessedFromItem = false;
    if (dto.merchantId) {
      merchant = await this.prisma.merchant.findUnique({ where: { id: dto.merchantId }, select: merchantSelect });
      if (!merchant) throw new NotFoundException('Merchant not found');
    } else {
      const text = dto.merchantText ?? itemHint?.merchantHint ?? null;
      if (text) {
        const res = resolveMerchant(text, await this.core.merchants());
        if (res) {
          merchantConfidence = dto.merchantText ? res.confidence : Math.min(res.confidence, itemHint?.confidence ?? 0.6);
          merchantGuessedFromItem = !dto.merchantText;
          merchant = await this.prisma.merchant.findUnique({ where: { id: res.merchantId }, select: merchantSelect });
        }
      }
    }
    const name = merchant?.name ?? dto.merchantText ?? dto.item ?? 'purchase';
    const at = dto.plannedFor ? new Date(dto.plannedFor) : now;

    // the spend category: the merchant's, else the one named, else what the item looks like
    const categories = await this.prisma.category.findMany({ select: { id: true, slug: true, parentId: true } });
    const bySlug = new Map(categories.map((c) => [c.slug, c]));
    const byId = new Map(categories.map((c) => [c.id, c]));
    const chosen = merchant ? { id: merchant.categoryId, slug: merchant.category.slug, parentId: merchant.category.parentId } : bySlug.get(dto.category ?? '') ?? bySlug.get(itemHint?.categorySlug ?? '') ?? null;
    const parentSlug = chosen?.parentId ? byId.get(chosen.parentId)?.slug ?? null : null;

    const ctx = await this.recs.context(userId);
    const exclude = new Set(dto.excludeCardIds ?? []);
    const wcs = ctx.cards.filter((c) => !exclude.has(c.id));
    const target = chosen
      ? { categoryId: chosen.id, parentCategoryId: chosen.parentId, merchantId: merchant?.id ?? null, fallbackCategoryId: ctx.fallbackCategoryId }
      : { categoryId: ctx.fallbackCategoryId, fallbackCategoryId: ctx.fallbackCategoryId };
    const ranked = rankCards(wcs, target, { valuations: ctx.valuations });

    const profiles = await this.prisma.profile.findMany({ where: { userId }, select: { id: true, nickname: true, isPrimary: true } });
    const nick = new Map(profiles.map((p) => [p.id, p.nickname]));
    const primary = profiles.find((p) => p.isPrimary) ?? null;
    const dc = new Map(wcs.map((c) => [c.id, c]));
    const memberOf = (profileId: string | null | undefined) => (profileId ? nick.get(profileId) ?? null : primary?.nickname ?? null);
    const cards: PlanCard[] = ranked.map((r) => {
      const c = dc.get(r.walletCardId);
      const isCash = !!c?.card.currency.isCash;
      return {
        walletCardId: r.walletCardId,
        cardName: r.name,
        member: memberOf(c?.profileId),
        isAuthorizedUser: c?.cardholder === 'AUTHORIZED_USER',
        centsPerDollar: r.centsPerDollar,
        earnReason: r.reason,
        isCash,
        pointsPerDollar: isCash ? undefined : r.effectiveMultiplier,
        centsPerPoint: r.centsPerPoint,
      };
    });
    const cardIds = new Set(cards.map((c) => c.walletCardId));

    // offers, portal rates
    const holdings = merchant ? (await this.core.holdings(userId, at)).filter((x) => x.row.merchantId === merchant!.id) : [];
    const offers: PlanOffer[] = holdings.map((x) => ({ terms: x.offer, title: offerLabel(name, { valueCents: x.offer.valueCents, percent: x.offer.percent, points: x.offer.points, minSpendCents: x.offer.minSpendCents }), eligibleWalletCardIds: x.eligibleWalletCardIds.filter((i) => cardIds.has(i)), userOffers: x.userOffers, offersUrl: x.row.issuer?.offersUrl ?? null }));
    const rates = merchant ? await this.prisma.portalRate.findMany({ where: { merchantId: merchant.id, OR: [{ expiresAt: null }, { expiresAt: { gte: at } }], ratePercent: { not: null } } }) : [];

    // credits the household has not used that cover this purchase
    const credits: PlanCredit[] = (await this.benefits.list(userId, {}, now))
      .filter((v) => v.enabled && v.kind === 'CREDIT' && v.walletCard.status === 'APPROVED' && cardIds.has(v.walletCard.id) && v.currentPeriod.remainingCents > 0)
      .filter((v) => creditMatches(v.autoRules, { merchantName: merchant?.name ?? null, item: dto.item ?? null, categorySlug: chosen?.slug ?? null, parentSlug }))
      .map((v) => ({ walletCardId: v.walletCard.id, title: v.name, remainingCents: v.currentPeriod.remainingCents, expiresOn: v.currentPeriod.lastDay ? new Date(v.currentPeriod.lastDay) : null, confidence: v.autoRules.suggested ? 60 : 85 }));

    // certificates (free night, companion, upgrade) held for this merchant's brand
    const certRows = merchant
      ? await this.prisma.loyaltyCertificate.findMany({
          where: { userId, status: 'AVAILABLE', potentialValueCents: { gt: 0 }, OR: [{ expiresAt: null }, { expiresAt: { gte: at } }] },
          include: { profile: { select: { id: true, nickname: true } }, program: { select: { name: true } } },
        })
      : [];
    const certificates: PlanCertificate[] = certRows
      .filter((c) => certificateMatches({ programName: c.program?.name ?? null, eligible: c.eligible }, { name: merchant!.name, parentCompany: merchant!.parentCompany }))
      .map((c) => ({ id: c.id, name: c.name, member: c.profile.id === primary?.id ? primary.nickname : c.profile.nickname, valueCents: c.potentialValueCents, expiresAt: c.expiresAt, confidence: Math.min(60, c.reliability + 35) }));

    // welcome bonuses still earnable, transfer partners, and fee context
    const bonuses: PlanBonus[] = [];
    const notes: Array<{ walletCardId: string; message: string }> = [];
    const rankedBy = new Map(ranked.map((r) => [r.walletCardId, r]));
    for (const wc of wcs) {
      const r = rankedBy.get(wc.id);
      if (!r) continue;
      const k = wc.card;
      if (!wc.bonusEarned && k.bonusSpendCents && k.bonusPoints && wc.approvedAt && k.bonusMonths) {
        const deadline = addMonths(wc.approvedAt, k.bonusMonths);
        const remaining = k.bonusSpendCents - wc.bonusSpendCents;
        if (deadline.getTime() >= at.getTime() && remaining > 0) bonuses.push({ walletCardId: wc.id, requiredCents: k.bonusSpendCents, remainingCents: remaining, bonusValueCents: Math.round(k.bonusPoints * r.centsPerPoint), deadline });
      }
      const fee = wc.annualFeeOverrideCents ?? k.annualFeeCents;
      if (fee > 0 && wc.approvedAt) {
        const next = new Date(Date.UTC(at.getUTCFullYear(), wc.approvedAt.getUTCMonth(), wc.approvedAt.getUTCDate()));
        if (next.getTime() < at.getTime()) next.setUTCFullYear(next.getUTCFullYear() + 1);
        const days = Math.round((next.getTime() - at.getTime()) / DAY);
        if (days >= 0 && days <= 30) notes.push({ walletCardId: wc.id, message: `${r.name}'s annual fee of $${(fee / 100).toFixed(0)} posts around ${next.toISOString().slice(0, 10)}; decide whether to keep the card before using it for a large purchase.` });
      }
    }
    const pointCards = wcs.filter((c) => !c.card.currency.isCash);
    const partners = pointCards.length ? await this.prisma.transferPartner.findMany({ where: { currencyId: { in: [...new Set(pointCards.map((c) => c.card.currency.id))] }, program: { isActive: true } }, include: { program: { select: { name: true, centsPerPoint: true } } } }) : [];
    const transfers: PlanTransfer[] = [];
    for (const wc of pointCards) {
      const cpp = rankedBy.get(wc.id)?.centsPerPoint ?? Number(wc.card.currency.centsPerPoint);
      let best: { cpp: number; name: string } | null = null;
      for (const t of partners.filter((p) => p.currencyId === wc.card.currency.id)) {
        const live = t.bonusPercent > 0 && (!t.bonusEndsAt || t.bonusEndsAt.getTime() >= at.getTime()) ? 1 + t.bonusPercent / 100 : 1;
        const v = Number(t.program.centsPerPoint) * (t.ratioTo / t.ratioFrom) * live;
        if (!best || v > best.cpp) best = { cpp: v, name: t.program.name };
      }
      if (best && best.cpp > cpp) transfers.push({ walletCardId: wc.id, upliftCentsPerPoint: best.cpp - cpp, partner: best.name, note: `${best.name} at about ${best.cpp.toFixed(1)}¢ a point (estimate) against ${cpp.toFixed(1)}¢ plain` });
    }

    const plans: Plan[] = planPurchase({
      merchant: { id: merchant?.id ?? null, name },
      amountCents: dto.amountCents,
      now: at,
      cards,
      offers,
      portalRates: rates.map((r) => ({ portal: r.portal, ratePercent: Number(r.ratePercent), source: r.source, reliability: 50 })),
      merchantConfidence,
      credits,
      certificates,
      bonuses,
      transfers,
      notes,
    });
    // no recommendation without evidence: a plan with nothing to cite is dropped
    const supported = plans.filter((p) => p.evidence.length > 0);
    const best = supported[0] ?? null;
    if (best && merchantGuessedFromItem) best.warnings.unshift(`No merchant was named; "${name}" was guessed from the item "${dto.item}". Confirm the merchant.`);
    if (best && !merchant && itemHint) best.warnings.unshift(`No merchant was named; the ${itemHint.label.toLowerCase()} was read as ${itemHint.categorySlug.replace(/-/g, ' ')} spend, so only card earning applies.`);

    // what lapses, the best day to buy, who should pay
    const dated: DatedValue[] = [];
    const seenOffers = new Set<string>();
    for (const o of offers) {
      if (seenOffers.has(o.terms.id) || !o.eligibleWalletCardIds.length) continue;
      seenOffers.add(o.terms.id);
      const v = offerValueCents(o.terms, dto.amountCents);
      if (v > 0) dated.push({ kind: 'OFFER', label: o.title, startsAt: o.terms.startsAt, endsAt: o.terms.endsAt, valueCents: v });
    }
    for (const c of credits) dated.push({ kind: 'CREDIT', label: c.title, startsAt: null, endsAt: c.expiresOn, valueCents: Math.min(c.remainingCents, dto.amountCents) });
    for (const c of certificates) dated.push({ kind: 'CERTIFICATE', label: c.name, startsAt: null, endsAt: c.expiresAt, valueCents: Math.min(c.valueCents, dto.amountCents) });
    const plannedFor = dto.plannedFor ? new Date(dto.plannedFor) : null;
    const expiry = expiryImpact(dated, plannedFor, now);
    const bestTime = bestTimeToBuy(dated, plannedFor, now);
    const strategies = strategiesFor(supported);
    const household = memberAdvice(supported);
    const preferredName = dto.preferMember ? nick.get(dto.preferMember) ?? null : null;
    const preferredOpt = dto.preferMember ? household.options.find((o) => o.member === preferredName) ?? null : null;
    const preferred = dto.preferMember ? { member: preferredName, available: !!preferredOpt, expectedCents: preferredOpt?.expectedCents ?? null, vsBestCents: preferredOpt && household.best ? household.best.expectedCents - preferredOpt.expectedCents : null } : null;

    if (best && dto.record !== false) {
      await this.intel.event(userId, 'RECOMMENDED', 'SYSTEM', { merchant: name, item: dto.item ?? null, merchantConfidence, amountCents: dto.amountCents, kind: best.kind, legs: best.legs.map((l) => ({ walletCardId: l.walletCardId, amountCents: l.amountCents, earnCents: l.earnCents, offerCents: l.offerCents })), expectedCents: best.expectedCents, confidence: best.confidence, evidence: best.evidence, stackRules: best.stack.version, engine: PLAN_VERSION });
    }
    const insights = { expiryImpact: expiry, bestTimeToBuy: bestTime, bestMember: household.best, memberReason: household.reason, strategies };
    let plannedId: string | null = null;
    if (dto.save) {
      const row = await this.prisma.plannedPurchase.create({
        data: {
          userId,
          merchantId: merchant?.id ?? null,
          merchantText: name,
          amountCents: dto.amountCents,
          plannedFor,
          item: dto.item ?? null,
          category: chosen?.slug ?? null,
          priority: dto.priority ?? null,
          expectedCents: best?.expectedCents ?? null,
          result: (best ? JSON.parse(JSON.stringify({ ...best, insights })) : null) as Prisma.InputJsonValue,
        },
      });
      plannedId = row.id;
    }
    return {
      merchant: merchant ? { id: merchant.id, name: merchant.name } : { id: null, name },
      merchantConfidence,
      amountCents: dto.amountCents,
      item: dto.item ?? null,
      itemHint,
      category: chosen ? { slug: chosen.slug } : null,
      plans: supported.slice(0, 5),
      strategies,
      expiryImpact: expiry,
      bestTimeToBuy: bestTime,
      household: { options: household.options, best: household.best, marginCents: household.marginCents, reason: household.reason, preferred },
      plannedPurchaseId: plannedId,
    };
  }

  async planned(userId: string) {
    return this.prisma.plannedPurchase.findMany({ where: { userId }, orderBy: [{ plannedFor: 'asc' }, { createdAt: 'desc' }], take: 100 });
  }

  async updatePlanned(userId: string, id: string, dto: UpdatePlannedDto) {
    const row = await this.prisma.plannedPurchase.findFirst({ where: { id, userId } });
    if (!row) throw new NotFoundException('Planned purchase not found');
    if (dto.chosenWalletCardId) await this.wallet.assertOwned(userId, dto.chosenWalletCardId);
    return this.prisma.plannedPurchase.update({
      where: { id },
      data: {
        ...(dto.status && { status: dto.status }),
        ...(dto.actualCents !== undefined && { actualCents: dto.actualCents }),
        ...(dto.chosenWalletCardId && { chosenWalletCardId: dto.chosenWalletCardId }),
        ...(dto.plannedFor && { plannedFor: new Date(dto.plannedFor) }),
        ...(dto.priority && { priority: dto.priority }),
      },
    });
  }

  async removePlanned(userId: string, id: string) {
    const r = await this.prisma.plannedPurchase.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Planned purchase not found');
  }
}

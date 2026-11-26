import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { BenefitAuditService } from "../benefit-audit/benefit-audit.module";
import { daysUntil, offerStats } from "../domain/offer-intel";
import {
  cardKindOf,
  enrich,
  RecInput,
  recentApplications,
  RecOutput,
  REC_ENGINE_VERSION,
  REC_WEIGHTS,
  selectRecommendation,
} from "../domain/recommendation-intel";
import { StrategyService } from "./strategy.service";

const MAX_CANDIDATES = 40;

/**
 * Smart next-card recommendation: the existing scorer's ranking enriched with goals, velocity, business
 * eligibility, balances, benefit utilization and offer timing, stored with an input snapshot and a factor
 * list so every recommendation can be audited. Deterministic engines only; nothing leaves the server.
 */
@Injectable()
export class SmartRecommendationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategy: StrategyService,
    private readonly benefits: BenefitAuditService,
  ) {}

  async smart(userId: string, q: { profileId?: string; limit?: number } = {}, now = new Date()) {
    const ranked = await this.strategy.nextCard(userId, { profileId: q.profileId, limit: 500 }, now);
    const profileId = ranked.member.profileId;
    const top = ranked.cards.slice(0, MAX_CANDIDATES);
    const ids = top.map((c) => c.cardId);

    const [profile, cards, history, wallet, balances, util] = await Promise.all([
      this.prisma.profile.findFirst({ where: { id: profileId, userId }, select: { goals: true, hasBusiness: true, creditBand: true } }),
      this.prisma.creditCard.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          type: true,
          annualFeeCents: true,
          offerExpiresAt: true,
          currency: { select: { code: true, name: true, isCash: true } },
        },
      }),
      this.prisma.cardOffer.findMany({
        where: { cardId: { in: ids }, kind: "WELCOME" },
        select: { cardId: true, bonusAmount: true, valuationCents: true, validFrom: true, validTo: true },
        orderBy: { validFrom: "asc" },
      }),
      this.prisma.walletCard.findMany({
        where: { wallet: { userId }, approvedAt: { not: null }, status: { in: ["APPROVED", "CLOSED"] } },
        select: { approvedAt: true, card: { select: { issuer: { select: { name: true } } } } },
      }),
      this.prisma.loyaltyBalance.findMany({
        where: { userId, profileId, currencyId: { not: null } },
        select: { points: true, currency: { select: { code: true, centsPerPoint: true } } },
      }),
      this.benefits.rollupView(userId, "household", now).catch(() => null),
    ]);

    const meta = new Map(cards.map((c) => [c.id, c]));
    const apps = recentApplications(wallet.map((w) => w.approvedAt), now);
    const since = (m: number) => now.getTime() - m * 30.4375 * 86_400_000;
    const activity = {
      newAccountsAny: (m: number) => wallet.filter((w) => w.approvedAt!.getTime() >= since(m)).length,
      newAccountsAt: (issuer: string, m: number) => wallet.filter((w) => w.card.issuer.name === issuer && w.approvedAt!.getTime() >= since(m)).length,
    };
    const balanceValue: Record<string, number> = {};
    for (const b of balances) if (b.currency) balanceValue[b.currency.code] = (balanceValue[b.currency.code] ?? 0) + Math.round(b.points * Number(b.currency.centsPerPoint));
    const utilization = util && util.groups[0] && util.groups[0].allocatedCents > 0 ? util.groups[0].utilizationPct : null;
    const user: RecInput["user"] = {
      goals: profile?.goals ?? [],
      hasBusiness: profile?.hasBusiness ?? false,
      creditBandKnown: !!profile?.creditBand,
      appsLast6m: apps.last6m,
      appsLast12m: apps.last12m,
      balanceValueByCurrencyCents: balanceValue,
      benefitUtilizationPct: utilization,
    };

    const outs: RecOutput[] = top.map((s) => {
      const m = meta.get(s.cardId);
      const stats = offerStats(history.filter((h) => h.cardId === s.cardId), now);
      return enrich({
        score: s,
        card: { kind: cardKindOf(m?.currency ?? null), isBusiness: m?.type === "BUSINESS", currencyCode: m?.currency.code ?? null, annualFeeCents: m?.annualFeeCents ?? 0 },
        user,
        offer: { verdict: stats.verdict, daysToExpiry: daysUntil(m?.offerExpiresAt, now), bestEverCents: stats.bestEverCents, currentValueCents: stats.currentValueCents },
        activity,
      });
    });
    const pick = selectRecommendation(outs);
    const stored = [pick.recommended, ...pick.alternatives].filter((o): o is RecOutput => !!o);
    const ids2: Record<string, string> = {};
    for (const o of stored) ids2[o.cardId] = await this.store(userId, profileId, o, user);

    const lim = Math.min(q.limit ?? 10, 50);
    return {
      engine: REC_ENGINE_VERSION,
      member: ranked.member,
      recommended: pick.recommended && { ...pick.recommended, recommendationId: ids2[pick.recommended.cardId] },
      alternatives: pick.alternatives.map((o) => ({ ...o, recommendationId: ids2[o.cardId] })),
      others: outs.filter((o) => !stored.includes(o)).sort((a, b) => b.adjustedScoreCents - a.adjustedScoreCents).slice(0, lim),
      inputs: { goals: user.goals, appsLast6m: user.appsLast6m, hasBusiness: user.hasBusiness, creditBandKnown: user.creditBandKnown, benefitUtilizationPct: user.benefitUtilizationPct },
      disclaimer: "Estimates from your data and catalog terms — not financial or credit advice. Application probability is an estimate; approval is up to the issuer.",
    };
  }

  private async store(userId: string, profileId: string, o: RecOutput, user: RecInput["user"]): Promise<string> {
    const rec = await this.prisma.recommendation.create({
      data: {
        userId,
        profileId,
        cardId: o.cardId,
        engineVersion: REC_ENGINE_VERSION,
        // counts and flags only: no card numbers, names or balances in points
        inputs: {
          goals: user.goals,
          hasBusiness: user.hasBusiness,
          creditBandKnown: user.creditBandKnown,
          appsLast6m: user.appsLast6m,
          appsLast12m: user.appsLast12m,
          benefitUtilizationPct: user.benefitUtilizationPct,
          balanceCurrencies: Object.keys(user.balanceValueByCurrencyCents),
        } as Prisma.InputJsonValue,
        weights: REC_WEIGHTS as unknown as Prisma.InputJsonValue,
        scoreCents: o.adjustedScoreCents,
        firstYearValueCents: o.firstYearValueCents,
        longTermValueCents: o.longTermValueCents,
        probability: o.probability,
        confidence: o.confidence,
        eligible: o.eligible,
        risks: o.risks as Prisma.InputJsonValue,
        advice: o.advice as unknown as Prisma.InputJsonValue,
        factors: { create: o.factors.map((f) => ({ key: f.key, label: f.label, deltaCents: f.deltaCents, note: f.note })) },
      },
    });
    return rec.id;
  }

  /** The stored inputs, weights and factor list behind one recommendation (owner only). */
  async audit(userId: string, id: string) {
    const r = await this.prisma.recommendation.findFirst({
      where: { id, userId },
      include: { factors: true },
    });
    if (!r) throw new NotFoundException("Recommendation not found");
    const card = await this.prisma.creditCard.findUnique({ where: { id: r.cardId }, select: { name: true, slug: true } });
    return {
      id: r.id,
      createdAt: r.createdAt,
      engineVersion: r.engineVersion,
      card,
      inputs: r.inputs,
      weights: r.weights,
      scoreCents: r.scoreCents,
      firstYearValueCents: r.firstYearValueCents,
      longTermValueCents: r.longTermValueCents,
      probability: r.probability,
      probabilityIsEstimate: true,
      confidence: r.confidence,
      eligible: r.eligible,
      risks: r.risks,
      advice: r.advice,
      factors: r.factors.map((f) => ({ key: f.key, label: f.label, deltaCents: f.deltaCents, note: f.note })),
    };
  }
}

import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { applicationDifficulty, offerAdvice, OFFER_CONFIG, OFFER_ENGINE_VERSION } from "../domain/offer-intel";
import { StrategyService } from "../strategy/strategy.service";
import { CardRefreshService } from "./card-refresh.service";

const DAY = 86_400_000;

/**
 * The offer dashboard: every current welcome offer with its history position (public data), and — for the
 * signed-in user — eligibility, 5/24 impact, first-year and long-term value, application difficulty and
 * advice. Everything is computed here by deterministic engines; no model is involved and no user data leaves
 * the server (ADR-004).
 */
@Injectable()
export class OfferMarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refresh: CardRefreshService,
    private readonly strategy: StrategyService,
  ) {}

  async market(userId: string, now = new Date()) {
    const [offers, ranked, opened] = await Promise.all([
      this.refresh.welcomeBonuses({}, now),
      this.strategy.nextCard(userId, { limit: 500 }, now),
      this.prisma.walletCard.findMany({
        where: { wallet: { userId }, approvedAt: { not: null }, status: { in: ["APPROVED", "CLOSED"] } },
        select: { approvedAt: true, card: { select: { issuer: { select: { name: true } } } } },
      }),
    ]);
    const scoreBySlug = new Map(ranked.cards.map((c) => [c.slug, c]));
    const since = (months: number) => now.getTime() - months * 30.4375 * DAY;
    const activity = {
      newAccountsAny: (m: number) => opened.filter((o) => o.approvedAt!.getTime() >= since(m)).length,
      newAccountsAt: (issuer: string, m: number) =>
        opened.filter((o) => o.card.issuer.name === issuer && o.approvedAt!.getTime() >= since(m)).length,
    };

    // for offers the main applicant is blocked from, find a household member who is not
    const blocked = offers.filter((o) => scoreBySlug.get(o.slug)?.eligible === false).slice(0, 8);
    const alternates = new Map<string, string | null>();
    for (const o of blocked) {
      try {
        const w = await this.strategy.whoShouldApply(userId, o.slug, {}, now);
        alternates.set(o.slug, w.best && w.best.member !== ranked.member.nickname ? w.best.member : null);
      } catch {
        alternates.set(o.slug, null);
      }
    }

    const rows = offers.map((o) => {
      const me = scoreBySlug.get(o.slug) ?? null;
      const held = activity.newAccountsAt(o.issuer, 24);
      const difficulty = applicationDifficulty(o.issuer, { ...activity, holdsProduct: false });
      const advice = offerAdvice({
        verdict: o.verdict,
        daysToExpiry: o.daysToExpiry,
        bestEverCents: o.bestEverCents,
        currentValueCents: o.valuationCents,
        applicantBlocked: me ? !me.eligible : false,
        alternateMember: alternates.get(o.slug) ?? null,
      });
      return {
        ...o,
        advice,
        difficulty,
        recentAtIssuer: held,
        you: me && {
          eligible: me.eligible,
          blockers: me.blockers,
          warnings: me.warnings,
          firstYearValueCents: me.firstYearValueCents,
          longTermValueCents: me.longTermValueCents,
          approvalOdds: me.approvalOdds,
          five24: me.five24,
          confidence: me.confidence,
        },
      };
    });

    const byExpiry = rows
      .filter((r) => r.daysToExpiry != null && r.daysToExpiry >= 0 && r.daysToExpiry <= OFFER_CONFIG.soonDays)
      .sort((a, b) => (a.daysToExpiry as number) - (b.daysToExpiry as number));
    const highs = rows
      .filter((r) => r.verdict === "BEST_EVER" || r.verdict === "NEAR_HIGH")
      .sort((a, b) => (b.valuationCents ?? 0) - (a.valuationCents ?? 0));
    const recommended =
      rows
        .filter((r) => r.you?.eligible)
        .sort((a, b) => (b.you?.firstYearValueCents ?? 0) - (a.you?.firstYearValueCents ?? 0))[0] ?? null;

    return {
      engine: OFFER_ENGINE_VERSION,
      member: ranked.member,
      offers: rows,
      expiringSoon: byExpiry.map((r) => r.slug),
      historicalHighs: highs.map((r) => r.slug),
      recommended: recommended && {
        slug: recommended.slug,
        card: recommended.card,
        why: `Highest first-year value among cards you are eligible for (${recommended.verdict.toLowerCase().replace("_", " ")} offer).`,
      },
      disclaimer: "Offer data comes from the card catalog; estimates are not financial advice. Rules marked community-reported are not confirmed by the issuer.",
    };
  }
}

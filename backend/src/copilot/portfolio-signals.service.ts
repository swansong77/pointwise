import { Injectable } from '@nestjs/common';
import { householdNextCards } from '../domain/card-scorer';
import { cardVerdicts, CardReview, MonthlySignals } from '../domain/copilot-brief';
import { upcomingRenewals } from '../domain/insights';
import { PortfolioService } from '../portfolio/portfolio';
import { StrategyService } from '../strategy/strategy.service';

const DAY = 86_400_000;

/** What each card returned against its fee, the household's 5/24 and its best next application, for reviews and reports. */
@Injectable()
export class PortfolioSignalsService {
  constructor(
    private readonly portfolio: PortfolioService,
    private readonly strategy: StrategyService,
  ) {}

  async monthlySignals(userId: string, now: Date): Promise<MonthlySignals> {
    const [ctx, pf, f24] = await Promise.all([this.strategy.scoringContext(userId, {}, now), this.portfolio.portfolio(userId, {}, now), this.portfolio.five24(userId, {}, now)]);
    const renewals = new Map(upcomingRenewals(ctx.household, now, 400).map((r) => [r.walletCardId, r.daysUntil]));
    const cards: CardReview[] = [...pf.groups.active, ...pf.groups.authorizedUser]
      .filter((c) => c.status === 'APPROVED')
      .map((c) => {
        const wc = ctx.household.find((h) => h.id === c.walletCardId);
        const family = wc ? ctx.cards.find((x) => x.id === wc.card.id)?.productFamily : null;
        return {
          card: c.name,
          feeCents: c.annualFeeCents,
          valueCents: c.realizedBenefitCents + c.rewardsCents,
          daysToRenewal: renewals.get(c.walletCardId) ?? null,
          hasSiblingNoFee: !!family && ctx.cards.some((x) => x.productFamily === family && x.id !== wc?.card.id && x.annualFeeCents === 0),
          openedMonths: wc?.approvedAt ? Math.floor((now.getTime() - wc.approvedAt.getTime()) / (30.44 * DAY)) : null,
        };
      });
    const pick = householdNextCards(ctx.cards, ctx.applicants, ctx.household, ctx.spend.lines, ctx.opt, 1).pick;
    return {
      cards,
      applyPick: pick ? { member: pick.member, card: pick.name, firstYearCents: pick.firstYearValueCents, usesSlot: pick.five24.countsToward && pick.five24.slotCostCents > 0 } : null,
      members: f24.members.map((m) => ({ member: m.profile.nickname, count: m.status.count, underLimit: m.status.underLimit, nextSlotAt: m.status.nextSlotAt })),
      feesCents: cards.reduce((s, c) => s + c.feeCents, 0),
      valueCents: cards.reduce((s, c) => s + c.valueCents, 0),
    };
  }

  /** fees against what the cards returned, the cards worth a decision, and who the household's next application would be */
  async portfolioSummary(userId: string, now: Date) {
    const m = await this.monthlySignals(userId, now);
    const v = cardVerdicts(m.cards);
    return { feesCents: m.feesCents, valueCents: m.valueCents, cards: m.cards.length, toReview: v.filter((x) => x.verdict !== 'KEEP').length, verdicts: v, members: m.members, applyPick: m.applyPick };
  }

  /** twelve-month totals across the cards you hold: what they earned, the credits used and missed, and the fees */
  async portfolioTotals(userId: string, now: Date) {
    const pf = await this.portfolio.portfolio(userId, {}, now);
    const cards = pf.groups.active;
    const sum = (f: (c: (typeof cards)[number]) => number) => cards.reduce((t, c) => t + f(c), 0);
    return { rewardsCents: sum((c) => c.rewardsCents), realizedBenefitCents: sum((c) => c.realizedBenefitCents), faceBenefitCents: sum((c) => c.faceBenefitCents), missedBenefitCents: sum((c) => c.missedBenefitCents), feesCents: sum((c) => c.annualFeeCents) };
  }
}

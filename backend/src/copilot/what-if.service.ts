import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { calculateWalletValue, annualFee } from '../domain/calculator';
import { asWalletCard, CardScore, CandidateCard, DEFAULT_BENEFIT_USE_RATE, householdNextCards, scoreCard, whoShouldApply } from '../domain/card-scorer';
import { upcomingRenewals } from '../domain/insights';
import { applyOutcome, ApplyRow, cancelOutcome, changeOutcome, transferOutcome, waitOutcome, WhatIfOutcome, WhatIfRequest } from '../domain/what-if';
import { OfferDashboardsService } from '../offers/offer-dashboards.service';
import { PortfolioService } from '../portfolio/portfolio';
import { StrategyService } from '../strategy/strategy.service';
import { WalletService } from '../wallet/wallet.service';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const named = (a: string, b: string) => {
  const x = norm(a);
  const y = norm(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/** the scorer keeps spend per month; the wallet calculator wants it per year */
const annual = (lines: Array<{ categoryId: string; monthlyCents: number }>) => lines.map((l) => ({ categoryId: l.categoryId, annualSpendCents: l.monthlyCents * 12 }));

const row = (s: CardScore): ApplyRow => ({
  profileId: s.profileId,
  member: s.member,
  eligible: s.eligible,
  blockers: s.blockers,
  firstYearValueCents: s.firstYearValueCents,
  longTermValueCents: s.longTermValueCents,
  benefitsCents: s.components.benefitsCents,
  five24: { before: s.five24.before, after: s.five24.after, countsToward: s.five24.countsToward, slotCostCents: s.five24.slotCostCents },
  confidence: s.confidence,
});

/**
 * What-if analysis on the household's own data: gathers what the existing engines know and runs the pure scenarios. It only reads;
 * "apply", "cancel" and "transfer" are compared, never done.
 */
@Injectable()
export class WhatIfService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategy: StrategyService,
    private readonly portfolio: PortfolioService,
    private readonly wallet: WalletService,
    private readonly dashboards: OfferDashboardsService,
  ) {}

  async run(userId: string, req: WhatIfRequest, now = new Date()): Promise<WhatIfOutcome> {
    switch (req.type) {
      case 'APPLY':
        return this.apply(userId, req, now);
      case 'WAIT':
        return this.wait(userId, req.days, now);
      case 'TRANSFER':
        return this.transfer(userId, req, now);
      case 'CANCEL':
        return this.cancel(userId, req, now);
      case 'CHANGE':
        return this.change(userId, req, now);
    }
  }

  private findCandidate(cards: CandidateCard[], ref: { id?: string; name?: string; slug?: string } | null): CandidateCard | null {
    if (!ref) return null;
    return cards.find((c) => c.id === ref.id || (ref.slug && c.slug === ref.slug)) ?? cards.find((c) => ref.name && named(c.name, ref.name)) ?? null;
  }

  private async apply(userId: string, req: Extract<WhatIfRequest, { type: 'APPLY' }>, now: Date) {
    const ctx = await this.strategy.scoringContext(userId, {}, now);
    let card = this.findCandidate(ctx.cards, req.card);
    let assumedCard = false;
    if (!card) {
      // no card named: use the card the household is already best placed to open
      const plan = householdNextCards(ctx.cards, ctx.applicants, ctx.household, ctx.spend.lines, ctx.opt, 1);
      card = plan.pick ? (ctx.cards.find((c) => c.id === plan.pick!.cardId) ?? null) : null;
      assumedCard = true;
    }
    if (!card) throw new NotFoundException('There is no card to compare right now.');
    const target = ctx.applicants.find((a) => a.profileId === req.memberId);
    if (!target) throw new BadRequestException('Say who would apply.');
    const ranking = ctx.applicants.map((a) => scoreCard(card!, a, ctx.household, ctx.spend.lines, ctx.opt));
    const choice = whoShouldApply(card, ctx.applicants, ctx.household, ctx.spend.lines, ctx.opt);
    const targetRow = ranking.find((r) => r.profileId === target.profileId)!;
    const out = applyOutcome(card.name, choice.best ? row(choice.best) : null, row(targetRow), ranking.map(row));
    if (assumedCard) out.assumptions.unshift(`No card was named, so this uses ${card.name}, the best next card for your household.`);
    return out;
  }

  private async wait(userId: string, days: number, now: Date) {
    const [f24, exp, cards] = await Promise.all([this.portfolio.five24(userId, {}, now), this.dashboards.expirations(userId, now), this.wallet.domainCards(userId)]);
    const later = new Date(now.getTime() + days * 86_400_000);
    const items = exp.buckets.flatMap((b) => b.items).map((i) => ({ label: i.label, endsAt: new Date(i.endsAt), valueCents: i.valueCents }));
    const renewals = upcomingRenewals(cards, now, Math.ceil(days)).map((r) => ({ card: r.name, renewsOn: r.renewsAt, feeCents: r.annualFeeCents }));
    const members = f24.members.map((m) => ({ member: m.profile.nickname, count: m.status.count, drops: m.status.contributing.map((c) => c.dropsOffAt as Date) }));
    void later;
    return waitOutcome({ days, now, members, items, renewals });
  }

  private async transfer(userId: string, req: Extract<WhatIfRequest, { type: 'TRANSFER' }>, now: Date) {
    if (!req.program || !req.points) throw new BadRequestException('Say which program and how many points.');
    const partners = await this.strategy.partners({}, now);
    const program = partners.programs.find((p) => named(p.name, req.program!));
    if (!program) throw new NotFoundException(`I could not find the program “${req.program}”.`);
    const plan = await this.strategy.plan(userId, { program: program.code, points: req.points }, now);
    return transferOutcome(plan as never, 0);
  }

  private async cancel(userId: string, req: Extract<WhatIfRequest, { type: 'CANCEL' }>, now: Date) {
    const [ctx, pf] = await Promise.all([this.strategy.scoringContext(userId, {}, now), this.portfolio.portfolio(userId, {}, now)]);
    const wc = ctx.household.find((h) => h.id === req.card?.walletCardId) ?? ctx.household.find((h) => req.card && (named(h.nickname ?? '', req.card.name) || named(h.card.name, req.card.name)));
    if (!wc) throw new NotFoundException(`I could not find ${req.card?.name ?? 'that card'} in your wallet.`);
    const before = calculateWalletValue(ctx.household, annual(ctx.spend.lines), ctx.opt);
    const without = ctx.household.filter((h) => h.id !== wc.id);
    const after = calculateWalletValue(without, annual(ctx.spend.lines), ctx.opt);
    const value = [...pf.groups.active, ...pf.groups.authorizedUser].find((c) => c.walletCardId === wc.id);
    const cats = await this.prisma.category.findMany({ where: { id: { in: before.categories.filter((c) => c.bestWalletCardId === wc.id).map((c) => c.categoryId) } }, select: { id: true, name: true } });
    const name = new Map(cats.map((c) => [c.id, c.name]));
    const changes = before.categories
      .filter((c) => c.bestWalletCardId === wc.id)
      .map((c, _i) => ({ category: name.get(c.categoryId) ?? 'Other', before: c.centsPerDollar, after: after.categories.find((a) => a.categoryId === c.categoryId)?.centsPerDollar ?? 0, spend: c.annualSpendCents }))
      .sort((a, b) => b.spend - a.spend);
    const renewal = upcomingRenewals([wc], now, 400)[0];
    const family = ctx.cards.find((c) => c.id === wc.card.id)?.productFamily;
    const sibling = family ? ctx.cards.some((c) => c.productFamily === family && c.id !== wc.card.id && c.annualFeeCents === 0) : false;
    const openedMonths = wc.approvedAt ? Math.floor((now.getTime() - wc.approvedAt.getTime()) / (30.44 * 86_400_000)) : null;
    return cancelOutcome({
      card: wc.nickname || wc.card.name,
      feeCents: annualFee(wc),
      rewardsLostCents: Math.max(0, before.grossRewardsCents - after.grossRewardsCents),
      benefitsUsedCents: value?.realizedBenefitCents ?? 0,
      benefitsAnnualCents: value?.faceBenefitCents ?? 0,
      daysToRenewal: renewal?.daysUntil ?? null,
      pointsOnCard: null,
      currency: wc.card.currency.code,
      categoryChanges: changes.map((c) => ({ category: c.category, before: Math.round(c.before * 10) / 10, after: Math.round(c.after * 10) / 10 })).filter((c) => c.before !== c.after),
      openedWithinMonths: openedMonths,
      hasSiblingNoFee: sibling,
    });
  }

  private async change(userId: string, req: Extract<WhatIfRequest, { type: 'CHANGE' }>, now: Date) {
    const ctx = await this.strategy.scoringContext(userId, {}, now);
    const from = ctx.household.find((h) => h.id === req.card?.walletCardId) ?? ctx.household.find((h) => req.card && (named(h.nickname ?? '', req.card.name) || named(h.card.name, req.card.name)));
    if (!from) throw new NotFoundException(`I could not find ${req.card?.name ?? 'that card'} in your wallet.`);
    const to = this.findCandidate(ctx.cards, req.to);
    if (!to) throw new NotFoundException(`I could not find ${req.to?.name ?? 'the new card'} in the catalog.`);
    const before = calculateWalletValue(ctx.household, annual(ctx.spend.lines), ctx.opt);
    const swapped = [...ctx.household.filter((h) => h.id !== from.id), { ...asWalletCard(to), approvedAt: from.approvedAt, profileId: from.profileId, cardholder: from.cardholder }];
    const after = calculateWalletValue(swapped, annual(ctx.spend.lines), ctx.opt);
    const fromCandidate = ctx.cards.find((c) => c.id === from.card.id);
    const family = fromCandidate?.productFamily;
    return changeOutcome({
      from: from.nickname || from.card.name,
      to: to.name,
      feeBeforeCents: annualFee(from),
      feeAfterCents: to.annualFeeCents,
      rewardsBeforeCents: before.grossRewardsCents,
      rewardsAfterCents: after.grossRewardsCents,
      benefitsBeforeCents: fromCandidate?.benefitsAnnualCents ?? 0,
      benefitsAfterCents: to.benefitsAnnualCents,
      useRate: ctx.opt.benefitUseRate ?? DEFAULT_BENEFIT_USE_RATE,
      sameFamily: !!family && family === to.productFamily,
    });
  }
}

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { calculateWalletValue } from '../domain/calculator';
import { AuCandidate, CategoryBest, householdChief, HouseholdMember } from '../domain/cos-household';
import { PortfolioService } from '../portfolio/portfolio';
import { StrategyService } from '../strategy/strategy.service';
import { ChiefService } from './chief.service';

/**
 * The household chief: what each member should do, who could be added as an authorized user, and which household card is best for the
 * categories the household spends most on. It suggests; it moves no spend and adds no one.
 */
@Injectable()
export class HouseholdChiefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly strategy: StrategyService,
    private readonly portfolio: PortfolioService,
    private readonly chief: ChiefService,
  ) {}

  async overview(userId: string, now = new Date()) {
    const [ctx, f24, profiles, wallet, { items }] = await Promise.all([
      this.strategy.scoringContext(userId, {}, now),
      this.portfolio.five24(userId, {}, now),
      this.prisma.profile.findMany({ where: { userId }, select: { id: true, nickname: true, relationship: true, birthYear: true, isPrimary: true } }),
      this.prisma.walletCard.findMany({ where: { wallet: { userId }, status: 'APPROVED' }, select: { id: true, profileId: true, cardholder: true, card: { select: { name: true, authorizedUserFeeCents: true } } } }),
      this.chief.items(userId, now),
    ]);
    const primary = profiles.find((p) => p.isPrimary);
    const owner = (profileId: string | null) => profileId ?? primary?.id ?? '';
    const nick = new Map(profiles.map((p) => [p.id, p.nickname]));

    const members: HouseholdMember[] = profiles.map((p) => {
      const f = f24.members.find((m) => m.profile.id === p.id);
      return {
        profileId: p.id,
        member: p.nickname,
        relationship: String(p.relationship),
        isPrimary: p.isPrimary,
        age: p.birthYear ? now.getUTCFullYear() - p.birthYear : null,
        five24: f ? { count: f.status.count, underLimit: f.status.underLimit } : null,
        cardsHeld: wallet.filter((w) => w.cardholder === 'PRIMARY' && owner(w.profileId) === p.id).length,
        authorizedOn: wallet.filter((w) => w.cardholder === 'AUTHORIZED_USER' && owner(w.profileId) === p.id).length,
      };
    });
    // a card that charges nothing for an authorized user (a fee of 0 is known; a missing fee is not assumed to be 0)
    const au: AuCandidate[] = wallet
      .filter((w) => w.cardholder === 'PRIMARY' && w.card.authorizedUserFeeCents != null)
      .map((w) => ({ card: w.card.name, holder: nick.get(owner(w.profileId)) ?? 'the account holder', feeCents: w.card.authorizedUserFeeCents as number }));

    const calc = calculateWalletValue(ctx.household, ctx.spend.lines.map((l) => ({ categoryId: l.categoryId, annualSpendCents: l.monthlyCents * 12 })), ctx.opt);
    const names = new Map((await this.prisma.category.findMany({ where: { id: { in: calc.categories.map((c) => c.categoryId) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
    const categories: CategoryBest[] = calc.categories
      .filter((c) => c.bestWalletCardId && c.annualSpendCents > 0)
      .sort((a, b) => b.annualSpendCents - a.annualSpendCents)
      .map((c) => {
        const wc = ctx.household.find((h) => h.id === c.bestWalletCardId);
        return { category: names.get(c.categoryId) ?? 'Other', card: c.bestCardName ?? '', holder: nick.get(owner(wc?.profileId ?? null)) ?? null, centsPerDollar: Math.round(c.centsPerDollar * 10) / 10, annualSpendCents: c.annualSpendCents };
      });
    return householdChief(members, items, au, categories);
  }
}

import { Controller, ForbiddenException, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser, MemberSafe } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { MemberContext } from '../domain/member-access';
import { benefitView, BenefitsModule, BenefitsService } from '../portfolio/benefits';
import { PortfolioModule, PortfolioService } from '../portfolio/portfolio';

/**
 * What a household member sees with their own sign-in ("My view"). Every query is pinned to the member's own profile inside the
 * owner's account (ctx.ownerId + ctx.profileId, resolved by the guard from the database). Read only. A member never reaches the
 * general routes: the guard denies everything not marked @MemberSafe.
 */
@Injectable()
export class MemberViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolio: PortfolioService,
    private readonly benefits: BenefitsService,
  ) {}

  async me(ctx: MemberContext, email: string) {
    const [p, hh] = await Promise.all([
      this.prisma.profile.findUniqueOrThrow({ where: { id: ctx.profileId }, select: { nickname: true, relationship: true, loginSince: true } }),
      this.prisma.household.findUnique({ where: { ownerId: ctx.ownerId }, select: { name: true } }),
    ]);
    return { email, nickname: p.nickname, relationship: p.relationship, since: p.loginSince, household: hh?.name ?? 'Household', visibility: ctx.visibility };
  }

  async overview(ctx: MemberContext, now = new Date()) {
    const { ownerId, profileId } = ctx;
    const [portfolio, benefitRows, loyalty, transactions] = await Promise.all([
      this.portfolio.portfolio(ownerId, { profileId }, now),
      this.benefits.rows(ownerId, { walletCard: { profileId } as never }),
      this.prisma.loyaltyAccount.findMany({
        where: { userId: ownerId, profileId },
        select: {
          id: true, nickname: true, customName: true, accountLast4: true, balance: true, pendingBalance: true, statusLevel: true,
          statusDeadline: true, expiresAt: true, lastActivityAt: true, program: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.transaction.findMany({
        where: { userId: ownerId, walletCard: { profileId } },
        orderBy: { occurredAt: 'desc' },
        take: 25,
        select: { id: true, amountCents: true, description: true, occurredAt: true, kind: true, walletCard: { select: { nickname: true, lastFour: true, card: { select: { name: true } } } } },
      }),
    ]);
    const benefits = benefitRows
      .filter((b) => b.enabled)
      .map((b) => benefitView(b, now))
      .map(({ usages: _u, autoRules: _a, notes: _n, howIssued: _h, ...v }) => v)
      .sort((a, b) => a.currentPeriod.end.getTime() - b.currentPeriod.end.getTime());
    return {
      asOf: now,
      cards: { groups: portfolio.groups, totals: portfolio.totals, counts: portfolio.counts },
      benefits,
      loyalty: loyalty.map((l) => ({ ...l, name: l.customName ?? l.program?.name ?? 'Loyalty account' })),
      transactions: transactions.map((t) => ({ id: t.id, amountCents: t.amountCents, description: t.description, occurredAt: t.occurredAt, kind: t.kind, card: t.walletCard.nickname || t.walletCard.card.name, lastFour: t.walletCard.lastFour })),
    };
  }

  /** Only for a member the owner made HOUSEHOLD-visible. Other members' sign-in details are never part of it. */
  async household(ctx: MemberContext, now = new Date()) {
    if (ctx.visibility !== 'HOUSEHOLD') throw new ForbiddenException('The household overview is not shared with this sign-in');
    const d = await this.portfolio.householdDashboard(ctx.ownerId, now);
    return {
      ...d,
      members: d.members.map((m) => ({ ...m, profile: { id: m.profile.id, nickname: m.profile.nickname, relationship: m.profile.relationship, cardCount: m.profile.cardCount } })),
    };
  }
}

const needMember = (u: AuthUser): MemberContext => {
  if (!u.member) throw new ForbiddenException('This is for household members who have their own sign-in');
  return u.member;
};

@ApiTags('member')
@ApiBearerAuth()
@MemberSafe()
@Controller('member')
export class MemberController {
  constructor(private readonly view: MemberViewService) {}

  @Get('me') me(@CurrentUser() u: AuthUser) {
    return this.view.me(needMember(u), u.email);
  }
  @Get('overview') overview(@CurrentUser() u: AuthUser) {
    return this.view.overview(needMember(u));
  }
  @Get('household') household(@CurrentUser() u: AuthUser) {
    return this.view.household(needMember(u));
  }
}

@Module({ imports: [PortfolioModule, BenefitsModule], controllers: [MemberController], providers: [MemberViewService] })
export class MemberModule {}

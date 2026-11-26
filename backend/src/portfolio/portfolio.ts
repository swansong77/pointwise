import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { toDomainWalletCard, walletCardInclude } from '../common/mappers';
import { PrismaService } from '../common/prisma.service';
import { annualFee } from '../domain/calculator';
import { five24Status, five24Timeline } from '../domain/five24';
import { toFive24Card } from '../domain/insights';
import { cardValue, rollupByHolder, sumValues } from '../domain/portfolio';
import { bestRuleForCard, effectiveCentsPerPoint } from '../domain/recommendation.engine';
import { benefitView, BenefitsModule, BenefitsService } from './benefits';
import { HouseholdsModule, HouseholdsService } from './households';

export class Five24Query {
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ default: 24 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) horizonMonths = 24;
}

export class PortfolioQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
}

const YEAR_MS = 365 * 86_400_000;

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
    private readonly benefits: BenefitsService,
  ) {}

  private async walletRows(userId: string) {
    return this.prisma.walletCard.findMany({
      where: { wallet: { userId } },
      include: { ...walletCardInclude, profile: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** 5/24 per household member (cards without a member belong to the primary member). */
  async five24(userId: string, q: Partial<Five24Query> = {}, now = new Date()) {
    const [members, rows] = await Promise.all([this.households.members(userId), this.walletRows(userId)]);
    const primary = members.find((m) => m.isPrimary);
    const ownerOf = (profileId: string | null) => profileId ?? primary?.id ?? null;
    const selected = q.profileId ? members.filter((m) => m.id === q.profileId) : members;
    return {
      asOf: now,
      members: selected.map((m) => {
        const cards = rows.filter((r) => ownerOf(r.profileId) === m.id).map((r) => toFive24Card(toDomainWalletCard(r)));
        return {
          profile: { id: m.id, nickname: m.nickname, relationship: m.relationship, isPrimary: m.isPrimary },
          status: five24Status(cards, now),
          timeline: five24Timeline(cards, now, q.horizonMonths ?? 24),
        };
      }),
    };
  }

  /** Rewards earned per wallet card from logged transactions in the last 12 months. */
  private async rewardsByCard(userId: string, rows: Awaited<ReturnType<PortfolioService['walletRows']>>, now: Date) {
    const [txs, valuations, categories] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId, kind: 'PURCHASE', occurredAt: { gte: new Date(now.getTime() - YEAR_MS), lte: now } },
        select: { walletCardId: true, amountCents: true, categoryId: true, merchantId: true },
      }),
      this.prisma.userValuation.findMany({ where: { userId } }),
      this.prisma.category.findMany({ select: { id: true, parentId: true, isFallback: true } }),
    ]);
    const vals = Object.fromEntries(valuations.map((v) => [v.currencyId, Number(v.centsPerPoint)]));
    const parent = new Map(categories.map((c) => [c.id, c.parentId]));
    const fallbackCategoryId = categories.find((c) => c.isFallback)?.id ?? null;
    const domain = new Map(rows.map((r) => [r.id, toDomainWalletCard(r)]));
    const out = new Map<string, { rewardsCents: number; spendCents: number; fallbackEarnRate: number | null }>();
    for (const [id, wc] of domain) {
      const fb = bestRuleForCard(wc, { categoryId: fallbackCategoryId, fallbackCategoryId }, now);
      out.set(id, { rewardsCents: 0, spendCents: 0, fallbackEarnRate: fb.multiplier ? (fb.multiplier * effectiveCentsPerPoint(wc, vals)) / 100 : null });
    }
    for (const t of txs) {
      const wc = domain.get(t.walletCardId);
      const acc = out.get(t.walletCardId);
      if (!wc || !acc || t.amountCents <= 0) continue;
      const { multiplier } = bestRuleForCard(
        wc,
        { categoryId: t.categoryId, parentCategoryId: t.categoryId ? parent.get(t.categoryId) : null, merchantId: t.merchantId, fallbackCategoryId },
        now,
      );
      acc.spendCents += t.amountCents;
      acc.rewardsCents += Math.round((t.amountCents * multiplier * effectiveCentsPerPoint(wc, vals)) / 100);
    }
    return out;
  }

  /** Card portfolio + value analytics per card, per cardholder and for the household. */
  async portfolio(userId: string, q: Partial<PortfolioQuery> = {}, now = new Date()) {
    const [members, rows, benefitRows] = await Promise.all([
      this.households.members(userId),
      this.walletRows(userId),
      this.benefits.rows(userId),
    ]);
    const primary = members.find((m) => m.isPrimary);
    const ownerOf = (profileId: string | null) => profileId ?? primary?.id ?? null;
    const rewards = await this.rewardsByCard(userId, rows, now);
    const views = benefitRows.filter((b) => b.enabled).map((b) => benefitView(b, now));

    const cards = rows
      .filter((r) => !q.profileId || ownerOf(r.profileId) === q.profileId)
      .map((r) => {
        const wc = toDomainWalletCard(r);
        const bs = views.filter((v) => v.walletCard.id === r.id);
        const rw = rewards.get(r.id) as { rewardsCents: number; spendCents: number; fallbackEarnRate: number | null };
        const isOpen = r.status === 'APPROVED';
        const value = cardValue({
          walletCardId: r.id,
          name: r.nickname || r.card.name,
          profileId: ownerOf(r.profileId),
          status: r.status,
          annualFeeCents: isOpen ? annualFee(wc) : 0,
          faceBenefitCents: isOpen ? bs.reduce((a, b) => a + b.annualValueCents, 0) : 0,
          realizedBenefitCents: bs.reduce((a, b) => a + b.year.usedThisYearCents, 0),
          missedBenefitCents: bs.reduce((a, b) => a + b.year.missedCents, 0),
          rewardsCents: rw.rewardsCents,
          spendCents: rw.spendCents,
          fallbackEarnRate: rw.fallbackEarnRate ?? undefined,
        });
        return {
          ...value,
          card: { id: r.card.id, name: r.card.name, issuer: r.card.issuer.name, color: r.card.color, type: r.card.type, network: r.card.network },
          nickname: r.nickname,
          lastFour: r.lastFour,
          cardholder: r.cardholder,
          openedAt: r.approvedAt,
          openDatePrecision: r.openDatePrecision,
          closedAt: r.closedAt,
          creditLimitCents: r.creditLimitCents,
          source: r.source,
          benefitCount: bs.length,
        };
      });

    const active = cards.filter((c) => c.status === 'APPROVED' && c.cardholder === 'PRIMARY');
    const authorizedUser = cards.filter((c) => c.status === 'APPROVED' && c.cardholder === 'AUTHORIZED_USER');
    const closed = cards.filter((c) => c.status === 'CLOSED');
    const pending = cards.filter((c) => c.status === 'APPLIED' || c.status === 'DENIED');
    const memberName = new Map(members.map((m) => [m.id, m]));
    return {
      asOf: now,
      groups: { active, authorizedUser, closed, pending },
      byHolder: rollupByHolder(cards).map((g) => ({
        ...g,
        profile: g.profileId ? { id: g.profileId, nickname: memberName.get(g.profileId)?.nickname, relationship: memberName.get(g.profileId)?.relationship } : null,
      })),
      totals: sumValues(cards),
      counts: { total: cards.length, active: active.length, authorizedUser: authorizedUser.length, closed: closed.length, pending: pending.length },
    };
  }

  /** Household dashboard: members with their cards, 5/24 and value, plus household totals. */
  async householdDashboard(userId: string, now = new Date()) {
    const [hh, p, f] = await Promise.all([this.households.get(userId), this.portfolio(userId, {}, now), this.five24(userId, {}, now)]);
    const all = [...p.groups.active, ...p.groups.authorizedUser, ...p.groups.closed, ...p.groups.pending];
    return {
      household: { id: hh.id, name: hh.name },
      members: hh.members.map((m) => {
        const cards = all.filter((c) => c.profileId === m.id);
        return {
          profile: m,
          cards,
          totals: sumValues(cards),
          five24: f.members.find((x) => x.profile.id === m.id)?.status ?? null,
        };
      }),
      totals: p.totals,
    };
  }
}

@ApiTags('portfolio')
@ApiBearerAuth()
@Controller()
export class PortfolioController {
  constructor(private readonly svc: PortfolioService) {}

  @Get('five24') five24(@CurrentUser() u: AuthUser, @Query() q: Five24Query) {
    return this.svc.five24(u.sub, q);
  }
  @Get('portfolio') portfolio(@CurrentUser() u: AuthUser, @Query() q: PortfolioQuery) {
    return this.svc.portfolio(u.sub, q);
  }
  @Get('household/dashboard') household(@CurrentUser() u: AuthUser) {
    return this.svc.householdDashboard(u.sub);
  }
  /** Spec aliases */
  @Get('524-status') five24Alias(@CurrentUser() u: AuthUser, @Query() q: Five24Query) {
    return this.svc.five24(u.sub, q);
  }
  @Get('family-dashboard') familyAlias(@CurrentUser() u: AuthUser) {
    return this.svc.householdDashboard(u.sub);
  }
}

@Module({
  imports: [HouseholdsModule, BenefitsModule],
  controllers: [PortfolioController],
  providers: [PortfolioService],
  exports: [PortfolioService],
})
export class PortfolioModule {}

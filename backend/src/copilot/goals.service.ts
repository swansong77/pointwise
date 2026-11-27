import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { annualFee } from '../domain/calculator';
import { GoalProgress, GoalSignals, checkGoal, goalProgress, GoalKindName, MAX_ACTIVE_GOALS } from '../domain/goals';
import { GoalView } from '../domain/copilot-plan';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { PortfolioService } from '../portfolio/portfolio';
import { WalletService } from '../wallet/wallet.service';

export interface GoalBody {
  kind: unknown;
  title: unknown;
  target?: unknown;
  dueAt?: unknown;
  profileId?: unknown;
}
export interface GoalPatch {
  title?: string;
  status?: 'ACTIVE' | 'DONE' | 'DROPPED';
  manualProgress?: number | null;
  dueAt?: string | null;
  target?: unknown;
}

/** Goals and how far along they are, computed from the household's own data. */
@Injectable()
export class GoalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolio: PortfolioService,
    private readonly wallet: WalletService,
    private readonly loyalty: LoyaltyService,
  ) {}

  /** the facts progress is measured against */
  async signals(userId: string, now: Date): Promise<GoalSignals> {
    const [f24, cards, pf, accounts, statuses] = await Promise.all([
      this.portfolio.five24(userId, {}, now),
      this.wallet.domainCards(userId),
      this.portfolio.portfolio(userId, {}, now),
      this.loyalty.accounts(userId, now),
      this.loyalty.statuses(userId, now),
    ]);
    return {
      five24: f24.members.map((m) => ({ profileId: m.profile.id, member: m.profile.nickname, count: m.status.count, limit: m.status.limit, nextSlotAt: m.status.nextSlotAt })),
      annualFeesCents: cards.filter((c) => c.status === 'APPROVED').reduce((s, c) => s + annualFee(c), 0),
      rewards12mCents: [...pf.groups.active, ...pf.groups.authorizedUser].reduce((s, c) => s + c.rewardsCents, 0),
      balances: accounts.map((a) => ({ program: a.programName, member: a.member ?? '', balance: a.balance })),
      statuses: statuses
        .filter((s) => s.current)
        .map((s) => ({ program: s.program, level: s.level, member: s.member, progress: s.progress, required: s.required, maintained: s.maintained, pct: s.view.pct, headline: s.view.headline, expiresAt: s.expiresAt })),
    };
  }

  async list(userId: string, now = new Date(), opts: { status?: 'ACTIVE' | 'ALL' } = {}) {
    const rows = await this.prisma.goal.findMany({
      where: { userId, ...(opts.status === 'ALL' ? { status: { not: 'DROPPED' } } : { status: 'ACTIVE' }) },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    if (!rows.length) return [];
    const signals = await this.signals(userId, now);
    return rows.map((g) => ({ ...g, progress: this.progress(g, signals, now) }));
  }

  private progress(g: { kind: string; title: string; target: Prisma.JsonValue; manualProgress: number | null; dueAt: Date | null; profileId: string | null }, signals: GoalSignals, now: Date): GoalProgress {
    return goalProgress({ kind: g.kind as GoalKindName, title: g.title, target: g.target, manualProgress: g.manualProgress, dueAt: g.dueAt, profileId: g.profileId }, signals, now);
  }

  /** the active goals as the planner reads them */
  async views(userId: string, now: Date): Promise<GoalView[]> {
    const rows = await this.list(userId, now);
    return rows.map((g) => ({ id: g.id, title: g.title, kind: g.kind, dueAt: g.dueAt, progress: g.progress }));
  }

  async create(userId: string, body: GoalBody, now = new Date()) {
    const c = checkGoal(body, now);
    if (!c.ok) throw new BadRequestException(c.error);
    if ((await this.prisma.goal.count({ where: { userId, status: 'ACTIVE' } })) >= MAX_ACTIVE_GOALS) throw new BadRequestException(`You can have up to ${MAX_ACTIVE_GOALS} active goals. Finish or drop one first.`);
    if (c.value.profileId && !(await this.prisma.profile.findFirst({ where: { id: c.value.profileId, userId }, select: { id: true } }))) throw new NotFoundException('Household member not found');
    const g = await this.prisma.goal.create({ data: { userId, kind: c.value.kind, title: c.value.title, target: c.value.target as Prisma.InputJsonValue, dueAt: c.value.dueAt, profileId: c.value.profileId } });
    return { ...g, progress: this.progress(g, await this.signals(userId, now), now) };
  }

  async update(userId: string, id: string, patch: GoalPatch, now = new Date()) {
    const g = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!g) throw new NotFoundException('Goal not found');
    const data: Prisma.GoalUpdateInput = {};
    if (patch.title !== undefined || patch.target !== undefined || patch.dueAt !== undefined) {
      const c = checkGoal({ kind: g.kind, title: patch.title ?? g.title, target: patch.target ?? g.target, dueAt: patch.dueAt === undefined ? g.dueAt : patch.dueAt, profileId: g.profileId }, new Date(0));
      if (!c.ok) throw new BadRequestException(c.error);
      data.title = c.value.title;
      data.target = c.value.target as Prisma.InputJsonValue;
      data.dueAt = c.value.dueAt;
    }
    if (patch.manualProgress !== undefined) {
      if (g.kind !== 'CUSTOM') throw new BadRequestException('Progress is worked out for this goal; only custom goals are set by hand');
      if (patch.manualProgress != null && (!Number.isInteger(patch.manualProgress) || patch.manualProgress < 0 || patch.manualProgress > 100)) throw new BadRequestException('Progress is 0 to 100');
      data.manualProgress = patch.manualProgress;
    }
    if (patch.status !== undefined) {
      if (!['ACTIVE', 'DONE', 'DROPPED'].includes(patch.status)) throw new BadRequestException('Unknown status');
      if (patch.status === 'ACTIVE' && g.status !== 'ACTIVE' && (await this.prisma.goal.count({ where: { userId, status: 'ACTIVE' } })) >= MAX_ACTIVE_GOALS) throw new BadRequestException(`You can have up to ${MAX_ACTIVE_GOALS} active goals.`);
      data.status = patch.status;
      data.completedAt = patch.status === 'DONE' ? now : null;
    }
    const out = await this.prisma.goal.update({ where: { id }, data });
    return { ...out, progress: this.progress(out, await this.signals(userId, now), now) };
  }

  async remove(userId: string, id: string) {
    const r = await this.prisma.goal.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Goal not found');
  }
}

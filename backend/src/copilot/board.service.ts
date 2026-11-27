import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { householdNextCards, rankCandidates } from '../domain/card-scorer';
import { Briefing, BRIEF_RETENTION_DAYS } from '../domain/copilot-brief';
import { boardReport, BoardSignals } from '../domain/cos-board';
import { FeeCardInput, feeBoard, feeTotals } from '../domain/cos-fees';
import { governance, GovMember, GovPick } from '../domain/cos-governance';
import { upcomingRenewals } from '../domain/insights';
import { LoyaltyAutomationService } from '../loyalty/loyalty-automation.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OfferDashboardsService } from '../offers/offer-dashboards.service';
import { PortfolioService } from '../portfolio/portfolio';
import { StrategyService } from '../strategy/strategy.service';
import { ChiefService } from './chief.service';
import { GoalsService } from './goals.service';
import { PortfolioSignalsService } from './portfolio-signals.service';

const DAY = 86_400_000;

export interface StoredBoard {
  id: string;
  periodKey: string;
  createdAt: Date;
  content: Briefing;
}

/**
 * The annual fee review board and the monthly board report. They read what the engines already know, say what each card returned and
 * what was missed, and recommend; the member decides, and nothing is done for them.
 */
@Injectable()
export class BoardService {
  private readonly log = new Logger(BoardService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly strategy: StrategyService,
    private readonly portfolio: PortfolioService,
    private readonly signals: PortfolioSignalsService,
    private readonly loyalty: LoyaltyService,
    private readonly loyaltyAuto: LoyaltyAutomationService,
    private readonly dashboards: OfferDashboardsService,
    private readonly goals: GoalsService,
    private readonly chief: ChiefService,
    private readonly notifications: NotificationsService,
  ) {}

  // ───────────── fee review board ─────────────

  async feeReview(userId: string, now = new Date()) {
    const [ctx, pf] = await Promise.all([this.strategy.scoringContext(userId, {}, now), this.portfolio.portfolio(userId, {}, now)]);
    const renewals = new Map(upcomingRenewals(ctx.household, now, 400).map((r) => [r.walletCardId, r.daysUntil]));
    const owner = new Map(ctx.applicants.map((a) => [a.profileId, a.nickname]));
    const primary = ctx.applicants[0];
    const picks = new Map(householdNextCards(ctx.cards, ctx.applicants, ctx.household, ctx.spend.lines, ctx.opt, 1).members.map((m) => [m.profileId, m.top[0]]));
    const since = new Date(now.getTime() - 730 * DAY);
    const cards: FeeCardInput[] = [];
    for (const c of pf.groups.active.filter((x) => x.status === 'APPROVED')) {
      const wc = ctx.household.find((h) => h.id === c.walletCardId);
      if (!wc) continue;
      const cand = ctx.cards.find((x) => x.id === wc.card.id);
      const siblings = cand?.productFamily ? ctx.cards.filter((x) => x.productFamily === cand.productFamily && x.id !== wc.card.id).sort((a, b) => a.annualFeeCents - b.annualFeeCents) : [];
      const reports = await this.prisma.retentionOfferReport.findMany({ where: { cardId: wc.card.id, reportedOn: { gte: since } }, orderBy: { reportedOn: 'desc' }, take: 200, select: { offer: true, accepted: true } });
      const ownerId = wc.profileId ?? primary?.profileId ?? '';
      const pick = picks.get(ownerId);
      cards.push({
        card: c.name,
        member: owner.get(ownerId) ?? null,
        feeCents: c.annualFeeCents,
        valueCents: c.realizedBenefitCents + c.rewardsCents,
        daysToRenewal: renewals.get(c.walletCardId) ?? null,
        openedMonths: wc.approvedAt ? Math.floor((now.getTime() - wc.approvedAt.getTime()) / (30.44 * DAY)) : null,
        sibling: siblings[0] ? { name: siblings[0].name, feeCents: siblings[0].annualFeeCents } : null,
        retention: reports.length ? { reports: reports.length, accepted: reports.filter((r) => r.accepted).length, sample: reports.find((r) => r.accepted)?.offer.slice(0, 80) ?? null } : null,
        replacement: pick ? { card: pick.name, longTermCents: pick.longTermValueCents } : null,
      });
    }
    const verdicts = feeBoard(cards);
    return { generatedAt: now.toISOString(), verdicts, totals: feeTotals(cards, verdicts) };
  }

  // ───────────── application governance ─────────────

  /** 5/24 per member, recent approvals, the best next card and who should apply, business and elevated-offer opportunities */
  async governance(userId: string, now = new Date()) {
    const [ctx, f24, business, recent] = await Promise.all([
      this.strategy.scoringContext(userId, {}, now),
      this.portfolio.five24(userId, {}, now),
      this.prisma.profile.findMany({ where: { userId, hasBusiness: true }, select: { id: true } }),
      this.prisma.walletCard.findMany({ where: { wallet: { userId }, status: 'APPROVED', cardholder: 'PRIMARY', approvedAt: { gte: new Date(now.getTime() - 90 * DAY) } }, select: { profileId: true, approvedAt: true, card: { select: { name: true } } }, take: 50 }),
    ]);
    const primaryId = ctx.applicants[0]?.profileId ?? '';
    const members: GovMember[] = f24.members.map((m) => ({
      member: m.profile.nickname,
      profileId: m.profile.id,
      isPrimary: m.profile.isPrimary,
      count: m.status.count,
      limit: m.status.limit,
      underLimit: m.status.underLimit,
      nextSlotAt: m.status.nextSlotAt,
      drops: m.status.contributing.map((c) => c.dropsOffAt as Date).filter(Boolean),
      recentApprovals: recent.filter((r) => (r.profileId ?? primaryId) === m.profile.id && r.approvedAt).map((r) => ({ card: r.card.name, approvedAt: r.approvedAt as Date })),
    }));
    const bySlug = new Map(ctx.cards.map((c) => [c.id, c]));
    const picks: GovPick[] = householdNextCards(ctx.cards, ctx.applicants, ctx.household, ctx.spend.lines, ctx.opt, 2).members.flatMap((m) =>
      m.top.map((s) => ({ member: m.member, profileId: m.profileId, card: s.name, slug: s.slug, firstYearCents: s.firstYearValueCents, longTermCents: s.longTermValueCents, usesSlot: s.five24.countsToward && s.five24.slotCostCents > 0, elevated: !!bySlug.get(s.cardId)?.offerElevated, business: false })),
    );
    // business cards are ranked for members who run a business; they usually do not use a 5/24 slot
    const businessCards = ctx.cards.filter((c) => c.type === 'BUSINESS');
    for (const b of business) {
      const a = ctx.applicants.find((x) => x.profileId === b.id);
      if (!a || !businessCards.length) continue;
      const top = rankCandidates(businessCards, a, ctx.household, ctx.spend.lines, ctx.opt).find((s) => s.eligible);
      if (top) picks.push({ member: a.nickname, profileId: a.profileId, card: top.name, slug: top.slug, firstYearCents: top.firstYearValueCents, longTermCents: top.longTermValueCents, usesSlot: top.five24.countsToward && top.five24.slotCostCents > 0, elevated: !!bySlug.get(top.cardId)?.offerElevated, business: true });
    }
    return governance(members, picks, now);
  }

  // ───────────── board report ─────────────

  private async boardSignals(userId: string, now: Date): Promise<BoardSignals> {
    const since = new Date(now.getTime() - 30 * DAY);
    const [savings, val, totals, goals, summary, events, certs, expired, redeemed, changes] = await Promise.all([
      this.dashboards.savings(userId, now),
      this.loyalty.valuation(userId, [], now),
      this.signals.portfolioTotals(userId, now),
      this.goals.list(userId, now),
      this.signals.portfolioSummary(userId, now),
      this.prisma.loyaltyEvent.findMany({ where: { userId, occurredAt: { gte: since }, kind: { in: ['EARN', 'BONUS', 'PURCHASE', 'EXPIRE'] } }, select: { kind: true, points: true }, take: 2000 }),
      this.prisma.loyaltyCertificate.findMany({ where: { userId, usedAt: { gte: since } }, select: { potentialValueCents: true }, take: 200 }),
      this.prisma.offerSnapshotItem.findMany({ where: { userId, status: 'EXPIRED', endsAt: { gte: since, lte: now }, decision: { in: ['RECOMMENDED', 'PENDING_REVIEW', 'NEW'] } }, select: { valueCents: true }, take: 500 }),
      this.prisma.userOffer.count({ where: { walletCard: { wallet: { userId } }, redeemedAt: { gte: since } } }),
      this.loyaltyAuto.recentChanges(userId, 30, now),
    ]);
    const months = savings.byMonth;
    const pts = (kinds: string[]) => events.filter((e) => kinds.includes(e.kind)).reduce((s, e) => s + Math.abs(e.points ?? 0), 0);
    return {
      savedThisMonthCents: months[months.length - 1]?.actualCents ?? 0,
      savedLastMonthCents: months[months.length - 2]?.actualCents ?? 0,
      offersRedeemed: redeemed,
      pointsEarned: pts(['EARN', 'BONUS', 'PURCHASE']),
      pointsExpired: pts(['EXPIRE']),
      certificatesUsed: certs.length,
      certificatesUsedCents: certs.reduce((s, c) => s + (c.potentialValueCents ?? 0), 0),
      creditsUtilizedCents: totals.realizedBenefitCents,
      missedCents: expired.reduce((s, o) => s + o.valueCents, 0),
      statusChanges: changes.changes.filter((c) => c.what === 'statusLevel').slice(0, 5).map((c) => `${c.program}: status ${String(c.value)}`),
      assetsCents: val.currentCents,
      cardNetCents: totals.rewardsCents + totals.realizedBenefitCents - totals.feesCents,
      household: { goalsTotal: goals.length, goalsBehind: goals.filter((g) => g.progress.state === 'AT_RISK' || g.progress.state === 'BEHIND').length, members: summary.members.map((m) => ({ member: m.member, count: m.count, underLimit: m.underLimit })) },
    };
  }

  /** This month's board report. The same month returns the one already written unless `force`; `notify` is for the scheduled run. */
  async generate(userId: string, now = new Date(), opts: { force?: boolean; notify?: boolean } = {}): Promise<{ board: StoredBoard; created: boolean }> {
    const periodKey = now.toISOString().slice(0, 7);
    const key = { userId_kind_periodKey: { userId, kind: 'BOARD' as const, periodKey } };
    const existing = await this.prisma.copilotBriefing.findUnique({ where: key });
    if (existing && !opts.force) return { board: this.toStored(existing), created: false };
    const [signals, review, center] = await Promise.all([this.boardSignals(userId, now), this.feeReview(userId, now), this.chief.commandCenter(userId, now)]);
    const content = boardReport({ signals, verdicts: review.verdicts, totals: review.totals, scores: center.scores, outlook: center.outlook, now });
    const row = await this.prisma.copilotBriefing.upsert({ where: key, update: { content: content as unknown as Prisma.InputJsonValue, createdAt: now }, create: { userId, kind: 'BOARD', periodKey, content: content as unknown as Prisma.InputJsonValue, createdAt: now } });
    if (opts.notify && !existing) await this.notifications.notify(userId, 'COPILOT', 'Your monthly board report', `${content.headline}. ${content.summary}`.slice(0, 300), '/chief-of-staff#board', `copilot:board:${periodKey}`);
    return { board: this.toStored(row), created: !existing };
  }

  private toStored(r: { id: string; periodKey: string; createdAt: Date; content: Prisma.JsonValue }): StoredBoard {
    return { id: r.id, periodKey: r.periodKey, createdAt: r.createdAt, content: r.content as unknown as Briefing };
  }

  async list(userId: string, limit = 12): Promise<StoredBoard[]> {
    const rows = await this.prisma.copilotBriefing.findMany({ where: { userId, kind: 'BOARD' }, orderBy: { createdAt: 'desc' }, take: Math.min(24, Math.max(1, limit)) });
    return rows.map((r) => this.toStored(r));
  }

  async get(userId: string, id: string): Promise<StoredBoard> {
    const r = await this.prisma.copilotBriefing.findFirst({ where: { id, userId, kind: 'BOARD' } });
    if (!r) throw new NotFoundException('Board report not found');
    return this.toStored(r);
  }

  /** the monthly run: members who turned the Chief of Staff on and did not switch monthly reviews off */
  async runDue(now: Date): Promise<number> {
    const users = await this.prisma.aiSettings.findMany({ where: { aiModeEnabled: true, chiefOfStaff: true, briefingMonthly: true }, select: { userId: true }, take: 2000 });
    let created = 0;
    for (const u of users) {
      try {
        if ((await this.generate(u.userId, now, { notify: true })).created) created++;
      } catch (e) {
        this.log.warn(`board report failed for one member: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
    return created;
  }

  /** kept as long as the other briefings */
  static readonly RETENTION_DAYS = BRIEF_RETENTION_DAYS;
}

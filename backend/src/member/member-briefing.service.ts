import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toDomainWalletCard, walletCardInclude } from '../common/mappers';
import { PrismaService } from '../common/prisma.service';
import { Briefing } from '../domain/copilot-brief';
import { bonusProgress, upcomingRenewals } from '../domain/insights';
import { MEMBER_HOME } from '../domain/member-access';
import { MemberBriefInput, MemberBriefKind, memberBrief, memberBriefNotice } from '../domain/member-brief';
import { NotificationsService } from '../notifications/notifications.service';
import { benefitView, BenefitsService } from '../portfolio/benefits';

const DAY = 86_400_000;
const daysUntil = (to: Date, now: Date) => Math.ceil((to.getTime() - now.getTime()) / DAY);

export interface StoredMemberBriefing {
  id: string;
  kind: MemberBriefKind;
  periodKey: string;
  createdAt: Date;
  content: Briefing;
}

/**
 * A household member's own briefing: built from their own profile's cards, credits, offers, points and spending (deterministic, no model),
 * stored once per period under the member's own user, and announced with one notification that follows their own preferences.
 */
@Injectable()
export class MemberBriefingService {
  private readonly log = new Logger(MemberBriefingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly benefits: BenefitsService,
    private readonly notifications: NotificationsService,
  ) {}

  async signals(ownerId: string, profileId: string, name: string, memberUserId: string, now: Date): Promise<MemberBriefInput> {
    const week = new Date(now.getTime() - 7 * DAY);
    const [benefitRows, offers, loyalty, certs, cards, spend, held] = await Promise.all([
      this.benefits.rows(ownerId, { walletCard: { profileId } as never }),
      this.prisma.userOffer.findMany({
        where: { status: 'ACTIVE', walletCard: { wallet: { userId: ownerId }, profileId }, offer: { endsAt: { gte: now } } },
        include: { offer: { select: { title: true, endsAt: true } }, walletCard: { select: { nickname: true, card: { select: { name: true } } } } },
        take: 50,
      }),
      this.prisma.loyaltyAccount.findMany({ where: { userId: ownerId, profileId }, select: { customName: true, balance: true, expiresAt: true, program: { select: { name: true } } } }),
      this.prisma.loyaltyCertificate.findMany({ where: { userId: ownerId, profileId, status: 'AVAILABLE', expiresAt: { gte: now } }, select: { name: true, expiresAt: true }, take: 20 }),
      this.prisma.walletCard.findMany({ where: { wallet: { userId: ownerId }, profileId }, include: walletCardInclude }),
      this.prisma.transaction.aggregate({ where: { userId: ownerId, walletCard: { profileId }, kind: 'PURCHASE', occurredAt: { gte: week, lte: now } }, _count: true, _sum: { amountCents: true } }),
      this.prisma.notification.count({ where: { userId: memberUserId, deferredAt: { gte: new Date(now.getTime() - DAY) } } }),
    ]);
    const domainCards = cards.map(toDomainWalletCard);
    return {
      name,
      benefits: benefitRows
        .filter((b) => b.enabled && b.walletCard.status === 'APPROVED')
        .map((b) => benefitView(b, now))
        .map((v) => ({ name: v.name, card: v.walletCard.name, remainingCents: v.currentPeriod.remainingCents, daysLeft: v.currentPeriod.daysLeft })),
      offers: offers.map((o) => ({ title: o.offer.title, card: o.walletCard.nickname || o.walletCard.card.name, daysLeft: daysUntil(o.offer.endsAt as Date, now), valueCents: null })),
      loyalty: loyalty.map((l) => ({ name: l.customName ?? l.program?.name ?? 'Loyalty', balance: l.balance, expiresInDays: l.expiresAt ? daysUntil(l.expiresAt, now) : null })),
      certificates: certs.map((c) => ({ name: c.name, daysLeft: daysUntil(c.expiresAt as Date, now) })),
      renewals: upcomingRenewals(domainCards, now, 30).map((r) => ({ name: r.name, daysUntil: r.daysUntil, feeCents: r.annualFeeCents })),
      bonuses: bonusProgress(domainCards, now).filter((b) => b.atRisk).map((b) => ({ name: b.name, spentCents: b.spentCents, requiredCents: b.requiredSpendCents, daysLeft: b.daysLeft })),
      spend: spend._count > 0 ? { count: spend._count, totalCents: spend._sum.amountCents ?? 0 } : null,
      held,
    };
  }

  private toStored(r: { id: string; kind: string; periodKey: string; createdAt: Date; content: Prisma.JsonValue }): StoredMemberBriefing {
    return { id: r.id, kind: r.kind as MemberBriefKind, periodKey: r.periodKey, createdAt: r.createdAt, content: r.content as unknown as Briefing };
  }

  /**
   * The member's briefing for this period. The same period returns the one already made unless `force`. A daily one is made only when
   * there is something to say (so there is nothing to announce on a quiet day); `notify` is for the scheduled run and tells them once.
   */
  async generate(memberUserId: string, kind: MemberBriefKind, now = new Date(), opts: { force?: boolean; notify?: boolean } = {}): Promise<{ briefing: StoredMemberBriefing | null; created: boolean }> {
    const profile = await this.prisma.profile.findUnique({ where: { loginUserId: memberUserId }, select: { id: true, userId: true, nickname: true } });
    if (!profile) return { briefing: null, created: false };
    const brief = memberBrief(kind, await this.signals(profile.userId, profile.id, profile.nickname, memberUserId, now), now);
    if (!brief) return { briefing: null, created: false };
    const key = { userId_kind_periodKey: { userId: memberUserId, kind, periodKey: brief.periodKey } };
    const existing = await this.prisma.copilotBriefing.findUnique({ where: key });
    if (existing && !opts.force) return { briefing: this.toStored(existing), created: false };
    const content = brief as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.copilotBriefing.upsert({ where: key, update: { content, createdAt: now }, create: { userId: memberUserId, kind, periodKey: brief.periodKey, content } });
    if (opts.notify && !existing) {
      const n = memberBriefNotice(brief);
      // COPILOT is exempt from Quiet Mode: the briefing is what Quiet Mode points to
      await this.notifications.notify(memberUserId, 'COPILOT', n.title, n.body, MEMBER_HOME, `member-brief:${kind.toLowerCase()}:${brief.periodKey}`);
    }
    return { briefing: this.toStored(row), created: !existing };
  }

  async list(memberUserId: string, kind?: MemberBriefKind, limit = 20): Promise<StoredMemberBriefing[]> {
    const rows = await this.prisma.copilotBriefing.findMany({
      where: { userId: memberUserId, kind: kind ?? { in: ['DAILY', 'WEEKLY'] } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(60, Math.max(1, limit)),
    });
    return rows.map((r) => this.toStored(r));
  }

  /** Scheduled run: every member with their own sign-in who has this briefing switched on. Returns how many were made. */
  async runDue(kind: MemberBriefKind, now = new Date()): Promise<number> {
    const members = await this.prisma.profile.findMany({ where: { loginUserId: { not: null } }, select: { loginUserId: true }, take: 5000 });
    const ids = members.map((m) => m.loginUserId as string);
    const prefs = new Map((await this.prisma.notificationPreference.findMany({ where: { userId: { in: ids } }, select: { userId: true, briefingDaily: true, briefingWeekly: true } })).map((p) => [p.userId, p]));
    let n = 0;
    for (const id of ids) {
      const p = prefs.get(id);
      if (kind === 'DAILY' ? p?.briefingDaily === false : p?.briefingWeekly === false) continue;
      try {
        if ((await this.generate(id, kind, now, { notify: true })).created) n++;
      } catch (e) {
        this.log.warn(`member briefing for ${id} failed: ${(e as Error).message}`);
      }
    }
    return n;
  }
}

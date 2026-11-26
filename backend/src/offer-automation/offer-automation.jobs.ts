import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { OfferSyncService } from './offer-sync.service';

const DAY = 86_400_000;
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Scheduled work for offer automation. Safe to run twice: runs are keyed by schedule boundary and notifications are deduplicated. */
@Injectable()
export class OfferAutomationJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: OfferSyncService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Runs every account whose scheduled time (daily 2 AM local by default, weekly, monthly) has passed. Called hourly. */
  async syncDue(now: Date, onlyUserId?: string): Promise<number> {
    return this.sync.runDue(now, onlyUserId);
  }

  /** Retries transient failures and closes runs that never finished. */
  async recover(now: Date, onlyUserId?: string): Promise<number> {
    return (await this.sync.recoverStale(now)) + (await this.sync.retryFailed(now, onlyUserId));
  }

  /** Monthly audit: how the automation did, per member, written to the audit trail and sent as one notification. */
  async monthlyAudit(now: Date): Promise<number> {
    const since = new Date(now.getTime() - 31 * DAY);
    const users = await this.prisma.offerAccount.findMany({ distinct: ['userId'], select: { userId: true } });
    let n = 0;
    for (const { userId } of users) {
      const [runs, failed, enrolled, auto, expiredUnused] = await Promise.all([
        this.prisma.offerSyncRun.count({ where: { userId, createdAt: { gte: since } } }),
        this.prisma.offerSyncRun.count({ where: { userId, createdAt: { gte: since }, status: 'FAILED' } }),
        this.prisma.offerSnapshotItem.count({ where: { userId, enrolledAt: { gte: since } } }),
        this.prisma.offerSnapshotItem.count({ where: { userId, enrolledAt: { gte: since }, autoEnrolled: true } }),
        this.prisma.offerSnapshotItem.findMany({ where: { userId, status: 'EXPIRED', endsAt: { gte: since }, decision: { in: ['RECOMMENDED', 'PENDING_REVIEW', 'NEW'] } }, select: { valueCents: true } }),
      ]);
      const missed = expiredUnused.reduce((s, e) => s + e.valueCents, 0);
      await this.prisma.offerEvent.create({ data: { userId, type: 'SYNC', actor: 'SYSTEM', detail: { action: 'monthly-audit', runs, failed, enrolled, auto, missedCents: missed } } });
      const prefs = await this.prisma.notificationPreference.findUnique({ where: { userId } });
      if (prefs && !prefs.offerAutomation) continue;
      await this.notifications.notify(userId, 'OFFER_SAVINGS_DIGEST', 'Your monthly offer summary', `${runs} sync(s), ${enrolled} offer(s) added (${auto} automatically), ${usd(missed)} of recommended offers expired unused.`, '/offers/automation', `offer-audit:${now.toISOString().slice(0, 7)}`);
      n++;
    }
    return n;
  }

  /** Weekly digest and expiring-soon reminders. */
  async digest(now: Date): Promise<number> {
    const soon = new Date(now.getTime() + 7 * DAY);
    const rows = await this.prisma.offerSnapshotItem.findMany({ where: { status: { in: ['AVAILABLE', 'ENROLLED'] }, endsAt: { gte: now, lte: soon }, OR: [{ status: 'ENROLLED' }, { decision: { in: ['RECOMMENDED', 'APPROVED'] } }] }, select: { userId: true, valueCents: true, status: true } });
    const byUser = new Map<string, { count: number; value: number }>();
    for (const r of rows) {
      const cur = byUser.get(r.userId) ?? { count: 0, value: 0 };
      byUser.set(r.userId, { count: cur.count + 1, value: cur.value + r.valueCents });
    }
    let n = 0;
    for (const [userId, v] of byUser) {
      const prefs = await this.prisma.notificationPreference.findUnique({ where: { userId } });
      if (prefs && !prefs.offerAutomation) continue;
      await this.notifications.notify(userId, 'OFFER_EXPIRING', `${v.count} offer(s) end within a week`, `About ${usd(v.value)} is at stake. Open your Offer Inbox.`, '/offers/automation', `offer-expiring:${userId}:${now.toISOString().slice(0, 10)}`);
      n++;
    }
    return n;
  }
}

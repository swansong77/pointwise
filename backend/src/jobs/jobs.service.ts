import { Injectable, Logger, Optional } from "@nestjs/common";
import { runRotatingJob } from "./rotating.job";
import { PageFetcher } from "../catalog-refresh/fetcher";
import { PrismaService } from "../common/prisma.service";
import { toDomainWalletCard, walletCardInclude } from "../common/mappers";
import { NotificationsService } from "../notifications/notifications.service";
import { MailService } from "./mail.service";
import { bonusProgress, upcomingRenewals } from "../domain/insights";
import { daysLeft, isExpiringSoon, matchesAlert } from "../domain/offers";
import { dueThreshold } from "../domain/benefits";
import { isoDay } from "../domain/dates";
import { benefitView, userBenefitInclude } from "../portfolio/benefits";
import { PortfolioService } from "../portfolio/portfolio";
import { ConnectionsService } from "../portfolio/connections";
import { NotificationDispatcher } from "../notifications/delivery";
import { McpClientService } from "../ai/mcp-client";
import { CardRefreshService } from "../catalog-refresh/card-refresh.service";
import { MailboxService } from "../mailbox/mailbox.service";
import { CardResearchService } from "../catalog-research/card-research.service";
import { OfferJobsService } from "../offers/offer-jobs.service";
import { LoyaltyJobsService } from "../loyalty/loyalty.module";
import { LoyaltyRefreshJobs } from "../loyalty/loyalty-automation.module";
import { OrchestratorService } from "../ai/orchestrator.service";
import { OfferAutomationJobs } from "../offer-automation/offer-automation.jobs";
import { BackupJobs } from "../data/data.module";
import { RemindersService } from "../reminders/reminders.module";

export const JOB_QUEUE = "pointwise-jobs";
export type JobName =
  | "scan-expiring-offers"
  | "scan-renewals"
  | "scan-bonus-deadlines"
  | "match-offer-alerts"
  | "email-digest"
  | "expire-offers"
  | "scan-benefit-expirations"
  | "snapshot-524"
  | "sync-bank-connections"
  | "check-mcp-servers"
  | "refresh-card-sources"
  | "sync-mailboxes"
  | "scan-transfer-bonuses"
  | "research-cards"
  | "scan-offer-opportunities"
  | "verify-offer-activation"
  | "scan-loyalty-expirations"
  | "snapshot-loyalty-balances"
  | "refresh-loyalty"
  | "loyalty-audit"
  | "offer-sync-due"
  | "offer-sync-recover"
  | "offer-audit-monthly"
  | "offer-digest"
  | "backup-nightly"
  | "update-rotating-categories"
  | "reminders-due";
export const JOB_NAMES: JobName[] = [
  "reminders-due",
  "update-rotating-categories",
  "backup-nightly",
  "refresh-loyalty",
  "loyalty-audit",
  "scan-loyalty-expirations",
  "snapshot-loyalty-balances",
  "offer-sync-due",
  "offer-sync-recover",
  "offer-audit-monthly",
  "offer-digest",
  "scan-offer-opportunities",
  "verify-offer-activation",
  "research-cards",
  "scan-transfer-bonuses",
  "refresh-card-sources",
  "sync-mailboxes",
  "check-mcp-servers",
  "scan-benefit-expirations",
  "snapshot-524",
  "sync-bank-connections",
  "scan-expiring-offers",
  "scan-renewals",
  "scan-bonus-deadlines",
  "match-offer-alerts",
  "email-digest",
  "expire-offers",
];

const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Job bodies. Every job is idempotent: notifications are keyed by a dedupe key, so re-running a
 * job on the same day never duplicates alerts.
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);
  private readonly rotatingFetcher = new PageFetcher();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    @Optional() private readonly portfolio?: PortfolioService,
    @Optional() private readonly connections?: ConnectionsService,
    @Optional() private readonly dispatcher?: NotificationDispatcher,
    @Optional() private readonly mcp?: McpClientService,
    @Optional() private readonly cardRefresh?: CardRefreshService,
    @Optional() private readonly mailboxes?: MailboxService,
    @Optional() private readonly cardResearch?: CardResearchService,
    @Optional() private readonly offerJobs?: OfferJobsService,
    @Optional() private readonly loyaltyJobs?: LoyaltyJobsService,
    @Optional() private readonly loyaltyRefresh?: LoyaltyRefreshJobs,
    @Optional() private readonly orchestrator?: OrchestratorService,
    @Optional() private readonly offerAutomation?: OfferAutomationJobs,
    @Optional() private readonly backupJobs?: BackupJobs,
    @Optional() private readonly reminders?: RemindersService,
  ) {}

  async run(
    name: JobName,
    now = new Date(),
  ): Promise<{ job: JobName; created: number }> {
    let created = 0;
    switch (name) {
      case "scan-expiring-offers":
        created = await this.scanExpiringOffers(now);
        break;
      case "scan-renewals":
        created = await this.scanRenewals(now);
        break;
      case "update-rotating-categories":
        created = await runRotatingJob(this.prisma, (...a) => this.notifications.notify(...a), now, this.rotatingFetcher);
        break;
      case "scan-bonus-deadlines":
        created = await this.scanBonusDeadlines(now);
        break;
      case "match-offer-alerts":
        created = await this.matchOfferAlerts(now);
        break;
      case "email-digest":
        created = await this.emailDigest(now);
        break;
      case "expire-offers":
        created = await this.expireOffers(now);
        break;
      case "scan-benefit-expirations":
        created = await this.scanBenefitExpirations(now);
        break;
      case "snapshot-524":
        created = await this.snapshot524(now);
        break;
      case "sync-bank-connections":
        created = (await this.connections?.syncAll(now)) ?? 0;
        break;
      case "check-mcp-servers":
        created = (await this.mcp?.refreshAll()) ?? 0;
        break;
      case "sync-mailboxes":
        created = (await this.mailboxes?.syncAll(now)) ?? 0;
        break;
      case "refresh-card-sources":
        created = (await this.cardRefresh?.refreshAll()) ?? 0;
        break;
      case "scan-transfer-bonuses":
        created = await this.scanTransferBonuses(now);
        break;
      case "research-cards":
        created = (await this.cardResearch?.processQueued()) ?? 0;
        break;
      case "scan-offer-opportunities":
        created = (await this.offerJobs?.scanOpportunities(now)) ?? 0;
        break;
      case "scan-loyalty-expirations":
        created = (await this.loyaltyJobs?.scanExpirations(now)) ?? 0;
        break;
      case "refresh-loyalty":
        created = (await this.loyaltyRefresh?.refreshDue(now, (id) => this.mailboxes?.sync(id, now) ?? Promise.resolve())) ?? 0;
        break;
      case "loyalty-audit":
        created = await this.loyaltyAudit(now);
        break;
      case "snapshot-loyalty-balances":
        created = (await this.loyaltyJobs?.snapshotBalances(now)) ?? 0;
        break;
      case "verify-offer-activation":
        created = (await this.offerJobs?.verifyActivations(now)) ?? 0;
        break;
      case "offer-sync-due":
        created = (await this.offerAutomation?.syncDue(now)) ?? 0;
        break;
      case "offer-sync-recover":
        created = (await this.offerAutomation?.recover(now)) ?? 0;
        break;
      case "offer-audit-monthly":
        created = (await this.offerAutomation?.monthlyAudit(now)) ?? 0;
        break;
      case "offer-digest":
        created = (await this.offerAutomation?.digest(now)) ?? 0;
        break;
      case "reminders-due":
        created = (await this.reminders?.dispatchDue(now)) ?? 0;
        break;
      case "backup-nightly":
        created = (await this.backupJobs?.nightly(now)) ?? 0;
        break;
    }
    this.logger.log(`job ${name} done: ${created}`);
    return { job: name, created };
  }

  /** Weekly: run the loyalty-audit workflow (recorded in the run log) and tell the member the result. */
  async loyaltyAudit(now: Date): Promise<number> {
    if (!this.orchestrator) return 0;
    const users = await this.prisma.user.findMany({ where: { loyaltyAccounts: { some: {} } }, select: { id: true, notificationPrefs: { select: { loyaltyExpiring: true } } }, take: 500 });
    const key = `loy:audit:${day(new Date(now.getTime() - ((now.getUTCDay() + 6) % 7) * 86_400_000))}`;
    let n = 0;
    for (const u of users) {
      if (u.notificationPrefs?.loyaltyExpiring === false) continue;
      const run = await this.orchestrator.run(u.id, "loyalty-audit", { question: "Weekly loyalty audit" }, now);
      if (run.status !== "COMPLETED") continue;
      const before = await this.prisma.notification.count({ where: { userId: u.id, dedupeKey: key } });
      await this.notifications.notify(u.id, "SYSTEM", "Your weekly loyalty audit", run.answer.split("\n").slice(0, 4).join(" "), "/loyalty", key);
      if (!before) n++;
    }
    return n;
  }

  /**
   * Active transfer bonuses → notify households holding that currency (once per bonus: the dedupe
   * key includes the partner, percentage and end date). Respects the transferBonuses preference.
   */
  async scanTransferBonuses(now: Date): Promise<number> {
    const partners = await this.prisma.transferPartner.findMany({
      where: {
        bonusPercent: { gt: 0 },
        OR: [{ bonusEndsAt: null }, { bonusEndsAt: { gt: now } }],
      },
      include: {
        currency: { select: { id: true, name: true } },
        program: { select: { name: true } },
      },
    });
    let n = 0;
    for (const p of partners) {
      const holders = await this.prisma.loyaltyBalance.groupBy({
        by: ["userId"],
        where: {
          currencyId: p.currencyId,
          points: { gt: 0 },
          user: {
            OR: [
              { notificationPrefs: null },
              { notificationPrefs: { transferBonuses: true } },
            ],
          },
        },
        _sum: { points: true },
      });
      const until = p.bonusEndsAt ? ` until ${day(p.bonusEndsAt)}` : "";
      for (const h of holders) {
        const pts = (h._sum.points ?? 0).toLocaleString("en-US");
        const before = await this.prisma.notification.count({
          where: {
            userId: h.userId,
            dedupeKey: `transfer-bonus:${p.id}:${p.bonusPercent}:${p.bonusEndsAt ? day(p.bonusEndsAt) : "open"}`,
          },
        });
        await this.notifications.notify(
          h.userId,
          "TRANSFER_BONUS",
          `${p.bonusPercent}% transfer bonus: ${p.currency.name} → ${p.program.name}`,
          `Transfers to ${p.program.name} get ${p.bonusPercent}% extra${until}. Your household holds ${pts} ${p.currency.name}. Only transfer for an award you can book — transfers can't be undone.`,
          "/travel",
          `transfer-bonus:${p.id}:${p.bonusPercent}:${p.bonusEndsAt ? day(p.bonusEndsAt) : "open"}`,
        );
        if (!before) n++;
      }
    }
    return n;
  }

  async scanExpiringOffers(now: Date): Promise<number> {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { offerExpiring: true },
    });
    let n = 0;
    for (const p of prefs) {
      const uos = await this.prisma.userOffer.findMany({
        where: {
          status: "ACTIVE",
          walletCard: { wallet: { userId: p.userId } },
          offer: { endsAt: { gte: now } },
        },
        include: {
          offer: true,
          walletCard: { include: { card: { select: { name: true } } } },
        },
      });
      for (const uo of uos) {
        if (!isExpiringSoon(uo.offer, uo, now, p.expiringDays)) continue;
        const d = daysLeft(uo.offer, now);
        const ends = day(uo.offer.endsAt as Date);
        await this.notifications.notify(
          p.userId,
          "OFFER_EXPIRING",
          `Offer expiring in ${d} day${d === 1 ? "" : "s"}`,
          `"${uo.offer.title}" on ${uo.walletCard.nickname || uo.walletCard.card.name} ends ${ends}.`,
          "/offers",
          `expiring:${uo.id}:${ends}`,
        );
        n++;
      }
    }
    return n;
  }

  private async walletsWithPref(pref: "cardRenewal" | "bonusDeadline") {
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { [pref]: true },
      select: { userId: true },
    });
    const wallets = await this.prisma.wallet.findMany({
      where: { userId: { in: prefs.map((p) => p.userId) } },
      include: { cards: { include: walletCardInclude } },
    });
    return wallets.map((w) => ({
      userId: w.userId,
      cards: w.cards.map(toDomainWalletCard),
    }));
  }

  async scanRenewals(now: Date): Promise<number> {
    let n = 0;
    for (const w of await this.walletsWithPref("cardRenewal")) {
      for (const r of upcomingRenewals(w.cards, now, 30)) {
        await this.notifications.notify(
          w.userId,
          "CARD_RENEWAL",
          `${r.name} renews in ${r.daysUntil} days`,
          `Annual fee of ${fmt(r.annualFeeCents)} posts around ${day(r.renewsAt)}. Decide whether to keep, downgrade, or cancel.`,
          "/wallet",
          `renewal:${r.walletCardId}:${day(r.renewsAt)}`,
        );
        n++;
      }
    }
    return n;
  }

  async scanBonusDeadlines(now: Date): Promise<number> {
    let n = 0;
    for (const w of await this.walletsWithPref("bonusDeadline")) {
      for (const b of bonusProgress(w.cards, now).filter((x) => x.atRisk)) {
        await this.notifications.notify(
          w.userId,
          "BONUS_DEADLINE",
          `Welcome bonus at risk: ${b.name}`,
          `You've spent ${fmt(b.spentCents)} of ${fmt(b.requiredSpendCents)} with ${b.daysLeft} days left.`,
          "/wallet",
          `bonus:${b.walletCardId}:${day(b.deadline)}`,
        );
        n++;
      }
    }
    return n;
  }

  /** Match catalog offers created in the last 24h against active keyword alerts. */
  async matchOfferAlerts(now: Date): Promise<number> {
    const since = new Date(now.getTime() - 86_400_000);
    const [offers, alerts] = await Promise.all([
      this.prisma.offer.findMany({
        where: { isActive: true, isCustom: false, createdAt: { gte: since } },
      }),
      this.prisma.offerAlert.findMany({
        where: {
          isActive: true,
          user: { notificationPrefs: { offerAlerts: true } },
        },
      }),
    ]);
    let n = 0;
    for (const a of alerts) {
      for (const o of offers.filter((o) => matchesAlert(o, a))) {
        await this.notifications.notify(
          a.userId,
          "OFFER_ALERT",
          `New offer: ${o.title}`,
          o.description ?? "A new offer matches your alert.",
          "/offers",
          `alert:${a.id}:${o.id}`,
        );
        n++;
      }
    }
    return n;
  }

  /** Mark user offers whose catalog offer ended as EXPIRED. */
  async expireOffers(now: Date): Promise<number> {
    const res = await this.prisma.userOffer.updateMany({
      where: { status: "ACTIVE", offer: { endsAt: { lt: now } } },
      data: { status: "EXPIRED" },
    });
    return res.count;
  }

  /** Email unread, un-emailed notifications to users who opted into the digest. */
  async emailDigest(now: Date): Promise<number> {
    const pending = await this.prisma.notification.findMany({
      where: {
        readAt: null,
        emailedAt: null,
        user: { notificationPrefs: { emailDigest: true } },
      },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });
    const byUser = new Map<string, typeof pending>();
    for (const p of pending)
      byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
    let sent = 0;
    for (const [userId, items] of byUser) {
      const body = items.map((i) => `• ${i.title}\n  ${i.body}`).join("\n\n");
      const subject = `PointWise: ${items.length} update${items.length > 1 ? "s" : ""}`;
      const ok = await this.mail.send(items[0].user.email, subject, body);
      if (ok) {
        await this.prisma.notification.updateMany({
          where: { id: { in: items.map((i) => i.id) } },
          data: { emailedAt: now },
        });
        sent++;
      } else {
        this.logger.warn(`digest for ${userId} not sent`);
      }
    }
    return sent;
  }

  /**
   * Benefit expiry alerts at period-scaled lead times (domain/benefits.alertThresholds). One delivery
   * per (benefit, period end, threshold, channel) — enforced by a unique row in BenefitNotification.
   * Users without a preferences row get the defaults (in-app + email on).
   */
  async scanBenefitExpirations(now: Date): Promise<number> {
    const rows = await this.prisma.userBenefit.findMany({
      where: {
        enabled: true,
        walletCard: { status: "APPROVED" },
        amountPerPeriodCents: { gt: 0 },
      },
      include: userBenefitInclude,
    });
    const userIds = [...new Set(rows.map((r) => r.walletCard.wallet.userId))];
    const prefs = new Map(
      (
        await this.prisma.notificationPreference.findMany({
          where: { userId: { in: userIds } },
        })
      ).map((p) => [p.userId, p]),
    );
    let n = 0;
    for (const b of rows) {
      const userId = b.walletCard.wallet.userId;
      const p = prefs.get(userId);
      if (p && !p.benefitExpiring) continue;
      const v = benefitView(b, now);
      const t = dueThreshold(
        b,
        v.currentPeriod,
        now,
        v.currentPeriod.remainingCents,
      );
      if (t == null) continue;
      const d = v.currentPeriod.daysLeft;
      const title =
        d <= 1 ? `${b.name} expires today` : `${b.name} expires in ${d} days`;
      const body = `$${(v.currentPeriod.remainingCents / 100).toFixed(2)} left on ${v.walletCard.name} — use it by ${isoDay(v.currentPeriod.lastDay)}.`;
      const channels: Array<"IN_APP" | "EMAIL" | "PUSH"> = ["IN_APP"];
      if (p?.benefitEmail ?? true) channels.push("EMAIL");
      if (p?.benefitPush ?? false) channels.push("PUSH");
      for (const channel of channels) {
        let logId: string;
        try {
          logId = (
            await this.prisma.benefitNotification.create({
              data: {
                userBenefitId: b.id,
                periodEnd: v.currentPeriod.end,
                thresholdDays: t,
                channel,
              },
            })
          ).id;
        } catch (e) {
          if ((e as { code?: string }).code === "P2002") continue; // already sent
          throw e;
        }
        if (channel === "IN_APP") {
          const dedupeKey = `benefit:${b.id}:${isoDay(v.currentPeriod.end)}:${t}`;
          // emailedAt is pre-set when the email channel handles it, so the daily digest won't repeat it
          await this.prisma.notification.upsert({
            where: { userId_dedupeKey: { userId, dedupeKey } },
            update: {},
            create: {
              userId,
              type: "BENEFIT_EXPIRING",
              title,
              body,
              link: "/benefits",
              dedupeKey,
              emailedAt: channels.includes("EMAIL") ? now : null,
            },
          });
        } else if (this.dispatcher) {
          await this.dispatcher.dispatch({
            benefitNotificationId: logId,
            userId,
            channel,
            title,
            body,
            link: "/benefits",
          });
        }
        n++;
      }
    }
    return n;
  }

  /** Daily 5/24 history per household member (idempotent per day). */
  async snapshot524(now: Date): Promise<number> {
    if (!this.portfolio) return 0;
    const owners = await this.prisma.household.findMany({
      select: { ownerId: true },
    });
    const takenOn = new Date(isoDay(now));
    let n = 0;
    for (const o of owners) {
      const f = await this.portfolio.five24(o.ownerId, {}, now);
      for (const m of f.members) {
        await this.prisma.fiveTwentyFourSnapshot.upsert({
          where: { profileId_takenOn: { profileId: m.profile.id, takenOn } },
          update: { count: m.status.count },
          create: { profileId: m.profile.id, takenOn, count: m.status.count },
        });
        n++;
      }
    }
    return n;
  }
}

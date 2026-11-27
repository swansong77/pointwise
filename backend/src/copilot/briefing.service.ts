import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { annualFee } from '../domain/calculator';
import { householdNextCards } from '../domain/card-scorer';
import { alertsFor, Alert, AlertSignals, BRIEF_KINDS, MAX_ALERTS_PER_RUN, BRIEF_RETENTION_DAYS, BriefKind, Briefing, cardVerdicts, CardReview, dailyBrief, daysLeftInMonth, MonthlySignals, monthlyBrief, notificationFor, weeklyBrief, WeeklySignals } from '../domain/copilot-brief';
import { centsOf, CopilotPlan } from '../domain/copilot-plan';
import { upcomingRenewals } from '../domain/insights';
import { LoyaltyAutomationService } from '../loyalty/loyalty-automation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PortfolioService } from '../portfolio/portfolio';
import { SearchAskService } from '../search/search-ask.service';
import { StrategyService } from '../strategy/strategy.service';
import { CopilotService } from './copilot.service';
import { ChiefService } from './chief.service';
import { PortfolioSignalsService } from './portfolio-signals.service';
import { GoalsService } from './goals.service';

const DAY = 86_400_000;
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

export interface StoredBriefing {
  id: string;
  kind: BriefKind;
  periodKey: string;
  createdAt: Date;
  content: Briefing;
  narration: { text: string; model: string; provider: string; local: boolean } | null;
}

/**
 * Daily, weekly and monthly AI Mode briefings and the few alerts worth interrupting for. They are built from the member's own data by the
 * same planner as everything else, stored once per period, and delivered as a notification. A model may reword a briefing only as the
 * member's consent allows; without it the built-in wording is used.
 */
@Injectable()
export class BriefingService {
  private readonly log = new Logger(BriefingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly copilot: CopilotService,
    private readonly notifications: NotificationsService,
    private readonly portfolio: PortfolioService,
    private readonly strategy: StrategyService,
    private readonly loyaltyAuto: LoyaltyAutomationService,
    private readonly search: SearchAskService,
    private readonly goals: GoalsService,
    private readonly chief: ChiefService,
    private readonly signals: PortfolioSignalsService,
  ) {}

  // ───────────── signals ─────────────

  private async newOffers(userId: string, since: Date) {
    const rows = await this.prisma.offerSnapshotItem.findMany({ where: { userId, firstSeenAt: { gte: since }, status: 'AVAILABLE' }, select: { valueCents: true }, take: 500 });
    return { count: rows.length, cents: rows.reduce((s, r) => s + r.valueCents, 0) };
  }

  private async weeklySignals(userId: string, now: Date): Promise<WeeklySignals> {
    const since = new Date(now.getTime() - 7 * DAY);
    const [fresh, added, redeemed, expired, certs, changes, health] = await Promise.all([
      this.newOffers(userId, since),
      this.prisma.offerSnapshotItem.findMany({ where: { userId, enrolledAt: { gte: since } }, select: { savedCents: true }, take: 500 }),
      this.prisma.userOffer.count({ where: { walletCard: { wallet: { userId } }, redeemedAt: { gte: since } } }),
      this.prisma.offerSnapshotItem.findMany({ where: { userId, status: 'EXPIRED', endsAt: { gte: since, lte: now }, decision: { in: ['RECOMMENDED', 'PENDING_REVIEW', 'NEW'] } }, select: { valueCents: true }, take: 500 }),
      this.prisma.loyaltyCertificate.count({ where: { userId, usedAt: { gte: since } } }),
      this.loyaltyAuto.recentChanges(userId, 7, now),
      this.loyaltyAuto.health(userId, [], now).catch(() => null),
    ]);
    return {
      newOffers: fresh.count,
      newOffersCents: fresh.cents,
      addedOffers: added.length,
      savedCents: added.reduce((s, r) => s + r.savedCents, 0),
      redeemedOffers: redeemed,
      missedCents: expired.reduce((s, r) => s + r.valueCents, 0),
      certsUsed: certs,
      changes: changes.changes.slice(0, 6).map((c) => ({ program: c.program, what: typeof c.value === 'number' ? `${c.what} ${c.value.toLocaleString('en-US')}` : c.what })),
      healthScore: health ? health.household.score : null,
      healthLabel: health ? health.household.label : null,
      healthReasons: health ? health.household.reasons : [],
    };
  }

  // ───────────── briefings ─────────────

  private toStored(r: { id: string; kind: string; periodKey: string; createdAt: Date; content: Prisma.JsonValue; narration: Prisma.JsonValue | null }): StoredBriefing {
    return { id: r.id, kind: r.kind as BriefKind, periodKey: r.periodKey, createdAt: r.createdAt, content: r.content as unknown as Briefing, narration: (r.narration as StoredBriefing['narration']) ?? null };
  }

  /**
   * Builds the briefing for this period. The same period returns the one already made unless `force` (the member asked for a fresh one).
   * `notify` is for the scheduled run: it tells the member once.
   */
  async generate(userId: string, kind: BriefKind, now = new Date(), opts: { force?: boolean; notify?: boolean } = {}): Promise<{ briefing: StoredBriefing; created: boolean }> {
    const key = { userId_kind_periodKey: { userId, kind, periodKey: kind === 'DAILY' ? now.toISOString().slice(0, 10) : kind === 'MONTHLY' ? now.toISOString().slice(0, 7) : weekKey(now) } };
    const existing = await this.prisma.copilotBriefing.findUnique({ where: key });
    if (existing && !opts.force) return { briefing: this.toStored(existing), created: false };

    const q = kind === 'DAILY' ? 'What should I do today?' : kind === 'WEEKLY' ? 'What should I do this week?' : 'What should I do this month?';
    const executive = kind === 'DAILY' && !!(await this.prisma.aiSettings.findUnique({ where: { userId }, select: { chiefOfStaff: true } }))?.chiefOfStaff;
    let brief: Briefing;
    let plan: CopilotPlan;
    if (executive) {
      // the Chief of Staff's format: greeting, the numbers, the top actions with value, time, risk and priority
      const e = await this.chief.dailyBriefing(userId, now);
      brief = e.brief;
      plan = e.plan;
    } else {
      const a = await this.copilot.agenda(userId, kind === 'MONTHLY' ? 'PLANNING' : kind === 'DAILY' ? 'QUICK' : 'PLANNING', q, now);
      plan = a.plan;
      if (kind === 'DAILY') {
        const fresh = await this.newOffers(userId, new Date(now.getTime() - DAY));
        brief = dailyBrief(a.plan, { newOffers: fresh.count, newOffersCents: fresh.cents }, now);
      } else if (kind === 'WEEKLY') brief = weeklyBrief(a.plan, await this.weeklySignals(userId, now), now);
      else brief = monthlyBrief(a.plan, await this.signals.monthlySignals(userId, now), now);
    }

    const run = await this.prisma.agentRun.create({ data: { userId, workflow: 'copilot-' + kind.toLowerCase(), question: q, status: 'RUNNING', engineVersion: brief.version } });
    const narrated = plan.items.length ? await this.copilot.narratePlan(userId, plan, run.id) : { narration: null, skipped: null };
    await this.prisma.agentRun.update({ where: { id: run.id }, data: { status: 'COMPLETED', finishedAt: new Date(), result: { kind, periodKey: brief.periodKey, headline: brief.headline, confidence: brief.confidence, narratedBy: narrated.narration?.model ?? null } as Prisma.InputJsonValue } });

    const content = brief as unknown as Prisma.InputJsonValue;
    const narration = narrated.narration ? ({ text: narrated.narration.text, model: narrated.narration.model, provider: narrated.narration.provider, local: narrated.narration.local } as Prisma.InputJsonValue) : Prisma.JsonNull;
    const row = await this.prisma.copilotBriefing.upsert({ where: key, update: { content, narration, createdAt: now }, create: { userId, kind, periodKey: key.userId_kind_periodKey.periodKey, content, narration, createdAt: now } });
    // with the Chief of Staff on, the board report is the one monthly message, so the monthly briefing is kept but not announced twice
    const folded = kind === 'MONTHLY' && !!(await this.prisma.aiSettings.findUnique({ where: { userId }, select: { chiefOfStaff: true } }))?.chiefOfStaff;
    if (opts.notify && !existing && !folded) {
      const n = notificationFor(brief);
      await this.notifications.notify(userId, 'COPILOT', n.title, n.body, '/copilot#briefings', `copilot:${kind.toLowerCase()}:${brief.periodKey}`);
    }
    return { briefing: this.toStored(row), created: !existing };
  }

  async list(userId: string, kind?: BriefKind, limit = 20): Promise<StoredBriefing[]> {
    const rows = await this.prisma.copilotBriefing.findMany({ where: { userId, ...(kind ? { kind } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(60, Math.max(1, limit)) });
    return rows.map((r) => this.toStored(r));
  }

  /** the newest briefing of each kind */
  async latest(userId: string): Promise<Record<BriefKind, StoredBriefing | null>> {
    const out = { DAILY: null, WEEKLY: null, MONTHLY: null } as Record<BriefKind, StoredBriefing | null>;
    for (const k of BRIEF_KINDS) {
      const r = await this.prisma.copilotBriefing.findFirst({ where: { userId, kind: k }, orderBy: { createdAt: 'desc' } });
      out[k] = r ? this.toStored(r) : null;
    }
    return out;
  }

  async get(userId: string, id: string): Promise<StoredBriefing> {
    const r = await this.prisma.copilotBriefing.findFirst({ where: { id, userId } });
    if (!r) throw new NotFoundException('Briefing not found');
    return this.toStored(r);
  }

  /** the scheduled run: members who turned AI Mode on and did not switch this kind off */
  async runDue(kind: BriefKind, now: Date): Promise<number> {
    const flag = kind === 'DAILY' ? 'briefingDaily' : kind === 'WEEKLY' ? 'briefingWeekly' : 'briefingMonthly';
    const users = await this.prisma.aiSettings.findMany({ where: { aiModeEnabled: true, [flag]: true }, select: { userId: true }, take: 2000 });
    let created = 0;
    for (const u of users) {
      try {
        if ((await this.generate(u.userId, kind, now, { notify: true })).created) created++;
      } catch (e) {
        this.log.warn(`${kind} briefing failed for one member: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
    return created;
  }

  // ───────────── proactive alerts ─────────────

  async alertSignals(userId: string, now: Date): Promise<AlertSignals> {
    const [ctx, goals, opp, credits] = await Promise.all([
      this.strategy.scoringContext(userId, {}, now),
      this.goals.views(userId, now),
      this.search.runStep(userId, { tool: 'get_offer_opportunities', label: 'Offer opportunities', input: {} }, now),
      this.search.runStep(userId, { tool: 'get_benefit_summary', label: 'Credits', input: { status: 'expiring', withinDays: 8 } }, now),
    ]);
    const open = (Array.isArray((opp.data as { items?: unknown[] } | null)?.items) ? (opp.data as { items: Array<Record<string, unknown>> }).items : []).filter((o) => o.activated === false && num(o.expectedValueCents) >= 500 && (o.daysLeft == null || num(o.daysLeft) <= 45));
    const pick = householdNextCards(ctx.cards, ctx.applicants, ctx.household, ctx.spend.lines, ctx.opt, 1).pick;
    const primary = ctx.applicants[0]?.profileId;
    const left = daysLeftInMonth(now);
    const creditItems = (Array.isArray((credits.data as { items?: unknown[] } | null)?.items) ? (credits.data as { items: Array<Record<string, unknown>> }).items : []).filter((i) => num(i.daysLeft) <= left);
    return {
      offersAvailableCents: open.reduce((s, o) => s + num(o.expectedValueCents), 0),
      offersAvailableCount: open.length,
      topOffers: open.sort((a, b) => num(b.expectedValueCents) - num(a.expectedValueCents)).map((o) => String(o.merchant ?? o.title ?? '')).filter(Boolean).slice(0, 2),
      applyPick: pick ? { member: pick.member, card: pick.name, slug: pick.slug, firstYearCents: pick.firstYearValueCents, memberIsPrimary: pick.profileId === primary, usesSlot: pick.five24.countsToward && pick.five24.slotCostCents > 0 } : null,
      goalsNeedingAttention: goals.filter((g) => g.progress.state === 'AT_RISK' || g.progress.state === 'BEHIND').map((g) => ({ id: g.id, title: g.title, detail: g.progress.detail })),
      creditsUnusedCents: creditItems.reduce((s, i) => s + (centsOf(i.remaining) ?? 0), 0),
      daysLeftInMonth: left,
    };
  }

  async alerts(userId: string, now: Date): Promise<Alert[]> {
    const own = alertsFor(await this.alertSignals(userId, now), now);
    // with the Chief of Staff on, each new Critical item is announced too (the most pressing first, never more than three in all)
    const on = !!(await this.prisma.aiSettings.findUnique({ where: { userId }, select: { chiefOfStaff: true } }))?.chiefOfStaff;
    if (!on) return own;
    const critical = (await this.chief.criticalAlerts(userId, now)).map((c) => ({ ...c, priority: 10 }));
    return [...critical, ...own].slice(0, MAX_ALERTS_PER_RUN);
  }

  /** the scheduled run: each alert is sent once (the key includes the week or month) */
  async runAlerts(now: Date): Promise<number> {
    const users = await this.prisma.aiSettings.findMany({ where: { aiModeEnabled: true, copilotAlerts: true }, select: { userId: true }, take: 2000 });
    let sent = 0;
    for (const u of users) {
      try {
        for (const a of await this.alerts(u.userId, now)) {
          const before = await this.prisma.notification.count({ where: { userId: u.userId, dedupeKey: a.dedupeKey } });
          if (before) continue;
          await this.notifications.notify(u.userId, 'COPILOT', a.title, a.body, a.link, a.dedupeKey);
          sent++;
        }
      } catch (e) {
        this.log.warn(`alerts failed for one member: ${e instanceof Error ? e.message : 'error'}`);
      }
    }
    return sent;
  }

  /** nothing is kept longer than BRIEF_RETENTION_DAYS */
  async purge(now: Date): Promise<number> {
    return (await this.prisma.copilotBriefing.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - BRIEF_RETENTION_DAYS * DAY) } } })).count;
  }

  /** fees against what the cards returned, the cards worth a decision, and who the household's next application would be, for the dashboard */
  portfolioSummary(userId: string, now: Date) {
    return this.signals.portfolioSummary(userId, now);
  }
}

function weekKey(now: Date): string {
  const back = (now.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back)).toISOString().slice(0, 10);
}

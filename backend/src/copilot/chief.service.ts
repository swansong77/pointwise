import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Briefing, periodKey } from '../domain/copilot-brief';
import { isHidden } from '../domain/copilot-memory';
import { CopilotPlan, PlanItem, renewalsWithin } from '../domain/copilot-plan';
import { isTravel, LifeEstimate, LifeKindName } from '../domain/cos-life';
import { executiveBrief, ExecSummary, factLine, summarize } from '../domain/cos-brief';
import { membershipItems, statusItems } from '../domain/cos-extra';
import { recoveryOf, Recovery, RecoverySignals } from '../domain/cos-recovery';
import { byScore, CENTER_LABEL, CENTER_ORDER, CenterHorizon, ExecItem, toExecItem } from '../domain/cos-score';
import { annualOutlook, scoreCards, ScoreSignals } from '../domain/cos-scores';
import { LoyaltyAutomationService } from '../loyalty/loyalty-automation.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { OfferDashboardsService } from '../offers/offer-dashboards.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PortfolioService } from '../portfolio/portfolio';
import { SearchAskService } from '../search/search-ask.service';
import { CopilotService } from './copilot.service';
import { GoalsService } from './goals.service';
import { LifeEventsService } from './life-events.service';
import { PortfolioSignalsService } from './portfolio-signals.service';

const DAY = 86_400_000;
const MAX_ITEMS = 80;
const EXTRA_STEPS = [
  { tool: 'get_renewals', label: 'Annual fees this year', input: { withinDays: 366 } },
  { tool: 'get_memberships', label: 'Memberships', input: {} },
  { tool: 'get_status_progress', label: 'Elite status', input: {} },
];

export interface ChiefAlert {
  key: string;
  title: string;
  body: string;
  link: string;
  dedupeKey: string;
}

/**
 * The Chief of Staff: ranks everything the specialists found into one short, explainable list, arranges it by when it matters, and says
 * what has been lost and what can still be saved. It reads; it never changes anything, and a model never sees any of it except the
 * redacted view the Copilot already builds.
 */
@Injectable()
export class ChiefService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly copilot: CopilotService,
    private readonly search: SearchAskService,
    private readonly loyalty: LoyaltyService,
    private readonly portfolio: PortfolioService,
    private readonly notifications: NotificationsService,
    private readonly signals: PortfolioSignalsService,
    private readonly loyaltyAuto: LoyaltyAutomationService,
    private readonly dashboards: OfferDashboardsService,
    private readonly goals: GoalsService,
    private readonly life: LifeEventsService,
  ) {}

  /** every item the Chief of Staff would put in front of the member, highest priority first */
  async items(userId: string, now: Date): Promise<{ items: ExecItem[]; plan: CopilotPlan }> {
    const [a, extra] = await Promise.all([this.copilot.agenda(userId, 'RESEARCH', 'What should I do this month?', now, { limit: MAX_ITEMS }), Promise.all(EXTRA_STEPS.map((st) => this.search.runStep(userId, st, now)))]);
    const [renew, members, status] = extra;
    const seen = new Set(a.plan.items.map((i) => i.id));
    const more = [...(renew.ok ? renewalsWithin(366, 6)(renew.data, now) : []), ...(members.ok ? membershipItems(members.data, now) : []), ...(status.ok ? statusItems(status.data) : []), ...(await this.lifeItems(userId, now))].filter((i) => !seen.has(i.id) && !isHidden(a.decisions.get(i.id), now));
    const items = [...a.plan.items, ...more].map((i) => toExecItem(i, now)).sort(byScore).slice(0, MAX_ITEMS);
    return { items, plan: a.plan };
  }

  /** upcoming life events as things to prepare for; the event's own title shows on the member's page and never in a redacted view */
  private async lifeItems(userId: string, now: Date): Promise<PlanItem[]> {
    const events = await this.life.upcoming(userId, now, 150);
    return events.map((e) => {
      const days = Math.max(0, Math.floor(((e.startsOn as Date).getTime() - now.getTime()) / DAY));
      const est = e.estimate as unknown as LifeEstimate | null;
      const usableCert = !!est?.certificates.some((c) => c.usable);
      const value = est?.expectedValueCents ?? null;
      return {
        id: 'life:' + e.id,
        lens: isTravel(e.kind as LifeKindName) ? ('TRAVEL' as const) : ('OFFER' as const),
        horizon: days <= 7 ? ('WEEK' as const) : days <= 31 ? ('MONTH' as const) : ('LATER' as const),
        priority: 6,
        title: e.title + (days <= 1 ? ' starts tomorrow' : ' starts in ' + days + ' days'),
        recommendation: est ? 'Line up ' + (est.bestCards[0]?.card ?? 'your best card') + ' for the spending' + (usableCert ? ' and use a certificate' : '') + '; the expected value is about $' + Math.round((value ?? 0) / 100).toLocaleString('en-US') + '.' : 'Get the estimate to see the best cards, credits and points for it.',
        reason: est ? 'Worked out from your own cards, credits and certificates.' : 'Planning early leaves time to use credits and certificates that would otherwise expire first.',
        evidence: ['Life events: ' + days + ' days away'],
        expectedValueCents: value,
        assumptions: est?.assumed ?? [],
        risks: est?.risks.slice(0, 1) ?? [],
        confidence: est?.confidence ?? 50,
        factors: [],
        href: '/chief-of-staff#life',
        facts: { kind: 'LIFE_EVENT', daysLeft: days, amountCents: value ?? undefined },
        calls: [],
      };
    });
  }

  /** the first name to greet, from the member's own account */
  async firstName(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const n = u?.name?.trim().split(/\s+/)[0];
    if (n) return n;
    return (await this.prisma.profile.findFirst({ where: { userId, isPrimary: true }, select: { nickname: true } }))?.nickname ?? null;
  }

  private newHighValueOffers(userId: string, now: Date) {
    return this.prisma.offerSnapshotItem.count({ where: { userId, firstSeenAt: { gte: new Date(now.getTime() - 7 * DAY) }, status: 'AVAILABLE', valueCents: { gte: 5000 } } });
  }

  async recoverySignals(userId: string, now: Date): Promise<RecoverySignals> {
    const [offers, pf, val] = await Promise.all([
      this.prisma.offerSnapshotItem.findMany({ where: { userId, status: 'EXPIRED', endsAt: { gte: new Date(now.getTime() - 90 * DAY), lte: now }, decision: { in: ['RECOMMENDED', 'PENDING_REVIEW', 'NEW'] } }, select: { merchantText: true, valueCents: true }, take: 200 }),
      this.portfolio.portfolio(userId, {}, now),
      this.loyalty.valuation(userId, [], now),
    ]);
    return {
      expiredOffers: offers.map((o) => ({ label: o.merchantText, cents: o.valueCents })),
      missedCredits: pf.groups.active.map((c) => ({ card: c.name, cents: c.missedBenefitCents })),
      expiredAssetsCents: val.expiredCents,
      recoveredCents: val.recoveredCents,
    };
  }

  async recovery(userId: string, now = new Date(), items?: ExecItem[]): Promise<Recovery> {
    const [sig, list] = await Promise.all([this.recoverySignals(userId, now), items ? Promise.resolve(items) : this.items(userId, now).then((r) => r.items)]);
    return recoveryOf(sig, list);
  }

  /** the Action Center: today, this week, this month, this quarter, the annual review */
  actionCenter(items: ExecItem[]) {
    return CENTER_ORDER.map((key: CenterHorizon) => {
      const list = items.filter((i) => i.center === key);
      return { key, label: CENTER_LABEL[key], count: list.length, valueAtRiskCents: list.reduce((s, i) => s + i.impact.atRiskCents, 0), items: list };
    });
  }

  async overview(userId: string, now = new Date()) {
    const [{ items, plan }, name, newHigh] = await Promise.all([this.items(userId, now), this.firstName(userId), this.newHighValueOffers(userId, now)]);
    const recovery = await this.recovery(userId, now, items);
    const summary: ExecSummary = summarize(items, newHigh);
    return {
      generatedAt: now.toISOString(),
      greeting: name ? `Good morning ${name}.` : 'Good morning.',
      summary,
      confidence: plan.confidence,
      top: items.slice(0, 10),
      center: this.actionCenter(items).map((h) => ({ key: h.key, label: h.label, count: h.count, valueAtRiskCents: h.valueAtRiskCents })),
      recovery,
      hidden: plan.memory.hidden.length,
    };
  }

  /** the executive daily briefing, with the plan it came from (so a model can be asked to reword it, if the member allowed that) */
  async dailyBriefing(userId: string, now: Date): Promise<{ brief: Briefing; plan: CopilotPlan; items: ExecItem[] }> {
    const [{ items, plan }, name, newHigh, quiet] = await Promise.all([this.items(userId, now), this.firstName(userId), this.newHighValueOffers(userId, now), this.prisma.notificationPreference.findUnique({ where: { userId }, select: { quietMode: true } })]);
    const recovery = await this.recovery(userId, now, items);
    const held = quiet?.quietMode ? await this.notifications.held(userId, new Date(now.getTime() - DAY)) : null;
    const brief = executiveBrief({ name, items, summary: summarize(items, newHigh), recovery, held: held ? { total: held.total, byType: held.byType.map((t) => ({ type: String(t.type), count: t.count })) } : null, confidence: plan.confidence, now });
    return { brief, plan, items };
  }

  /** a notification for each new Critical item, once (the key repeats until its deadline or the week ends) */
  async criticalAlerts(userId: string, now: Date, limit = 3): Promise<ChiefAlert[]> {
    const { items } = await this.items(userId, now);
    return items
      .filter((i) => i.band === 'CRITICAL')
      .slice(0, limit)
      .map((i) => ({ key: 'cos:' + i.id, title: `Critical: ${i.title}`, body: `${i.recommendation} ${factLine(i)}`.slice(0, 300), link: '/chief-of-staff', dedupeKey: `cos:crit:${i.id}:${i.deadline ?? periodKey('WEEKLY', now)}` }));
  }

  /**
   * The executive command center: the household's value in one place, five scores with their reasons, the top risks and opportunities,
   * and an estimate of the year. Every number comes from an engine that already exists.
   */
  async commandCenter(userId: string, now = new Date()) {
    const [{ items, plan }, val, health, savings, summary, totals, goals, members, certs, sig] = await Promise.all([
      this.items(userId, now),
      this.loyalty.valuation(userId, [], now),
      this.loyaltyAuto.health(userId, [], now).catch(() => null),
      this.dashboards.savings(userId, now),
      this.signals.portfolioSummary(userId, now),
      this.signals.portfolioTotals(userId, now),
      this.goals.list(userId, now),
      this.loyalty.memberships(userId, [], now),
      this.loyalty.certificates(userId, undefined, now),
      this.recoverySignals(userId, now),
    ]);
    const kind = (k: string) => items.filter((i) => i.facts.kind === k);
    const offers = [...kind('OFFER_ACTIVATE'), ...kind('OFFER_EXPIRING')];
    const trip = goals.find((g) => g.kind === 'TRIP' && g.progress.pct != null);
    const behind = goals.filter((g) => g.progress.state === 'AT_RISK' || g.progress.state === 'BEHIND').length;
    const scoreSig: ScoreSignals = {
      loyalty: { healthScore: health ? health.household.score : null, atRiskCents: val.atRiskCents, totalCents: val.currentCents, expiredCents: val.expiredCents },
      portfolio: { cards: summary.cards, feesCents: summary.feesCents, valueCents: summary.valueCents, toReview: summary.toReview },
      offers: { availableCount: offers.length, availableCents: offers.reduce((s, i) => s + Math.max(0, i.expectedValueCents ?? 0), 0), expiringUnactivated: kind('OFFER_ACTIVATE').filter((i) => (i.daysLeft ?? 99) <= 14).length, missedCents: sig.expiredOffers.reduce((s, o) => s + o.cents, 0), hitRate: savings.plans.hitRate, savedCents: savings.totals.savedCents },
      travel: {
        membershipsValid: members.filter((m) => m.view.state === 'ACTIVE').length,
        membershipsExpiring: members.filter((m) => m.view.state === 'EXPIRING').length,
        certificatesUsable: certs.filter((c) => c.view.effectiveStatus === 'AVAILABLE').length,
        certificatesExpiring: kind('CERTIFICATE_EXPIRING').length,
        points: val.totalPoints,
        activeBonus: kind('TRANSFER_BONUS').length > 0,
        tripGoalPct: trip?.progress.pct ?? null,
      },
      household: { criticalItems: items.filter((i) => i.band === 'CRITICAL').length, goalsTotal: goals.length, goalsBehind: behind, membersOverLimit: summary.members.filter((m) => !m.underLimit).length, members: summary.members.length },
    };
    const yearEnd = Date.UTC(now.getUTCFullYear() + 1, 0, 1);
    const feesRemaining = summary.verdicts.length ? await this.feesRemaining(userId, now, yearEnd) : 0;
    const outlook = annualOutlook({
      now,
      realizedYtdCents: savings.totals.savedCents,
      recentMonthsCents: savings.byMonth.slice(-6).map((m) => m.actualCents),
      rewardsRunRate12mCents: totals.rewardsCents,
      scheduledValueCents: items.reduce((s, i) => s + i.impact.preservedCents, 0),
      feesRemainingCents: feesRemaining,
    });
    const created = items.filter((i) => i.impact.createdCents > 0 || i.impact.futureCents > 0);
    const thisMonth = savings.byMonth[savings.byMonth.length - 1]?.actualCents ?? 0;
    return {
      generatedAt: now.toISOString(),
      values: {
        totalHouseholdCents: val.currentCents + (totals.rewardsCents + totals.realizedBenefitCents - totals.feesCents),
        pointsCents: val.byCategory.points,
        benefitsCents: totals.realizedBenefitCents,
        certificatesCents: val.byCategory.certificates,
        travelCreditsCents: val.byCategory.credits,
        offersAvailableCents: scoreSig.offers.availableCents,
        expiringAssetsCents: items.reduce((s, i) => s + i.impact.atRiskCents, 0),
        recentSavingsCents: thisMonth,
        savingsThisYearCents: savings.totals.savedCents,
        opportunitiesCount: created.length,
        opportunitiesCents: created.reduce((s, i) => s + i.impact.createdCents + i.impact.futureCents, 0),
        projectedSavingsCents: outlook.projectedAdditionalCents,
      },
      scores: scoreCards(scoreSig),
      outlook,
      risks: items.filter((i) => i.impact.atRiskCents > 0).slice(0, 10),
      opportunities: created.slice(0, 10),
      today: [...items.filter((i) => i.center === 'TODAY'), ...items.filter((i) => i.center === 'WEEK')].slice(0, 5),
      top: items.slice(0, 10),
      confidence: plan.confidence,
    };
  }

  /** annual fees that still post before the year ends */
  private async feesRemaining(userId: string, now: Date, yearEnd: number): Promise<number> {
    const m = await this.signals.monthlySignals(userId, now);
    return m.cards.filter((c) => c.daysToRenewal != null && now.getTime() + c.daysToRenewal * DAY < yearEnd).reduce((s, c) => s + c.feeCents, 0);
  }
}

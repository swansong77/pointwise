import { Injectable } from '@nestjs/common';
import { PlanItem } from '../domain/copilot-plan';
import { LoyaltyAutomationService } from '../loyalty/loyalty-automation.service';
import { BriefingService } from './briefing.service';
import { CopilotService } from './copilot.service';
import { GoalsService } from './goals.service';

const EXPIRING = new Set(['OFFER_EXPIRING', 'CERTIFICATE_EXPIRING', 'LOYALTY_AT_RISK', 'CREDIT_UNUSED']);
const SAVINGS = new Set(['OFFER_ACTIVATE', 'OFFER_EXPIRING']);
const slim = (i: PlanItem) => ({ id: i.id, lens: i.lens, horizon: i.horizon, title: i.title, recommendation: i.recommendation, reason: i.reason, confidence: i.confidence, expectedValueCents: i.expectedValueCents, href: i.href, calls: i.calls });

/**
 * The Copilot dashboard: today's tasks, what is expiring, what to do, the household, travel and savings opportunities, portfolio
 * health and goal progress, all from the same planner and the member's own data.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly copilot: CopilotService,
    private readonly briefings: BriefingService,
    private readonly goals: GoalsService,
    private readonly loyaltyAuto: LoyaltyAutomationService,
  ) {}

  async dashboard(userId: string, now = new Date()) {
    const [a, goals, latest, pf, health] = await Promise.all([
      this.copilot.agenda(userId, 'RESEARCH', 'What should I do this month?', now),
      this.goals.list(userId, now),
      this.briefings.latest(userId),
      this.briefings.portfolioSummary(userId, now),
      this.loyaltyAuto.health(userId, [], now).catch(() => null),
    ]);
    const items = a.plan.items;
    const sum = (kinds: Set<string>, pick: (i: PlanItem) => number) => items.filter((i) => kinds.has(i.facts.kind)).reduce((s, i) => s + pick(i), 0);
    const offersCents = sum(SAVINGS, (i) => Math.max(0, i.expectedValueCents ?? 0));
    const creditsCents = sum(new Set(['CREDIT_UNUSED']), (i) => Math.max(0, i.expectedValueCents ?? 0));
    const newest = [latest.DAILY, latest.WEEKLY, latest.MONTHLY].filter((b): b is NonNullable<typeof b> => !!b).sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0] ?? null;
    return {
      generatedAt: now.toISOString(),
      headline: a.plan.headline,
      summary: a.plan.summary,
      confidence: a.plan.confidence,
      counts: a.plan.counts,
      valueAtStakeCents: a.plan.valueAtStakeCents,
      /** what to do first: today's items, then this week's */
      today: items.filter((i) => i.horizon === 'TODAY' || i.horizon === 'WEEK').slice(0, 6).map(slim),
      expiring: items.filter((i) => EXPIRING.has(i.facts.kind)).slice(0, 6).map(slim),
      actions: items.filter((i) => i.lens !== 'GOAL' && (i.calls.length > 0 || i.priority >= 10)).slice(0, 5).map(slim),
      travel: items.filter((i) => i.lens === 'TRAVEL' || i.facts.kind === 'CERTIFICATE_EXPIRING').slice(0, 4).map(slim),
      savings: { offersCents, creditsCents, totalCents: offersCents + creditsCents },
      household: { members: pf.members, applyPick: pf.applyPick },
      portfolio: {
        healthScore: health ? health.household.score : null,
        healthLabel: health ? health.household.label : null,
        feesCents: pf.feesCents,
        valueCents: pf.valueCents,
        cards: pf.cards,
        toReview: pf.toReview,
      },
      goals,
      recommendations: items.filter((i) => i.lens !== 'GOAL').slice(0, 3).map(slim),
      briefing: newest ? { id: newest.id, kind: newest.kind, periodKey: newest.periodKey, headline: newest.content.headline, narration: newest.narration } : null,
      hidden: a.plan.memory.hidden.length,
    };
  }
}

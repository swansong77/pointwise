import { PrismaService } from '../common/prisma.service';
import { BenefitAuditService } from '../benefit-audit/benefit-audit.module';
import { Composed, WorkflowDef } from '../domain/orchestration';
import { PortfolioService } from '../portfolio/portfolio';
import { currentPublicOffers, PublicOffer } from '../strategy/offer-data';
import { SmartRecommendationService } from '../strategy/smart-recommendation.service';
import { StrategyService } from '../strategy/strategy.service';
import { OfferAnalysisService } from '../offers/offer-analysis.service';
import { SmartResult } from './workflow-types';

export interface WfCtx {
  userId: string;
  now: Date;
  question?: string;
  /** workflow inputs, e.g. the purchase being planned */
  params?: { merchantText?: string; amountCents?: number };
}

export interface WfDeps {
  prisma: PrismaService;
  portfolio: PortfolioService;
  strategy: StrategyService;
  smart: SmartRecommendationService;
  benefits: BenefitAuditService;
  offers: OfferAnalysisService;
}

const $ = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;

interface Five24Summary {
  members: Array<{ member: string; count: number; limit: number; underLimit: boolean }>;
}
interface PortfolioSummary {
  activeCards: number;
  annualFeesCents: number;
  benefitUtilizationPct: number | null;
  unusedCents: number;
}

async function five24Step(d: WfDeps, ctx: WfCtx): Promise<Five24Summary> {
  const f = await d.portfolio.five24(ctx.userId, {}, ctx.now);
  return {
    members: f.members.map((m) => ({ member: m.profile.nickname, count: m.status.count, limit: m.status.limit, underLimit: m.status.underLimit })),
  };
}

async function portfolioStep(d: WfDeps, ctx: WfCtx): Promise<PortfolioSummary> {
  const [cards, util, rec] = await Promise.all([
    d.prisma.walletCard.findMany({
      where: { wallet: { userId: ctx.userId }, status: 'APPROVED' },
      select: { annualFeeOverrideCents: true, card: { select: { annualFeeCents: true } } },
    }),
    d.benefits.rollupView(ctx.userId, 'household', ctx.now).catch(() => null),
    d.benefits.reconciliation(ctx.userId, ctx.now).catch(() => null),
  ]);
  const g = util?.groups[0];
  return {
    activeCards: cards.length,
    annualFeesCents: cards.reduce((n, c) => n + (c.annualFeeOverrideCents ?? c.card.annualFeeCents), 0),
    benefitUtilizationPct: g && g.allocatedCents > 0 ? g.utilizationPct : null,
    unusedCents: rec?.totals.unusedCents ?? 0,
  };
}

/** "What card should I get next?": offer → 5/24 → portfolio review → card strategy → recommendation engine. */
export function nextCardWorkflow(d: WfDeps): WorkflowDef<WfCtx> {
  return {
    key: 'next-card',
    title: 'What card should I get next?',
    steps: [
      { id: 'offers', agentKey: 'offer-monitoring', engine: 'offer-intel/1', privacy: 'PUBLIC', run: (c) => currentPublicOffers(d.prisma, c.now, 40) },
      { id: 'five24', agentKey: 'five24-planning', engine: 'five24', privacy: 'USER', run: (c) => five24Step(d, c) },
      { id: 'portfolio', agentKey: 'portfolio-review', engine: 'benefit-roll/1', privacy: 'USER', optional: true, run: (c) => portfolioStep(d, c) },
      {
        id: 'strategy',
        agentKey: 'card-strategy',
        engine: 'card-scorer',
        privacy: 'USER',
        run: async (c) => {
          const plan = await d.strategy.householdPlan(c.userId, { limit: 1 }, c.now);
          return { members: plan.members.map((m) => ({ member: m.member, top: m.top[0]?.name ?? null })), overall: plan.pick?.name ?? null };
        },
      },
      { id: 'recommendation', agentKey: 'card-strategy', engine: 'recommendation/2', privacy: 'USER', run: (c) => d.smart.smart(c.userId, {}, c.now) },
    ],
    compose: (r, s): Composed => {
      const rec = r.recommendation as SmartResult | undefined;
      const f24 = r.five24 as Five24Summary | undefined;
      const pf = r.portfolio as PortfolioSummary | undefined;
      const offers = (r.offers as PublicOffer[] | undefined) ?? [];
      const lines: string[] = [];
      const highlights: string[] = [];
      if (rec?.recommended) {
        const x = rec.recommended;
        lines.push(
          `Recommended: ${x.name} (${x.issuer}). First-year value ${$(x.firstYearValueCents)}, long-term ${$(x.longTermValueCents)}. Application probability about ${Math.round(x.probability * 100)}% (an estimate), confidence ${Math.round(x.confidence * 100)}%.`,
        );
        highlights.push(x.name);
        const offer = offers.find((o) => o.slug === x.slug);
        for (const a of offer?.advice ?? x.advice) lines.push(a.text);
        if (x.factors.length) lines.push(`Why: ${x.factors.slice(0, 3).map((f) => `${f.deltaCents >= 0 ? '+' : '−'}${$(Math.abs(f.deltaCents))} ${f.label.toLowerCase()}`).join('; ')}.`);
        if (x.risks.length) lines.push(`Risks: ${x.risks.slice(0, 2).join(' ')}`);
        if (rec.alternatives.length) lines.push(`Alternatives: ${rec.alternatives.map((a) => a.name).join(', ')}.`);
      } else if (s.recommendation === 'OK') lines.push('No card you are eligible for stands out right now.');
      else lines.push('A recommendation could not be produced.');
      if (f24) lines.push(`5/24: ${f24.members.map((m) => `${m.member} ${m.count}/${m.limit}${m.underLimit ? '' : ' (at the limit)'}`).join(', ')}.`);
      if (pf) lines.push(`Portfolio: ${pf.activeCards} active cards, annual fees ${$(pf.annualFeesCents)}${pf.benefitUtilizationPct != null ? `, benefits ${pf.benefitUtilizationPct}% used` : ''}.`);
      lines.push('This is general information, not financial or credit advice.');
      return { answer: lines.join('\n'), highlights };
    },
  };
}

/** Portfolio health: fees against value, benefit use, 5/24. */
export function portfolioReviewWorkflow(d: WfDeps): WorkflowDef<WfCtx> {
  return {
    key: 'portfolio-review',
    title: 'Review my portfolio',
    steps: [
      { id: 'portfolio', agentKey: 'portfolio-review', engine: 'benefit-roll/1', privacy: 'USER', run: (c) => portfolioStep(d, c) },
      { id: 'five24', agentKey: 'five24-planning', engine: 'five24', privacy: 'USER', optional: true, run: (c) => five24Step(d, c) },
    ],
    compose: (r): Composed => {
      const pf = r.portfolio as PortfolioSummary | undefined;
      const f24 = r.five24 as Five24Summary | undefined;
      const lines: string[] = [];
      if (pf) {
        lines.push(`You hold ${pf.activeCards} active cards with ${$(pf.annualFeesCents)} in annual fees.`);
        if (pf.benefitUtilizationPct != null) lines.push(`You have used ${pf.benefitUtilizationPct}% of this period's benefit value; ${$(pf.unusedCents)} is still unused.`);
        if (pf.unusedCents > 0) lines.push('Open the Benefit reconciliation page to see which credits are still available.');
      }
      if (f24) lines.push(`5/24: ${f24.members.map((m) => `${m.member} ${m.count}/${m.limit}`).join(', ')}.`);
      lines.push('This is general information, not financial or credit advice.');
      return { answer: lines.join('\n'), highlights: [] };
    },
  };
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

/** "I am about to spend $X at Y": merchant → household cards → offers/eligibility → stacking → ranked plan with evidence. */
export function purchasePlanWorkflow(d: WfDeps): WorkflowDef<WfCtx> {
  return {
    key: 'purchase-plan',
    title: 'Plan a purchase',
    steps: [
      {
        id: 'plan',
        agentKey: 'reward-optimization',
        engine: 'purchase-plan/1',
        privacy: 'USER',
        run: (c) => {
          if (!c.params?.merchantText || !c.params.amountCents) throw new Error('merchantText and amountDollars are required');
          return d.offers.plan(c.userId, { merchantText: c.params.merchantText, amountCents: c.params.amountCents }, c.now);
        },
      },
    ],
    compose: (r): Composed => {
      const res = r.plan as Awaited<ReturnType<OfferAnalysisService['plan']>> | undefined;
      const best = res?.plans[0];
      if (!res || !best) return { answer: 'No plan could be produced with evidence for this purchase. Add cards to your wallet first.', highlights: [] };
      const lines = [`Best: ${best.legs.map((l) => `${l.cardName}${l.member ? ` (${l.member})` : ''} for ${usd(l.amountCents)}`).join(' + ')} — expected return ${usd(best.expectedCents)} (up to ${usd(best.maxCents)}), confidence ${best.confidence}%.`];
      lines.push(...best.justification.slice(0, 4));
      for (const a of best.actions) lines.push(`Do first: ${a}`);
      for (const w of best.warnings.slice(0, 3)) lines.push(`Note: ${w}`);
      lines.push(`Evidence: ${best.evidence.length} item(s) recorded in the audit trail.`);
      lines.push('This is general information, not financial advice.');
      return { answer: lines.join('\n'), highlights: best.legs.map((l) => l.cardName) };
    },
  };
}

/** Weekly offer review: opportunities → missed offers → audit summary. */
export function offerReviewWorkflow(d: WfDeps): WorkflowDef<WfCtx> {
  return {
    key: 'offer-review',
    title: 'Review my offers',
    steps: [
      { id: 'opportunities', agentKey: 'offer-discovery', engine: 'opportunity/1', privacy: 'USER', run: (c) => d.offers.opportunities(c.userId, c.now) },
      { id: 'missed', agentKey: 'merchant-intelligence', engine: 'offer-engine/1', privacy: 'USER', run: (c) => d.offers.missed(c.userId, c.now) },
      {
        id: 'audit',
        agentKey: 'offer-audit',
        engine: 'offer-events/1',
        privacy: 'USER',
        optional: true,
        run: async (c) => {
          const since = new Date(c.now.getTime() - 30 * 86_400_000);
          const g = await d.prisma.offerEvent.groupBy({ by: ['type'], where: { userId: c.userId, createdAt: { gte: since } }, _count: true });
          return { last30Days: Object.fromEntries(g.map((x) => [x.type, x._count])) };
        },
      },
    ],
    compose: (r): Composed => {
      const opp = r.opportunities as Awaited<ReturnType<OfferAnalysisService['opportunities']>> | undefined;
      const missed = r.missed as Awaited<ReturnType<OfferAnalysisService['missed']>> | undefined;
      const audit = r.audit as { last30Days: Record<string, number> } | undefined;
      const lines: string[] = [];
      const top = (opp?.items ?? []).filter((o) => !o.activated).slice(0, 3);
      if (top.length) {
        lines.push('Offers worth acting on:');
        for (const o of top) lines.push(`• ${o.merchant ?? o.title}: score ${o.score}/100, ${usd(o.expectedValueCents)} expected${o.daysLeft != null ? `, ${o.daysLeft} day(s) left` : ''} (confidence ${o.confidence}%).`);
      } else lines.push('No open offers need action right now.');
      if (missed?.items.length) lines.push(`Missed in the last year: ${usd(missed.totalLostCents)} across ${missed.items.length} offer(s); the biggest was ${missed.items[0].offer.merchant ?? 'an offer'} (${missed.items[0].cause.toLowerCase().replace(/_/g, ' ')}).`);
      if (audit && Object.keys(audit.last30Days).length) lines.push(`Audit trail, last 30 days: ${Object.entries(audit.last30Days).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ')}.`);
      lines.push('This is general information, not financial advice.');
      return { answer: lines.join('\n'), highlights: top.map((o) => o.merchant ?? o.title) };
    },
  };
}

export const WORKFLOW_KEYS = ['next-card', 'portfolio-review', 'purchase-plan', 'offer-review'] as const;

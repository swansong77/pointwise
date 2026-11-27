import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { fromRoadmap } from '../domain/copilot-plan';
import { isMode, Mode } from '../domain/copilot-modes';
import { FEE_VERDICT_LABEL } from '../domain/cos-fees';
import { LifeEstimate } from '../domain/cos-life';
import { roadmap, RoadArea, RoadEvent, roadmapSpan } from '../domain/cos-roadmap';
import { BoardService } from './board.service';
import { ChiefService } from './chief.service';
import { GoalsService } from './goals.service';
import { LifeEventsService } from './life-events.service';

const DAY = 86_400_000;
const AREA: Record<string, RoadArea> = {
  OFFER_EXPIRING: 'OFFERS',
  OFFER_ACTIVATE: 'OFFERS',
  CREDIT_UNUSED: 'OFFERS',
  CERTIFICATE_EXPIRING: 'POINTS',
  LOYALTY_AT_RISK: 'POINTS',
  MEMBERSHIP_RENEWAL: 'POINTS',
  STATUS_REQUAL: 'POINTS',
  TRANSFER_BONUS: 'POINTS',
  RENEWAL_REVIEW: 'CARDS',
  FIVE24: 'APPLICATIONS',
  GOAL: 'GOALS',
  LIFE_EVENT: 'LIFE',
};

/** The next 90 days or the year ahead as a timeline of dated events, grouped into phases with the three areas to focus on. */
@Injectable()
export class RoadmapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly chief: ChiefService,
    private readonly board: BoardService,
    private readonly goals: GoalsService,
    private readonly life: LifeEventsService,
  ) {}

  async build(userId: string, span: 90 | 365, now = new Date()) {
    const [{ items }, fees, gov, goals, events] = await Promise.all([this.chief.items(userId, now), this.board.feeReview(userId, now), this.board.governance(userId, now), this.goals.list(userId, now), this.life.upcoming(userId, now, span)]);
    const out: RoadEvent[] = [];
    // dated items from the specialists; fee decisions come from the fee review board instead, which says what to do about each
    for (const i of items) {
      const area = AREA[i.facts.kind];
      if (!area || !i.deadline || i.facts.kind === 'RENEWAL_REVIEW' || i.facts.kind === 'LIFE_EVENT') continue;
      out.push({ date: new Date(i.deadline + 'T12:00:00Z'), title: i.title, area, valueCents: Math.abs(i.expectedValueCents ?? 0), atRisk: i.impact.atRiskCents > 0, href: i.href });
    }
    for (const v of fees.verdicts.filter((x) => x.verdict !== 'KEEP' && x.daysToRenewal != null)) {
      out.push({ date: new Date(now.getTime() + (v.daysToRenewal as number) * DAY), title: FEE_VERDICT_LABEL[v.verdict] + ': ' + v.card + ' renews', area: 'CARDS', valueCents: v.impactCents, atRisk: false, href: '/chief-of-staff#fees' });
    }
    for (const m of gov.members.filter((x) => x.nextSlotAt)) out.push({ date: new Date(m.nextSlotAt + 'T12:00:00Z'), title: m.member + ': a 5/24 slot opens', area: 'APPLICATIONS', valueCents: 0, atRisk: false, href: '/chief-of-staff#governance' });
    for (const g of goals.filter((x) => x.dueAt)) out.push({ date: g.dueAt as Date, title: 'Goal due: ' + g.title, area: 'GOALS', valueCents: 0, atRisk: g.progress.state === 'AT_RISK' || g.progress.state === 'BEHIND', href: '/copilot#goals' });
    for (const e of events) {
      const est = e.estimate as unknown as LifeEstimate | null;
      out.push({ date: e.startsOn as Date, title: e.title + ' starts', area: 'LIFE', valueCents: est?.expectedValueCents ?? 0, atRisk: false, href: '/chief-of-staff#life' });
    }
    return roadmap(out, span, now);
  }

  /** "What should I do over the next 90 days?" and the like: null when the question is not one */
  async ask(userId: string, q: string, modeIn: string | undefined, now = new Date()) {
    const span = roadmapSpan(q);
    if (!span) return null;
    const started = Date.now();
    const mode: Mode = isMode(modeIn) ? modeIn : 'PLANNING';
    const r = await this.build(userId, span, now);
    const plan = fromRoadmap(r, mode, q);
    const run = await this.prisma.agentRun.create({
      data: { userId, workflow: 'copilot-roadmap', question: q.slice(0, 300), status: 'COMPLETED', engineVersion: r.version, finishedAt: new Date(), durationMs: Date.now() - started, result: { span, events: r.eventCount, focus: r.focus.map((f) => f.area) } },
    });
    return { runId: run.id, mode, plan, narration: null, narrationSkipped: null, sessionId: null as string | null, tookMs: Date.now() - started };
  }
}

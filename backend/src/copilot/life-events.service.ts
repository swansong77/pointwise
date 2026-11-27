import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { centsOf } from '../domain/copilot-plan';
import { checkLifeEvent, expectedValue, isTravel, LIFE_VERSION, LifeEstimate, LifeKindName, MAX_ACTIVE_EVENTS } from '../domain/cos-life';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { SearchAskService } from '../search/search-ask.service';

const DAY = 86_400_000;
type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const num = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) ? x : 0);

export interface LifeBody {
  kind: unknown;
  title: unknown;
  destination?: unknown;
  startsOn?: unknown;
  endsOn?: unknown;
  travelers?: unknown;
  budgetCents?: unknown;
  status?: unknown;
}

/** Saved life events, and the estimate of what the member's cards, points and offers can do for each, from their own data. */
@Injectable()
export class LifeEventsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchAskService,
    private readonly loyalty: LoyaltyService,
  ) {}

  list(userId: string, opts: { all?: boolean } = {}) {
    return this.prisma.lifeEvent.findMany({ where: { userId, ...(opts.all ? {} : { status: { in: ['PLANNING', 'BOOKED'] } }) }, orderBy: [{ startsOn: 'asc' }, { createdAt: 'desc' }], take: 100 });
  }

  /** planned or booked events starting within `days`, soonest first */
  upcoming(userId: string, now: Date, days: number) {
    return this.prisma.lifeEvent.findMany({ where: { userId, status: { in: ['PLANNING', 'BOOKED'] }, startsOn: { gte: new Date(now.getTime() - DAY), lte: new Date(now.getTime() + days * DAY) } }, orderBy: { startsOn: 'asc' }, take: 20 });
  }

  async create(userId: string, body: LifeBody, now = new Date()) {
    const c = checkLifeEvent(body, now);
    if (!c.ok) throw new BadRequestException(c.error);
    if ((await this.prisma.lifeEvent.count({ where: { userId, status: { in: ['PLANNING', 'BOOKED'] } } })) >= MAX_ACTIVE_EVENTS) throw new BadRequestException('You can have up to ' + MAX_ACTIVE_EVENTS + ' upcoming events. Finish or cancel one first.');
    return this.prisma.lifeEvent.create({ data: { userId, ...c.value } });
  }

  async update(userId: string, id: string, patch: Partial<LifeBody>, now = new Date()) {
    const e = await this.prisma.lifeEvent.findFirst({ where: { id, userId } });
    if (!e) throw new NotFoundException('Event not found');
    const merged = { kind: e.kind, title: e.title, destination: e.destination, startsOn: e.startsOn, endsOn: e.endsOn, travelers: e.travelers, budgetCents: e.budgetCents, status: e.status, ...patch };
    const c = checkLifeEvent(merged, now, { allowPast: patch.startsOn === undefined && patch.status === undefined });
    if (!c.ok) throw new BadRequestException(c.error);
    // what the estimate was based on changed, so it is stale
    const changed = ['kind', 'destination', 'startsOn', 'endsOn', 'travelers', 'budgetCents'].some((k) => k in patch);
    return this.prisma.lifeEvent.update({ where: { id }, data: { ...c.value, ...(changed ? { estimate: Prisma.JsonNull, estimatedAt: null } : {}) } });
  }

  async remove(userId: string, id: string) {
    const r = await this.prisma.lifeEvent.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Event not found');
  }

  /**
   * What the member's own cards, certificates, credits and points can do for this event. Every figure comes from an engine; anything
   * the member did not give (dates, budget) is assumed and listed as an assumption. Read-only: nothing is booked or bought.
   */
  async estimate(userId: string, id: string, now = new Date()) {
    const e = await this.prisma.lifeEvent.findFirst({ where: { id, userId } });
    if (!e) throw new NotFoundException('Event not found');
    const kind = e.kind as LifeKindName;
    const assumed: string[] = [];
    const risks: string[] = [];
    const start = e.startsOn ?? new Date(now.getTime() + 60 * DAY);
    if (!e.startsOn) assumed.push('No start date, so it assumes about two months from now.');
    const nights = e.startsOn && e.endsOn ? Math.max(1, Math.round((e.endsOn.getTime() - e.startsOn.getTime()) / DAY)) : 7;
    if (isTravel(kind) && !(e.startsOn && e.endsOn)) assumed.push('No end date, so it assumes ' + nights + ' nights.');
    const end = e.endsOn ?? new Date(start.getTime() + nights * DAY);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const step = (tool: string, input: Record<string, unknown>) => this.search.runStep(userId, { tool, label: tool, input }, now);

    const bestCards: LifeEstimate['bestCards'] = [];
    const offers: string[] = [];
    let pointsUse: LifeEstimate['pointsUse'] = null;
    let credits: LifeEstimate['travelCredits'] = { cents: 0, items: [] };
    let certificates: LifeEstimate['certificates'] = [];
    let bonuses: string[] = [];

    const plan = async (use: string, item: string, dollars: number) => {
      const r = await step('plan_purchase', { item, amountDollars: Math.max(1, Math.round(dollars)) });
      if (!r.ok) {
        risks.push('The ' + use.toLowerCase() + ' plan could not be worked out: ' + (r.error ?? 'engine unavailable') + '.');
        return;
      }
      const best = obj(arr(obj(r.data).plans)[0]);
      if (!Object.keys(best).length) return;
      const leg = obj(arr(best.legs)[0]);
      bestCards.push({ use, card: str(leg.cardName) || 'your best card', member: str(leg.member) || null, expectedCents: num(best.expectedCents), netCostCents: num(best.netCostCents), why: str(arr(best.justification)[0]) });
      for (const a of arr(best.actions).map(str).filter(Boolean)) if (!offers.includes(a)) offers.push(a);
    };

    if (isTravel(kind)) {
      const dest = e.destination ?? 'your destination';
      let flights: number;
      let hotels: number;
      if (e.budgetCents) {
        flights = (e.budgetCents / 100) * 0.4;
        hotels = (e.budgetCents / 100) * 0.6;
      } else {
        flights = 600 * e.travelers;
        hotels = 150 * nights;
        assumed.push('No budget, so it assumes $' + Math.round(flights).toLocaleString('en-US') + ' for flights and $' + Math.round(hotels).toLocaleString('en-US') + ' for lodging.');
      }
      const [award, bonusRes, creditRes, certRows] = await Promise.all([
        step('plan_award_trip', { destination: dest, dateFrom: iso(start), dateTo: iso(end), cabin: 'ECONOMY' }),
        step('get_transfer_bonuses', {}),
        step('get_benefit_summary', { status: 'available' }),
        this.loyalty.certificates(userId, undefined, now),
        plan('Flights', 'flights to ' + dest, flights),
        plan('Lodging', 'hotel stay in ' + dest, hotels),
      ]);
      if (award.ok) {
        const o = obj(arr(obj(award.data).options)[0]);
        if (Object.keys(o).length) pointsUse = { program: str(o.programName), pointsNeeded: num(o.pointsNeeded), covered: num(o.covered), shortfall: num(o.shortfall), summary: award.summary.slice(0, 300) };
      }
      if (bonusRes.ok) {
        bonuses = arr(bonusRes.data)
          .map(obj)
          .filter((r) => num(r.activeBonusPercent) > 0)
          .slice(0, 3)
          .map((r) => str(r.currencyName) + ' to ' + str(r.programName) + ': ' + num(r.activeBonusPercent) + '% bonus');
      }
      if (creditRes.ok) {
        const items = arr(obj(creditRes.data).items)
          .map(obj)
          .filter((b) => /travel|airline|flight|hotel|lounge|global entry|clear|priority pass|tsa/i.test(str(b.benefit)))
          .map((b) => ({ benefit: str(b.benefit), card: str(b.card), cents: centsOf(b.remaining) ?? 0 }))
          .filter((b) => b.cents > 0);
        credits = { cents: items.reduce((s, b) => s + b.cents, 0), items: items.slice(0, 6) };
      }
      certificates = certRows
        .filter((c) => c.view.effectiveStatus === 'AVAILABLE')
        .slice(0, 6)
        .map((c) => ({ name: c.name, cents: c.potentialValueCents ?? 0, expiresOn: c.expiresAt ? iso(c.expiresAt) : '', usable: !c.expiresAt || c.expiresAt.getTime() >= start.getTime() }));
      if (certificates.some((c) => !c.usable)) risks.push('One or more certificates expire before the trip starts and are not counted.');
      risks.push('Award space and prices change; check availability before you transfer or book.');
    } else {
      const dollars = e.budgetCents ? e.budgetCents / 100 : 2000;
      if (!e.budgetCents) assumed.push('No budget, so it assumes $2,000.');
      const item = kind === 'MOVING' ? 'moving company and supplies' : kind === 'HOME_PROJECT' ? 'home improvement' : e.title;
      await plan('Purchase', item, dollars);
    }

    const est: LifeEstimate = {
      version: LIFE_VERSION,
      kind,
      assumed,
      bestCards,
      offers: offers.slice(0, 6),
      pointsUse,
      travelCredits: credits,
      certificates,
      transferBonuses: bonuses,
      expectedValueCents: 0,
      assumptions: ['Rewards use the best card for each part of the spend, as the purchase planner works it out.', 'Points are shown separately and are not added to the total.', ...assumed],
      risks,
      confidence: Math.max(30, 70 - assumed.length * 8 - (bestCards.length ? 0 : 25)),
    };
    est.expectedValueCents = expectedValue(est);
    const event = await this.prisma.lifeEvent.update({ where: { id }, data: { estimate: est as unknown as Prisma.InputJsonValue, estimatedAt: now } });
    return { event, estimate: est };
  }
}

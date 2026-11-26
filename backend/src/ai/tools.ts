import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { isoDay } from '../domain/dates';
import { upcomingRenewals } from '../domain/insights';
import { norm, tokenSimilarity } from '../domain/import';
import { OffersService } from '../offers/offers.service';
import { OfferAnalysisService } from '../offers/offer-analysis.service';
import { OfferIntelService } from '../offers/offer-intel.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { BenefitsService } from '../portfolio/benefits';
import { HouseholdsService } from '../portfolio/households';
import { PortfolioService } from '../portfolio/portfolio';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { StrategyService } from '../strategy/strategy.service';
import { TermsService } from '../strategy/terms.service';
import { WalletService } from '../wallet/wallet.service';
import { JsonSchemaObject, ToolSpec } from './types';

/**
 * Pointwise tools for the AI layer and the Pointwise MCP server. Every handler is scoped to the
 * calling user (same services and guards as the REST API) and returns `{ summary, data }`:
 * numbers come from the deterministic engines, the model only explains them. Outputs are
 * minimised — no card digits, emails or internal ids beyond what a follow-up call needs.
 */

export interface ToolContext {
  userId: string;
  now?: Date;
}

export interface ToolOutput {
  summary: string;
  data: unknown;
}

export interface ToolDef extends ToolSpec {
  readOnly: boolean;
  /**
   * PUBLIC: catalog data only — results may be returned to the model.
   * USER (default): the user's own data — results go to the user only, never to an AI provider.
   */
  dataClass?: 'PUBLIC' | 'USER';
  /** write tools are never executed directly: the user must confirm a pending action */
  requiresConfirmation?: boolean;
  /** human-readable description of a proposed write, shown in the confirmation prompt */
  describe?: (input: Record<string, unknown>) => string;
  handler: (ctx: ToolContext, input: Record<string, unknown>) => Promise<ToolOutput>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): JsonSchemaObject => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });
const num = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'number', description, ...extra });
const $ = (cents: number | null | undefined) => (cents == null ? 'n/a' : `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`);
const S = (v: unknown, max = 120): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const N = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined);

/** best fuzzy match of `q` among `items` by name (exact, contains, token similarity ≥ 0.34) */
export function fuzzyFind<T>(items: T[], q: string, name: (t: T) => string): T | null {
  const nq = norm(q);
  if (!nq) return null;
  const exact = items.find((i) => norm(name(i)) === nq);
  if (exact) return exact;
  const contains = items.find((i) => norm(name(i)).includes(nq) || nq.includes(norm(name(i))));
  if (contains) return contains;
  let best: { t: T; s: number } | null = null;
  for (const i of items) {
    const s = tokenSimilarity(q, name(i));
    if (!best || s > best.s) best = { t: i, s };
  }
  return best && best.s >= 0.34 ? best.t : null;
}

@Injectable()
export class ToolRegistry {
  readonly tools: ToolDef[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolio: PortfolioService,
    private readonly benefits: BenefitsService,
    private readonly households: HouseholdsService,
    private readonly recs: RecommendationsService,
    private readonly offers: OffersService,
    private readonly wallet: WalletService,
    private readonly strategy: StrategyService,
    private readonly terms: TermsService,
    private readonly offerAnalysis: OfferAnalysisService,
    private readonly offerIntel: OfferIntelService,
    private readonly loyalty: LoyaltyService,
  ) {
    this.tools = this.build();
  }

  get(name: string): ToolDef | undefined {
    return this.tools.find((t) => t.name === name);
  }

  names(): string[] {
    return this.tools.map((t) => t.name);
  }

  specs(names: string[]): ToolDef[] {
    return this.tools.filter((t) => names.includes(t.name));
  }

  /** True when a tool's result may be returned to an AI provider. */
  isPublic(name: string): boolean {
    return this.get(name)?.dataClass === 'PUBLIC';
  }

  private build(): ToolDef[] {
    return [
      {
        name: 'get_five24_status',
        description:
          "Chase 5/24 status for each household member (or one member by name): count, label (e.g. '4/24'), whether under the limit, the date the next slot opens, and which cards count or don't and why.",
        inputSchema: obj({ member: str('Household member nickname; omit for everyone') }),
        readOnly: true,
        handler: async (ctx, input) => {
          const f = await this.portfolio.five24(ctx.userId, {}, ctx.now);
          const want = S(input.member);
          const members = want ? f.members.filter((m) => norm(m.profile.nickname) === norm(want)) : f.members;
          if (want && members.length === 0) throw new NotFoundException(`No household member named "${want}"`);
          const data = members.map((m) => ({
            member: m.profile.nickname,
            relationship: m.profile.relationship,
            label: m.status.label,
            count: m.status.count,
            underLimit: m.status.underLimit,
            nextSlotAt: m.status.nextSlotAt && isoDay(m.status.nextSlotAt),
            nextDropAt: m.status.nextDropAt && isoDay(m.status.nextDropAt),
            counting: m.status.contributing.map((c) => ({ card: c.name, reason: c.reason, countsUntil: c.dropsOffAt && isoDay(c.dropsOffAt) })),
            notCounted: m.status.excluded.map((c) => ({ card: c.name, reason: c.reason })),
            unknownOpenDate: m.status.unknown.map((c) => c.name),
          }));
          const summary = data
            .map((d) => `${d.member}: ${d.label}${d.underLimit ? ' (under 5/24)' : ` (at or over 5/24; under again on ${d.nextSlotAt})`}${d.unknownOpenDate.length ? ` — ${d.unknownOpenDate.length} card(s) without an open date` : ''}`)
            .join('\n');
          return { summary: summary || 'No household members found.', data };
        },
      },
      {
        name: 'get_benefit_summary',
        description:
          'Card benefits/credits: totals for the year and lists of available (unused or partly used), expiring soon, completed or missed benefits with remaining value and last usable day.',
        inputSchema: obj({
          status: str('Which list to return', { enum: ['available', 'expiring', 'completed', 'missed', 'all'] }),
          withinDays: num('For "expiring": days ahead (default 30)', { minimum: 1, maximum: 120 }),
        }),
        readOnly: true,
        handler: async (ctx, input) => {
          const within = Math.min(120, Math.max(1, Math.round(N(input.withinDays) ?? 30)));
          const s = await this.benefits.summary(ctx.userId, ctx.now ?? new Date(), within);
          const status = S(input.status) ?? 'available';
          const pick = status === 'all' ? [...s.available, ...s.expiring, ...s.completed] : (s[status as 'available' | 'expiring' | 'completed' | 'missed'] ?? s.available);
          const items = pick.slice(0, 40).map((b) => ({
            benefit: b.name,
            card: b.walletCard.name,
            status: b.currentPeriod.status,
            remaining: $(b.currentPeriod.remainingCents),
            lastDay: isoDay(new Date(b.currentPeriod.lastDay)),
            daysLeft: b.currentPeriod.daysLeft,
            period: b.period,
            annualValue: $(b.annualValueCents),
            usedThisYear: $(b.year.usedThisYearCents),
            missedThisYear: $(b.year.missedCents),
          }));
          const t = s.totals;
          const head = `Benefits: ${$(t.annualValueCents)} a year in total, ${$(t.usedThisYearCents)} used this year, ${$(t.remainingThisYearCents)} still available, ${$(t.missedThisYearCents)} missed.`;
          const list = items.length ? items.map((i) => `• ${i.benefit} (${i.card}): ${i.remaining} left, use by ${i.lastDay}`).join('\n') : `No ${status} benefits.`;
          return { summary: `${head}\n${status === 'all' ? 'Benefits' : status[0].toUpperCase() + status.slice(1)}:\n${list}`, data: { totals: t, items } };
        },
      },
      {
        name: 'get_portfolio_value',
        description:
          'Value analysis of the cards (last 12 months): annual fee, benefit face value and amount used, rewards earned on logged spend, net and effective value, return on spend and break-even spend. Filter by member or card name.',
        inputSchema: obj({ member: str('Household member nickname'), card: str('Card name or nickname') }),
        readOnly: true,
        handler: async (ctx, input) => {
          const p = await this.portfolio.portfolio(ctx.userId, {}, ctx.now);
          const members = await this.households.members(ctx.userId);
          let cards = [...p.groups.active, ...p.groups.authorizedUser, ...p.groups.closed];
          const member = S(input.member);
          if (member) {
            const m = members.find((x) => norm(x.nickname) === norm(member));
            if (!m) throw new NotFoundException(`No household member named "${member}"`);
            cards = cards.filter((c) => c.profileId === m.id);
          }
          const cardQ = S(input.card);
          if (cardQ) {
            const hit = fuzzyFind(cards, cardQ, (c) => `${c.nickname ?? ''} ${c.card.name}`);
            if (!hit) throw new NotFoundException(`No card matching "${cardQ}" in the wallet`);
            cards = [hit];
          }
          const holder = (id: string | null) => members.find((m) => m.id === id)?.nickname ?? '—';
          const data = cards.map((c) => ({
            card: c.name,
            holder: holder(c.profileId),
            status: c.status,
            authorizedUser: c.cardholder === 'AUTHORIZED_USER',
            annualFee: $(c.annualFeeCents),
            benefitFaceValue: $(c.faceBenefitCents),
            benefitsUsed: $(c.realizedBenefitCents),
            rewards: $(c.rewardsCents),
            spend: $(c.spendCents),
            effectiveValue: $(c.effectiveValueCents),
            returnOnSpend: c.returnOnSpend,
            breakEvenSpend: c.breakEvenSpendCents == null ? 'n/a' : $(c.breakEvenSpendCents),
          }));
          const t = p.totals;
          const summary = cardQ
            ? data.map((d) => `${d.card}: fee ${d.annualFee}, benefits used ${d.benefitsUsed} of ${d.benefitFaceValue}, rewards ${d.rewards} → effective value ${d.effectiveValue} (break-even spend ${d.breakEvenSpend}).`).join('\n')
            : `Household: fees ${$(t.annualFeeCents)}, benefits used ${$(t.realizedBenefitCents)} of ${$(t.faceBenefitCents)}, rewards ${$(t.rewardsCents)}, effective value ${$(t.effectiveValueCents)} across ${data.length} cards.`;
          return { summary, data: { cards: data } };
        },
      },
      {
        name: 'get_card_details',
        description: "Details of one card in the user's wallet: holder, opened, fee, each tracked benefit with use this period and year, and value.",
        inputSchema: obj({ card: str('Card name or nickname') }, ['card']),
        readOnly: true,
        handler: async (ctx, input) => {
          const q = S(input.card) ?? '';
          const p = await this.portfolio.portfolio(ctx.userId, {}, ctx.now);
          const all = [...p.groups.active, ...p.groups.authorizedUser, ...p.groups.closed, ...p.groups.pending];
          const c = fuzzyFind(all, q, (x) => `${x.nickname ?? ''} ${x.card.name}`);
          if (!c) throw new NotFoundException(`No card matching "${q}" in the wallet`);
          const bens = await this.benefits.list(ctx.userId, { walletCardId: c.walletCardId }, ctx.now);
          const data = {
            card: c.name,
            issuer: c.card.issuer,
            opened: c.openedAt && isoDay(new Date(c.openedAt)),
            status: c.status,
            annualFee: $(c.annualFeeCents),
            effectiveValue: $(c.effectiveValueCents),
            benefits: bens.map((b) => ({
              benefit: b.name,
              perPeriod: $(b.amountPerPeriodCents),
              period: b.period,
              usedThisPeriod: $(b.currentPeriod.usedCents),
              remaining: $(b.currentPeriod.remainingCents),
              usedThisYear: $(b.year.usedThisYearCents),
              lastDay: isoDay(new Date(b.currentPeriod.lastDay)),
            })),
          };
          const used = bens.reduce((a, b) => a + b.year.usedThisYearCents, 0);
          return {
            summary: `${c.name}: fee ${$(c.annualFeeCents)}; ${bens.length} tracked benefits with ${$(used)} used this year; effective value ${$(c.effectiveValueCents)}.`,
            data,
          };
        },
      },
      {
        name: 'get_household',
        description: 'Household members (relationship), their cards, 5/24 label and value totals.',
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const d = await this.portfolio.householdDashboard(ctx.userId, ctx.now);
          const data = d.members.map((m) => ({
            member: m.profile.nickname,
            relationship: m.profile.relationship,
            five24: m.five24?.label ?? 'n/a',
            cards: m.cards.map((c) => `${c.name}${c.cardholder === 'AUTHORIZED_USER' ? ' (AU)' : ''}${c.status === 'CLOSED' ? ' (closed)' : ''}`),
            annualFees: $(m.totals.annualFeeCents),
            effectiveValue: $(m.totals.effectiveValueCents),
          }));
          return { summary: data.map((m) => `${m.member} (${m.relationship}): ${m.cards.length} cards, ${m.five24}, fees ${m.annualFees}`).join('\n'), data: { household: d.household.name, members: data } };
        },
      },
      {
        name: 'best_card_for',
        description: 'Best card in the wallet for a merchant (e.g. "Costco") or spending category (e.g. "dining"), ranked by value per dollar.',
        inputSchema: obj({ query: str('Merchant or category name') }, ['query']),
        readOnly: true,
        handler: async (ctx, input) => {
          const q = S(input.query, 80) ?? '';
          const merchants = await this.prisma.merchant.findMany({ select: { id: true, slug: true, name: true } });
          const merchant = fuzzyFind(merchants, q, (m) => m.name);
          let label: string;
          let ranked: Array<{ name: string; centsPerDollar: number; multiplier: number; reason: string }>;
          if (merchant) {
            const r = await this.recs.forMerchant(ctx.userId, merchant.id);
            label = `${r.merchant.name} (${r.merchant.category.name})`;
            ranked = r.ranked;
          } else {
            const cats = await this.prisma.category.findMany({ select: { id: true, slug: true, name: true, isFallback: true } });
            const cat = fuzzyFind(cats, q, (c) => c.name) ?? (/costco|sam'?s club|bj'?s|warehouse/i.test(q) ? cats.find((c) => c.slug === 'wholesale-clubs') : null) ?? cats.find((c) => c.isFallback);
            if (!cat) throw new NotFoundException('No matching merchant or category');
            const r = await this.recs.forCategory(ctx.userId, cat.id);
            label = `${q} → category ${r.category.name}${norm(cat.name) === norm(q) ? '' : ' (closest match)'}`;
            ranked = r.ranked;
          }
          const top = ranked.slice(0, 3).map((r) => ({ card: r.name, centsPerDollar: r.centsPerDollar, multiplier: r.multiplier, why: r.reason }));
          if (!top.length) return { summary: `No cards in the wallet yet, so no recommendation for ${label}.`, data: { for: label, ranked: [] } };
          return { summary: `Best for ${label}: ${top[0].card} (${top[0].centsPerDollar}¢ per $1 — ${top[0].why}).${top[1] ? ` Next: ${top[1].card} (${top[1].centsPerDollar}¢).` : ''}`, data: { for: label, ranked: top } };
        },
      },
      {
        name: 'search_card_catalog',
        description: 'Search the public card catalog: fee, welcome bonus, main earning categories. Public data only — it does not know which cards the user holds.',
        inputSchema: obj({
          query: str('Name, issuer or category keyword'),
          maxAnnualFeeDollars: num('Maximum annual fee in dollars', { minimum: 0 }),
          type: str('Personal or business', { enum: ['PERSONAL', 'BUSINESS'] }),
        }),
        readOnly: true,
        dataClass: 'PUBLIC',
        handler: async (_ctx, input) => {
          const q = S(input.query, 60);
          const maxFee = N(input.maxAnnualFeeDollars);
          const type = input.type === 'BUSINESS' || input.type === 'PERSONAL' ? input.type : undefined;
          const cards = await this.prisma.creditCard.findMany({
              where: {
                isActive: true,
                ownerId: null,
                ...(type && { type }),
                ...(maxFee != null && { annualFeeCents: { lte: Math.round(maxFee * 100) } }),
                ...(q && { OR: [{ name: { contains: q, mode: 'insensitive' } }, { issuer: { name: { contains: q, mode: 'insensitive' } } }, { rewards: { some: { category: { name: { contains: q, mode: 'insensitive' } } } } }] }),
              },
              include: { issuer: true, currency: true, rewards: { include: { category: true }, orderBy: { multiplier: 'desc' }, take: 3 } },
              orderBy: [{ popularity: 'desc' }],
              take: 10,
            });
          const data = cards.map((c) => ({
            card: c.name,
            issuer: c.issuer.name,
            type: c.type,
            annualFee: $(c.annualFeeCents),
            welcomeBonus: c.bonusDescription ?? null,
            currency: `${c.currency.name} (~${Number(c.currency.centsPerPoint)}¢/pt)`,
            topEarning: c.rewards.map((r) => `${Number(r.multiplier)}x ${r.category?.name ?? 'merchant'}`),
          }));
          return { summary: data.length ? data.map((d) => `• ${d.card} (${d.issuer}, ${d.annualFee}): ${d.welcomeBonus ?? 'no current bonus'}`).join('\n') : 'No catalog cards match.', data: { cards: data } };
        },
      },
      {
        name: 'compare_cards',
        description: 'Side-by-side comparison of 2–4 cards from the public catalog: fee, bonus, earning rates and catalog benefits. Public data only.',
        inputSchema: obj({ cards: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4, description: 'Card names' } }, ['cards']),
        readOnly: true,
        dataClass: 'PUBLIC',
        handler: async (_ctx, input) => {
          const names = Array.isArray(input.cards) ? input.cards.map((c) => S(c, 80)).filter((c): c is string => !!c).slice(0, 4) : [];
          if (names.length < 2) throw new NotFoundException('Give at least two card names to compare');
          const catalog = await this.prisma.creditCard.findMany({
            where: { ownerId: null, isActive: true },
            include: { issuer: true, currency: true, rewards: { include: { category: true }, orderBy: { multiplier: 'desc' }, take: 5 }, benefits: true },
          });
          const data = names.map((n) => {
            const c = fuzzyFind(catalog, n, (x) => x.name);
            if (!c) return { requested: n, found: false };
            return {
              requested: n,
              found: true,
              card: c.name,
              issuer: c.issuer.name,
              annualFee: $(c.annualFeeCents),
              welcomeBonus: c.bonusDescription,
              earning: c.rewards.map((r) => `${Number(r.multiplier)}x ${r.category?.name ?? 'merchant'}`),
              pointValue: `${Number(c.currency.centsPerPoint)}¢ per point (${c.currency.name})`,
              benefits: c.benefits.map((b) => `${b.name} ${$(b.amountPerPeriodCents)} ${b.period.toLowerCase()}`),
            };
          });
          const missing = data.filter((d) => !d.found).map((d) => d.requested);
          const found = data.filter((d) => d.found) as Array<{ card: string; annualFee: string; earning: string[] }>;
          return {
            summary: `${found.map((d) => `${d.card}: fee ${d.annualFee}; ${d.earning.slice(0, 2).join(', ')}`).join(' | ')}${missing.length ? `. Not in the catalog: ${missing.join(', ')}` : ''}`,
            data,
          };
        },
      },
      {
        name: 'get_card_offer_history',
        description: 'Public welcome-offer history of a catalog card (e.g. "60K → 75K → 90K"), the current offer, its estimated value and whether it is elevated vs the last 24 months. Public data only.',
        inputSchema: obj({ card: str('Card name') }, ['card']),
        readOnly: true,
        dataClass: 'PUBLIC',
        handler: async (_ctx, input) => {
          const cards = await this.prisma.creditCard.findMany({ where: { ownerId: null, isActive: true }, select: { id: true, name: true, bonusType: true } });
          const c = fuzzyFind(cards, S(input.card, 80) ?? '', (x) => x.name);
          if (!c) throw new NotFoundException(`No catalog card matching "${S(input.card, 80)}"`);
          const versions = await this.prisma.cardOffer.findMany({ where: { cardId: c.id, kind: 'WELCOME' }, orderBy: { validFrom: 'asc' } });
          const fmt = (n: number | null) => (n == null ? '—' : c.bonusType === 'CASH' ? `$${Math.round(n / 100)}` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
          const current = versions.find((v) => !v.validTo);
          const data = versions.map((v) => ({ bonus: fmt(v.bonusAmount), from: isoDay(v.validFrom), to: v.validTo ? isoDay(v.validTo) : null, value: $(v.valuationCents), elevated: v.elevated }));
          return {
            summary: versions.length
              ? `${c.name}: ${versions.map((v) => fmt(v.bonusAmount)).join(' → ')}. Current offer ${fmt(current?.bonusAmount ?? null)} (≈ ${$(current?.valuationCents)})${current?.elevated ? ' — elevated vs the last 24 months' : ''}.`
              : `No offer history recorded for ${c.name}.`,
            data: { card: c.name, versions: data },
          };
        },
      },
      {
        name: 'get_renewals',
        description: 'Cards with an annual fee renewing soon, with value received vs fee — input for keep / downgrade / cancel decisions.',
        inputSchema: obj({ withinDays: num('Days ahead (default 90)', { minimum: 1, maximum: 366 }) }),
        readOnly: true,
        handler: async (ctx, input) => {
          const within = Math.min(366, Math.max(1, Math.round(N(input.withinDays) ?? 90)));
          const now = ctx.now ?? new Date();
          const [cards, p] = await Promise.all([this.wallet.domainCards(ctx.userId), this.portfolio.portfolio(ctx.userId, {}, now)]);
          const values = new Map([...p.groups.active, ...p.groups.authorizedUser].map((c) => [c.walletCardId, c]));
          const data = upcomingRenewals(cards, now, within).map((r) => {
            const v = values.get(r.walletCardId);
            const valueCents = v ? v.realizedBenefitCents + v.rewardsCents : 0;
            return {
              card: r.name,
              renewsOn: isoDay(r.renewsAt),
              daysUntil: r.daysUntil,
              annualFee: $(r.annualFeeCents),
              valueReceived: $(valueCents),
              coversFee: valueCents >= r.annualFeeCents,
            };
          });
          return {
            summary: data.length ? data.map((d) => `${d.card}: ${d.annualFee} on ${d.renewsOn}; value received ${d.valueReceived} — ${d.coversFee ? 'covers the fee' : 'does NOT cover the fee'}`).join('\n') : `No annual fees in the next ${within} days.`,
            data,
          };
        },
      },
      {
        name: 'recommend_next_card',
        description:
          'Which card a household member should open next, scored from the household’s spend, current cards, 5/24 status and card terms (first-year value, ongoing value, 5/24 impact, confidence, reasons). With "card", says which member should apply for that card. Results go to the user only.',
        inputSchema: obj({ member: str('Household member nickname (optional; default: whole household)'), card: str('Catalog card name (optional): who should apply for it') }),
        readOnly: true,
        handler: async (ctx, input) => {
          const memberQ = S(input.member);
          const cardQ = S(input.card);
          const fmtCard = (c: { name: string; member: string; firstYearValueCents: number; longTermValueCents: number; five24: { countsToward: boolean; before: number; after: number; slotCostCents: number }; confidence: number; warnings: string[] }) =>
            `${c.name} for ${c.member}: first-year ~${$(c.firstYearValueCents)}, then ~${$(c.longTermValueCents)}/yr; ${c.five24.countsToward ? (c.five24.slotCostCents ? `5/24 ${c.five24.before}→${c.five24.after}` : 'no 5/24 slot used') : 'does not count toward 5/24'}; confidence ${Math.round(c.confidence * 100)} %${c.warnings[0] ? ` — note: ${c.warnings[0]}` : ''}`;
          if (cardQ) {
            const catalog = await this.prisma.creditCard.findMany({ where: { ownerId: null, isActive: true }, select: { slug: true, name: true } });
            const hit = fuzzyFind(catalog, cardQ, (c) => c.name);
            if (!hit) return { summary: `I couldn't find "${cardQ}" in the catalog.`, data: null };
            const r = await this.strategy.whoShouldApply(ctx.userId, hit.slug, {}, ctx.now);
            return { summary: `${r.why}${r.best ? `\n${fmtCard(r.best)}` : ''}\nGeneral information, not financial advice.`, data: { best: r.best, ranking: r.ranking.map((x) => ({ member: x.member, eligible: x.eligible, blockers: x.blockers, score: x.score })) } };
          }
          if (memberQ) {
            const members = await this.households.members(ctx.userId);
            const m = fuzzyFind(members, memberQ, (x) => x.nickname);
            if (!m) return { summary: `No household member called "${memberQ}".`, data: null };
            const r = await this.strategy.nextCard(ctx.userId, { profileId: m.id, limit: 5 }, ctx.now);
            const eligible = r.cards.filter((c) => c.eligible).slice(0, 3);
            return {
              summary: eligible.length ? `Top cards for ${m.nickname} (${r.member.five24.count}/24):\n${eligible.map((c, i) => `${i + 1}. ${fmtCard(c)}`).join('\n')}\nGeneral information, not financial advice.` : `No eligible cards for ${m.nickname} right now: ${r.cards[0]?.blockers[0] ?? 'no candidates'}.`,
              data: eligible,
            };
          }
          const plan = await this.strategy.householdPlan(ctx.userId, { limit: 2 }, ctx.now);
          const lines = plan.members.map((m) => `• ${m.member}: ${m.top.length ? m.top.map((c) => `${c.name} (~${$(c.firstYearValueCents)} first year)`).join(', ') : 'nothing eligible right now'}`);
          return { summary: `${plan.why}\n${lines.join('\n')}\n(Spend source: ${plan.spend.source.toLowerCase()}.) General information, not financial advice.`, data: plan };
        },
      },
      {
        name: 'get_transfer_options',
        description: "Each household member's points balances, their cash value and the best transfer partner for each (incl. active transfer bonuses). Results go to the user only.",
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const r = await this.strategy.transfers(ctx.userId, ctx.now);
          if (!r.balances.length) return { summary: 'No points balances yet — add them on the Travel page.', data: r };
          return {
            summary: `${r.balances.map((b) => `• ${b.member} — ${b.points.toLocaleString('en-US')} ${b.currencyName} (${$(b.cashValueCents)} direct): ${b.advice}`).join('\n')}\nTotal: ${$(r.totals.cashValueCents)} direct, up to ${$(r.totals.bestValueCents)} via transfers.`,
            data: r,
          };
        },
      },
      {
        name: 'plan_award',
        description: 'Plan how to cover an award costing N points in a loyalty program from the household’s balances: own program points first, then the cheapest transfers (respecting household pooling). Results go to the user only.',
        inputSchema: obj({ program: str('Loyalty program name or code, e.g. "SkyHigh"'), points: num('Award price in program points'), member: str('Member who books (optional)') }, ['program', 'points']),
        readOnly: true,
        handler: async (ctx, input) => {
          const points = N(input.points);
          const progQ = S(input.program);
          if (!progQ || !points || points <= 0) return { summary: 'Tell me the program and how many points the award costs.', data: null };
          const programs = await this.prisma.loyaltyProgram.findMany({ where: { isActive: true }, select: { code: true, name: true } });
          const prog = fuzzyFind(programs, progQ, (p) => `${p.name} ${p.code}`);
          if (!prog) return { summary: `I don't know the loyalty program "${progQ}".`, data: null };
          let profileId: string | undefined;
          const memberQ = S(input.member);
          if (memberQ) profileId = fuzzyFind(await this.households.members(ctx.userId), memberQ, (m) => m.nickname)?.id;
          const plan = await this.strategy.plan(ctx.userId, { program: prog.code, points: Math.round(points), profileId }, ctx.now);
          const steps = plan.steps.map((s, i) => `${i + 1}. ${s.kind === 'TRANSFER' ? `Transfer ${s.pointsUsed.toLocaleString('en-US')} ${s.from} from ${s.member} → ${s.programPoints.toLocaleString('en-US')} ${plan.program.code}${s.transferDays ? ` (up to ${s.transferDays} day(s))` : ' (instant)'}` : `Use ${s.pointsUsed.toLocaleString('en-US')} ${plan.program.code} from ${s.member}`}`);
          return { summary: [`${plan.summary}`, ...steps, ...plan.warnings.map((w) => `⚠ ${w}`)].join('\n'), data: plan };
        },
      },
      {
        name: 'get_transfer_partners',
        description: 'Public catalog: which loyalty programs a bank currency transfers to (ratio, transfer time, current bonus, value per point). No user data.',
        inputSchema: obj({ currency: str('Currency code, e.g. NW_MILES (optional)'), program: str('Program code, e.g. SKYHIGH (optional)') }),
        readOnly: true,
        dataClass: 'PUBLIC',
        handler: async (_ctx, input) => {
          const code = (v: unknown) => S(v, 32)?.toUpperCase().replace(/[^A-Z0-9_]/g, '');
          const r = await this.strategy.partners({ currency: code(input.currency), program: code(input.program) }, _ctx.now);
          const lines = r.currencies.flatMap((c) => c.options.map((o) => `• ${c.name} → ${o.programName}: ${o.programPointsPerPoint}:1, ~${o.centsPerPoint}¢ per point${o.bonusPercent ? `, ${o.bonusPercent} % bonus` : ''}${o.transferDays ? `, ${o.transferDays} day(s)` : ', instant'}`));
          return { summary: lines.length ? lines.join('\n') : 'No transfer partners match.', data: r };
        },
      },
      {
        name: 'search_card_terms',
        description: 'Public catalog fine print: searches card descriptions, features, earning rules and benefit terms (e.g. "lounge access", "trip delay insurance", "foreign transaction"). Returns quoted snippets per card. No user data.',
        inputSchema: obj({ query: str('What to look for'), card: str('Card name (optional)') }, ['query']),
        readOnly: true,
        dataClass: 'PUBLIC',
        handler: async (_ctx, input) => {
          const query = S(input.query, 200);
          if (!query) return { summary: 'Tell me what to look for in the card terms.', data: null };
          const r = await this.terms.search(query, { card: S(input.card, 80), limit: 8 });
          return {
            summary: r.hits.length ? r.hits.map((h) => `• ${h.card} (${h.kind}): "${h.snippet.replace(/[«»]/g, '')}"`).join('\n') : `Nothing in the catalog terms mentions "${query}".`,
            data: r.hits.map(({ card, kind, snippet }) => ({ card, kind, snippet })),
          };
        },
      },
      {
        name: 'get_point_valuations',
        description: 'Reward currencies the user earns, their cents-per-point valuation (user override or default) and which cards earn them — input for travel and transfer strategy.',
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const [cards, valuations] = await Promise.all([this.wallet.domainCards(ctx.userId), this.wallet.valuations(ctx.userId)]);
          const byCurrency = new Map<string, { currency: string; centsPerPoint: number; userOverride: boolean; cards: string[] }>();
          for (const c of cards.filter((x) => x.status === 'APPROVED')) {
            const cur = c.card.currency;
            const e = byCurrency.get(cur.id) ?? { currency: cur.code, centsPerPoint: valuations[cur.id] ?? cur.centsPerPoint, userOverride: valuations[cur.id] != null, cards: [] };
            e.cards.push(c.nickname || c.card.name);
            byCurrency.set(cur.id, e);
          }
          const data = [...byCurrency.values()];
          return {
            summary: data.length ? data.map((d) => `${d.currency}: ${d.centsPerPoint}¢/pt${d.userOverride ? ' (your valuation)' : ''} — ${d.cards.join(', ')}`).join('\n') : 'No rewards currencies yet.',
            data: { currencies: data, note: 'Award availability is not tracked; see get_transfer_options for transfer partners.' },
          };
        },
      },
      {
        name: 'get_offers',
        description: "The user's tracked card-linked offers (active ones with value left and days remaining).",
        inputSchema: obj({ status: str('Offer status', { enum: ['ACTIVE', 'REDEEMED', 'EXPIRED', 'ALL'] }) }),
        readOnly: true,
        handler: async (ctx, input) => {
          const status = ['ACTIVE', 'REDEEMED', 'EXPIRED', 'ALL'].includes(String(input.status)) ? (input.status as 'ACTIVE') : 'ACTIVE';
          const rows = await this.offers.mine(ctx.userId, { status, sort: 'endDate' } as never);
          const data = (rows as Array<{ title: string; daysLeft: number | null; remainingCents: number; walletCard: { nickname: string | null; card: { name: string } } }>)
            .slice(0, 30)
            .map((o) => ({ offer: o.title, card: o.walletCard.nickname || o.walletCard.card.name, daysLeft: o.daysLeft, valueLeft: $(o.remainingCents) }));
          return { summary: data.length ? data.map((o) => `• ${o.offer} (${o.card})${o.daysLeft != null ? `, ${o.daysLeft} days left` : ''}`).join('\n') : 'No offers in that status.', data };
        },
      },
      {
        name: 'get_spend_summary',
        description: "The household's typical monthly spend by category (from entered values, logged transactions, or a typical household).",
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const sp = await this.strategy.spend(ctx.userId, ctx.now);
          const lines = [...sp.lines].sort((a, b) => b.monthlyCents - a.monthlyCents).slice(0, 12);
          const names = new Map((await this.prisma.category.findMany({ select: { id: true, name: true } })).map((c) => [c.id, c.name]));
          const data = lines.map((l) => ({ category: names.get(l.categoryId) ?? l.categoryId, perMonth: $(l.monthlyCents) }));
          return { summary: `Monthly spend about ${$(sp.monthlyTotalCents)} (source: ${sp.source.toLowerCase()}).\n${data.map((d) => `• ${d.category}: ${d.perMonth}`).join('\n')}`, data: { source: sp.source, monthly: $(sp.monthlyTotalCents), lines: data } };
        },
      },
      {
        name: 'plan_purchase',
        description: 'Best way to pay for a planned purchase: which household card (and whether to split), the offer to activate first, portal rate, expected return and the evidence behind it.',
        inputSchema: obj({ merchant: str('Merchant name, e.g. Marriott'), amountDollars: num('Planned spend in dollars', { exclusiveMinimum: 0 }) }, ['merchant', 'amountDollars']),
        readOnly: true,
        handler: async (ctx, input) => {
          const merchant = S(input.merchant);
          const amount = N(input.amountDollars);
          if (!merchant || !amount || amount <= 0) throw new NotFoundException('merchant and amountDollars are required');
          const res = await this.offerAnalysis.plan(ctx.userId, { merchantText: merchant, amountCents: Math.round(amount * 100) }, ctx.now);
          const best = res.plans[0];
          if (!best) return { summary: 'No plan with evidence could be produced.', data: res };
          const legs = best.legs.map((l) => `${l.cardName}${l.member ? ` (${l.member})` : ''} for ${$(l.amountCents)}`).join(' + ');
          return { summary: `Best: ${legs}. Expected return ${$(best.expectedCents)}, confidence ${best.confidence}%.\n${[...best.justification, ...best.actions.map((a) => `Do first: ${a}`), ...best.warnings.map((w) => `Note: ${w}`)].join('\n')}`, data: res };
        },
      },
      {
        name: 'get_missed_offers',
        description: 'Offers the household could have used in the last 12 months but did not, with the root cause (not added, not activated, wrong card, below minimum, expired) and the evidence.',
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const r = await this.offerAnalysis.missed(ctx.userId, ctx.now);
          const lines = r.items.slice(0, 10).map((m) => `• ${m.offer.merchant ?? m.offer.title}: ${$(m.lostCents)} (${m.cause.toLowerCase().replace(/_/g, ' ')}, confidence ${m.confidence}%) — ${m.action}`);
          return { summary: lines.length ? `Missed about ${$(r.totalLostCents)}.\n${lines.join('\n')}` : 'No missed offers found.', data: r };
        },
      },
      {
        name: 'get_offer_opportunities',
        description: 'Offers ranked by opportunity score (0-100) with a reason for every factor and a confidence.',
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const r = await this.offerAnalysis.opportunities(ctx.userId, ctx.now);
          const lines = r.items.slice(0, 10).map((o) => `• ${o.merchant ?? o.title}: score ${o.score}/100, ${$(o.expectedValueCents)} expected${o.daysLeft != null ? `, ${o.daysLeft} days left` : ''}${o.activated ? '' : ', not activated'} (confidence ${o.confidence}%)`);
          return { summary: lines.length ? lines.join('\n') : 'No open offers.', data: r };
        },
      },
      {
        name: 'get_offer_audit_trail',
        description: 'Recent offer events: imports, activations, recommendations and detected misses, each with its evidence and confidence.',
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const ev = await this.offerIntel.events(ctx.userId, { limit: 30 });
          return { summary: ev.length ? ev.map((e) => `• ${e.createdAt.toISOString().slice(0, 10)} ${e.type.toLowerCase()} (${e.actor.toLowerCase()})`).join('\n') : 'No offer events yet.', data: ev };
        },
      },
      {
        name: 'get_loyalty_summary',
        description: "The household's loyalty assets: points by program, certificates, status, memberships, and their value (current, potential, at risk, expired, recovered).",
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const [v, accts] = await Promise.all([this.loyalty.valuation(ctx.userId, [], ctx.now), this.loyalty.accounts(ctx.userId, ctx.now)]);
          const top = accts.slice(0, 12).map((a) => `• ${a.member}: ${a.programName} ${a.balance.toLocaleString('en-US')} ${a.unit} (${$(a.valueCents)})`);
          return { summary: `Current ${$(v.currentCents)}, potential ${$(v.potentialCents)}, at risk ${$(v.atRiskCents)}, expired ${$(v.expiredCents)}, recovered ${$(v.recoveredCents)}.\n${top.join('\n')}`, data: { valuation: v, accounts: accts } };
        },
      },
      {
        name: 'get_expiring_loyalty',
        description: 'Balances at risk of expiring, with the predicted date, confidence, the alert wording and ways to keep them alive.',
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const r = await this.loyalty.expirations(ctx.userId, ctx.now);
          const lines = r.items.filter((i) => i.message).slice(0, 10).map((i) => `• ${i.message} (confidence ${i.prediction.confidence}%)${i.preservation[0] ? ` Cheapest fix: ${i.preservation[0].label}.` : ''}`);
          return { summary: lines.length ? lines.join('\n') : 'No balances are at risk.', data: r };
        },
      },
      {
        name: 'get_certificates',
        description: 'Free night, companion and upgrade certificates with expiry, potential value and restrictions, expiring first.',
        inputSchema: obj({ category: str('Certificate kind', { enum: ['FREE_NIGHT', 'COMPANION', 'UPGRADE'] }) }),
        readOnly: true,
        handler: async (ctx, input) => {
          const cat = ['FREE_NIGHT', 'COMPANION', 'UPGRADE'].includes(String(input.category)) ? String(input.category) : undefined;
          const ops = (await this.loyalty.certificateIntelligence(ctx.userId, [], ctx.now)).filter((o) => !cat || true);
          const rows = await this.loyalty.certificates(ctx.userId, cat, ctx.now);
          return { summary: ops.length ? ops.slice(0, 10).map((o) => `• ${o.message}`).join('\n') : 'No unused certificates.', data: { opportunities: ops, certificates: rows } };
        },
      },
      {
        name: 'get_status_progress',
        description: 'Elite status for each member: progress, expiry, renewal likelihood and recommended actions.',
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const rows = (await this.loyalty.statuses(ctx.userId, ctx.now)).filter((s) => s.current);
          return { summary: rows.length ? rows.map((s) => `• ${s.member}: ${s.view.headline}${s.view.actions[0] ? ` — ${s.view.actions[0]}` : ''}`).join('\n') : 'No elite status recorded.', data: rows };
        },
      },
      {
        name: 'get_memberships',
        description: 'Memberships (Global Entry, CLEAR, lounges) with expiry, renewal eligibility and any card credit that can pay for renewal.',
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          const rows = await this.loyalty.memberships(ctx.userId, [], ctx.now);
          return { summary: rows.length ? rows.map((m) => `• ${m.member}: ${m.view.headline}`).join('\n') : 'No memberships recorded.', data: rows };
        },
      },
      {
        name: 'get_transfer_bonuses',
        description: 'Transfer routes with the current bonus, its history, and a transfer-now / wait recommendation.',
        inputSchema: obj({}),
        readOnly: true,
        handler: async (ctx) => {
          void ctx;
          const routes = await this.loyalty.transferRoutes(ctx.now);
          const hot = routes.filter((r) => r.activeBonusPercent || r.advice.verdict === 'WAIT').slice(0, 10);
          return { summary: hot.length ? hot.map((r) => `• ${r.currencyName} → ${r.programName}: ${r.advice.text}`).join('\n') : 'No active transfer bonuses.', data: routes };
        },
      },
      {
        name: 'plan_award_trip',
        description: 'Evaluate an award trip: which program to book, what to transfer, which expiring points and free night certificates to use. Prices are estimates unless pointsNeeded is given.',
        inputSchema: obj({ destination: str('Destination'), dateFrom: str('Departure date, YYYY-MM-DD'), dateTo: str('Return date, YYYY-MM-DD'), cabin: str('Cabin', { enum: ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'] }), pointsNeeded: num('Exact points needed, if known', { exclusiveMinimum: 0 }) }, ['destination', 'dateFrom', 'dateTo', 'cabin']),
        readOnly: true,
        handler: async (ctx, input) => {
          const cabin = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'].includes(String(input.cabin)) ? (String(input.cabin) as 'BUSINESS') : 'ECONOMY';
          const r = await this.loyalty.evaluateTrip(ctx.userId, { destination: S(input.destination) ?? 'trip', dateFrom: S(input.dateFrom) ?? '', dateTo: S(input.dateTo) ?? '', cabin, pointsNeeded: N(input.pointsNeeded) } as never, ctx.now);
          const best = r.options[0];
          return { summary: best ? `Best: ${best.programName} (${best.pointsNeeded.toLocaleString('en-US')} points${r.pointsEstimated ? ', estimated' : ''}). ${[...best.reasons, ...best.warnings].join(' ')}` : 'No program in reach for this trip.', data: r };
        },
      },
      {
        name: 'log_benefit_usage',
        description:
          'Record that the user used part of a benefit/credit (e.g. "$15 of the dining credit"). This changes data, so it is NOT executed directly: it creates a pending action the user must confirm in the app.',
        inputSchema: obj({ benefit: str('Benefit name'), card: str('Card name (if ambiguous)'), amountDollars: num('Amount used in dollars', { exclusiveMinimum: 0 }), note: str('Optional note') }, ['benefit', 'amountDollars']),
        readOnly: false,
        requiresConfirmation: true,
        describe: (i) => `Log ${$(Math.round((N(i.amountDollars) ?? 0) * 100))} used on "${S(i.benefit)}"${S(i.card) ? ` (${S(i.card)})` : ''}`,
        handler: async (ctx, input) => {
          const amountCents = Math.round((N(input.amountDollars) ?? 0) * 100);
          if (amountCents <= 0) throw new NotFoundException('Amount must be greater than zero');
          const views = await this.benefits.list(ctx.userId, {}, ctx.now);
          const cardQ = S(input.card);
          const pool = cardQ ? views.filter((v) => fuzzyFind([v.walletCard], cardQ, (w) => w.name)) : views;
          const b = fuzzyFind(pool, S(input.benefit) ?? '', (v) => `${v.name} ${v.walletCard.name}`);
          if (!b) throw new NotFoundException(`No tracked benefit matching "${S(input.benefit)}"`);
          const updated = await this.benefits.logUsage(ctx.userId, b.id, { amountCents, note: S(input.note, 200) }, ctx.now);
          return { summary: `Logged ${$(amountCents)} on ${b.name} (${b.walletCard.name}); ${$(updated.currentPeriod.remainingCents)} left this period.`, data: { benefit: b.name, remaining: $(updated.currentPeriod.remainingCents) } };
        },
      },
    ];
  }
}

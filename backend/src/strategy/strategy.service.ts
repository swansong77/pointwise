import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toDomainCard } from '../common/mappers';
import { PrismaService } from '../common/prisma.service';
import { annualValueCents } from '../domain/benefits';
import { Applicant, CandidateCard, householdNextCards, rankCandidates, ScoreOptions, SpendLine, SpendSource, whoShouldApply } from '../domain/card-scorer';
import { adviseBalances, Balance, Currency, Partner, planAward, Program, transferOptions } from '../domain/travel';
import { HouseholdsService } from '../portfolio/households';
import { PortfolioService } from '../portfolio/portfolio';
import { WalletService } from '../wallet/wallet.service';

/** Typical monthly household spend (cents) used when nothing better is known — low confidence. */
export const DEFAULT_SPEND: Record<string, number> = {
  groceries: 600_00,
  dining: 400_00,
  gas: 150_00,
  travel: 200_00,
  'online-shopping': 250_00,
  streaming: 30_00,
  'everything-else': 1200_00,
};

export interface ScoreQuery {
  profileId?: string;
  benefitUseRate?: number;
  slotValueCents?: number;
  limit?: number;
}

const YEAR_MS = 365 * 86_400_000;

@Injectable()
export class StrategyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
    private readonly portfolio: PortfolioService,
    private readonly wallet: WalletService,
  ) {}

  // ───────────── spend profile ─────────────

  /** Spend profile: what the user entered, else 12 months of logged transactions, else a typical household. */
  async spend(userId: string, now = new Date()): Promise<{ source: SpendSource; lines: SpendLine[]; monthlyTotalCents: number }> {
    const categories = await this.prisma.category.findMany({ select: { id: true, slug: true, name: true, parentId: true, sortOrder: true }, orderBy: { sortOrder: 'asc' } });
    const byId = new Map(categories.map((c) => [c.id, c]));
    const line = (categoryId: string, monthlyCents: number): SpendLine => {
      const c = byId.get(categoryId)!;
      return { categoryId, parentCategoryId: c.parentId, name: c.name, monthlyCents };
    };
    const done = (source: SpendSource, lines: SpendLine[]) => ({ source, lines, monthlyTotalCents: lines.reduce((s, l) => s + l.monthlyCents, 0) });

    const entered = await this.prisma.spendProfileEntry.findMany({ where: { userId } });
    if (entered.some((e) => e.monthlyCents > 0)) return done('PROFILE', entered.filter((e) => byId.has(e.categoryId)).map((e) => line(e.categoryId, e.monthlyCents)));

    const since = new Date(now.getTime() - YEAR_MS);
    const tx = await this.prisma.transaction.groupBy({ by: ['categoryId'], where: { userId, kind: 'PURCHASE', occurredAt: { gte: since }, categoryId: { not: null } }, _sum: { amountCents: true }, _count: true, _min: { occurredAt: true } });
    const txCount = tx.reduce((s, t) => s + t._count, 0);
    if (txCount >= 10) {
      const first = tx.reduce((m, t) => (t._min.occurredAt && t._min.occurredAt < m ? t._min.occurredAt : m), now);
      const months = Math.min(12, Math.max(1, (now.getTime() - first.getTime()) / (YEAR_MS / 12)));
      return done(
        'TRANSACTIONS',
        tx.filter((t) => t.categoryId && byId.has(t.categoryId)).map((t) => line(t.categoryId!, Math.round((t._sum.amountCents ?? 0) / months))),
      );
    }
    const bySlug = new Map(categories.map((c) => [c.slug, c.id]));
    return done(
      'DEFAULT',
      Object.entries(DEFAULT_SPEND)
        .filter(([slug]) => bySlug.has(slug))
        .map(([slug, cents]) => line(bySlug.get(slug)!, cents)),
    );
  }

  async setSpend(userId: string, lines: Array<{ categoryId: string; monthlyCents: number }>) {
    const ids = [...new Set(lines.map((l) => l.categoryId))];
    if (ids.length !== lines.length) throw new BadRequestException('Each category may appear once');
    const found = await this.prisma.category.count({ where: { id: { in: ids } } });
    if (found !== ids.length) throw new BadRequestException('Unknown category');
    await this.prisma.$transaction([
      this.prisma.spendProfileEntry.deleteMany({ where: { userId } }),
      ...lines.filter((l) => l.monthlyCents > 0).map((l) => this.prisma.spendProfileEntry.create({ data: { userId, categoryId: l.categoryId, monthlyCents: l.monthlyCents } })),
    ]);
    return this.spend(userId);
  }

  // ───────────── next-card scorer ─────────────

  private async candidates(now: Date): Promise<CandidateCard[]> {
    const cards = await this.prisma.creditCard.findMany({
      where: { ownerId: null, isActive: true, productStatus: 'OPEN' },
      include: { currency: true, rewards: true, issuer: true, benefits: { where: { isActive: true } }, offerHistory: { where: { kind: 'WELCOME', validTo: null }, take: 1 } },
      orderBy: [{ popularity: 'desc' }, { name: 'asc' }],
    });
    return cards.map((c) => ({
      ...toDomainCard(c),
      slug: c.slug,
      issuerName: c.issuer.name,
      businessReportsToPersonal: c.issuer.businessReportsToPersonal,
      enforcesFive24: c.issuer.enforcesFive24,
      productFamily: c.productFamily,
      benefitsAnnualCents: c.benefits.filter((b) => b.kind === 'CREDIT').reduce((s, b) => s + annualValueCents(b), 0),
      bonusValuationCents: c.bonusValuationCents,
      offerElevated: c.offerHistory[0]?.elevated ?? false,
      recommendedCredit: c.recommendedCredit,
      // an expired offer has no bonus
      ...(c.offerExpiresAt && c.offerExpiresAt < now && { bonusPoints: null, bonusValuationCents: null }),
    }));
  }

  private async applicants(userId: string, now: Date): Promise<Applicant[]> {
    const [members, f24, rows] = await Promise.all([
      this.households.members(userId),
      this.portfolio.five24(userId, {}, now),
      this.prisma.walletCard.findMany({ where: { wallet: { userId }, status: { in: ['APPROVED', 'APPLIED'] }, cardholder: 'PRIMARY' }, select: { profileId: true, cardId: true, card: { select: { productFamily: true } } } }),
    ]);
    const primary = members.find((m) => m.isPrimary);
    return members.map((m) => {
      const f = f24.members.find((x) => x.profile.id === m.id)?.status;
      const held = rows.filter((r) => (r.profileId ?? primary?.id) === m.id);
      const age = m.birthYear ? now.getUTCFullYear() - m.birthYear : null;
      const minor = age != null && age < 18;
      return {
        profileId: m.id,
        nickname: m.nickname,
        canApply: !minor,
        cannotApplyReason: minor ? `${m.nickname} is under 18 (authorized-user cards only)` : undefined,
        five24: {
          count: f?.count ?? 0,
          limit: f?.limit ?? 5,
          underLimit: f?.underLimit ?? true,
          dropOffs: (f?.contributing ?? []).map((c) => c.dropsOffAt).filter((d): d is Date => d != null),
          unknownCount: f?.unknown.length ?? 0,
        },
        heldCardIds: held.map((h) => h.cardId),
        heldFamilies: held.map((h) => h.card.productFamily).filter((x): x is string => !!x),
        creditBand: m.creditBand,
      };
    });
  }

  private async scoringContext(userId: string, q: ScoreQuery, now: Date) {
    const [cards, applicants, household, valuations, spend, fallback] = await Promise.all([
      this.candidates(now),
      this.applicants(userId, now),
      this.wallet.domainCards(userId),
      this.wallet.valuations(userId),
      this.spend(userId, now),
      this.prisma.category.findFirst({ where: { isFallback: true }, select: { id: true } }),
    ]);
    const opt: ScoreOptions = { fallbackCategoryId: fallback?.id ?? null, valuations, benefitUseRate: q.benefitUseRate, slotValueCents: q.slotValueCents, spendSource: spend.source, now };
    return { cards, applicants, household, spend, opt };
  }

  /** Ranked next cards for one member (default: the primary member). */
  async nextCard(userId: string, q: ScoreQuery = {}, now = new Date()) {
    const ctx = await this.scoringContext(userId, q, now);
    const member = q.profileId ? ctx.applicants.find((a) => a.profileId === q.profileId) : ctx.applicants[0];
    if (!member) throw new NotFoundException('Household member not found');
    const ranked = rankCandidates(ctx.cards, member, ctx.household, ctx.spend.lines, ctx.opt);
    return {
      member: { profileId: member.profileId, nickname: member.nickname, five24: { count: member.five24.count, limit: member.five24.limit, underLimit: member.five24.underLimit } },
      spend: { source: ctx.spend.source, monthlyTotalCents: ctx.spend.monthlyTotalCents },
      cards: ranked.slice(0, q.limit ?? 20),
      disclaimer: 'Estimates from your data and catalog terms — not financial or credit advice. Approval is up to the issuer.',
    };
  }

  /** Best next card per member and the household's overall pick. */
  async householdPlan(userId: string, q: ScoreQuery = {}, now = new Date()) {
    const ctx = await this.scoringContext(userId, q, now);
    const plan = householdNextCards(ctx.cards, ctx.applicants, ctx.household, ctx.spend.lines, ctx.opt, q.limit ?? 3);
    return { ...plan, spend: { source: ctx.spend.source, monthlyTotalCents: ctx.spend.monthlyTotalCents } };
  }

  /** Which member should apply for a given card. */
  async whoShouldApply(userId: string, cardIdOrSlug: string, q: ScoreQuery = {}, now = new Date()) {
    const ctx = await this.scoringContext(userId, q, now);
    const card = ctx.cards.find((c) => c.id === cardIdOrSlug || c.slug === cardIdOrSlug);
    if (!card) throw new NotFoundException('Card not found or not open to new applicants');
    return whoShouldApply(card, ctx.applicants, ctx.household, ctx.spend.lines, ctx.opt);
  }

  // ───────────── travel ─────────────

  private async travelCatalog() {
    const [currencies, programs, partners] = await Promise.all([
      this.prisma.rewardCurrency.findMany({ orderBy: { name: 'asc' } }),
      this.prisma.loyaltyProgram.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.transferPartner.findMany(),
    ]);
    return {
      currencies: currencies.map((c): Currency => ({ id: c.id, code: c.code, name: c.name, centsPerPoint: Number(c.centsPerPoint), isCash: c.isCash, householdPooling: c.householdPooling, transferIncrement: c.transferIncrement })),
      programs: programs.map((p): Program => ({ id: p.id, code: p.code, name: p.name, kind: p.kind, centsPerPoint: Number(p.centsPerPoint), householdPooling: p.householdPooling })),
      partners: partners.map((p): Partner => ({ currencyId: p.currencyId, programId: p.programId, ratioFrom: p.ratioFrom, ratioTo: p.ratioTo, transferDays: p.transferDays, bonusPercent: p.bonusPercent, bonusEndsAt: p.bonusEndsAt })),
    };
  }

  /** Public: loyalty programs and every transfer partner (optionally for one currency or program code). */
  async partners(q: { currency?: string; program?: string } = {}, now = new Date()) {
    const cat = await this.travelCatalog();
    const currencies = cat.currencies.filter((c) => !q.currency || c.code === q.currency.toUpperCase());
    return {
      programs: cat.programs.filter((p) => !q.program || p.code === q.program.toUpperCase()),
      currencies: currencies
        .map((c) => ({
          code: c.code,
          name: c.name,
          centsPerPoint: c.centsPerPoint,
          householdPooling: c.householdPooling,
          options: transferOptions(c, cat.partners, cat.programs, now)
            .filter((o) => !q.program || o.program.code === q.program.toUpperCase())
            .map((o) => ({ program: o.program.code, programName: o.program.name, kind: o.program.kind, programPointsPerPoint: o.programPointsPerPoint, centsPerPoint: o.centsPerPoint, upliftVsCash: o.upliftVsCash, bonusPercent: o.bonusPercent, bonusEndsAt: o.bonusEndsAt, transferDays: o.transferDays })),
        }))
        .filter((c) => c.options.length > 0 || (!!q.currency && !q.program)),
    };
  }

  private async balanceRows(userId: string): Promise<Balance[]> {
    const rows = await this.prisma.loyaltyBalance.findMany({ where: { userId }, include: { profile: { select: { nickname: true, sortOrder: true } } }, orderBy: [{ profile: { sortOrder: 'asc' } }, { points: 'desc' }] });
    return rows.map((r) => ({ profileId: r.profileId, member: r.profile.nickname, currencyId: r.currencyId, programId: r.programId, points: r.points }));
  }

  async balances(userId: string) {
    const rows = await this.prisma.loyaltyBalance.findMany({
      where: { userId },
      include: { profile: { select: { nickname: true, sortOrder: true } }, currency: { select: { code: true, name: true, centsPerPoint: true } }, program: { select: { code: true, name: true, kind: true, centsPerPoint: true } } },
      orderBy: [{ profile: { sortOrder: 'asc' } }, { points: 'desc' }],
    });
    return rows.map((r) => {
      const cpp = Number(r.currency?.centsPerPoint ?? r.program?.centsPerPoint ?? 0);
      return {
        id: r.id,
        profileId: r.profileId,
        member: r.profile.nickname,
        kind: r.currencyId ? ('CURRENCY' as const) : ('PROGRAM' as const),
        code: r.currency?.code ?? r.program!.code,
        name: r.currency?.name ?? r.program!.name,
        points: r.points,
        valueCents: Math.round(r.points * cpp),
        updatedAt: r.updatedAt,
      };
    });
  }

  async setBalance(userId: string, dto: { profileId: string; code: string; points: number }) {
    await this.households.owned(userId, dto.profileId);
    const code = dto.code.toUpperCase();
    const [currency, program] = await Promise.all([this.prisma.rewardCurrency.findUnique({ where: { code } }), this.prisma.loyaltyProgram.findUnique({ where: { code } })]);
    if (!currency && !program) throw new BadRequestException(`Unknown currency or loyalty program "${dto.code}"`);
    if (currency?.isCash) throw new BadRequestException('Cash back is not a points balance');
    const where: Prisma.LoyaltyBalanceWhereInput = { profileId: dto.profileId, ...(currency ? { currencyId: currency.id } : { programId: program!.id }) };
    const existing = await this.prisma.loyaltyBalance.findFirst({ where });
    if (dto.points === 0) {
      if (existing) await this.prisma.loyaltyBalance.delete({ where: { id: existing.id } });
      return { deleted: !!existing };
    }
    const row = existing
      ? await this.prisma.loyaltyBalance.update({ where: { id: existing.id }, data: { points: dto.points } })
      : await this.prisma.loyaltyBalance.create({ data: { userId, profileId: dto.profileId, currencyId: currency?.id ?? null, programId: currency ? null : program!.id, points: dto.points } });
    return { id: row.id, points: row.points };
  }

  async deleteBalance(userId: string, id: string) {
    const r = await this.prisma.loyaltyBalance.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Balance not found');
  }

  /** Each member's currency balances with their best transfer option. */
  async transfers(userId: string, now = new Date()) {
    const [cat, balances] = await Promise.all([this.travelCatalog(), this.balanceRows(userId)]);
    const advice = adviseBalances(balances, cat.currencies, cat.partners, cat.programs, now);
    return {
      balances: advice.map((a) => ({
        profileId: a.profileId,
        member: a.member,
        currency: a.currency.code,
        currencyName: a.currency.name,
        points: a.points,
        cashValueCents: a.cashValueCents,
        bestValueCents: a.bestValueCents,
        best: a.best && { program: a.best.program.code, programName: a.best.program.name, centsPerPoint: a.best.centsPerPoint, upliftVsCash: a.best.upliftVsCash, bonusPercent: a.best.bonusPercent, bonusEndsAt: a.best.bonusEndsAt, transferDays: a.best.transferDays },
        advice: a.advice,
      })),
      totals: { cashValueCents: advice.reduce((s, a) => s + a.cashValueCents, 0), bestValueCents: advice.reduce((s, a) => s + a.bestValueCents, 0) },
    };
  }

  /** Cover an award of N points in a program from the household's balances. */
  async plan(userId: string, dto: { program: string; points: number; profileId?: string }, now = new Date()) {
    if (dto.profileId) await this.households.owned(userId, dto.profileId);
    const [cat, balances, primary] = await Promise.all([this.travelCatalog(), this.balanceRows(userId), this.households.primary(userId)]);
    const program = cat.programs.find((p) => p.code === dto.program.toUpperCase());
    if (!program) throw new NotFoundException(`Unknown loyalty program "${dto.program}"`);
    const booker = dto.profileId ?? primary.id;
    const plan = planAward({ programId: program.id, pointsNeeded: dto.points, bookerProfileId: booker }, balances, cat.currencies, cat.partners, cat.programs, now);
    return { ...plan, program: { code: program.code, name: program.name, kind: program.kind, centsPerPoint: program.centsPerPoint } };
  }

  // ───────────── admin: programs & partners ─────────────

  async upsertProgram(actorId: string, dto: { code: string; name: string; kind?: 'AIRLINE' | 'HOTEL' | 'OTHER'; centsPerPoint: number; householdPooling?: boolean; isActive?: boolean }) {
    const code = dto.code.toUpperCase();
    const data = { name: dto.name, kind: dto.kind ?? 'AIRLINE', centsPerPoint: dto.centsPerPoint, householdPooling: dto.householdPooling ?? false, isActive: dto.isActive ?? true };
    const p = await this.prisma.loyaltyProgram.upsert({ where: { code }, update: data, create: { code, ...data } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'upsert', entity: 'LoyaltyProgram', entityId: p.id, diff: { code, ...data } } });
    return p;
  }

  async upsertPartner(actorId: string, dto: { currency: string; program: string; ratioFrom?: number; ratioTo?: number; transferDays?: number; bonusPercent?: number; bonusEndsAt?: string | null; notes?: string }) {
    const [currency, program] = await Promise.all([
      this.prisma.rewardCurrency.findUnique({ where: { code: dto.currency.toUpperCase() } }),
      this.prisma.loyaltyProgram.findUnique({ where: { code: dto.program.toUpperCase() } }),
    ]);
    if (!currency || !program) throw new BadRequestException('Unknown currency or program');
    if (currency.isCash) throw new BadRequestException('Cash back cannot transfer to partners');
    const data = {
      ratioFrom: dto.ratioFrom ?? 1,
      ratioTo: dto.ratioTo ?? 1,
      transferDays: dto.transferDays ?? 0,
      bonusPercent: dto.bonusPercent ?? 0,
      bonusEndsAt: dto.bonusEndsAt ? new Date(dto.bonusEndsAt) : null,
      notes: dto.notes ?? null,
    };
    const p = await this.prisma.transferPartner.upsert({ where: { currencyId_programId: { currencyId: currency.id, programId: program.id } }, update: data, create: { currencyId: currency.id, programId: program.id, ...data } });
    await this.prisma.auditLog.create({ data: { actorId, action: 'upsert', entity: 'TransferPartner', entityId: p.id, diff: { currency: currency.code, program: program.code, ...data, bonusEndsAt: dto.bonusEndsAt ?? null } } });
    return p;
  }

  async deletePartner(actorId: string, id: string) {
    const r = await this.prisma.transferPartner.deleteMany({ where: { id } });
    if (!r.count) throw new NotFoundException('Transfer partner not found');
    await this.prisma.auditLog.create({ data: { actorId, action: 'delete', entity: 'TransferPartner', entityId: id } });
  }

  async adminPartners() {
    return this.prisma.transferPartner.findMany({ include: { currency: { select: { code: true, name: true } }, program: { select: { code: true, name: true } } }, orderBy: [{ currency: { code: 'asc' } }, { program: { code: 'asc' } }] });
  }
}

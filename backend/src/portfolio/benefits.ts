import { effectiveRules } from "../domain/spend";
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
  OmitType,
  PartialType,
} from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import {
  BenefitKind,
  BenefitPeriod,
  PeriodBasis,
  Prisma,
} from "@prisma/client";
import { AuthUser, CurrentUser } from "../common/decorators";
import { PrismaService } from "../common/prisma.service";
import {
  annualValueCents,
  benefitYearSummary,
  BenefitStatus,
  lastDay,
  monthsOf,
  periodContaining,
  utilization,
} from "../domain/benefits";

export class CreateBenefitDto {
  @ApiProperty() @IsUUID() walletCardId: string;
  @ApiPropertyOptional({ description: "copy a catalog template" })
  @IsOptional()
  @IsUUID()
  benefitId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
  @ApiPropertyOptional({ enum: BenefitKind })
  @IsOptional()
  @IsEnum(BenefitKind)
  kind?: BenefitKind;
  @ApiPropertyOptional({ enum: BenefitPeriod })
  @IsOptional()
  @IsEnum(BenefitPeriod)
  period?: BenefitPeriod;
  @ApiPropertyOptional({ description: "only for MULTI_YEAR (e.g. 48)" })
  @IsOptional()
  @IsInt()
  @Min(13)
  @Max(120)
  periodMonths?: number;
  @ApiPropertyOptional({ enum: PeriodBasis })
  @IsOptional()
  @IsEnum(PeriodBasis)
  basis?: PeriodBasis;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_00)
  amountPerPeriodCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  howIssued?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  actionNeeded?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateBenefitDto extends PartialType(
  OmitType(CreateBenefitDto, ["walletCardId", "benefitId"] as const),
) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UsageDto {
  @ApiProperty({ description: "cents used" })
  @IsInt()
  @Min(1)
  @Max(10_000_00)
  amountCents: number;
  @ApiPropertyOptional({
    description:
      "defaults to now; decides which period the usage counts toward",
  })
  @IsOptional()
  @IsDateString()
  usedOn?: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

const STATUSES = [
  "UNUSED",
  "PARTIAL",
  "COMPLETED",
  "EXPIRED",
  "EXPIRING_SOON",
] as const;
export class BenefitListQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() walletCardId?: string;
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES as unknown as string[])
  status?: BenefitStatus;
  @ApiPropertyOptional({ default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  expiringDays = 30;
}

export const userBenefitInclude = {
  usages: {
    include: {
      transaction: { select: { description: true, occurredAt: true } },
    },
  },
  category: { select: { slug: true, name: true } },
  walletCard: {
    select: {
      id: true,
      nickname: true,
      status: true,
      approvedAt: true,
      profileId: true,
      cardholder: true,
      lastFour: true,
      card: {
        select: { name: true, color: true, issuer: { select: { name: true } } },
      },
      wallet: { select: { userId: true } },
    },
  },
} satisfies Prisma.UserBenefitInclude;
export type UserBenefitRow = Prisma.UserBenefitGetPayload<{
  include: typeof userBenefitInclude;
}>;

/** Pure view of one tracked benefit at `now` (current period + benefit year). */
export function benefitView(b: UserBenefitRow, now: Date, expiringDays = 30) {
  const anchor = b.walletCard.approvedAt;
  const window = periodContaining(b, anchor, now);
  const byPeriod = new Map<string, number>();
  for (const u of b.usages)
    byPeriod.set(
      u.periodStart.toISOString(),
      (byPeriod.get(u.periodStart.toISOString()) ?? 0) + u.amountCents,
    );
  const current = utilization(
    b.amountPerPeriodCents,
    byPeriod.get(window.start.toISOString()) ?? 0,
    window,
    now,
    expiringDays,
  );
  const year = benefitYearSummary(b, anchor, now, byPeriod);
  return {
    id: b.id,
    name: b.name,
    kind: b.kind,
    category: b.category,
    period: b.period,
    periodMonths: monthsOf(b),
    basis: b.basis,
    amountPerPeriodCents: b.amountPerPeriodCents,
    annualValueCents: annualValueCents(b),
    howIssued: b.howIssued,
    actionNeeded: b.actionNeeded,
    notes: b.notes,
    enabled: b.enabled,
    autoTrack: b.autoTrack,
    autoRules: effectiveRules(b.autoRules, {
      name: b.name,
      howIssued: b.howIssued,
      categorySlug: b.category?.slug,
    }),
    walletCard: {
      id: b.walletCard.id,
      name: b.walletCard.nickname || b.walletCard.card.name,
      issuer: b.walletCard.card.issuer.name,
      color: b.walletCard.card.color,
      profileId: b.walletCard.profileId,
      cardholder: b.walletCard.cardholder,
      status: b.walletCard.status,
    },
    currentPeriod: {
      start: window.start,
      end: window.end,
      lastDay: lastDay(window),
      ...current,
    },
    renewsAt: window.end,
    year,
    usages: b.usages
      .filter((u) => u.status !== "DISMISSED")
      .slice()
      .sort((a, c) => c.usedOn.getTime() - a.usedOn.getTime())
      .slice(0, 20)
      .map((u) => ({
        id: u.id,
        amountCents: u.amountCents,
        usedOn: u.usedOn,
        periodStart: u.periodStart,
        note: u.note,
        source: u.source,
        status: u.status,
        transaction: u.transaction
          ? { id: u.transactionId, description: u.transaction.description }
          : null,
      })),
  };
}
export type BenefitView = ReturnType<typeof benefitView>;

@Injectable()
export class BenefitsService {
  constructor(private readonly prisma: PrismaService) {}

  catalog(cardId?: string) {
    return this.prisma.benefit.findMany({
      where: {
        isActive: true,
        ...(cardId && { cardId }),
        card: { ownerId: null },
      },
      include: {
        category: { select: { slug: true, name: true } },
        card: { select: { id: true, name: true } },
      },
      orderBy: [{ cardId: "asc" }, { name: "asc" }],
    });
  }

  categories() {
    return this.prisma.benefitCategory.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    });
  }

  async rows(userId: string, where: Prisma.UserBenefitWhereInput = {}) {
    return this.prisma.userBenefit.findMany({
      where: {
        ...where,
        walletCard: {
          wallet: { userId },
          ...((where.walletCard as object) ?? {}),
        },
      },
      include: userBenefitInclude,
      orderBy: [{ walletCard: { sortOrder: "asc" } }, { name: "asc" }],
    });
  }

  async list(
    userId: string,
    q: Partial<BenefitListQuery> = {},
    now = new Date(),
  ): Promise<BenefitView[]> {
    const rows = await this.rows(userId, {
      ...(q.walletCardId && { walletCardId: q.walletCardId }),
      ...(q.profileId && { walletCard: { profileId: q.profileId } }),
    });
    const views = rows.map((r) => benefitView(r, now, q.expiringDays ?? 30));
    return q.status
      ? views.filter((v) => v.currentPeriod.status === q.status)
      : views;
  }

  /** Benefit dashboard: buckets + totals over enabled benefits on open cards. */
  async summary(userId: string, now = new Date(), expiringDays = 30) {
    const views = (await this.list(userId, { expiringDays }, now)).filter(
      (v) => v.enabled && v.walletCard.status !== "CLOSED",
    );
    const by = (s: BenefitStatus) =>
      views.filter((v) => v.currentPeriod.status === s);
    const sum = (f: (v: BenefitView) => number) =>
      views.reduce((a, v) => a + f(v), 0);
    return {
      totals: {
        annualValueCents: sum((v) => v.annualValueCents),
        usedThisYearCents: sum((v) => v.year.usedThisYearCents),
        remainingThisYearCents: sum((v) => v.year.remainingThisYearCents),
        missedThisYearCents: sum((v) => v.year.missedCents),
        currentRemainingCents: sum((v) => v.currentPeriod.remainingCents),
      },
      counts: Object.fromEntries(STATUSES.map((s) => [s, by(s).length])),
      available: views.filter((v) =>
        ["UNUSED", "PARTIAL"].includes(v.currentPeriod.status),
      ),
      expiring: by("EXPIRING_SOON").sort(
        (a, b) => a.currentPeriod.daysLeft - b.currentPeriod.daysLeft,
      ),
      completed: by("COMPLETED"),
      missed: views
        .filter((v) => v.year.missedCents > 0)
        .sort((a, b) => b.year.missedCents - a.year.missedCents),
    };
  }

  async owned(userId: string, id: string): Promise<UserBenefitRow> {
    const b = await this.prisma.userBenefit.findUnique({
      where: { id },
      include: userBenefitInclude,
    });
    if (!b) throw new NotFoundException("Benefit not found");
    if (b.walletCard.wallet.userId !== userId)
      throw new ForbiddenException("Not your benefit");
    return b;
  }

  async create(userId: string, dto: CreateBenefitDto) {
    const wc = await this.prisma.walletCard.findUnique({
      where: { id: dto.walletCardId },
      include: { wallet: true },
    });
    if (!wc) throw new NotFoundException("Wallet card not found");
    if (wc.wallet.userId !== userId)
      throw new ForbiddenException("Not your card");
    let template: Prisma.BenefitGetPayload<object> | null = null;
    if (dto.benefitId) {
      template = await this.prisma.benefit.findUnique({
        where: { id: dto.benefitId },
      });
      if (!template || template.cardId !== wc.cardId)
        throw new BadRequestException(
          "Benefit template does not belong to this card",
        );
    }
    const name = dto.name ?? template?.name;
    const amount = dto.amountPerPeriodCents ?? template?.amountPerPeriodCents;
    if (!name || amount == null)
      throw new BadRequestException(
        "name and amountPerPeriodCents are required for custom benefits",
      );
    const period = dto.period ?? template?.period ?? "ANNUAL";
    const periodMonths =
      period === "MULTI_YEAR"
        ? (dto.periodMonths ?? template?.periodMonths)
        : monthsOf({ period });
    if (!periodMonths)
      throw new BadRequestException(
        "periodMonths is required for MULTI_YEAR benefits",
      );
    try {
      const created = await this.prisma.userBenefit.create({
        data: {
          walletCardId: wc.id,
          benefitId: template?.id,
          name,
          kind: dto.kind ?? template?.kind ?? "CREDIT",
          period,
          periodMonths,
          basis: dto.basis ?? template?.basis ?? "CALENDAR",
          amountPerPeriodCents: amount,
          categoryId: dto.categoryId ?? template?.categoryId,
          howIssued: dto.howIssued ?? template?.howIssued,
          actionNeeded: dto.actionNeeded ?? template?.actionNeeded,
          notes: dto.notes ?? template?.notes,
        },
        include: userBenefitInclude,
      });
      return benefitView(created, new Date());
    } catch (e) {
      if ((e as { code?: string }).code === "P2002")
        throw new BadRequestException(
          `"${name}" is already tracked on this card`,
        );
      throw e;
    }
  }

  /** Copy every catalog template of the card's product (skips ones already tracked). */
  async applyTemplates(
    userId: string,
    walletCardId: string,
  ): Promise<{ added: number }> {
    const wc = await this.prisma.walletCard.findUnique({
      where: { id: walletCardId },
      include: { wallet: true },
    });
    if (!wc) throw new NotFoundException("Wallet card not found");
    if (wc.wallet.userId !== userId)
      throw new ForbiddenException("Not your card");
    return {
      added: await BenefitsService.copyTemplates(this.prisma, wc.id, wc.cardId),
    };
  }

  static async copyTemplates(
    prisma: Pick<PrismaService, "benefit" | "userBenefit">,
    walletCardId: string,
    cardId: string,
  ): Promise<number> {
    const templates = await prisma.benefit.findMany({
      where: { cardId, isActive: true },
    });
    if (templates.length === 0) return 0;
    const res = await prisma.userBenefit.createMany({
      data: templates.map((t) => ({
        walletCardId,
        benefitId: t.id,
        name: t.name,
        kind: t.kind,
        autoRules: t.autoRules ?? undefined,
        period: t.period,
        periodMonths: t.periodMonths,
        basis: t.basis,
        amountPerPeriodCents: t.amountPerPeriodCents,
        categoryId: t.categoryId,
        howIssued: t.howIssued,
        actionNeeded: t.actionNeeded,
        notes: t.notes,
      })),
      skipDuplicates: true,
    });
    return res.count;
  }

  async update(userId: string, id: string, dto: UpdateBenefitDto) {
    const b = await this.owned(userId, id);
    const period = dto.period ?? b.period;
    const periodMonths =
      period === "MULTI_YEAR"
        ? (dto.periodMonths ??
          (b.period === "MULTI_YEAR" ? b.periodMonths : undefined))
        : monthsOf({ period });
    if (!periodMonths)
      throw new BadRequestException(
        "periodMonths is required for MULTI_YEAR benefits",
      );
    const updated = await this.prisma.userBenefit.update({
      where: { id },
      data: {
        name: dto.name,
        kind: dto.kind,
        period,
        periodMonths,
        basis: dto.basis,
        amountPerPeriodCents: dto.amountPerPeriodCents,
        categoryId: dto.categoryId,
        howIssued: dto.howIssued,
        actionNeeded: dto.actionNeeded,
        notes: dto.notes,
        enabled: dto.enabled,
      },
      include: userBenefitInclude,
    });
    return benefitView(updated, new Date());
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.prisma.userBenefit.delete({ where: { id } });
  }

  async logUsage(userId: string, id: string, dto: UsageDto, now = new Date()) {
    const b = await this.owned(userId, id);
    const usedOn = dto.usedOn ? new Date(dto.usedOn) : now;
    if (usedOn.getTime() > now.getTime() + 86_400_000)
      throw new BadRequestException("usedOn cannot be in the future");
    const window = periodContaining(b, b.walletCard.approvedAt, usedOn);
    const already = b.usages
      .filter((u) => u.periodStart.getTime() === window.start.getTime())
      .reduce((a, u) => a + u.amountCents, 0);
    const remaining = b.amountPerPeriodCents - already;
    if (b.amountPerPeriodCents > 0 && dto.amountCents > remaining) {
      throw new BadRequestException(
        `Only $${(Math.max(0, remaining) / 100).toFixed(2)} is left in this period`,
      );
    }
    await this.prisma.benefitUsage.create({
      data: {
        userBenefitId: id,
        periodStart: window.start,
        amountCents: dto.amountCents,
        usedOn,
        note: dto.note,
      },
    });
    return benefitView(await this.owned(userId, id), now);
  }

  async removeUsage(
    userId: string,
    id: string,
    usageId: string,
  ): Promise<void> {
    const b = await this.owned(userId, id);
    if (!b.usages.some((u) => u.id === usageId))
      throw new NotFoundException("Usage not found");
    await this.prisma.benefitUsage.delete({ where: { id: usageId } });
  }
}

@ApiTags("benefits")
@ApiBearerAuth()
@Controller("benefits")
export class BenefitsController {
  constructor(private readonly svc: BenefitsService) {}

  @Get("catalog") catalog(@Query("cardId") cardId?: string) {
    if (cardId !== undefined && !/^[0-9a-f-]{36}$/i.test(cardId))
      throw new BadRequestException("cardId must be a UUID");
    return this.svc.catalog(cardId);
  }
  @Get("categories") categories() {
    return this.svc.categories();
  }
  @Get() list(@CurrentUser() u: AuthUser, @Query() q: BenefitListQuery) {
    return this.svc.list(u.sub, q);
  }
  @Get("summary") summary(
    @CurrentUser() u: AuthUser,
    @Query() q: BenefitListQuery,
  ) {
    return this.svc.summary(u.sub, new Date(), q.expiringDays);
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: CreateBenefitDto) {
    return this.svc.create(u.sub, dto);
  }
  @Post("apply-templates/:walletCardId") apply(
    @CurrentUser() u: AuthUser,
    @Param("walletCardId", ParseUUIDPipe) id: string,
  ) {
    return this.svc.applyTemplates(u.sub, id);
  }
  @Patch(":id") update(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UpdateBenefitDto,
  ) {
    return this.svc.update(u.sub, id, dto);
  }
  @Delete(":id") @HttpCode(204) remove(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.remove(u.sub, id);
  }
  @Post(":id/usage") usage(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: UsageDto,
  ) {
    return this.svc.logUsage(u.sub, id, dto);
  }
  @Delete(":id/usage/:usageId") @HttpCode(204) removeUsage(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("usageId", ParseUUIDPipe) usageId: string,
  ) {
    return this.svc.removeUsage(u.sub, id, usageId);
  }
}

@Module({
  controllers: [BenefitsController],
  providers: [BenefitsService],
  exports: [BenefitsService],
})
export class BenefitsModule {}

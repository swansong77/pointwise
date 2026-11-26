import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsHexColor, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { CardNetwork, CardType, OfferKind, Role, CreditBand } from '@prisma/client';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { PrismaService } from '../common/prisma.service';
import { applyRotating, rotatingCoverage } from '../seed/rotating.apply';
import { ROTATING_SOURCES } from '../seed/rotating-sources';
import { ROTATING_SCHEDULE } from '../jobs/rotating.job';
import { PageQuery, paginate } from '../common/pagination';
import { AnalyticsModule, AnalyticsService } from '../analytics/analytics.service';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class RotatingCategoryInput {
  @ApiProperty() @IsString() @Matches(SLUG) cat!: string;
  @ApiProperty() @IsNumber() @Min(0.1) @Max(10) mult!: number;
  @ApiProperty() @IsString() @MinLength(8) @MaxLength(300) desc!: string;
}
export class RotatingQuarterInput {
  @ApiProperty({ example: '2027-Q1' }) @IsString() @Matches(/^20\d\d-Q[1-4]$/) quarter!: string;
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @Matches(SLUG, { each: true }) cards!: string[];
  @ApiProperty({ type: [RotatingCategoryInput] }) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => RotatingCategoryInput) categories!: RotatingCategoryInput[];
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) @Max(100000) capDollars?: number;
  @ApiProperty({ description: 'The issuer page that announces the quarter' }) @IsString() @MaxLength(500) sourceUrl!: string;
  @ApiProperty({ example: '2026-12-15' }) @IsString() @Matches(/^20\d\d-\d\d-\d\d$/) checkedOn!: string;
}

export class RewardInput {
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() merchantId?: string;
  @ApiProperty() @IsNumber() @Min(0) @Max(100) multiplier: number;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(300) description: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isRotating?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) capCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsIn(['QUARTER', 'YEAR']) capPeriod?: string;
}

export class CardInput {
  @ApiProperty() @Matches(SLUG) @MaxLength(80) slug: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiProperty() @IsUUID() issuerId: string;
  @ApiProperty({ enum: CardNetwork }) @IsEnum(CardNetwork) network: CardNetwork;
  @ApiPropertyOptional({ enum: CardType }) @IsOptional() @IsEnum(CardType) type?: CardType;
  @ApiProperty() @IsUUID() currencyId: string;
  @ApiProperty() @IsInt() @Min(0) @Max(10_000_00) annualFeeCents: number;
  @ApiPropertyOptional() @IsOptional() @IsHexColor() color?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) bonusDescription?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) bonusPoints?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) bonusSpendCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(24) bonusMonths?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional({ enum: CreditBand, description: 'Credit typically needed for approval' }) @IsOptional() @IsEnum(CreditBand) recommendedCredit?: CreditBand;
  @ApiPropertyOptional({ type: [RewardInput] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => RewardInput) rewards?: RewardInput[];
}

export class CategoryInput {
  @ApiProperty() @Matches(SLUG) @MaxLength(80) slug: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
}

export class MerchantInput {
  @ApiProperty() @Matches(SLUG) @MaxLength(80) slug: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name: string;
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @Matches(/^[a-z0-9.-]+\.[a-z]{2,}$/, { each: true }) hosts?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPopular?: boolean;
}

export class OfferInput {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(140) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) terms?: string;
  @ApiProperty({ enum: OfferKind }) @IsEnum(OfferKind) kind: OfferKind;
  @ApiProperty() @IsInt() @Min(0) valueCents: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minSpendCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() issuerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cardId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() merchantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateCardInput extends PartialType(CardInput) {}
export class UpdateCategoryInput extends PartialType(CategoryInput) {}
export class UpdateMerchantInput extends PartialType(MerchantInput) {}
export class UpdateOfferInput extends PartialType(OfferInput) {}

export class RoleInput {
  @ApiProperty({ enum: Role }) @IsEnum(Role) role: Role;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly analytics: AnalyticsService) {}

  /** Adds or corrects one quarter of rotating categories from an issuer's announcement a person has read. Contacts no issuer. */
  async setRotating(actorId: string, dto: RotatingQuarterInput) {
    const result = await applyRotating(this.prisma, [dto]);
    if (result.problems.length) throw new BadRequestException(result.problems.join('; '));
    await this.audit(actorId, 'ROTATING_CATEGORIES', 'Reward', dto.quarter, { cards: dto.cards, categories: dto.categories.map((c) => c.cat), sourceUrl: dto.sourceUrl });
    return result;
  }

  /** The state of the scheduled rotating-category refresh: whether the public-page read is on, when it runs, what it reads. */
  rotatingSettings() {
    return {
      autoFetch: process.env.ROTATING_AUTO_FETCH !== 'false',
      schedule: ROTATING_SCHEDULE,
      override: 'User override of the no-issuer-automation rule, scoped to reading public rotating-category pages (ADR-029).',
      sources: ROTATING_SOURCES.map((s) => ({ cards: s.cards, url: s.url, unreadable: s.unreadable ?? null })),
    };
  }

  async rotatingStatus(now = new Date()) {
    return rotatingCoverage(this.prisma, now);
  }

  private audit(actorId: string, action: string, entity: string, entityId: string, diff?: unknown) {
    return this.prisma.auditLog.create({ data: { actorId, action, entity, entityId, diff: (diff ?? undefined) as object | undefined } });
  }

  async createCard(actor: string, dto: CardInput) {
    const { rewards, ...data } = dto;
    const card = await this.prisma.creditCard.create({
      data: { ...data, rewards: rewards ? { create: rewards.map((r) => ({ ...r, startsAt: r.startsAt ? new Date(r.startsAt) : null, endsAt: r.endsAt ? new Date(r.endsAt) : null })) } : undefined },
      include: { rewards: true },
    });
    await this.audit(actor, 'create', 'CreditCard', card.id, dto);
    return card;
  }

  async updateCard(actor: string, id: string, dto: Partial<CardInput>) {
    const { rewards, ...data } = dto;
    const card = await this.prisma.$transaction(async (tx) => {
      if (rewards) {
        await tx.reward.deleteMany({ where: { cardId: id } });
        await tx.reward.createMany({ data: rewards.map((r) => ({ ...r, cardId: id, startsAt: r.startsAt ? new Date(r.startsAt) : null, endsAt: r.endsAt ? new Date(r.endsAt) : null })) });
      }
      return tx.creditCard.update({ where: { id }, data, include: { rewards: true } });
    });
    await this.audit(actor, 'update', 'CreditCard', id, dto);
    return card;
  }

  async deactivateCard(actor: string, id: string) {
    await this.prisma.creditCard.update({ where: { id }, data: { isActive: false } });
    await this.audit(actor, 'deactivate', 'CreditCard', id);
  }

  async createCategory(actor: string, dto: CategoryInput) {
    const c = await this.prisma.category.create({ data: dto });
    await this.audit(actor, 'create', 'Category', c.id, dto);
    return c;
  }

  async updateCategory(actor: string, id: string, dto: Partial<CategoryInput>) {
    const c = await this.prisma.category.update({ where: { id }, data: dto });
    await this.audit(actor, 'update', 'Category', id, dto);
    return c;
  }

  async createMerchant(actor: string, dto: MerchantInput) {
    const m = await this.prisma.merchant.create({ data: { ...dto, hosts: dto.hosts ?? [] } });
    await this.audit(actor, 'create', 'Merchant', m.id, dto);
    return m;
  }

  async updateMerchant(actor: string, id: string, dto: Partial<MerchantInput>) {
    const m = await this.prisma.merchant.update({ where: { id }, data: dto });
    await this.audit(actor, 'update', 'Merchant', id, dto);
    return m;
  }

  async createOffer(actor: string, dto: OfferInput) {
    const o = await this.prisma.offer.create({ data: { ...dto, startsAt: dto.startsAt ? new Date(dto.startsAt) : null, endsAt: dto.endsAt ? new Date(dto.endsAt) : null } });
    await this.audit(actor, 'create', 'Offer', o.id, dto);
    return o;
  }

  async updateOffer(actor: string, id: string, dto: Partial<OfferInput>) {
    const o = await this.prisma.offer.update({
      where: { id },
      data: { ...dto, startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined, endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined },
    });
    await this.audit(actor, 'update', 'Offer', id, dto);
    return o;
  }

  async deleteOffer(actor: string, id: string) {
    await this.prisma.offer.update({ where: { id }, data: { isActive: false } });
    await this.audit(actor, 'deactivate', 'Offer', id);
  }

  async users(q: PageQuery) {
    const where = q.q ? { email: { contains: q.q, mode: 'insensitive' as const } } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, role: true, createdAt: true, subscription: { select: { plan: true, status: true } }, _count: { select: { transactions: true } } },
        orderBy: { createdAt: 'desc' },
        ...paginate(q),
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async setRole(actor: string, id: string, role: Role) {
    const u = await this.prisma.user.update({ where: { id }, data: { role }, select: { id: true, email: true, role: true } });
    await this.audit(actor, 'set_role', 'User', id, { role });
    return u;
  }

  auditLog(q: PageQuery) {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, include: { actor: { select: { email: true } } }, ...paginate(q) });
  }

  stats() {
    return this.analytics.summary(30);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('stats') stats() { return this.admin.stats(); }
  @Post('rotating-categories') @HttpCode(200) rotating(@CurrentUser() u: AuthUser, @Body() dto: RotatingQuarterInput) { return this.admin.setRotating(u.sub, dto); }
  @Get('rotating-categories') rotatingStatus() { return this.admin.rotatingStatus(); }
  @Get('rotating-categories/settings') rotatingSettings() { return this.admin.rotatingSettings(); }
  @Get('users') users(@Query() q: PageQuery) { return this.admin.users(q); }
  @Patch('users/:id/role') role(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RoleInput) { return this.admin.setRole(u.sub, id, dto.role); }
  @Get('audit') audit(@Query() q: PageQuery) { return this.admin.auditLog(q); }

  @Post('cards') createCard(@CurrentUser() u: AuthUser, @Body() dto: CardInput) { return this.admin.createCard(u.sub, dto); }
  @Patch('cards/:id') updateCard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCardInput) { return this.admin.updateCard(u.sub, id, dto); }
  @Delete('cards/:id') @HttpCode(204) deleteCard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.admin.deactivateCard(u.sub, id); }

  @Post('categories') createCategory(@CurrentUser() u: AuthUser, @Body() dto: CategoryInput) { return this.admin.createCategory(u.sub, dto); }
  @Patch('categories/:id') updateCategory(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryInput) { return this.admin.updateCategory(u.sub, id, dto); }

  @Post('merchants') createMerchant(@CurrentUser() u: AuthUser, @Body() dto: MerchantInput) { return this.admin.createMerchant(u.sub, dto); }
  @Patch('merchants/:id') updateMerchant(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMerchantInput) { return this.admin.updateMerchant(u.sub, id, dto); }

  @Post('offers') createOffer(@CurrentUser() u: AuthUser, @Body() dto: OfferInput) { return this.admin.createOffer(u.sub, dto); }
  @Patch('offers/:id') updateOffer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfferInput) { return this.admin.updateOffer(u.sub, id, dto); }
  @Delete('offers/:id') @HttpCode(204) deleteOffer(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.admin.deleteOffer(u.sub, id); }
}

@Module({ imports: [AnalyticsModule], controllers: [AdminController], providers: [AdminService] })
export class AdminModule {}

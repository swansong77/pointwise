import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { HouseholdsModule } from '../portfolio/households';
import { PortfolioModule } from '../portfolio/portfolio';
import { WalletModule } from '../wallet/wallet.module';
import { StrategyService } from './strategy.service';
import { SmartRecommendationService } from './smart-recommendation.service';
import { BenefitAuditModule } from '../benefit-audit/benefit-audit.module';
import { TermsService } from './terms.service';

const CODE = /^[A-Za-z0-9_]{2,32}$/;

export class ScoreQueryDto {
  @ApiPropertyOptional({ description: 'Household member (default: primary)' }) @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ description: 'Share of card credits you expect to use, 0–1 (default 0.5)' }) @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(1) benefitUseRate?: number;
  @ApiPropertyOptional({ description: 'Cost of using one 5/24 slot, cents (default 15000)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10_000_00) slotValueCents?: number;
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class SpendLineDto {
  @ApiProperty() @IsUUID() categoryId: string;
  @ApiProperty({ description: 'Typical monthly spend in cents' }) @IsInt() @Min(0) @Max(1_000_000_00) monthlyCents: number;
}
export class SpendProfileDto {
  @ApiProperty({ type: [SpendLineDto] }) @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SpendLineDto) lines: SpendLineDto[];
}

export class BalanceDto {
  @ApiProperty() @IsUUID() profileId: string;
  @ApiProperty({ description: 'Reward currency code (e.g. NW_MILES) or loyalty program code (e.g. SKYHIGH)' }) @IsString() @Matches(CODE) code: string;
  @ApiProperty({ description: '0 removes the balance' }) @IsInt() @Min(0) @Max(100_000_000) points: number;
}

export class PlanDto {
  @ApiProperty({ description: 'Loyalty program code' }) @IsString() @Matches(CODE) program: string;
  @ApiProperty({ description: 'Program points the award costs' }) @IsInt() @Min(1) @Max(10_000_000) points: number;
  @ApiPropertyOptional({ description: 'Member who books (default: primary)' }) @IsOptional() @IsUUID() profileId?: string;
}

export class TermsQuery {
  @ApiProperty({ description: 'What to look for, e.g. "lounge access" or "trip delay"' }) @IsString() @MinLength(2) @MaxLength(200) q: string;
  @ApiPropertyOptional({ description: 'Card slug or part of its name' }) @IsOptional() @IsString() @MaxLength(80) card?: string;
  @ApiPropertyOptional({ default: 10 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

export class PartnerQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(CODE) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(CODE) program?: string;
}

export class ProgramDto {
  @ApiProperty() @IsString() @Matches(CODE) code: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiPropertyOptional({ enum: ['AIRLINE', 'HOTEL', 'OTHER'] }) @IsOptional() @IsIn(['AIRLINE', 'HOTEL', 'OTHER']) kind?: 'AIRLINE' | 'HOTEL' | 'OTHER';
  @ApiProperty({ description: 'Valuation, cents per point' }) @IsNumber() @Min(0) @Max(100) centsPerPoint: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() householdPooling?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class PartnerDto {
  @ApiProperty() @IsString() @Matches(CODE) currency: string;
  @ApiProperty() @IsString() @Matches(CODE) program: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(1000) ratioFrom?: number;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) @Max(1000) ratioTo?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(60) transferDays?: number;
  @ApiPropertyOptional({ default: 0 }) @IsOptional() @IsInt() @Min(0) @Max(200) bonusPercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() bonusEndsAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

@ApiTags('recommendations')
@ApiBearerAuth()
@Controller()
export class StrategyController {
  constructor(
    private readonly svc: StrategyService,
    private readonly smart: SmartRecommendationService,
  ) {}

  @Get('me/spend-profile') spend(@CurrentUser() u: AuthUser) {
    return this.svc.spend(u.sub);
  }
  @Put('me/spend-profile') setSpend(@CurrentUser() u: AuthUser, @Body() dto: SpendProfileDto) {
    return this.svc.setSpend(u.sub, dto.lines);
  }
  @Get('recommendations/next-card') nextCard(@CurrentUser() u: AuthUser, @Query() q: ScoreQueryDto) {
    return this.svc.nextCard(u.sub, q);
  }
  /** Next card with goals, velocity, business eligibility, balances, utilization and offer timing; stored for audit. */
  @Get('recommendations/smart') smartNext(@CurrentUser() u: AuthUser, @Query() q: ScoreQueryDto) {
    return this.smart.smart(u.sub, q);
  }
  @Get('recommendations/audit/:id') audit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.smart.audit(u.sub, id);
  }
  @Get('household/next-card') household(@CurrentUser() u: AuthUser, @Query() q: ScoreQueryDto) {
    return this.svc.householdPlan(u.sub, q);
  }
  @Get('recommendations/who-should-apply/:card') who(@CurrentUser() u: AuthUser, @Param('card') card: string, @Query() q: ScoreQueryDto) {
    return this.svc.whoShouldApply(u.sub, card, q);
  }
}

/** Public catalog: transfer partners (no authentication). */
@ApiTags('travel')
@Controller()
export class TransferPartnersController {
  constructor(private readonly svc: StrategyService) {}

  @Public() @Get('transfer-partners') partners(@Query() q: PartnerQuery) {
    return this.svc.partners(q);
  }
}

/** Public catalog: fine-print search over card terms (full-text search, no AI). */
@ApiTags('catalog')
@Controller()
export class CardTermsController {
  constructor(private readonly terms: TermsService) {}

  @Public() @Get('card-terms/search') search(@Query() q: TermsQuery) {
    return this.terms.search(q.q, { card: q.card, limit: q.limit });
  }
}

@ApiTags('travel')
@ApiBearerAuth()
@Controller()
export class TravelController {
  constructor(private readonly svc: StrategyService) {}
  @Get('me/balances') balances(@CurrentUser() u: AuthUser) {
    return this.svc.balances(u.sub);
  }
  @Put('me/balances') setBalance(@CurrentUser() u: AuthUser, @Body() dto: BalanceDto) {
    return this.svc.setBalance(u.sub, dto);
  }
  @Delete('me/balances/:id') @HttpCode(204) deleteBalance(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteBalance(u.sub, id);
  }
  @Get('travel/transfers') transfers(@CurrentUser() u: AuthUser) {
    return this.svc.transfers(u.sub);
  }
  @Post('travel/plan') @HttpCode(200) plan(@CurrentUser() u: AuthUser, @Body() dto: PlanDto) {
    return this.svc.plan(u.sub, dto);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(RolesGuard)
@Controller('admin')
export class TravelAdminController {
  constructor(private readonly svc: StrategyService) {}

  @Get('transfer-partners') list() {
    return this.svc.adminPartners();
  }
  @Put('transfer-partners') upsert(@CurrentUser() u: AuthUser, @Body() dto: PartnerDto) {
    return this.svc.upsertPartner(u.sub, dto);
  }
  @Delete('transfer-partners/:id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deletePartner(u.sub, id);
  }
  @Put('loyalty-programs') program(@CurrentUser() u: AuthUser, @Body() dto: ProgramDto) {
    return this.svc.upsertProgram(u.sub, dto);
  }
}

@Module({ imports: [PortfolioModule, HouseholdsModule, WalletModule, BenefitAuditModule], providers: [StrategyService, TermsService, SmartRecommendationService], exports: [StrategyService, TermsService, SmartRecommendationService] })
export class StrategyCoreModule {}

@Module({ imports: [StrategyCoreModule], controllers: [StrategyController, TransferPartnersController, CardTermsController, TravelController, TravelAdminController] })
export class StrategyModule {}

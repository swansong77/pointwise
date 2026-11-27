import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { CashbackService } from './cashback.service';

const CODE = /^[a-z0-9][a-z0-9-]{1,39}$/;

export class AccountDto {
  @ApiProperty() @IsBoolean() has: boolean;
  @ApiPropertyOptional({ description: 'Which household member has the account (default: you)' }) @IsOptional() @IsUUID() profileId?: string;
}

export class RecommendQuery {
  @ApiProperty({ description: 'merchant id, slug or name' }) @IsString() @MinLength(1) @MaxLength(100) merchant: string;
  @ApiPropertyOptional({ description: 'purchase amount in cents (default $500)' }) @IsOptional() @Type(() => Number) @IsInt() @Min(100) @Max(1_000_000_00) amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) payWith?: string;
}

export class SiteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(60) name?: string;
  @ApiPropertyOptional({ enum: ['CASHBACK', 'POINTS'] }) @IsOptional() @IsIn(['CASHBACK', 'POINTS']) kind?: 'CASHBACK' | 'POINTS';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) homeUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) storeUrlTemplate?: string | null;
  @ApiPropertyOptional({ description: 'what one point is worth, in cents (points sites)' }) @IsOptional() @IsNumber() @Min(0) @Max(100) pointCents?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoRead?: boolean;
}

export class RateDto {
  @ApiProperty() @IsString() @Matches(CODE) site: string;
  @ApiProperty({ description: 'merchant id, slug or name' }) @IsString() @MinLength(1) @MaxLength(100) merchant: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(100) ratePercent?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(200) pointsPerDollar?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() upTo?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) conditions?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) source?: string;
}

export class CsvDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(500_000) csv: string;
}

export class PasteDto {
  @ApiProperty() @IsString() @Matches(CODE) site: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) merchant: string;
  @ApiProperty({ description: 'the text of the site\'s store page' }) @IsString() @MinLength(3) @MaxLength(50_000) text: string;
  @ApiProperty({ description: 'false = only show what was read' }) @IsBoolean() save: boolean;
}

export class CompareDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) merchant: string;
  @ApiProperty({ description: 'the text of a comparison page for one store' }) @IsString() @MinLength(3) @MaxLength(50_000) text: string;
  @ApiProperty({ description: 'false = only show what was read' }) @IsBoolean() save: boolean;
}

export class StatusDto {
  @ApiPropertyOptional({ description: 'one site; omit for all' }) @IsOptional() @IsString() @Matches(CODE) site?: string;
}

export class RatesQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @Matches(CODE) site?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) merchant?: string;
}

@ApiTags('cashback')
@ApiBearerAuth()
@Controller('cashback')
export class CashbackController {
  constructor(private readonly svc: CashbackService) {}

  /** The shopping sites, how each looks right now, and who in the household has an account on it. */
  @Get('sites') sites(@CurrentUser() u: AuthUser) {
    return this.svc.sites(u.sub);
  }
  /** Say that you (or a household member) have or no longer have an account. Never a username or password. */
  @Put('accounts/:site') @HttpCode(204) async account(@CurrentUser() u: AuthUser, @Param('site') site: string, @Body() dto: AccountDto) {
    await this.svc.setAccount(u.sub, site, dto.profileId, dto.has);
  }
  /** Which site to use for a purchase at a merchant. */
  @Get('recommend') recommend(@CurrentUser() u: AuthUser, @Query() q: RecommendQuery) {
    return this.svc.recommendFor(u.sub, q.merchant, q.amount ?? 50_000, q.payWith ?? null);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(RolesGuard)
@Controller('admin/cashback')
export class CashbackAdminController {
  constructor(private readonly svc: CashbackService) {}

  @Get('sites') sites() {
    return this.svc.adminSites();
  }
  @Put('sites/:code') upsertSite(@Param('code') code: string, @Body() dto: SiteDto) {
    if (!CODE.test(code)) throw new BadRequestException('The code is lower-case letters, digits and dashes.');
    return this.svc.upsertSite(code, dto);
  }
  /** Check that a site (or every site) answers. */
  @Post('status') @HttpCode(200) async status(@Body() dto: StatusDto) {
    if (dto.site) return [await this.svc.checkSite(dto.site)];
    await this.svc.checkAll();
    return this.svc.adminSites();
  }
  @Get('rates') rates(@Query() q: RatesQuery) {
    return this.svc.listRates(q);
  }
  @Post('rates') rate(@CurrentUser() u: AuthUser, @Body() dto: RateDto) {
    return this.svc.upsertRate({ ...dto, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null }, u.sub);
  }
  @Delete('rates/:id') @HttpCode(204) removeRate(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteRate(id);
  }
  @Post('rates/import') @HttpCode(200) importCsv(@CurrentUser() u: AuthUser, @Body() dto: CsvDto) {
    return this.svc.importCsv(dto.csv, u.sub);
  }
  @Post('rates/paste') @HttpCode(200) paste(@CurrentUser() u: AuthUser, @Body() dto: PasteDto) {
    return this.svc.pasteRate(dto, u.sub);
  }
  /** One store's comparison page pasted: every known site's rate at once. */
  @Post('rates/compare') @HttpCode(200) compare(@CurrentUser() u: AuthUser, @Body() dto: CompareDto) {
    return this.svc.pasteComparison(dto, u.sub);
  }
}

/** Providers only: the shopping planner, the scheduled status check and the AI tools use these. */
@Module({ providers: [CashbackService], exports: [CashbackService] })
export class CashbackCoreModule {}

@Module({ imports: [CashbackCoreModule], controllers: [CashbackController, CashbackAdminController] })
export class CashbackModule {}

import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Public, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { AiCoreModule } from '../ai/ai.module';
import { NotificationsModule } from '../notifications/notifications.service';
import { CardRefreshService } from './card-refresh.service';
import { OfferMarketService } from './offer-market.service';
import { StrategyCoreModule } from '../strategy/strategy.module';

export class SourceDto {
  @ApiProperty() @IsUUID() cardId: string;
  @ApiProperty({ description: 'https URL on an allow-listed issuer domain' }) @IsString() @MaxLength(1000) url: string;
}
export class SourceUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
export class PasteDto {
  @ApiProperty({ description: 'Text (or HTML) copied from the public product page' }) @IsString() @MinLength(20) @MaxLength(200_000) text: string;
}
export class DecideDto {
  @ApiPropertyOptional({ description: 'Approve with an edited value instead of the proposed one' }) @IsOptional() value?: unknown;
}
export class ProposalQuery {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED'] }) @IsOptional() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() cardId?: string;
}
export class ForceQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() force?: boolean;
}
export class ElevatedQuery {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }) => value === 'true' || value === true) @IsBoolean() elevated?: boolean;
}
export class RetentionDto {
  @ApiProperty() @IsUUID() cardId: string;
  @ApiProperty({ example: '20,000 points after $2,000 spend in 3 months' }) @IsString() @MinLength(3) @MaxLength(200) offer: string;
  @ApiProperty() @IsBoolean() accepted: boolean;
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(RolesGuard)
@Controller('admin')
export class CardRefreshAdminController {
  constructor(private readonly svc: CardRefreshService) {}

  @Get('card-sources') sources(@Query('cardId') cardId?: string) {
    return this.svc.sources(cardId);
  }
  @Post('card-sources') add(@Body() dto: SourceDto) {
    return this.svc.addSource(dto.cardId, dto.url);
  }
  @Patch('card-sources/:id') update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SourceUpdateDto) {
    return this.svc.updateSource(id, dto);
  }
  @Delete('card-sources/:id') @HttpCode(204) remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.removeSource(id);
  }
  @Post('card-sources/:id/refresh') @HttpCode(200) refreshSource(@Param('id', ParseUUIDPipe) id: string, @Query() q: ForceQuery) {
    return this.svc.refreshSource(id, { force: q.force });
  }
  @Post('cards/:id/refresh') @HttpCode(200) refreshCard(@Param('id', ParseUUIDPipe) id: string, @Query() q: ForceQuery) {
    return this.svc.refreshCard(id, { force: q.force });
  }
  @Post('cards/:id/extract') @HttpCode(200) paste(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PasteDto) {
    return this.svc.extractFromText(id, dto.text);
  }
  @Get('card-proposals') proposals(@Query() q: ProposalQuery) {
    return this.svc.proposals(q);
  }
  @Post('card-proposals/:id/approve') @HttpCode(200) approve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DecideDto) {
    return this.svc.decide(id, true, u.sub, dto.value);
  }
  @Post('card-proposals/:id/reject') @HttpCode(200) reject(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.decide(id, false, u.sub);
  }
}

@ApiTags('catalog')
@Controller()
export class CardKnowledgeController {
  constructor(private readonly svc: CardRefreshService) {}

  @Public() @Get('cards/:idOrSlug/offer-history') history(@Param('idOrSlug') id: string) {
    return this.svc.history(id);
  }
  @Public() @Get('welcome-bonuses') welcome(@Query() q: ElevatedQuery) {
    return this.svc.welcomeBonuses(q);
  }
  @Public() @Get('annual-fees') fees() {
    return this.svc.annualFees();
  }
  @ApiBearerAuth() @Get('cards/:idOrSlug/retention-offers') retention(@Param('idOrSlug') id: string) {
    return this.svc.retentionSummary(id);
  }
  @ApiBearerAuth() @Post('me/retention-offers') report(@CurrentUser() u: AuthUser, @Body() dto: RetentionDto) {
    return this.svc.reportRetention(u.sub, dto);
  }
}

/** Shared by API and worker. */
@Module({ imports: [AiCoreModule, NotificationsModule], providers: [CardRefreshService], exports: [CardRefreshService] })
export class CardRefreshCoreModule {}

@ApiTags('offers')
@ApiBearerAuth()
@Controller('offers')
export class OfferMarketController {
  constructor(private readonly market: OfferMarketService) {}

  /** Offer dashboard: history position, expiry advice, difficulty and your first-year / long-term value. */
  @Get('market') get(@CurrentUser() u: AuthUser) {
    return this.market.market(u.sub);
  }
}

@Module({
  imports: [CardRefreshCoreModule, StrategyCoreModule],
  providers: [OfferMarketService],
  controllers: [CardRefreshAdminController, CardKnowledgeController, OfferMarketController],
})
export class CardRefreshModule {}

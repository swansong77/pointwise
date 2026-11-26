import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { OfferSource } from '@prisma/client';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ImportOffersDto, InventoryQuery, PlanPurchaseDto, SetActivationDto } from './offers.dto';
import { OfferAnalysisService } from './offer-analysis.service';
import { OfferIntelService } from './offer-intel.service';

@ApiTags('offer-intelligence')
@ApiBearerAuth()
@Controller('offers/intel')
export class OfferIntelController {
  constructor(
    private readonly intel: OfferIntelService,
    private readonly analysis: OfferAnalysisService,
  ) {}

  @Post('import')
  import(@CurrentUser() u: AuthUser, @Body() dto: ImportOffersDto) {
    return this.intel.importText(u.sub, dto.walletCardId, dto.text);
  }

  @Get('inventory')
  inventory(@CurrentUser() u: AuthUser, @Query() q: InventoryQuery) {
    return this.intel.inventory(u.sub, { walletCardId: q.walletCardId, source: q.source as OfferSource | undefined, activation: q.activation });
  }

  @Get('events')
  events(@CurrentUser() u: AuthUser, @Query('offerId') offerId?: string) {
    return this.intel.events(u.sub, { offerId });
  }

  @Get('activation-queue')
  queue(@CurrentUser() u: AuthUser) {
    return this.intel.activationQueue(u.sub);
  }

  @Post('activation/:id')
  activation(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetActivationDto) {
    return this.intel.setActivation(u.sub, id, dto.status, dto.note);
  }

  @Get('opportunities')
  opportunities(@CurrentUser() u: AuthUser) {
    return this.analysis.opportunities(u.sub);
  }

  @Get('missed')
  missed(@CurrentUser() u: AuthUser) {
    return this.analysis.missed(u.sub);
  }

  @Get('merchants/:slug/timeline')
  timeline(@Param('slug') slug: string) {
    return this.analysis.timeline(slug);
  }

  @Post('plan')
  plan(@CurrentUser() u: AuthUser, @Body() dto: PlanPurchaseDto) {
    if (!dto.merchantId && !dto.merchantText) throw new BadRequestException('merchantId or merchantText is required');
    return this.analysis.plan(u.sub, dto);
  }

  @Get('planned')
  planned(@CurrentUser() u: AuthUser) {
    return this.analysis.planned(u.sub);
  }

  @Delete('planned/:id')
  @HttpCode(204)
  removePlanned(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.analysis.removePlanned(u.sub, id);
  }
}

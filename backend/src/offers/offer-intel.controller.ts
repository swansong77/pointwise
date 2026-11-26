import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { OfferSource } from '@prisma/client';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators';
import { ImportOffersDto, InventoryQuery, OfferInventoryQuery, PlanPurchaseDto, SetActivationDto, UpdatePlannedDto } from './offers.dto';
import { LIFECYCLE_STATES, LifecycleState } from '../domain/offer-lifecycle';
import { OfferInventoryService } from './offer-inventory.service';
import { OfferDashboardsService } from './offer-dashboards.service';
import { OfferAnalysisService } from './offer-analysis.service';
import { OfferIntelService } from './offer-intel.service';

@ApiTags('offer-intelligence')
@ApiBearerAuth()
@Controller('offers/intel')
export class OfferIntelController {
  constructor(
    private readonly intel: OfferIntelService,
    private readonly analysis: OfferAnalysisService,
    private readonly inventoryAll: OfferInventoryService,
    private readonly dashboards: OfferDashboardsService,
  ) {}

  @Post('import')
  import(@CurrentUser() u: AuthUser, @Body() dto: ImportOffersDto) {
    return this.intel.importText(u.sub, dto.walletCardId, dto.text);
  }

  @Get('inventory')
  inventory(@CurrentUser() u: AuthUser, @Query() q: InventoryQuery) {
    return this.intel.inventory(u.sub, { walletCardId: q.walletCardId, source: q.source as OfferSource | undefined, activation: q.activation });
  }

  /** Every offer in the household (on cards and found by syncs) with one lifecycle, searchable and filterable. */
  @Get('inventory/unified')
  unified(@CurrentUser() u: AuthUser, @Query() q: OfferInventoryQuery) {
    const states = q.states ? (q.states.split(',').map((x) => x.trim().toUpperCase()).filter((x): x is LifecycleState => (LIFECYCLE_STATES as string[]).includes(x))) : undefined;
    return this.inventoryAll.list(u.sub, { ...q, states });
  }

  /** One card: details, benefits and credits, certificates, offers by lifecycle, missed offers, savings. */
  @Get('cards/:walletCardId')
  cardDetail(@CurrentUser() u: AuthUser, @Param('walletCardId', ParseUUIDPipe) walletCardId: string) {
    return this.inventoryAll.cardDetail(u.sub, walletCardId);
  }

  /** Offers, credits and certificates about to lapse, in buckets, with what is lost if each is missed. */
  @Get('expirations')
  expirations(@CurrentUser() u: AuthUser) {
    return this.dashboards.expirations(u.sub);
  }

  /** Savings received and expected, by card, member, merchant and month; finished plans against what they expected. */
  @Get('savings')
  savings(@CurrentUser() u: AuthUser) {
    return this.dashboards.savings(u.sub);
  }

  /** Each member's offers, offers on several cards, and who should pay at each merchant. */
  @Get('household')
  household(@CurrentUser() u: AuthUser) {
    return this.dashboards.household(u.sub);
  }

  /** One merchant in depth. */
  @Get('merchants/:slug/dashboard')
  merchantDashboard(@CurrentUser() u: AuthUser, @Param('slug') slug: string) {
    return this.dashboards.merchant(u.sub, slug);
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
    if (!dto.merchantId && !dto.merchantText && !dto.item && !dto.category) throw new BadRequestException('merchantId, merchantText, item or category is required');
    return this.analysis.plan(u.sub, dto);
  }

  @Get('planned')
  planned(@CurrentUser() u: AuthUser) {
    return this.analysis.planned(u.sub);
  }

  @Patch('planned/:id')
  updatePlanned(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlannedDto) {
    return this.analysis.updatePlanned(u.sub, id, dto);
  }

  @Delete('planned/:id')
  @HttpCode(204)
  removePlanned(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.analysis.removePlanned(u.sub, id);
  }
}

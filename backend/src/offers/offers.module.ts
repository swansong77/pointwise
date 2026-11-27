import { CashbackCoreModule } from '../cashback/cashback.module';
import { Module } from '@nestjs/common';
import { OfferCoreModule } from './offer-jobs.service';
import { OfferAnalysisService } from './offer-analysis.service';
import { BenefitsModule } from '../portfolio/benefits';
import { OfferInventoryService } from './offer-inventory.service';
import { OfferDashboardsService } from './offer-dashboards.service';
import { OfferIntelController } from './offer-intel.controller';
import { OfferIntelService } from './offer-intel.service';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({ imports: [OfferCoreModule, BenefitsModule, CashbackCoreModule], controllers: [OffersController, OfferIntelController], providers: [OffersService, OfferIntelService, OfferAnalysisService, OfferInventoryService, OfferDashboardsService], exports: [OffersService, OfferIntelService, OfferAnalysisService, OfferInventoryService, OfferDashboardsService] })
export class OffersModule {}

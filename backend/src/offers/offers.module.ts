import { Module } from '@nestjs/common';
import { OfferCoreModule } from './offer-jobs.service';
import { OfferAnalysisService } from './offer-analysis.service';
import { OfferIntelController } from './offer-intel.controller';
import { OfferIntelService } from './offer-intel.service';
import { OffersController } from './offers.controller';
import { OffersService } from './offers.service';

@Module({ imports: [OfferCoreModule], controllers: [OffersController, OfferIntelController], providers: [OffersService, OfferIntelService, OfferAnalysisService], exports: [OffersService, OfferIntelService, OfferAnalysisService] })
export class OffersModule {}

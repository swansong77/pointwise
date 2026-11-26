import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ClientIpThrottlerGuard } from './common/throttler.guard';
import { PrismaModule } from './common/prisma.service';
import { JwtAuthGuard } from './common/guards';
import { AuthModule } from './auth/auth.module';
import { MailModule } from './jobs/mail.service';
import { CatalogModule } from './catalog/catalog.module';
import { WalletModule } from './wallet/wallet.module';
import { OffersModule } from './offers/offers.module';
import { RecommendationsModule } from './recommendations/recommendations.module';
import { CalculatorModule } from './calculator/calculator.controller';
import { NearbyModule } from './nearby/nearby.service';
import { InsightsModule } from './insights/insights.service';
import { NotificationsModule } from './notifications/notifications.service';
import { SubscriptionsModule } from './subscriptions/subscriptions.service';
import { TransactionsModule } from './transactions/transactions.service';
import { UsersModule } from './users/users.service';
import { AnalyticsModule } from './analytics/analytics.service';
import { AdminModule } from './admin/admin.controller';
import { HealthModule } from './health/health.controller';
import { JobsApiModule } from './jobs/jobs.module';
import { HouseholdsModule } from './portfolio/households';
import { BenefitsModule } from './portfolio/benefits';
import { PortfolioModule } from './portfolio/portfolio';
import { ImportsModule } from './portfolio/imports';
import { ConnectionsModule } from './portfolio/connections';
import { CreditReportsModule } from './portfolio/credit-reports';
import { DeliveryModule } from './notifications/delivery';
import { AiModule } from './ai/ai.module';
import { CardRefreshModule } from './catalog-refresh/card-refresh.module';
import { StrategyModule } from './strategy/strategy.module';
import { CardResearchModule } from './catalog-research/card-research.module';
import { SpendModule } from './spend/spend.module';
import { BenefitAuditModule } from './benefit-audit/benefit-audit.module';
import { LoyaltyModule } from './loyalty/loyalty.module';
import { LoyaltyAutomationModule } from './loyalty/loyalty-automation.module';
import { MailboxModule } from './mailbox/mailbox.module';
import { CaptureModule } from './capture/capture.module';
import { OpsModule } from './ops/ops.module';
import { OfferAutomationModule } from './offer-automation/offer-automation.module';

const rateLimit = Number(process.env.RATE_LIMIT_PER_MIN ?? 100);

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: rateLimit }]),
    PrismaModule,
    MailModule,
    AuthModule,
    CatalogModule,
    WalletModule,
    RecommendationsModule,
    OffersModule,
    CalculatorModule,
    NearbyModule,
    InsightsModule,
    NotificationsModule,
    SubscriptionsModule,
    TransactionsModule,
    UsersModule,
    AnalyticsModule,
    AdminModule,
    HealthModule,
    JobsApiModule,
    HouseholdsModule,
    BenefitsModule,
    PortfolioModule,
    ImportsModule,
    ConnectionsModule,
    CreditReportsModule,
    DeliveryModule,
    AiModule,
    CardRefreshModule,
    StrategyModule,
    CardResearchModule,
    SpendModule,
    BenefitAuditModule,
    LoyaltyModule,
    LoyaltyAutomationModule,
    MailboxModule,
    CaptureModule,
    OpsModule,
    OfferAutomationModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}

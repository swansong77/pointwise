import { Controller, Get, Injectable, Module } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { RecommendationsService } from '../recommendations/recommendations.service';
import { bonusProgress, fiveTwentyFour, upcomingRenewals } from '../domain/insights';
import { isExpiringSoon, remainingCents } from '../domain/offers';
import { effectivePlan } from '../domain/entitlements';

@Injectable()
export class InsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly recs: RecommendationsService,
  ) {}

  async dashboard(userId: string, now = new Date()) {
    const [cards, prefs, userOffers, bestByCategory, sub, unread] = await Promise.all([
      this.wallet.domainCards(userId),
      this.prisma.notificationPreference.findUnique({ where: { userId } }),
      this.prisma.userOffer.findMany({
        where: { walletCard: { wallet: { userId } } },
        include: { offer: true, walletCard: { include: { card: { select: { name: true, color: true } } } } },
      }),
      this.recs.allCategories(userId),
      this.prisma.subscription.findUnique({ where: { userId } }),
      this.prisma.notification.count({ where: { userId, readAt: null, deferredAt: null } }),
    ]);
    const expiringDays = prefs?.expiringDays ?? 7;
    const expiring = userOffers
      .filter((uo) => isExpiringSoon(uo.offer, uo, now, expiringDays))
      .sort((a, b) => (a.offer.endsAt?.getTime() ?? 0) - (b.offer.endsAt?.getTime() ?? 0))
      .slice(0, 10);
    const active = userOffers.filter((uo) => uo.status === 'ACTIVE' && (!uo.offer.endsAt || uo.offer.endsAt >= now));
    const redeemed = userOffers.filter((uo) => uo.status === 'REDEEMED');
    return {
      plan: effectivePlan(sub, now),
      unreadNotifications: unread,
      stats: {
        cards: cards.filter((c) => c.status === 'APPROVED').length,
        activeOffers: active.length,
        availableOfferValueCents: active.reduce((s, uo) => s + remainingCents(uo.offer, uo), 0),
        redeemedValueCents: redeemed.reduce((s, uo) => s + (uo.amountUsedCents || uo.offer.valueCents), 0),
      },
      bestByCategory,
      expiringOffers: expiring,
      renewals: upcomingRenewals(cards, now, 60),
      bonuses: bonusProgress(cards, now),
      fiveTwentyFour: fiveTwentyFour(cards, now),
    };
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get()
  dashboard(@CurrentUser() u: AuthUser) {
    return this.insights.dashboard(u.sub);
  }
}

@Module({ controllers: [InsightsController], providers: [InsightsService] })
export class InsightsModule {}

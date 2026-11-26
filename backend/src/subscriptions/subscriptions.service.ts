import { BadRequestException, Body, Controller, Get, Injectable, Module, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { BillingInterval, effectivePlan, limitsFor, periodEndFor, PRICES } from '../domain/entitlements';

export class CheckoutDto {
  @ApiProperty({ enum: ['month', 'year', 'lifetime'] }) @IsIn(['month', 'year', 'lifetime'])
  interval: BillingInterval;
}

/**
 * Billing provider abstraction. `mock` (default for dev/test) activates immediately.
 * A Stripe provider would create a Checkout Session and activate via webhook instead.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private get provider(): string {
    return this.config.get('BILLING_PROVIDER') ?? 'mock';
  }

  async get(userId: string) {
    const sub = await this.prisma.subscription.upsert({ where: { userId }, update: {}, create: { userId } });
    return { ...sub, effectivePlan: effectivePlan(sub), limits: limitsFor(sub), prices: PRICES };
  }

  async checkout(userId: string, interval: BillingInterval) {
    if (this.provider !== 'mock') {
      throw new BadRequestException(`Billing provider "${this.provider}" is not configured in this build`);
    }
    const now = new Date();
    const trial = interval === 'year' ? PRICES.year.trialDays : 0;
    await this.prisma.subscription.upsert({
      where: { userId },
      update: {
        plan: 'PRO', status: trial ? 'TRIALING' : 'ACTIVE', interval, provider: 'mock',
        currentPeriodEnd: periodEndFor(interval, now), cancelAtPeriodEnd: false,
      },
      create: { userId, plan: 'PRO', status: trial ? 'TRIALING' : 'ACTIVE', interval, provider: 'mock', currentPeriodEnd: periodEndFor(interval, now) },
    });
    await this.prisma.analyticsEvent.create({ data: { userId, name: 'subscription_started', properties: { interval } } });
    return this.get(userId);
  }

  /** Cancel at period end; lifetime purchases cannot be canceled. */
  async cancel(userId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!sub || sub.plan !== 'PRO') throw new BadRequestException('No active subscription');
    if (sub.interval === 'lifetime') throw new BadRequestException('Lifetime purchases cannot be canceled');
    await this.prisma.subscription.update({ where: { userId }, data: { status: 'CANCELED', cancelAtPeriodEnd: true } });
    await this.prisma.analyticsEvent.create({ data: { userId, name: 'subscription_canceled', properties: {} } });
    return this.get(userId);
  }

  async resume(userId: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!sub || sub.status !== 'CANCELED' || !sub.currentPeriodEnd || sub.currentPeriodEnd < new Date()) {
      throw new BadRequestException('Nothing to resume');
    }
    await this.prisma.subscription.update({ where: { userId }, data: { status: 'ACTIVE', cancelAtPeriodEnd: false } });
    return this.get(userId);
  }
}

@ApiTags('subscription')
@ApiBearerAuth()
@Controller('subscription')
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Public()
  @Get('plans')
  plans() {
    return PRICES;
  }

  @Get()
  get(@CurrentUser() u: AuthUser) {
    return this.subs.get(u.sub);
  }

  @Post('checkout')
  checkout(@CurrentUser() u: AuthUser, @Body() dto: CheckoutDto) {
    return this.subs.checkout(u.sub, dto.interval);
  }

  @Post('cancel')
  cancel(@CurrentUser() u: AuthUser) {
    return this.subs.cancel(u.sub);
  }

  @Post('resume')
  resume(@CurrentUser() u: AuthUser) {
    return this.subs.resume(u.sub);
  }
}

@Module({ controllers: [SubscriptionsController], providers: [SubscriptionsService], exports: [SubscriptionsService] })
export class SubscriptionsModule {}

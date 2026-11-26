import { Body, Controller, HttpCode, Injectable, Module, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, Matches } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

export class TrackDto {
  @ApiProperty({ example: 'page_viewed' }) @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  name: string;

  @ApiPropertyOptional() @IsOptional() @IsObject()
  properties?: Record<string, unknown>;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async track(userId: string | null, dto: TrackDto) {
    const props = JSON.stringify(dto.properties ?? {});
    // Bound payload size to keep the events table small.
    const properties = props.length > 2000 ? { truncated: true } : (dto.properties ?? {});
    await this.prisma.analyticsEvent.create({ data: { userId, name: dto.name, properties: properties as object } });
  }

  async summary(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const [users, newUsers, pro, events, topEvents] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
      this.prisma.subscription.count({ where: { plan: 'PRO', status: { in: ['ACTIVE', 'TRIALING'] } } }),
      this.prisma.analyticsEvent.count({ where: { createdAt: { gte: since } } }),
      this.prisma.analyticsEvent.groupBy({ by: ['name'], where: { createdAt: { gte: since } }, _count: { name: true }, orderBy: { _count: { name: 'desc' } }, take: 10 }),
    ]);
    return { days, users, newUsers, proSubscribers: pro, events, topEvents: topEvents.map((e) => ({ name: e.name, count: e._count.name })) };
  }
}

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly a: AnalyticsService) {}

  @Post('events')
  @HttpCode(202)
  track(@CurrentUser() u: AuthUser, @Body() dto: TrackDto) {
    return this.a.track(u.sub, dto);
  }
}

@Module({ controllers: [AnalyticsController], providers: [AnalyticsService], exports: [AnalyticsService] })
export class AnalyticsModule {}

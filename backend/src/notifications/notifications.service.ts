import { Body, Controller, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationType } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

export class PreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offerExpiring?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cardRenewal?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bonusDeadline?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offerAlerts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emailDigest?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(60) expiringDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() benefitExpiring?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() benefitEmail?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() benefitPush?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() transferBonuses?: boolean;
}

export class ListQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() unreadOnly?: boolean;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 50;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, q: ListQuery) {
    return this.prisma.notification.findMany({
      where: { userId, ...(q.unreadOnly && { readAt: null }) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
    if (res.count === 0) throw new NotFoundException('Notification not found');
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }

  /** Idempotent create: (userId, dedupeKey) is unique so scheduled jobs can re-run safely. */
  async notify(userId: string, type: NotificationType, title: string, body: string, link?: string, dedupeKey?: string) {
    if (dedupeKey) {
      return this.prisma.notification.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey } },
        update: {},
        create: { userId, type, title, body, link, dedupeKey },
      });
    }
    return this.prisma.notification.create({ data: { userId, type, title, body, link } });
  }

  async preferences(userId: string) {
    return this.prisma.notificationPreference.upsert({ where: { userId }, update: {}, create: { userId } });
  }

  async updatePreferences(userId: string, dto: PreferencesDto) {
    return this.prisma.notificationPreference.upsert({ where: { userId }, update: dto, create: { userId, ...dto } });
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly n: NotificationsService) {}

  @Get()
  list(@CurrentUser() u: AuthUser, @Query() q: ListQuery) {
    return this.n.list(u.sub, q);
  }

  @Get('unread-count')
  async unread(@CurrentUser() u: AuthUser) {
    return { count: await this.n.unreadCount(u.sub) };
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.n.markRead(u.sub, id);
  }

  @Post('read-all')
  @HttpCode(204)
  readAll(@CurrentUser() u: AuthUser) {
    return this.n.markAllRead(u.sub);
  }

  @Get('preferences')
  prefs(@CurrentUser() u: AuthUser) {
    return this.n.preferences(u.sub);
  }

  @Put('preferences')
  updatePrefs(@CurrentUser() u: AuthUser, @Body() dto: PreferencesDto) {
    return this.n.updatePreferences(u.sub, dto);
  }
}

@Module({ controllers: [NotificationsController], providers: [NotificationsService], exports: [NotificationsService] })
export class NotificationsModule {}

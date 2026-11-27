import { Body, Controller, Get, HttpCode, Injectable, Logger, Module, NotFoundException, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { NotificationType } from '@prisma/client';
import { isCritical } from '../domain/notification-severity';
import { MEMBER_HOME, memberWants } from '../domain/member-access';
import { AuthUser, CurrentUser, MemberSafe } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';

export class PreferencesDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offerExpiring?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() cardRenewal?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bonusDeadline?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() offerAlerts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() emailDigest?: boolean;
  @ApiPropertyOptional({ description: 'A household member: send me my own daily briefing (only when there is something to say)' }) @IsOptional() @IsBoolean() briefingDaily?: boolean;
  @ApiPropertyOptional({ description: 'A household member: send me my own weekly briefing' }) @IsOptional() @IsBoolean() briefingWeekly?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(60) expiringDays?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() benefitExpiring?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() benefitEmail?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() benefitPush?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() transferBonuses?: boolean;
  @ApiPropertyOptional({ description: 'hold non-critical notifications for the executive briefing' }) @IsOptional() @IsBoolean() quietMode?: boolean;
}

export class ListQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Boolean) @IsBoolean() unreadOnly?: boolean;
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 50;
  @ApiPropertyOptional({ description: 'also list notifications held by Quiet Mode' }) @IsOptional() @Type(() => Boolean) @IsBoolean() includeDeferred?: boolean;
}

@Injectable()
export class NotificationsService {
  private readonly log = new Logger(NotificationsService.name);
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, q: ListQuery) {
    return this.prisma.notification.findMany({
      where: { userId, ...(q.unreadOnly && { readAt: null }), ...(!q.includeDeferred && { deferredAt: null }) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null, deferredAt: null } });
  }

  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
    if (res.count === 0) throw new NotFoundException('Notification not found');
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }

  /**
   * Idempotent create: (userId, dedupeKey) is unique so scheduled jobs can re-run safely.
   *
   * With Quiet Mode on, a notification that is not critical (see `notification-severity.ts`) is stored as held: it is not counted as
   * unread, not e-mailed, and the executive briefing reports it. Critical ones, reminders and the briefings themselves go out at once.
   */
  async notify(userId: string, type: NotificationType, title: string, body: string, link?: string, dedupeKey?: string, opts: { profileId?: string | null } = {}) {
    if (!opts.profileId) return this.store(userId, type, title, body, link, dedupeKey);
    // an item that concerns one household member also goes to that member's own sign-in, if they have one
    const p = await this.prisma.profile.findUnique({ where: { id: opts.profileId }, select: { loginUserId: true, notifyOwner: true } });
    // the owner can stop hearing about a member who has their own sign-in; the member still does
    const row = p && p.loginUserId && !p.notifyOwner ? null : await this.store(userId, type, title, body, link, dedupeKey);
    if (p?.loginUserId) await this.toMember(p.loginUserId, type, title, body, dedupeKey);
    return row;
  }

  /**
   * The member's own copy of a household notification. It follows THEIR preferences (a kind they switched off is not sent) and THEIR Quiet
   * Mode, points at their own view, and never stops the owner's notification if anything goes wrong here.
   */
  private async toMember(memberUserId: string, type: NotificationType, title: string, body: string, dedupeKey?: string) {
    try {
      const prefs = await this.prisma.notificationPreference.findUnique({ where: { userId: memberUserId } });
      if (!memberWants(type, prefs)) return;
      await this.store(memberUserId, type, title, body, MEMBER_HOME, dedupeKey ? `m:${dedupeKey}` : undefined);
    } catch (e) {
      this.log.warn(`member copy of ${type} not delivered: ${(e as Error).message}`);
    }
  }

  private async store(userId: string, type: NotificationType, title: string, body: string, link?: string, dedupeKey?: string) {
    const deferredAt = !isCritical(type) && (await this.quiet(userId)) ? new Date() : null;
    if (dedupeKey) {
      return this.prisma.notification.upsert({
        where: { userId_dedupeKey: { userId, dedupeKey } },
        update: {},
        create: { userId, type, title, body, link, dedupeKey, deferredAt },
      });
    }
    return this.prisma.notification.create({ data: { userId, type, title, body, link, deferredAt } });
  }

  private async quiet(userId: string): Promise<boolean> {
    return !!(await this.prisma.notificationPreference.findUnique({ where: { userId }, select: { quietMode: true } }))?.quietMode;
  }

  /** What Quiet Mode is holding for the member: counts by type, newest first. Used by the executive briefing. */
  async held(userId: string, since: Date) {
    const rows = await this.prisma.notification.findMany({ where: { userId, deferredAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: 500, select: { type: true, title: true } });
    const byType = new Map<NotificationType, number>();
    for (const r of rows) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    return { total: rows.length, byType: [...byType.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count), sample: rows.slice(0, 3).map((r) => r.title) };
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
// a household member has their own notifications, preferences and push subscriptions (their own user id)
@MemberSafe()
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

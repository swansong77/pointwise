import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { checkReminder, MAX_PENDING_REMINDERS } from '../domain/reminders';
import { NotificationsModule, NotificationsService } from '../notifications/notifications.service';

export class ReminderDto {
  @ApiProperty() @IsString() @MaxLength(400) title: string;
  @ApiProperty({ description: 'ISO date-time' }) @IsString() @MaxLength(40) dueAt: string;
  @ApiPropertyOptional({ description: 'a page inside PointWise, such as /offers/expirations' }) @IsOptional() @IsString() @MaxLength(300) link?: string;
}

/** Reminders the member set. When one falls due the daily job turns it into a notification. */
@Injectable()
export class RemindersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  list(userId: string, status: 'PENDING' | 'SENT' | 'ALL' = 'PENDING') {
    return this.prisma.reminder.findMany({
      where: { userId, ...(status === 'ALL' ? { status: { not: 'DISMISSED' } } : { status }) },
      orderBy: { dueAt: 'asc' },
      take: 200,
    });
  }

  async create(userId: string, dto: ReminderDto, source = 'MANUAL', now = new Date()) {
    const c = checkReminder(dto, now);
    if (!c.ok) throw new BadRequestException(c.error);
    // the same reminder asked for twice is one reminder
    const same = await this.prisma.reminder.findFirst({ where: { userId, title: c.title, dueAt: c.dueAt, status: 'PENDING' } });
    if (same) return same;
    const pending = await this.prisma.reminder.count({ where: { userId, status: 'PENDING' } });
    if (pending >= MAX_PENDING_REMINDERS) throw new BadRequestException(`You can have up to ${MAX_PENDING_REMINDERS} pending reminders. Dismiss some first.`);
    return this.prisma.reminder.create({ data: { userId, title: c.title, dueAt: c.dueAt, link: c.link, source } });
  }

  async remove(userId: string, id: string) {
    const r = await this.prisma.reminder.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Reminder not found');
  }

  /** Daily job: notifies for every pending reminder that is due. Safe to run twice (the notification key is the reminder id). */
  async dispatchDue(now: Date): Promise<number> {
    const due = await this.prisma.reminder.findMany({ where: { status: 'PENDING', dueAt: { lte: now } }, orderBy: { dueAt: 'asc' }, take: 500 });
    let n = 0;
    for (const r of due) {
      await this.notifications.notify(r.userId, 'REMINDER', 'Reminder', r.title, r.link ?? undefined, 'reminder:' + r.id);
      await this.prisma.reminder.update({ where: { id: r.id }, data: { status: 'SENT', sentAt: now } });
      n++;
    }
    return n;
  }
}

@ApiTags('reminders')
@ApiBearerAuth()
@Controller('reminders')
export class RemindersController {
  constructor(private readonly svc: RemindersService) {}
  @Get() list(@CurrentUser() u: AuthUser, @Query('status') status?: string) {
    return this.svc.list(u.sub, status === 'SENT' || status === 'ALL' ? status : 'PENDING');
  }
  @Post() create(@CurrentUser() u: AuthUser, @Body() dto: ReminderDto) {
    return this.svc.create(u.sub, dto, 'SEARCH');
  }
  @Delete(':id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(u.sub, id);
  }
}

/** the service alone, for the job worker */
@Module({ imports: [NotificationsModule], providers: [RemindersService], exports: [RemindersService] })
export class RemindersCoreModule {}

@Module({ imports: [RemindersCoreModule], controllers: [RemindersController] })
export class RemindersModule {}

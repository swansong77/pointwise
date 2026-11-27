import { BullModule, InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Module,
  Optional,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { Job, Queue } from 'bullmq';
import { AuthUser, CurrentUser, MemberSafe } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { MailService } from '../jobs/mail.service';

export const NOTIFY_QUEUE = 'pointwise-notifications';

export interface DeliveryJob {
  benefitNotificationId?: string;
  userId: string;
  channel: 'EMAIL' | 'PUSH';
  title: string;
  body: string;
  link?: string;
}

/**
 * Push endpoints are URLs chosen by the browser — and the server POSTs to them. To prevent SSRF,
 * only the public push services of the major browsers are accepted.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

class PushKeysDto {
  @ApiProperty() @IsString() @MaxLength(200) p256dh: string;
  @ApiProperty() @IsString() @MaxLength(100) auth: string;
}
export class PushSubscriptionDto {
  @ApiProperty() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(600) endpoint: string;
  @ApiProperty({ type: PushKeysDto }) @ValidateNested() @Type(() => PushKeysDto) keys: PushKeysDto;
}
export class PushUnsubscribeDto {
  @ApiProperty() @IsString() @MaxLength(600) endpoint: string;
}

type WebPush = typeof import('web-push');

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly webpush: WebPush | null;
  readonly publicKey: string | null;

  constructor(private readonly prisma: PrismaService) {
    const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv, VAPID_SUBJECT: subject } = process.env;
    if (pub && priv) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const wp = require('web-push') as WebPush;
      wp.setVapidDetails(subject ?? 'mailto:alerts@pointwise.local', pub, priv);
      this.webpush = wp;
      this.publicKey = pub;
    } else {
      this.webpush = null;
      this.publicKey = null;
    }
  }

  async subscribe(userId: string, dto: PushSubscriptionDto) {
    if (!this.publicKey) throw new BadRequestException('Push notifications are not configured on this server');
    if (!isAllowedPushEndpoint(dto.endpoint)) throw new BadRequestException('Unsupported push service');
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
      create: { userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
    });
    await this.prisma.notificationPreference.upsert({ where: { userId }, update: { benefitPush: true }, create: { userId, benefitPush: true } });
    return { subscribed: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /** Send to every subscription of the user; expired subscriptions (404/410) are removed. */
  async send(userId: string, payload: { title: string; body: string; link?: string }): Promise<boolean> {
    if (!this.webpush) return false;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    let ok = false;
    for (const s of subs) {
      if (!isAllowedPushEndpoint(s.endpoint)) continue;
      try {
        await this.webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 86_400 });
        ok = true;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
        else this.logger.warn(`push to ${new URL(s.endpoint).hostname} failed: ${status ?? (e as Error).message}`);
      }
    }
    return ok;
  }
}

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly push: PushService,
  ) {}

  async deliver(job: DeliveryJob): Promise<boolean> {
    let ok = false;
    if (job.channel === 'EMAIL') {
      const user = await this.prisma.user.findUnique({ where: { id: job.userId }, select: { email: true, deletedAt: true } });
      if (user && !user.deletedAt) {
        const link = job.link ? `\n\nOpen: ${(process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '')}${job.link}` : '';
        ok = await this.mail.send(user.email, `PointWise: ${job.title}`, `${job.body}${link}`);
      }
    } else {
      ok = await this.push.send(job.userId, { title: job.title, body: job.body, link: job.link });
    }
    if (job.benefitNotificationId) {
      await this.prisma.benefitNotification.update({ where: { id: job.benefitNotificationId }, data: { success: ok } }).catch(() => undefined);
    }
    if (!ok) this.logger.warn(`${job.channel} delivery to ${job.userId} not sent`);
    return ok;
  }
}

/** Enqueue side (API + worker). Falls back to inline delivery when no queue is registered (tests). */
@Injectable()
export class NotificationDispatcher {
  constructor(
    private readonly delivery: DeliveryService,
    @Optional() @InjectQueue(NOTIFY_QUEUE) private readonly queue?: Queue,
  ) {}

  async dispatch(job: DeliveryJob): Promise<void> {
    if (this.queue) {
      await this.queue.add('deliver', job, { attempts: 3, backoff: { type: 'exponential', delay: 30_000 }, removeOnComplete: 500, removeOnFail: 1000 });
    } else {
      await this.delivery.deliver(job);
    }
  }
}

/** Consumer — runs only in the notification-service process. */
@Processor(NOTIFY_QUEUE)
export class DeliveryProcessor extends WorkerHost {
  constructor(private readonly delivery: DeliveryService) {
    super();
  }
  async process(job: Job<DeliveryJob>): Promise<boolean> {
    const ok = await this.delivery.deliver(job.data);
    // email failures are retried by BullMQ (attempts: 3); push "no subscriptions" is not an error
    if (!ok && job.data.channel === 'EMAIL') throw new Error('email not sent');
    return ok;
  }
}

@ApiTags('notifications')
@ApiBearerAuth()
@MemberSafe()
@Controller('notifications/push')
export class PushController {
  constructor(private readonly push: PushService) {}

  @Get('key') key() {
    return { publicKey: this.push.publicKey };
  }
  @Post('subscriptions') subscribe(@CurrentUser() u: AuthUser, @Body() dto: PushSubscriptionDto) {
    return this.push.subscribe(u.sub, dto);
  }
  @Delete('subscriptions') @HttpCode(204) unsubscribe(@CurrentUser() u: AuthUser, @Body() dto: PushUnsubscribeDto) {
    return this.push.unsubscribe(u.sub, dto.endpoint);
  }
}

/** API + worker: push endpoints and the enqueueing dispatcher. */
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFY_QUEUE })],
  controllers: [PushController],
  providers: [PushService, DeliveryService, NotificationDispatcher],
  exports: [NotificationDispatcher, PushService, DeliveryService],
})
export class DeliveryModule {}

/** notification-service process: consumes the queue. */
@Module({
  imports: [BullModule.registerQueue({ name: NOTIFY_QUEUE })],
  providers: [PushService, DeliveryService, DeliveryProcessor],
})
export class DeliveryWorkerModule {}

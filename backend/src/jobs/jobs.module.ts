import { BullModule, InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { OfferAutomationCoreModule } from '../offer-automation/offer-automation.module';
import { DataJobsModule } from '../data/data.module';
import {
  Controller,
  HttpCode,
  Injectable,
  Logger,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Param,
  ParseEnumPipe,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Job, Queue } from "bullmq";
import { Roles } from "../common/decorators";
import { RolesGuard } from "../common/guards";
import { NotificationsModule } from "../notifications/notifications.service";
import { DeliveryModule } from "../notifications/delivery";
import { PortfolioModule } from "../portfolio/portfolio";
import { ConnectionsModule } from "../portfolio/connections";
import { AiCoreModule } from "../ai/ai.module";
import { MailboxCoreModule } from "../mailbox/mailbox.module";
import { OfferCoreModule } from "../offers/offer-jobs.service";
import { LoyaltyCoreModule } from "../loyalty/loyalty.module";
import { LoyaltyAutomationCoreModule } from "../loyalty/loyalty-automation.module";
import { CardRefreshCoreModule } from "../catalog-refresh/card-refresh.module";
import { CardResearchCoreModule } from "../catalog-research/card-research.module";
import { JOB_NAMES, JOB_QUEUE, JobName, JobsService } from "./jobs.service";

/** Cron schedule (UTC). */
export const SCHEDULE: Record<JobName, string> = {
  "expire-offers": "5 0 * * *",
  "scan-expiring-offers": "0 13 * * *",
  "scan-renewals": "10 13 * * *",
  "scan-bonus-deadlines": "20 13 * * *",
  "match-offer-alerts": "0 * * * *",
  "email-digest": "0 14 * * *",
  "scan-benefit-expirations": "30 13 * * *",
  "snapshot-524": "15 0 * * *",
  "sync-bank-connections": "0 6 * * *",
  "check-mcp-servers": "*/15 * * * *",
  "refresh-card-sources": "0 5 * * *",
  /** reads new issuer mail from connected mailboxes (read-only IMAP) */
  "sync-mailboxes": "*/15 * * * *",
  "scan-transfer-bonuses": "40 13 * * *",
  /** picks up queued card-research runs (admin-started; no runs → no model calls) */
  "research-cards": "*/2 * * * *",
  /** expiring high-value offers and newly found missed offers */
  "scan-offer-opportunities": "50 13 * * *",
  /** confirms assisted activations from statement credits; flags those that never paid */
  "verify-offer-activation": "0 7 * * *",
  /** points, certificate, membership and status alerts at 365/180/90/60/30/14/7/1 days */
  "scan-loyalty-expirations": "45 13 * * *",
  /** a balance snapshot per account on the 1st */
  "snapshot-loyalty-balances": "30 0 1 * *",
  /** syncs mailboxes for members with urgent due accounts; nudges about stale data */
  "refresh-loyalty": "10 * * * *",
  /** weekly loyalty audit (Mondays) */
  "loyalty-audit": "30 14 * * 1",
  /** hourly: runs every offer account whose local scheduled time (2 AM by default) has passed */
  "offer-sync-due": "5 * * * *",
  /** retries transient sync failures and closes stuck runs */
  "offer-sync-recover": "*/10 * * * *",
  /** first of the month: how offer automation did */
  "offer-audit-monthly": "30 6 1 * *",
  /** expiring offers */
  "offer-digest": "45 13 * * *",
  /** encrypted backup into BACKUP_DIR, only when BACKUP_PASSPHRASE is set */
  "backup-nightly": "30 3 * * *",
};

const JobNameEnum = Object.fromEntries(JOB_NAMES.map((n) => [n, n])) as Record<
  string,
  string
>;

@Processor(JOB_QUEUE)
export class JobsProcessor extends WorkerHost {
  constructor(private readonly jobs: JobsService) {
    super();
  }
  async process(job: Job): Promise<unknown> {
    return this.jobs.run(job.name as JobName);
  }
}

/**
 * Registers repeatable jobs (idempotent by scheduler id). Runs in the dedicated `scheduler`
 * process, which re-asserts the schedule hourly so edits to SCHEDULE roll out without manual steps.
 */
@Injectable()
export class JobsScheduler
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JobsScheduler.name);
  private timer?: NodeJS.Timeout;
  constructor(@InjectQueue(JOB_QUEUE) private readonly queue: Queue) {}
  async register() {
    const known = new Set(Object.keys(SCHEDULE));
    for (const s of await this.queue.getJobSchedulers()) {
      if (s.key && !known.has(s.key))
        await this.queue.removeJobScheduler(s.key);
    }
    for (const [name, pattern] of Object.entries(SCHEDULE)) {
      await this.queue.upsertJobScheduler(
        name,
        { pattern, tz: "UTC" },
        { name, opts: { removeOnComplete: 100, removeOnFail: 500 } },
      );
    }
    this.logger.log(
      `scheduled ${Object.keys(SCHEDULE).length} repeatable jobs`,
    );
  }
  async onApplicationBootstrap() {
    await this.register();
    this.timer = setInterval(
      () => void this.register().catch((e) => this.logger.error(e)),
      3_600_000,
    );
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}

@ApiTags("admin")
@ApiBearerAuth()
@Roles("ADMIN")
@UseGuards(RolesGuard)
@Controller("admin/jobs")
export class JobsController {
  constructor(
    @InjectQueue(JOB_QUEUE) private readonly queue: Queue,
    private readonly jobs: JobsService,
  ) {}

  /** Enqueue a job for the worker. */
  @Post(":name")
  @HttpCode(202)
  async enqueue(@Param("name", new ParseEnumPipe(JobNameEnum)) name: JobName) {
    const job = await this.queue.add(
      name,
      {},
      { removeOnComplete: 100, removeOnFail: 500 },
    );
    return { enqueued: name, id: job.id };
  }

  /** Run synchronously (admin troubleshooting & integration tests). */
  @Post(":name/run")
  run(@Param("name", new ParseEnumPipe(JobNameEnum)) name: JobName) {
    return this.jobs.run(name);
  }
}

const queueRoot = () =>
  BullModule.forRoot({
    connection: {
      url: process.env.REDIS_URL ?? "redis://localhost:6379",
      maxRetriesPerRequest: null,
    } as never,
  });

const jobDeps = () => [
  queueRoot(),
  BullModule.registerQueue({ name: JOB_QUEUE }),
  NotificationsModule,
  DeliveryModule,
  PortfolioModule,
  ConnectionsModule,
  AiCoreModule,
  CardRefreshCoreModule,
  CardResearchCoreModule,
  MailboxCoreModule,
  OfferCoreModule,
  LoyaltyCoreModule,
  LoyaltyAutomationCoreModule,
  OfferAutomationCoreModule,
  DataJobsModule,
];

@Module({
  imports: jobDeps(),
  controllers: [JobsController],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsApiModule {}

/** worker process: executes jobs */
@Module({ imports: jobDeps(), providers: [JobsService, JobsProcessor] })
export class JobsWorkerModule {}

/** scheduler process: only registers the cron schedule */
@Module({
  imports: [queueRoot(), BullModule.registerQueue({ name: JOB_QUEUE })],
  providers: [JobsScheduler],
})
export class JobsSchedulerModule {}

export { queueRoot };

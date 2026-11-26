import { BullModule, InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Injectable, Module, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Queue } from 'bullmq';
import { Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { PrismaService } from '../common/prisma.service';
import { AiCoreModule } from '../ai/ai.module';
import { ModelRouter } from '../ai/router';
import { JOB_QUEUE } from '../jobs/jobs.service';

export class LogQuery {
  @ApiPropertyOptional({ default: 100 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit?: number;
}

type Check = { ok: boolean; latencyMs: number; error?: string };
const DAY = 86_400_000;

async function timed(fn: () => Promise<unknown>): Promise<Check> {
  const t = Date.now();
  try {
    await fn();
    return { ok: true, latencyMs: Date.now() - t };
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t, error: (e as Error).message.slice(0, 200) };
  }
}

export interface OpsEvent {
  at: Date;
  level: 'error' | 'warn' | 'info';
  source: 'job' | 'ai' | 'mcp' | 'card-source' | 'audit';
  message: string;
}

/**
 * Admin operations view: dependency health, queue and scheduler state, recent job runs, AI model
 * health (circuit breakers of this API process + 24 h success rates), MCP servers and card sources.
 * Read-only; no secrets or user data (user ids are not included).
 */
@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly router: ModelRouter,
    @InjectQueue(JOB_QUEUE) private readonly queue: Queue,
  ) {}

  async health(now = new Date()) {
    const since = new Date(now.getTime() - DAY);
    const [db, redis] = await Promise.all([timed(() => this.prisma.$queryRaw`SELECT 1`), timed(() => this.queue.getJobCounts('waiting'))]);
    const [counts, schedulers, recent, models, usage, mcp, sources] = await Promise.all([
      redis.ok ? this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed') : Promise.resolve(null),
      redis.ok ? this.queue.getJobSchedulers() : Promise.resolve([]),
      redis.ok ? this.queue.getJobs(['completed', 'failed'], 0, 199) : Promise.resolve([]),
      this.prisma.aiModel.findMany({ where: { status: 'ACTIVE' }, include: { provider: { select: { name: true, kind: true, status: true } } }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.aiUsage.groupBy({ by: ['modelId', 'success'], where: { createdAt: { gte: since } }, _count: true, _avg: { latencyMs: true } }),
      this.prisma.mcpServer.findMany({ select: { name: true, status: true, lastCheckedAt: true, lastError: true }, orderBy: { name: 'asc' } }),
      this.prisma.cardDataSource.findMany({ where: { active: true }, select: { url: true, lastFetchedAt: true, failureCount: true, lastError: true, card: { select: { name: true } } } }),
    ]);

    const lastRun = new Map<string, { at: Date; ok: boolean; result?: unknown; error?: string; durationMs?: number }>();
    for (const j of recent) {
      const at = new Date(j.finishedOn ?? j.processedOn ?? j.timestamp);
      const prev = lastRun.get(j.name);
      if (prev && prev.at >= at) continue;
      lastRun.set(j.name, { at, ok: !j.failedReason, result: j.returnvalue ?? undefined, error: j.failedReason || undefined, durationMs: j.finishedOn && j.processedOn ? j.finishedOn - j.processedOn : undefined });
    }
    const breaker = this.router.breaker.snapshot(now.getTime());
    const failingSources = sources.filter((s) => s.failureCount > 0);

    const aiModels = models.map((m) => {
      const ok = usage.find((u) => u.modelId === m.id && u.success);
      const bad = usage.find((u) => u.modelId === m.id && !u.success);
      const requests = (ok?._count ?? 0) + (bad?._count ?? 0);
      return {
        model: m.displayName,
        provider: m.provider.name,
        kind: m.provider.kind,
        circuit: breaker[m.id]?.open ? 'OPEN' : 'CLOSED',
        openUntil: breaker[m.id]?.openUntil ?? null,
        requests24h: requests,
        errorRate24h: requests ? Math.round(((bad?._count ?? 0) / requests) * 1000) / 1000 : 0,
        avgLatencyMs: ok?._avg.latencyMs != null ? Math.round(ok._avg.latencyMs) : null,
      };
    });

    const problems: string[] = [];
    if (!db.ok) problems.push('Database unreachable');
    if (!redis.ok) problems.push('Redis unreachable (jobs and rate limits affected)');
    if ((counts?.failed ?? 0) > 0) problems.push(`${counts?.failed} failed job(s) retained`);
    for (const m of aiModels.filter((x) => x.circuit === 'OPEN')) problems.push(`AI model ${m.model}: circuit open`);
    for (const s of mcp.filter((x) => x.status === 'ACTIVE' && x.lastError)) problems.push(`MCP server ${s.name}: ${s.lastError}`);
    if (failingSources.length) problems.push(`${failingSources.length} card source(s) failing`);

    return {
      status: !db.ok ? 'down' : problems.length ? 'degraded' : 'ok',
      checkedAt: now,
      problems,
      process: { uptimeSec: Math.round(process.uptime()), node: process.version, rssMb: Math.round(process.memoryUsage().rss / 1048576), version: process.env.APP_VERSION ?? '0.1.0' },
      dependencies: { database: db, redis },
      queue: { counts, schedulers: schedulers.map((s) => ({ job: s.key, pattern: s.pattern ?? null, next: s.next ? new Date(s.next) : null, lastRun: lastRun.get(s.key) ?? null })) },
      ai: { models: aiModels, note: 'Circuit state is per API process; 24 h figures come from the usage ledger.' },
      mcp,
      cardSources: { active: sources.length, failing: failingSources.map((s) => ({ card: s.card.name, url: s.url, failures: s.failureCount, lastError: s.lastError, lastFetchedAt: s.lastFetchedAt })) },
    };
  }

  /** Recent problems and admin actions, newest first. */
  async logs(limit = 100, now = new Date()): Promise<OpsEvent[]> {
    const since = new Date(now.getTime() - 7 * DAY);
    const [failed, aiErrors, mcp, sources, audit] = await Promise.all([
      this.queue.getJobs(['failed'], 0, limit - 1).catch(() => []),
      this.prisma.aiUsage.findMany({ where: { success: false, createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: limit, select: { createdAt: true, errorCode: true, agentKey: true, model: { select: { displayName: true } } } }),
      this.prisma.mcpServer.findMany({ where: { lastError: { not: null } }, select: { name: true, lastError: true, lastCheckedAt: true } }),
      this.prisma.cardDataSource.findMany({ where: { lastError: { not: null } }, select: { url: true, lastError: true, lastFetchedAt: true } }),
      this.prisma.auditLog.findMany({ where: { createdAt: { gte: since } }, orderBy: { createdAt: 'desc' }, take: limit, select: { createdAt: true, action: true, entity: true, entityId: true } }),
    ]);
    const events: OpsEvent[] = [
      ...failed.map((j) => ({ at: new Date(j.finishedOn ?? j.timestamp), level: 'error' as const, source: 'job' as const, message: `${j.name} failed: ${(j.failedReason ?? 'unknown').slice(0, 300)}` })),
      ...aiErrors.map((u) => ({ at: u.createdAt, level: 'warn' as const, source: 'ai' as const, message: `${u.model?.displayName ?? 'model'} (${u.agentKey}): ${u.errorCode ?? 'error'}` })),
      ...mcp.map((m) => ({ at: m.lastCheckedAt ?? now, level: 'warn' as const, source: 'mcp' as const, message: `${m.name}: ${m.lastError}` })),
      ...sources.map((s) => ({ at: s.lastFetchedAt ?? now, level: 'warn' as const, source: 'card-source' as const, message: `${s.url}: ${s.lastError}` })),
      ...audit.map((a) => ({ at: a.createdAt, level: 'info' as const, source: 'audit' as const, message: `${a.action} ${a.entity} ${a.entityId}` })),
    ];
    return events.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(RolesGuard)
@Controller('admin/ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('health') health() {
    return this.ops.health();
  }
  @Get('logs') logs(@Query() q: LogQuery) {
    return this.ops.logs(q.limit ?? 100);
  }
}

@Module({ imports: [BullModule.registerQueue({ name: JOB_QUEUE }), AiCoreModule], controllers: [OpsController], providers: [OpsService] })
export class OpsModule {}

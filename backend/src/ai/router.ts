import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { ProviderFactory, ProviderRow, defaultProviderFactory, isUsable } from './providers';
import { ChatRequest, ChatResponse, ProviderError, TextSink, Usage } from './types';

export interface ModelRow {
  id: string;
  modelId: string;
  displayName: string;
  capabilities: string[];
  inputPrice: unknown;
  outputPrice: unknown;
  cacheReadPrice: unknown;
  status: 'ACTIVE' | 'DISABLED';
  provider: ProviderRow & { name: string };
}

/** Cost in micro-USD: tokens × (USD per 1M tokens). Null when the model has no price. */
export function costMicroUsd(m: Pick<ModelRow, 'inputPrice' | 'outputPrice' | 'cacheReadPrice'>, u: Usage): number | null {
  if (m.inputPrice == null || m.outputPrice == null) return null;
  const inP = Number(m.inputPrice);
  const outP = Number(m.outputPrice);
  const cacheP = m.cacheReadPrice == null ? inP : Number(m.cacheReadPrice);
  // cache writes are billed at ~1.25× input on Anthropic; approximate with input price × 1.25
  return Math.round(u.inputTokens * inP + u.outputTokens * outP + u.cacheReadTokens * cacheP + u.cacheWriteTokens * inP * 1.25);
}

/** Simple per-model circuit breaker: 3 retryable failures within 2 minutes open it for 60 s. */
export class CircuitBreaker {
  private readonly state = new Map<string, { failures: number[]; openUntil: number }>();
  constructor(
    private readonly threshold = 3,
    private readonly windowMs = 120_000,
    private readonly openMs = 60_000,
  ) {}
  isOpen(key: string, now = Date.now()): boolean {
    return (this.state.get(key)?.openUntil ?? 0) > now;
  }
  failure(key: string, now = Date.now()) {
    const s = this.state.get(key) ?? { failures: [], openUntil: 0 };
    s.failures = [...s.failures.filter((t) => now - t < this.windowMs), now];
    if (s.failures.length >= this.threshold) {
      s.openUntil = now + this.openMs;
      s.failures = [];
    }
    this.state.set(key, s);
  }
  success(key: string) {
    this.state.delete(key);
  }
  /** Current state per model (ops page): open circuits and recent failures in the window. */
  snapshot(now = Date.now()): Record<string, { open: boolean; openUntil: Date | null; recentFailures: number }> {
    const out: Record<string, { open: boolean; openUntil: Date | null; recentFailures: number }> = {};
    for (const [k, s] of this.state) {
      const open = s.openUntil > now;
      out[k] = { open, openUntil: open ? new Date(s.openUntil) : null, recentFailures: s.failures.filter((t) => now - t < this.windowMs).length };
    }
    return out;
  }
}

export interface RouteContext {
  userId: string | null;
  conversationId?: string | null;
  agentKey: string;
}

export interface RoutedResponse {
  response: ChatResponse;
  model: ModelRow;
  attempts: Array<{ model: string; error: string }>;
}

export const modelInclude = { provider: true } as const;

@Injectable()
export class ModelRouter {
  private readonly logger = new Logger(ModelRouter.name);
  readonly breaker = new CircuitBreaker();
  factory: ProviderFactory = defaultProviderFactory;

  constructor(private readonly prisma: PrismaService) {}

  /** Models that can serve requests now (enabled model + usable provider). */
  async usableModels(): Promise<ModelRow[]> {
    const rows = (await this.prisma.aiModel.findMany({
      where: { status: 'ACTIVE', provider: { status: 'ACTIVE' } },
      include: modelInclude,
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    })) as unknown as ModelRow[];
    return rows.filter((m) => isUsable(m.provider));
  }

  /** Preferred model first (if usable), then the agent's chain, de-duplicated. */
  async resolveChain(chain: string[], preferredModelId?: string | null): Promise<ModelRow[]> {
    const usable = await this.usableModels();
    const byId = new Map(usable.map((m) => [m.id, m]));
    const ids = [...(preferredModelId ? [preferredModelId] : []), ...chain];
    const out: ModelRow[] = [];
    for (const id of ids) {
      const m = byId.get(id);
      if (m && !out.includes(m)) out.push(m);
    }
    return out;
  }

  async chat(chain: ModelRow[], req: Omit<ChatRequest, 'model' | 'capabilities'>, ctx: RouteContext, sink?: TextSink): Promise<RoutedResponse> {
    const attempts: RoutedResponse['attempts'] = [];
    for (const model of chain) {
      if (this.breaker.isOpen(model.id)) {
        attempts.push({ model: model.displayName, error: 'circuit open' });
        continue;
      }
      const started = Date.now();
      try {
        const provider = this.factory(model.provider);
        const full = { ...req, model: model.modelId, capabilities: model.capabilities };
        let streamed = false;
        const response =
          sink && provider.chatStream
            ? await provider.chatStream(full, (d) => {
                streamed = true;
                sink.text(d);
              }).catch((e: unknown) => {
                if (streamed) sink.reset();
                throw e;
              })
            : await provider.chat(full);
        if (sink && !provider.chatStream && response.text) sink.text(response.text);
        this.breaker.success(model.id);
        await this.record(model, response.usage, ctx, Date.now() - started, true);
        return { response, model, attempts };
      } catch (e) {
        const err = e instanceof ProviderError ? e : new ProviderError((e as Error).message, 'unknown', true);
        attempts.push({ model: model.displayName, error: err.code });
        await this.record(model, { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, ctx, Date.now() - started, false, err.code);
        if (err.retryable) this.breaker.failure(model.id);
        this.logger.warn(`${model.displayName} failed (${err.code}); trying next model`);
      }
    }
    throw new ServiceUnavailableException({
      message: chain.length ? 'All configured AI models failed. Try again shortly.' : 'No AI model is configured. An administrator must enable a provider.',
      attempts,
    });
  }

  private async record(model: ModelRow, u: Usage, ctx: RouteContext, latencyMs: number, success: boolean, errorCode?: string) {
    await this.prisma.aiUsage.create({
      data: {
        userId: ctx.userId,
        conversationId: ctx.conversationId ?? null,
        agentKey: ctx.agentKey,
        modelId: model.id,
        providerKind: model.provider.kind,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheWriteTokens: u.cacheWriteTokens,
        costMicroUsd: success ? costMicroUsd(model, u) : null,
        latencyMs,
        success,
        errorCode: errorCode ?? null,
      },
    });
  }
}

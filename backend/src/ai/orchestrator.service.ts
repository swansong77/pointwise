import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { BenefitAuditService } from "../benefit-audit/benefit-audit.module";
import { PrismaService } from "../common/prisma.service";
import { canNarrate, ORCH_ENGINE_VERSION, runWorkflow, WorkflowDef } from "../domain/orchestration";
import { PortfolioService } from "../portfolio/portfolio";
import { SmartRecommendationService } from "../strategy/smart-recommendation.service";
import { StrategyService } from "../strategy/strategy.service";
import { isLocalProvider } from "./privacy";
import { PromptsService } from "./prompts.service";
import { ModelRouter } from "./router";
import { selectModels } from "./routing";
import { awardTripWorkflow, loyaltyReviewWorkflow, nextCardWorkflow, offerReviewWorkflow, portfolioReviewWorkflow, purchasePlanWorkflow, WfCtx, WfDeps } from "./workflows";
import { OfferAnalysisService } from "../offers/offer-analysis.service";
import { LoyaltyService } from "../loyalty/loyalty.service";

export interface WorkflowRequest {
  question?: string;
  params?: WfCtx['params'];
  /** ask a model to rewrite the composed answer (only ever a model allowed to see it) */
  narrate?: boolean;
}

/**
 * Runs declarative workflows and records every step (AgentRun / AgentStep). Steps are deterministic engines;
 * a model is used only to narrate the final text, and only a model the privacy rules allow: for runs that
 * touched the user's data that means a local model (Ollama), never an external provider (ADR-004, ADR-005).
 */
@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);
  private readonly workflows: Map<string, WorkflowDef<WfCtx>>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolio: PortfolioService,
    private readonly strategy: StrategyService,
    private readonly smart: SmartRecommendationService,
    private readonly benefits: BenefitAuditService,
    private readonly router: ModelRouter,
    private readonly prompts: PromptsService,
    private readonly offers: OfferAnalysisService,
    private readonly loyalty: LoyaltyService,
  ) {
    const deps: WfDeps = { prisma, portfolio, strategy, smart, benefits, offers, loyalty };
    this.workflows = new Map([nextCardWorkflow(deps), portfolioReviewWorkflow(deps), purchasePlanWorkflow(deps), offerReviewWorkflow(deps), loyaltyReviewWorkflow(deps), awardTripWorkflow(deps)].map((w) => [w.key, w]));
  }

  list() {
    return [...this.workflows.values()].map((w) => ({
      key: w.key,
      title: w.title,
      steps: w.steps.map((s) => ({ id: s.id, agent: s.agentKey, engine: s.engine, privacy: s.privacy })),
    }));
  }

  async run(userId: string, key: string, req: WorkflowRequest = {}, now = new Date()) {
    const wf = this.workflows.get(key);
    if (!wf) throw new NotFoundException(`Unknown workflow "${key}"`);
    const run = await this.prisma.agentRun.create({
      data: { userId, workflow: key, question: req.question?.slice(0, 500), engineVersion: ORCH_ENGINE_VERSION },
    });
    const started = Date.now();
    try {
      const out = await runWorkflow(wf, { userId, now, question: req.question, params: req.params });
      const narration = req.narrate ? await this.narrate(userId, out.composed.answer, out.privacy) : null;
      const prompt = narration?.promptVersion ?? null;
      await this.prisma.$transaction([
        this.prisma.agentStep.createMany({
          data: out.steps.map((s, i) => ({
            runId: run.id,
            ordinal: s.ordinal,
            agentKey: s.agentKey,
            engine: s.engine,
            privacy: s.privacy,
            status: s.status,
            inputHash: s.inputHash,
            output: (s.output ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            durationMs: s.durationMs,
            error: s.error,
            // the narration is a property of the run; it is recorded on the last executed step
            ...(narration && i === out.steps.length - 1 && { narratedBy: narration.model, promptKey: narration.promptKey, promptVersion: narration.promptVersion }),
          })),
        }),
        this.prisma.agentRun.update({
          where: { id: run.id },
          data: {
            status: out.failed ? "FAILED" : "COMPLETED",
            finishedAt: new Date(),
            durationMs: Date.now() - started,
            promptVersions: prompt != null ? ({ [narration!.promptKey]: prompt } as Prisma.InputJsonValue) : Prisma.JsonNull,
            result: { answer: out.composed.answer, highlights: out.composed.highlights, privacy: out.privacy, narration: narration?.text ?? null } as Prisma.InputJsonValue,
            error: out.failed ? out.steps.find((s) => s.status === "FAILED")?.error ?? "failed" : null,
          },
        }),
      ]);
      return {
        runId: run.id,
        workflow: key,
        status: out.failed ? "FAILED" : "COMPLETED",
        privacy: out.privacy,
        answer: out.composed.answer,
        narration: narration ? { text: narration.text, model: narration.model, promptVersion: narration.promptVersion } : null,
        narrationSkipped: req.narrate && !narration ? "No model is allowed to see this answer (a local model is required for your own data)." : undefined,
        steps: out.steps.map((s) => ({ ordinal: s.ordinal, id: s.id, agent: s.agentKey, engine: s.engine, privacy: s.privacy, status: s.status, durationMs: s.durationMs, error: s.error })),
      };
    } catch (e) {
      await this.prisma.agentRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), durationMs: Date.now() - started, error: (e as Error).message.slice(0, 300) } });
      throw e;
    }
  }

  /** Rewrites the answer with a model the privacy rules allow, or returns null when none is allowed/available. */
  private async narrate(userId: string, answer: string, privacy: "PUBLIC" | "USER") {
    const usable = await this.router.usableModels();
    const [model] = selectModels(usable, { privacy, maxCost: "FREE" });
    const narrator = model ? { local: isLocalProvider(model.provider.kind) } : null;
    if (!model || !canNarrate(privacy, narrator)) return null;
    if (!narrator!.local) {
      const consent = await this.prisma.aiSettings.findUnique({ where: { userId } });
      if (!consent?.consentedAt) return null;
    }
    const prompt = await this.prompts.current("narration.default");
    try {
      const { response } = await this.router.chat(
        [model],
        { system: prompt.body, messages: [{ role: "user", text: answer }], tools: [], maxTokens: 500, effort: "low" },
        { userId, agentKey: "narrator" },
      );
      const text = response.text.trim();
      if (!text) return null;
      return { text, model: model.displayName, promptKey: prompt.key, promptVersion: prompt.version };
    } catch (e) {
      this.logger.warn(`narration skipped: ${(e as Error).message}`);
      return null;
    }
  }

  async runs(userId: string) {
    const rows = await this.prisma.agentRun.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take: 30, select: { id: true, workflow: true, status: true, startedAt: true, durationMs: true, question: true } });
    return rows;
  }

  /** The full trace of one run (owner only). */
  async runDetail(userId: string, id: string) {
    const run = await this.prisma.agentRun.findFirst({ where: { id, userId }, include: { steps: { orderBy: { ordinal: "asc" } } } });
    if (!run) throw new NotFoundException("Run not found");
    return {
      id: run.id,
      workflow: run.workflow,
      question: run.question,
      status: run.status,
      engineVersion: run.engineVersion,
      promptVersions: run.promptVersions,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: run.durationMs,
      result: run.result,
      error: run.error,
      steps: run.steps.map((s) => ({
        ordinal: s.ordinal,
        agent: s.agentKey,
        engine: s.engine,
        privacy: s.privacy,
        status: s.status,
        inputHash: s.inputHash,
        output: s.output,
        narratedBy: s.narratedBy,
        promptKey: s.promptKey,
        promptVersion: s.promptVersion,
        durationMs: s.durationMs,
        error: s.error,
      })),
    };
  }
}

import { createHash } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isLocalProvider, mayReceiveRedacted, redactForModel } from '../ai/privacy';
import { ModelRouter } from '../ai/router';
import { selectModels } from '../ai/routing';
import { PrismaService } from '../common/prisma.service';
import { clampTemperature, effortFor, isDepth, isMode, isStyle, Mode, MODE_SPEC, MODES, STYLES, Style } from '../domain/copilot-modes';
import { AGENDA_STEPS, CopilotPlan, COPILOT_VERSION, composeAgenda, fromSearchAnswer, fromWhatIf, isAgendaQuestion, TOOL_LENS, whatIfNeeds } from '../domain/copilot-plan';
import { understand } from '../domain/query-understanding';
import { parseWhatIf } from '../domain/what-if';
import { buildView, grounded, Household, leaks, narrationPrompt, PROMPT_VERSION, rehydrate } from '../domain/copilot-view';
import type { StepResult } from '../domain/answer-compose';
import { SearchAskService } from '../search/search-ask.service';
import { SearchService } from '../search/search.service';
import { GoalsService } from './goals.service';
import { MemoryService } from './memory.service';
import { WhatIfService } from './what-if.service';

export interface CopilotNarration {
  text: string;
  model: string;
  provider: string;
  local: boolean;
  disclosureId: string;
}

export interface CopilotResponse {
  runId: string;
  mode: Mode;
  plan: CopilotPlan;
  /** a model's wording of the plan, when one was allowed to see the redacted view */
  narration: CopilotNarration | null;
  /** why no model wrote it, in words the person can act on */
  narrationSkipped: string | null;
  sessionId: string | null;
  tookMs: number;
}

export interface CopilotSettingsDto {
  aiModeEnabled?: boolean;
  mode?: string;
  temperature?: number | null;
  reasoningDepth?: string | null;
  responseStyle?: string;
  /** the separate consent to share a redacted view with cloud models */
  cloudShare?: boolean;
  cloudProviders?: string[];
}

const DISCLOSURE_DAYS = 90;

@Injectable()
export class CopilotService {
  private readonly log = new Logger(CopilotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: SearchAskService,
    private readonly router: ModelRouter,
    private readonly searchData: SearchService,
    private readonly whatIf: WhatIfService,
    private readonly goals: GoalsService,
    private readonly memory: MemoryService,
  ) {}

  /** The member's AI settings row, created on first use. Safe when two requests create it at once. */
  private async ensureSettings(userId: string) {
    const found = await this.prisma.aiSettings.findUnique({ where: { userId } });
    if (found) return found;
    try {
      return await this.prisma.aiSettings.create({ data: { userId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return this.prisma.aiSettings.findUniqueOrThrow({ where: { userId } });
      throw e;
    }
  }

  // ───────────── settings ─────────────

  async settings(userId: string) {
    const s = await this.ensureSettings(userId);
    const providers = await this.prisma.aiProvider.findMany({ orderBy: { name: 'asc' }, select: { name: true, kind: true, status: true } });
    return {
      aiModeEnabled: s.aiModeEnabled,
      mode: isMode(s.copilotMode) ? s.copilotMode : 'QUICK',
      temperature: s.temperature,
      reasoningDepth: s.reasoningDepth,
      responseStyle: isStyle(s.responseStyle) ? s.responseStyle : 'BALANCED',
      cloudShare: { consented: !!s.cloudShareConsentAt, consentedAt: s.cloudShareConsentAt, providers: s.cloudProviders },
      // local providers need no permission; the rest can be allowed one by one
      providers: providers.map((p) => ({ name: p.name, kind: p.kind, local: isLocalProvider(p.kind), enabled: p.status === 'ACTIVE' })),
      modes: MODES.map((m) => ({ key: m, label: MODE_SPEC[m].label, blurb: MODE_SPEC[m].blurb })),
      styles: STYLES,
    };
  }

  async updateSettings(userId: string, dto: CopilotSettingsDto) {
    if (dto.mode !== undefined && !isMode(dto.mode)) throw new BadRequestException('Unknown mode');
    if (dto.responseStyle !== undefined && !isStyle(dto.responseStyle)) throw new BadRequestException('Unknown response style');
    if (dto.reasoningDepth != null && !isDepth(dto.reasoningDepth)) throw new BadRequestException('Unknown reasoning depth');
    if (dto.temperature != null && (typeof dto.temperature !== 'number' || dto.temperature < 0 || dto.temperature > 1)) throw new BadRequestException('Temperature must be between 0 and 1');
    let providers: string[] | undefined;
    if (dto.cloudProviders !== undefined) {
      const known = await this.prisma.aiProvider.findMany({ where: { name: { in: dto.cloudProviders } }, select: { name: true } });
      const names = new Set(known.map((k) => k.name));
      const unknown = dto.cloudProviders.filter((n) => !names.has(n));
      if (unknown.length) throw new BadRequestException('Unknown provider: ' + unknown.join(', '));
      providers = [...names];
    }
    const data: Prisma.AiSettingsUpdateInput = {
      ...(dto.aiModeEnabled !== undefined && { aiModeEnabled: dto.aiModeEnabled }),
      ...(dto.mode !== undefined && { copilotMode: dto.mode }),
      ...(dto.temperature !== undefined && { temperature: clampTemperature(dto.temperature) }),
      ...(dto.reasoningDepth !== undefined && { reasoningDepth: dto.reasoningDepth }),
      ...(dto.responseStyle !== undefined && { responseStyle: dto.responseStyle }),
      ...(dto.cloudShare !== undefined && { cloudShareConsentAt: dto.cloudShare ? new Date() : null }),
      ...(providers !== undefined && { cloudProviders: providers }),
    };
    await this.ensureSettings(userId);
    await this.prisma.aiSettings.update({ where: { userId }, data });
    return this.settings(userId);
  }

  // ───────────── what was sent ─────────────

  disclosures(userId: string, limit = 50) {
    return this.prisma.aiDisclosure.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: Math.min(200, Math.max(1, limit)) });
  }

  async clearDisclosures(userId: string) {
    return { removed: (await this.prisma.aiDisclosure.deleteMany({ where: { userId } })).count };
  }

  /** retention: nothing is kept longer than DISCLOSURE_DAYS */
  async purgeDisclosures(now: Date): Promise<number> {
    const r = await this.prisma.aiDisclosure.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - DISCLOSURE_DAYS * 86_400_000) } } });
    return r.count;
  }

  // ───────────── ask ─────────────

  private async household(userId: string): Promise<Household> {
    const [profiles, user, cards] = await Promise.all([
      this.prisma.profile.findMany({ where: { userId }, select: { nickname: true, relationship: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }),
      this.prisma.walletCard.findMany({ where: { wallet: { userId } }, select: { lastFour: true, nickname: true } }),
    ]);
    const secrets = [user?.email, user?.email?.split('@')[0], user?.name, ...cards.map((c) => c.lastFour), ...cards.map((c) => c.nickname)].filter((x): x is string => !!x && x.trim().length >= 3);
    return { members: profiles.map((p) => ({ nickname: p.nickname, relationship: p.relationship })), secrets };
  }

  async ask(userId: string, q: string, opts: { mode?: string; sessionId?: string; now?: Date } = {}): Promise<CopilotResponse> {
    const started = Date.now();
    const now = opts.now ?? new Date();
    const s = await this.ensureSettings(userId);
    const mode: Mode = isMode(opts.mode) ? opts.mode : isMode(s.copilotMode) ? s.copilotMode : 'QUICK';
    const style: Style = isStyle(s.responseStyle) ? s.responseStyle : 'BALANCED';

    let plan: CopilotPlan;
    let results: StepResult[] = [];
    let sessionId: string | null = null;
    let engines: string[];
    const parsed = parseWhatIf(q, understand(q, await this.searchData.dictionaries(userId), now));
    if (parsed) {
      engines = ['what-if'];
      if (parsed.needs.length) plan = whatIfNeeds(q, mode, parsed.needs);
      else {
        try {
          plan = fromWhatIf(await this.whatIf.run(userId, parsed.request, now), mode, q);
        } catch (e) {
          // a card or program that is not there is said plainly; nothing else is swallowed
          if (e instanceof BadRequestException || e instanceof NotFoundException) plan = whatIfNeeds(q, mode, [e.message.replace(/\.$/, '').toLowerCase()]);
          else throw e;
        }
      }
    } else if (isAgendaQuestion(q)) {
      const [prefs, decisions, goals] = await Promise.all([this.memory.preferences(userId), this.memory.decisions(userId, now), this.goals.views(userId, now)]);
      results = await Promise.all(AGENDA_STEPS.map((st) => this.search.runStep(userId, st, now)));
      plan = composeAgenda(results, mode, q, now, { prefs, decisions, goals });
      engines = [...AGENDA_STEPS.map((st) => st.tool), 'goals'];
      await this.memory.recordRecommended(userId, plan.items.map((i) => ({ id: i.id, title: i.title })), now);
    } else {
      const r = await this.search.ask(userId, q, undefined, opts.sessionId, now);
      sessionId = r.sessionId;
      engines = r.engines;
      plan = fromSearchAnswer(r.answer, mode, q, engines);
    }

    const run = await this.prisma.agentRun.create({
      data: { userId, workflow: 'copilot', question: redactForModel(q).slice(0, 300), status: 'RUNNING', engineVersion: COPILOT_VERSION },
    });
    const narrated = plan.kind === 'AGENDA' && plan.items.length > 0 ? await this.narrate(userId, plan, { mode, style, settings: s, runId: run.id }) : { narration: null, skipped: null };

    const failed = results.filter((r) => !r.ok).length;
    await this.prisma.agentRun.update({
      where: { id: run.id },
      data: {
        status: 'COMPLETED',
        finishedAt: new Date(),
        durationMs: Date.now() - started,
        promptVersions: narrated.narration ? ({ [PROMPT_VERSION]: 1 } as Prisma.InputJsonValue) : Prisma.JsonNull,
        result: {
          kind: plan.kind,
          mode,
          headline: plan.headline,
          confidence: plan.confidence,
          items: plan.items.map((i) => ({ id: i.id, lens: i.lens, horizon: i.horizon, confidence: i.confidence, calls: i.calls.map((c) => c.kind) })),
          lenses: plan.lenses.map((l) => ({ lens: l.lens, ok: l.ok, found: l.found })),
          failedEngines: failed,
          narratedBy: narrated.narration?.model ?? null,
        } as unknown as Prisma.InputJsonValue,
        steps: {
          create: engines.map((engine, ordinal) => {
            const r = results.find((x) => x.tool === engine);
            const input = AGENDA_STEPS.find((st) => st.tool === engine)?.input ?? {};
            return {
              ordinal,
              agentKey: 'copilot-' + (TOOL_LENS[engine] ?? 'search').toLowerCase(),
              engine,
              privacy: 'USER',
              status: r && !r.ok ? 'FAILED' : 'OK',
              inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
              output: { ok: r ? r.ok : true } as Prisma.InputJsonValue,
              error: r && !r.ok ? (r.error ?? 'failed').slice(0, 160) : null,
            };
          }),
        },
      },
    });

    return { runId: run.id, mode, plan, narration: narrated.narration, narrationSkipped: narrated.skipped, sessionId, tookMs: Date.now() - started };
  }

  /**
   * Lets a model word the plan, but only from the redacted view, only a model the member's settings allow, and only after the view
   * passed the leak check. What is sent is stored for the member to inspect. A model that cites a figure the view does not contain is
   * not used.
   */
  private async narrate(
    userId: string,
    plan: CopilotPlan,
    ctx: { mode: Mode; style: Style; settings: { preferredModelId?: string | null; cloudShareConsentAt: Date | null; cloudProviders: string[]; temperature: number | null; reasoningDepth: string | null }; runId: string },
  ): Promise<{ narration: CopilotNarration | null; skipped: string | null }> {
    const share = { consentedAt: ctx.settings.cloudShareConsentAt, providers: ctx.settings.cloudProviders };
    const usable = await this.router.usableModels();
    const allowed = usable.filter((m) => mayReceiveRedacted(m.provider, share));
    if (!allowed.length) {
      return {
        narration: null,
        skipped: usable.length
          ? 'The built-in planner wrote this. To let a cloud model reword it, turn on sharing a redacted view in Settings and allow a provider.'
          : 'The built-in planner wrote this. No AI model is set up.',
      };
    }
    const preferred = allowed.find((m) => m.id === ctx.settings.preferredModelId);
    const model = preferred ?? selectModels(allowed, { privacy: 'PUBLIC' })[0] ?? allowed[0];

    const h = await this.household(userId);
    const view = buildView(plan, h);
    const bad = leaks(view, h);
    if (bad.length) {
      this.log.warn('copilot view not sent: ' + bad.join(', '));
      return { narration: null, skipped: 'Nothing was sent to a model: the summary could not be fully de-identified.' };
    }

    const system = narrationPrompt(ctx.style);
    const local = isLocalProvider(model.provider.kind);
    // stored before the call: it was sent whether or not the model answers
    const disclosure = await this.prisma.aiDisclosure.create({
      data: { userId, runId: ctx.runId, provider: model.provider.name, model: model.displayName, local, purpose: 'narration', payload: { promptVersion: PROMPT_VERSION, system, view } as unknown as Prisma.InputJsonValue },
    });
    try {
      const { response } = await this.router.chat(
        [model],
        {
          system,
          messages: [{ role: 'user', text: JSON.stringify(view) }],
          tools: [],
          maxTokens: MODE_SPEC[ctx.mode].maxTokens,
          effort: effortFor(ctx.mode, isDepth(ctx.settings.reasoningDepth) ? ctx.settings.reasoningDepth : null),
          ...(ctx.settings.temperature != null && { temperature: ctx.settings.temperature }),
        },
        { userId, agentKey: 'copilot' },
      );
      const text = response.text.trim();
      if (!text) return { narration: null, skipped: 'The model returned nothing, so the built-in planner’s wording is shown.' };
      const g = grounded(text, view);
      if (!g.ok) return { narration: null, skipped: 'The model mentioned figures that are not in your plan, so it was not used. The built-in planner’s wording is shown.' };
      return { narration: { text: rehydrate(text, h), model: model.displayName, provider: model.provider.name, local, disclosureId: disclosure.id }, skipped: null };
    } catch (e) {
      this.log.warn('copilot narration failed: ' + (e instanceof Error ? e.message : 'error'));
      return { narration: null, skipped: 'The model could not be reached, so the built-in planner’s wording is shown.' };
    }
  }
}

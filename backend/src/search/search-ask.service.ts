import { Injectable, Logger } from '@nestjs/common';
import { ToolRegistry } from '../ai/tools';
import { composeAnswer, SearchAnswer, StepResult } from '../domain/answer-compose';
import { understand } from '../domain/query-understanding';
import { applyFollowUp, routeFor, Slots, slotsFrom, sanitizeSlots, ToolStep } from '../domain/search-router';
import { SearchMemoryService } from './search-memory.service';
import { SearchService } from './search.service';

const ANSWER_TTL_MS = 60_000;
const STEP_TIMEOUT_MS = 8_000;
const MAX_CACHED = 300;

export interface AskResult {
  /** the conversation this answer belongs to; send it with the next question */
  sessionId: string;
  answer: SearchAnswer;
  /** send these back with the next question so a follow-up knows what "it" is */
  slots: Slots;
  usedFollowUp: boolean;
  /** the engines that answered, for the audit trail */
  engines: string[];
  cached: boolean;
  tookMs: number;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timed out')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });

/**
 * Answers a typed question: understand it, run the existing engines it maps to, compose the answer. Everything runs server-side on
 * the caller's own data; no model is involved, so nothing about the household leaves the process.
 */
@Injectable()
export class SearchAskService {
  private readonly log = new Logger(SearchAskService.name);
  private readonly answers = new Map<string, { at: number; value: Omit<AskResult, 'cached' | 'tookMs' | 'sessionId'> }>();

  constructor(
    private readonly search: SearchService,
    private readonly tools: ToolRegistry,
    private readonly memory: SearchMemoryService,
  ) {}

  async runStep(userId: string, step: ToolStep, now: Date): Promise<StepResult> {
    const tool = this.tools.get(step.tool);
    if (!tool) return { tool: step.tool, label: step.label, ok: false, summary: '', data: null, error: 'engine not available' };
    try {
      const out = await withTimeout(tool.handler({ userId, now, quiet: true }, step.input), STEP_TIMEOUT_MS);
      return { tool: step.tool, label: step.label, ok: true, summary: out.summary, data: out.data };
    } catch (e) {
      // the engine's own message is for the person; stack traces and internals stay in the log
      const message = e instanceof Error ? e.message : 'failed';
      this.log.warn('search step ' + step.tool + ' failed: ' + message);
      return { tool: step.tool, label: step.label, ok: false, summary: '', data: null, error: message.slice(0, 160) };
    }
  }

  async ask(userId: string, q: string, slotsIn: unknown, sessionId?: string, now = new Date()): Promise<AskResult> {
    const started = Date.now();
    // the server's memory of the conversation wins; slots sent by the browser are the fallback
    const remembered = await this.memory.slotsOf(userId, sessionId, now);
    const prev = remembered ?? sanitizeSlots(slotsIn);
    const dict = await this.search.dictionaries(userId);
    const key = userId + '|' + q.trim().toLowerCase() + '|' + JSON.stringify(prev);

    let value: Omit<AskResult, 'cached' | 'tookMs' | 'sessionId'>;
    let cached = false;
    let understanding = understand(q, dict, now);
    const hit = this.answers.get(key);
    if (hit && started - hit.at < ANSWER_TTL_MS) {
      value = hit.value;
      cached = true;
      understanding = applyFollowUp(understanding, prev).understanding;
    } else {
      const followed = applyFollowUp(understanding, prev);
      understanding = followed.understanding;
      const route = routeFor(understanding);
      const results = await Promise.all(route.steps.map((s) => this.runStep(userId, s, now)));
      const answer = composeAnswer(understanding, route, results, now);
      // an unanswered question must not wipe what the conversation knew
      const slots = answer.unanswered && prev ? prev : slotsFrom(understanding);
      value = { answer, slots, usedFollowUp: followed.usedFollowUp, engines: route.steps.map((st) => st.tool) };
      if (this.answers.size >= MAX_CACHED) this.answers.delete(this.answers.keys().next().value as string);
      if (!answer.unanswered && results.every((r) => r.ok)) this.answers.set(key, { at: Date.now(), value });
    }
    const id = await this.memory.remember(userId, sessionId, value.slots, { q, intent: understanding.intent === 'UNKNOWN' ? null : understanding.intent, summary: value.answer.summary }, now);
    if (!value.answer.unanswered) await this.memory.record(userId, q, understanding, value.answer.summary, value.answer.related, now);
    return { ...value, sessionId: id, cached, tookMs: Date.now() - started };
  }
}

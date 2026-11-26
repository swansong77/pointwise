/**
 * Workflow orchestration core (pure). A workflow is an ordered list of steps; each step is one agent
 * profile's deterministic engine run with a privacy class. The runner records every step (input hash,
 * output, status, duration) so the reasoning behind an answer can be reproduced and audited, and decides
 * whether the composed answer may be narrated by a model (ADR-004, ADR-005).
 */
import { createHash } from 'crypto';

export const ORCH_ENGINE_VERSION = 'orchestrator/1';

export type Privacy = 'PUBLIC' | 'USER';
export type StepStatus = 'OK' | 'SKIPPED' | 'FAILED';

export interface StepDef<Ctx> {
  id: string;
  agentKey: string;
  engine: string;
  privacy: Privacy;
  /** a failure here does not stop the workflow */
  optional?: boolean;
  /** what the step reads, hashed into the audit record */
  input?: (ctx: Ctx, prior: Record<string, unknown>) => unknown;
  run: (ctx: Ctx, prior: Record<string, unknown>) => Promise<unknown>;
}

export interface Composed {
  answer: string;
  highlights: string[];
}

export interface WorkflowDef<Ctx> {
  key: string;
  title: string;
  steps: StepDef<Ctx>[];
  compose: (results: Record<string, unknown>, statuses: Record<string, StepStatus>) => Composed;
}

export interface StepRecord {
  ordinal: number;
  id: string;
  agentKey: string;
  engine: string;
  privacy: Privacy;
  status: StepStatus;
  inputHash: string;
  output: unknown;
  error: string | null;
  durationMs: number;
}

export interface RunOutcome {
  steps: StepRecord[];
  results: Record<string, unknown>;
  failed: boolean;
  composed: Composed;
  /** USER if any step that ran touched the user's data */
  privacy: Privacy;
}

export function hashInput(v: unknown): string {
  const stable = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(stable)
      : x && typeof x === 'object'
        ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, val]) => [k, stable(val)]))
        : x;
  return createHash('sha256').update(JSON.stringify(stable(v ?? null))).digest('hex');
}

/** Runs steps in order. A failed required step skips the rest; a failed optional step is recorded and passed over. */
export async function runWorkflow<Ctx>(wf: WorkflowDef<Ctx>, ctx: Ctx, clock: () => number = Date.now): Promise<RunOutcome> {
  const steps: StepRecord[] = [];
  const results: Record<string, unknown> = {};
  const statuses: Record<string, StepStatus> = {};
  let failed = false;
  for (const [i, def] of wf.steps.entries()) {
    const base = { ordinal: i + 1, id: def.id, agentKey: def.agentKey, engine: def.engine, privacy: def.privacy };
    if (failed) {
      statuses[def.id] = 'SKIPPED';
      steps.push({ ...base, status: 'SKIPPED', inputHash: hashInput(null), output: null, error: 'an earlier required step failed', durationMs: 0 });
      continue;
    }
    const started = clock();
    try {
      const inputHash = hashInput(def.input ? def.input(ctx, results) : null);
      const out = await def.run(ctx, results);
      results[def.id] = out;
      statuses[def.id] = 'OK';
      steps.push({ ...base, status: 'OK', inputHash, output: out, error: null, durationMs: Math.max(0, clock() - started) });
    } catch (e) {
      statuses[def.id] = 'FAILED';
      if (!def.optional) failed = true;
      steps.push({ ...base, status: 'FAILED', inputHash: hashInput(null), output: null, error: (e as Error).message.slice(0, 300), durationMs: Math.max(0, clock() - started) });
    }
  }
  const privacy: Privacy = steps.some((s) => s.status === 'OK' && s.privacy === 'USER') ? 'USER' : 'PUBLIC';
  return { steps, results, failed, composed: wf.compose(results, statuses), privacy };
}

/** A model may narrate a run only if the run's data class allows that model's provider. */
export function canNarrate(runPrivacy: Privacy, narrator: { local: boolean } | null): boolean {
  return !!narrator && (runPrivacy === 'PUBLIC' || narrator.local);
}

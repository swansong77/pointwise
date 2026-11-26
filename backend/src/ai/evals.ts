/**
 * Answer-grounding evals (docs/ai-evals.md). Each case asks the assistant a question on the demo
 * family account and checks that the right tool answered, the answer contains the expected facts,
 * nothing forbidden appears, and user-data answers stayed private (never sent to a model).
 * Graded deterministically — no LLM judge — so results are comparable between models and runs.
 */

export interface EvalCase {
  id: string;
  question: string;
  agent?: string;
  /** tool that must appear in the trace */
  expectTool?: string;
  /** the expected tool may report an error (e.g. "not found" is the right answer) */
  allowToolError?: boolean;
  /** regex sources the answer must match */
  mustMatch?: string[];
  /** substrings the answer must not contain */
  mustNotContain?: string[];
  /** true: answered from user data (private); false: catalog answer from the model */
  expectPrivate?: boolean;
}

export interface EvalRun {
  answer: string;
  refused?: boolean;
  private?: boolean;
  trace: Array<{ tool: string; ok: boolean }>;
}

export interface EvalCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export interface EvalResult {
  id: string;
  question: string;
  pass: boolean;
  score: number;
  checks: EvalCheck[];
  latencyMs?: number;
}

export function gradeRun(c: EvalCase, run: EvalRun, latencyMs?: number): EvalResult {
  const checks: EvalCheck[] = [];
  checks.push({ name: 'answered', pass: !!run.answer.trim() && !run.refused, detail: run.refused ? 'refused' : run.answer.trim() ? undefined : 'empty answer' });
  if (c.expectTool) {
    const hit = run.trace.find((t) => t.tool === c.expectTool);
    checks.push({ name: `tool:${c.expectTool}`, pass: !!hit && (hit.ok || !!c.allowToolError), detail: hit ? (hit.ok ? undefined : 'tool failed') : `called ${run.trace.map((t) => t.tool).join(', ') || 'no tool'}` });
  }
  for (const src of c.mustMatch ?? []) {
    const ok = new RegExp(src, 'i').test(run.answer);
    checks.push({ name: `matches:${src}`, pass: ok, detail: ok ? undefined : run.answer.slice(0, 160) });
  }
  for (const s of c.mustNotContain ?? []) checks.push({ name: `excludes:${s}`, pass: !run.answer.includes(s) });
  if (c.expectPrivate !== undefined) checks.push({ name: c.expectPrivate ? 'private' : 'catalog-only', pass: !!run.private === c.expectPrivate });
  const passed = checks.filter((x) => x.pass).length;
  return { id: c.id, question: c.question, pass: passed === checks.length, score: checks.length ? passed / checks.length : 1, checks, latencyMs };
}

export interface EvalSummary {
  cases: number;
  passed: number;
  passRate: number;
  meanScore: number;
  failures: Array<{ id: string; failed: string[] }>;
}

export function summarize(results: EvalResult[]): EvalSummary {
  const passed = results.filter((r) => r.pass).length;
  return {
    cases: results.length,
    passed,
    passRate: results.length ? passed / results.length : 1,
    meanScore: results.length ? results.reduce((s, r) => s + r.score, 0) / results.length : 1,
    failures: results.filter((r) => !r.pass).map((r) => ({ id: r.id, failed: r.checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ''}`) })),
  };
}

export function toMarkdown(model: string, results: EvalResult[]): string {
  const s = summarize(results);
  const rows = results.map((r) => `| ${r.id} | ${r.pass ? '✅' : '❌'} | ${Math.round(r.score * 100)} % | ${r.latencyMs ?? '—'} | ${r.checks.filter((c) => !c.pass).map((c) => c.name).join(', ') || '—'} |`);
  return [`# Eval report — ${model}`, '', `Passed ${s.passed}/${s.cases} (${Math.round(s.passRate * 100)} %), mean score ${Math.round(s.meanScore * 100)} %.`, '', '| Case | Pass | Score | ms | Failed checks |', '|---|---|---|---|---|', ...rows, ''].join('\n');
}

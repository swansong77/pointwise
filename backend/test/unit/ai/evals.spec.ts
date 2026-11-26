import { gradeRun, summarize, toMarkdown } from '../../../src/ai/evals';

describe('eval grader', () => {
  const c = { id: 'EV-X', question: 'q', expectTool: 'get_five24_status', mustMatch: ['Jordan: \\d/24'], mustNotContain: ['secret'], expectPrivate: true };

  it('passes when tool, facts, exclusions and privacy all hold', () => {
    const r = gradeRun(c, { answer: 'Jordan: 5/24', private: true, trace: [{ tool: 'get_five24_status', ok: true }] }, 12);
    expect(r).toMatchObject({ pass: true, score: 1, latencyMs: 12 });
    expect(r.checks.map((x) => x.name)).toEqual(['answered', 'tool:get_five24_status', 'matches:Jordan: \\d/24', 'excludes:secret', 'private']);
  });

  it('reports each failed check with detail', () => {
    const r = gradeRun(c, { answer: 'a secret', private: false, trace: [{ tool: 'get_offers', ok: true }] });
    expect(r.pass).toBe(false);
    expect(r.score).toBeCloseTo(1 / 5);
    expect(r.checks.filter((x) => !x.pass).map((x) => [x.name, x.detail])).toEqual([
      ['tool:get_five24_status', 'called get_offers'],
      ['matches:Jordan: \\d/24', 'a secret'],
      ['excludes:secret', undefined],
      ['private', undefined],
    ]);
    expect(gradeRun(c, { answer: 'x', trace: [{ tool: 'get_five24_status', ok: false }] }).checks[1]).toMatchObject({ pass: false, detail: 'tool failed' });
    expect(gradeRun({ ...c, allowToolError: true }, { answer: 'x', trace: [{ tool: 'get_five24_status', ok: false }] }).checks[1].pass).toBe(true);
    expect(gradeRun({ id: 'n', question: 'q' }, { answer: ' ', trace: [] }).checks[0]).toMatchObject({ pass: false, detail: 'empty answer' });
    expect(gradeRun({ id: 'n', question: 'q', expectTool: 't' }, { answer: 'no', refused: true, trace: [] }).checks.map((x) => x.detail)).toEqual(['refused', 'called no tool']);
    expect(gradeRun({ id: 'p', question: 'q', expectPrivate: false }, { answer: 'ok', trace: [] }).pass).toBe(true);
  });

  it('summarises and renders a markdown report', () => {
    const ok = gradeRun({ id: 'A', question: 'q' }, { answer: 'fine', trace: [] }, 5);
    const bad = gradeRun({ id: 'B', question: 'q', mustMatch: ['x'] }, { answer: 'y', trace: [] });
    const s = summarize([ok, bad]);
    expect(s).toMatchObject({ cases: 2, passed: 1, passRate: 0.5, meanScore: 0.75, failures: [{ id: 'B', failed: ['matches:x (y)'] }] });
    expect(summarize([])).toMatchObject({ passRate: 1, meanScore: 1 });
    const md = toMarkdown('demo', [ok, bad]);
    expect(md).toContain('Passed 1/2 (50 %), mean score 75 %.');
    expect(md).toContain('| A | ✅ | 100 % | 5 | — |');
    expect(md).toContain('| B | ❌ | 50 % | — | matches:x |');
  });
});

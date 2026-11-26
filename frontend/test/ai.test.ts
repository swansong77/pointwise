import { answerLines, budgetLabel, toolLabel, usd, SUGGESTED_QUESTIONS } from '@/lib/ai';

describe('assistant helpers', () => {
  it('answerLines splits bullets and paragraphs without HTML', () => {
    expect(answerLines('Benefits: $1\n• Dining (Gold): $10 left\n- Rideshare\n1. First\n\n<b>x</b>')).toEqual([
      { bullet: false, text: 'Benefits: $1' },
      { bullet: true, text: 'Dining (Gold): $10 left' },
      { bullet: true, text: 'Rideshare' },
      { bullet: true, text: 'First' },
      { bullet: false, text: '<b>x</b>' },
    ]);
    expect(answerLines('')).toEqual([]);
  });
  it('labels tools, including external MCP tools', () => {
    expect(toolLabel('get_five24_status')).toBe('5/24 status');
    expect(toolLabel('mcp_docs_search')).toBe('External: docs_search');
    expect(toolLabel('something_else')).toBe('something_else');
  });
  it('budget and money formatting', () => {
    expect(budgetLabel(12345, 2000000)).toBe('12,345 / 2,000,000 tokens (1%)');
    expect(budgetLabel(5, 0)).toBe('5 / 0 tokens (0%)');
    expect(budgetLabel(3_000_000, 2_000_000)).toMatch(/\(100%\)$/);
    expect(usd(0)).toBe('$0.00');
    expect(usd(0.004)).toBe('<$0.01');
    expect(usd(12.345)).toBe('$12.35');
  });
  it('ships the spec questions as suggestions', () => {
    expect(SUGGESTED_QUESTIONS).toContain('What is my current 5/24 status?');
  });
});

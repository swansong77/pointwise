import { describe, expect, it } from 'vitest';
import { titleCase } from '@/lib/title-case';

describe('titleCase', () => {
  it('capitalises each word and keeps small words lower', () => {
    expect(titleCase('Benefit audit')).toBe('Benefit Audit');
    expect(titleCase('plan a purchase')).toBe('Plan a Purchase');
    expect(titleCase('Status & memberships')).toBe('Status & Memberships');
    expect(titleCase('Imports & conflicts')).toBe('Imports & Conflicts');
    expect(titleCase('Loyalty health')).toBe('Loyalty Health');
    expect(titleCase('the best card of the year')).toBe('The Best Card of the Year');
    expect(titleCase('year-to-date spend')).toBe('Year-To-Date Spend');
  });
  it('leaves brands, numbers and acronyms alone', () => {
    expect(titleCase('AI & MCP')).toBe('AI & MCP');
    expect(titleCase('5/24 status')).toBe('5/24 Status');
    expect(titleCase('PointWise assistant')).toBe('PointWise Assistant');
    expect(titleCase('$/1M in')).toBe('$/1M in');
    expect(titleCase('Waiting for review (3)')).toBe('Waiting for Review (3)');
  });
  it('never changes sentences', () => {
    expect(titleCase('Add a card to your wallet, then try again.')).toBe('Add a card to your wallet, then try again.');
    expect(titleCase('Is anything missing?')).toBe('Is anything missing?');
    expect(titleCase('one two three four five six seven eight nine ten')).toBe('one two three four five six seven eight nine ten');
    expect(titleCase('')).toBe('');
    expect(titleCase(7)).toBe('7');
  });
});

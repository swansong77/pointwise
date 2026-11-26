import { describe, expect, it } from 'vitest';
import { accountLabel, LEVELS, METHOD_LABEL, VALIDATION_TONE, validationSummary } from '../src/lib/benefit-audit';

const v = (over = {}) => ({ status: 'PASS' as const, confidence: 100, statementCount: 12, importedCount: 12, differenceCount: 0, statementCents: 50000, importedCents: 50000, missingCents: 0, notes: [], ...over });

describe('benefit audit helpers', () => {
  it('labels an account with its card, last digits and cardholder', () => {
    expect(accountLabel({ card: 'Amex Gold', lastFour: '1001', cardholder: 'Me' })).toBe('Amex Gold ··1001 (Me)');
    expect(accountLabel({ card: 'Amex Gold', lastFour: null, cardholder: null })).toBe('Amex Gold');
  });
  it('offers the four levels', () => {
    expect(LEVELS.map((l) => l.id)).toEqual(['account', 'cardholder', 'product', 'household']);
  });
  it('summarises validation', () => {
    expect(validationSummary(v())).toBe('All 12 transactions on the statement were imported.');
    expect(validationSummary(v({ status: 'WARNING', importedCount: 11, differenceCount: 1, missingCents: 2500 }))).toBe('11 of 12 transactions imported · $25 not captured');
    expect(validationSummary(v({ status: 'FAILED', importedCount: 3, missingCents: 0 }))).toBe('3 of 12 transactions imported');
    expect(VALIDATION_TONE).toEqual({ PASS: 'green', WARNING: 'amber', FAILED: 'red' });
  });
  it('names every detection method', () => {
    for (const m of ['EXACT', 'ALIAS', 'REGEX', 'FUZZY', 'AI', 'MANUAL']) expect(METHOD_LABEL[m]).toBeTruthy();
  });
});

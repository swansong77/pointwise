import { describe, expect, it } from 'vitest';
import { ADMIN_NAV, NAV } from '../src/lib/nav';
import { confidenceText, confidenceTone, isOpenShortcut, matchPages, mergeSuggestions, moveIndex, Suggestion } from '../src/lib/search';

const key = (o: Partial<{ key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }>) => ({
  key: 'k',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...o,
});

describe('search helpers', () => {
  it('opens on Ctrl+K and Cmd+K only', () => {
    expect(isOpenShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isOpenShortcut(key({ metaKey: true }))).toBe(true);
    expect(isOpenShortcut(key({ ctrlKey: true, key: 'K' }))).toBe(true);
    expect(isOpenShortcut(key({}))).toBe(false);
    expect(isOpenShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isOpenShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isOpenShortcut(key({ ctrlKey: true, key: 'j' }))).toBe(false);
  });

  it('finds pages by the start of their name or of any word in it', () => {
    expect(matchPages('exp', NAV).map((p) => p.label)).toEqual(['Expirations']);
    expect(matchPages('household', NAV).map((p) => p.label)).toEqual(expect.arrayContaining(['Household', 'Household Offers']));
    expect(matchPages('offer inv', NAV).map((p) => p.label)).toEqual(['Offer Inventory']);
    expect(matchPages('x', NAV)).toEqual([]);
    expect(matchPages('', NAV)).toEqual([]);
    expect(matchPages('backup', ADMIN_NAV)[0]).toMatchObject({ type: 'PAGE', href: '/admin/backup' });
    expect(matchPages('sav', NAV, 1)).toHaveLength(1);
  });

  it('puts matching pages after the question and before the other results', () => {
    const server: Suggestion[] = [
      { type: 'QUERY', id: 'ask', label: 'q', query: 'q' },
      { type: 'ENTITY', id: 'e1', label: 'Hilton' },
    ];
    const pages: Suggestion[] = [{ type: 'PAGE', id: 'p', label: 'Offers', href: '/offers' }];
    expect(mergeSuggestions(server, pages).map((s) => s.id)).toEqual(['ask', 'p', 'e1']);
    expect(mergeSuggestions([server[0]], pages).map((s) => s.id)).toEqual(['ask', 'p']);
    expect(mergeSuggestions([], [])).toEqual([]);
  });

  it('moves the highlight with wrap-around', () => {
    expect(moveIndex(-1, 1, 3)).toBe(0);
    expect(moveIndex(-1, -1, 3)).toBe(2);
    expect(moveIndex(2, 1, 3)).toBe(0);
    expect(moveIndex(0, -1, 3)).toBe(2);
    expect(moveIndex(1, 1, 0)).toBe(-1);
  });

  it('describes confidence in words', () => {
    expect([confidenceText(90), confidenceText(60), confidenceText(10)]).toEqual(['High', 'Medium', 'Low']);
    expect([confidenceTone(90), confidenceTone(50), confidenceTone(0)]).toEqual(['green', 'amber', 'slate']);
  });
});

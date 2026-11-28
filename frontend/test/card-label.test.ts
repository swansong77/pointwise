import { cardLabel, cardOwners } from '../src/lib/card-label';
import type { WalletCard } from '../src/lib/types';

describe('card labels', () => {
  it('names the card, its owner and the last digits, leaving out what is not known', () => {
    expect(cardLabel({ nickname: 'Travel', card: { name: 'Venture X' }, profile: { nickname: 'Riley' }, lastFour: '8047' })).toBe('Travel · Riley ··8047');
    expect(cardLabel({ card: { name: 'Venture X' }, profile: { nickname: 'Riley' }, lastFour: null })).toBe('Venture X · Riley');
    expect(cardLabel({ card: { name: 'Venture X' }, profile: null, lastFour: '8047' })).toBe('Venture X ··8047');
    // a transaction row carries the same facts under other names
    expect(cardLabel({ name: 'Venture X', owner: { nickname: 'Sam' }, lastFour: '2222' })).toBe('Venture X · Sam ··2222');
  });
  it('lists each holder once, in the order first met, skipping cards without one', () => {
    const c = (id: string | null, nick = 'x') => ({ profile: id ? { id, nickname: nick, relationship: 'OTHER', isPrimary: false } : null }) as unknown as WalletCard;
    expect(cardOwners([c('a', 'Riley'), c(null), c('b', 'Sam'), c('a', 'Riley')])).toEqual([
      { id: 'a', nickname: 'Riley' },
      { id: 'b', nickname: 'Sam' },
    ]);
  });
});

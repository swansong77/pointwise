import type { WalletCard } from './types';

/** "Venture X · Riley ··8047": card name, whose card it is (only when it has an owner) and the last digits (only when known). */
export function cardLabel(w: { nickname?: string | null; name?: string; card?: { name: string }; owner?: { nickname: string } | null; profile?: { nickname: string } | null; lastFour?: string | null }) {
  const name = w.nickname || w.name || w.card?.name || 'Card';
  const owner = (w.owner ?? w.profile)?.nickname;
  return `${name}${owner ? ` · ${owner}` : ''}${w.lastFour ? ` ··${w.lastFour}` : ''}`;
}

/** The household members who hold at least one of the cards, in the order first met (for a "whose cards" filter). */
export function cardOwners(cards: WalletCard[]) {
  const seen = new Map<string, string>();
  for (const c of cards) if (c.profile && !seen.has(c.profile.id)) seen.set(c.profile.id, c.profile.nickname);
  return [...seen].map(([id, nickname]) => ({ id, nickname }));
}

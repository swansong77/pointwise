import { rankCards } from '../src/domain/recommendation.engine';
import { calculateWalletValue } from '../src/domain/calculator';
const cats = Array.from({ length: 16 }, (_, i) => 'c' + i);
const cards = Array.from({ length: 50 }, (_, i) => ({
  id: 'w' + i, nickname: null, status: 'APPROVED' as const, approvedAt: null, closedAt: null, annualFeeOverrideCents: null, bonusEarned: false, bonusSpendCents: 0, selectedCategoryIds: [],
  card: { id: 'k' + i, name: 'Card ' + i, color: '#000', type: 'PERSONAL' as const, annualFeeCents: 9500, bonusSpendCents: null, bonusMonths: null, bonusPoints: null,
    currency: { id: 'cur' + (i % 5), code: 'X', centsPerPoint: 1 + (i % 5) * 0.25, isCash: false },
    rewards: cats.slice(0, 6).map((c, j) => ({ id: `r${i}${j}`, categoryId: cats[(i + j) % 16], merchantId: null, multiplier: 1 + ((i * j) % 5), description: 'x', isRotating: false, startsAt: null, endsAt: null })) },
}));
const N = 2000;
let t = process.hrtime.bigint();
for (let n = 0; n < N; n++) for (const c of cats) rankCards(cards, { categoryId: c, fallbackCategoryId: 'c15' });
let ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`rank 50 cards x 16 categories: ${(ms / N).toFixed(3)} ms per dashboard`);
t = process.hrtime.bigint();
for (let n = 0; n < N; n++) calculateWalletValue(cards, cats.map((c) => ({ categoryId: c, annualSpendCents: 100000 })), { fallbackCategoryId: 'c15' });
ms = Number(process.hrtime.bigint() - t) / 1e6;
console.log(`calculator 50 cards x 16 categories: ${(ms / N).toFixed(3)} ms per call`);

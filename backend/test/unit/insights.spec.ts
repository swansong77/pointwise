import { addMonths, bonusProgress, daysBetween, fiveTwentyFour, nextAnniversary, startOfUtcDay, upcomingRenewals } from '../../src/domain/insights';
import { card, wc } from './fixtures';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('insights', () => {
  describe('addMonths', () => {
    it('adds months', () => expect(addMonths(d('2026-01-15'), 3).toISOString().slice(0, 10)).toBe('2026-04-15'));
    it('clamps to month end', () => expect(addMonths(d('2026-01-31'), 1).toISOString().slice(0, 10)).toBe('2026-02-28'));
    it('handles leap years', () => expect(addMonths(d('2024-02-29'), 12).toISOString().slice(0, 10)).toBe('2025-02-28'));
    it('subtracts months across years', () => expect(addMonths(d('2026-02-10'), -24).toISOString().slice(0, 10)).toBe('2024-02-10'));
  });

  it('daysBetween / startOfUtcDay', () => {
    expect(daysBetween(d('2026-01-01'), d('2026-01-31'))).toBe(30);
    expect(startOfUtcDay(new Date('2026-05-05T23:59:59Z')).toISOString()).toBe('2026-05-05T00:00:00.000Z');
  });

  describe('fiveTwentyFour', () => {
    const now = d('2026-06-01');
    const personal = (id: string, approved: string, extra = {}) => wc({ id, card: card({ id: `c-${id}` }), approvedAt: d(approved), ...extra });
    it('counts personal approvals in the last 24 months', () => {
      const res = fiveTwentyFour(
        [
          personal('a', '2025-01-01'),
          personal('b', '2024-06-02'), // inside (window starts 2024-06-01, exclusive)
          personal('c', '2024-06-01'), // exactly 24 months → excluded
          personal('d', '2026-03-01', { status: 'CLOSED' }), // closed still counts
          personal('e', '2026-05-01', { status: 'DENIED' }), // denied doesn't count
          wc({ id: 'f', card: card({ id: 'biz', type: 'BUSINESS' }), approvedAt: d('2026-01-01') }), // business excluded
          personal('g', '2026-07-01'), // future → excluded
          wc({ id: 'h', card: card({ id: 'h' }) }), // no date
        ],
        now,
      );
      expect(res.count).toBe(3);
      expect(res.countedWalletCardIds.sort()).toEqual(['a', 'b', 'd']);
      expect(res.nextDropAt?.toISOString().slice(0, 10)).toBe('2026-06-02');
      expect(res.underLimit).toBe(true);
    });
    it('reports over limit and null drop when empty', () => {
      const five = ['a', 'b', 'c', 'd', 'e'].map((id, i) => personal(id, `2026-0${i + 1}-01`));
      expect(fiveTwentyFour(five, now).underLimit).toBe(false);
      expect(fiveTwentyFour([], now)).toMatchObject({ count: 0, nextDropAt: null, underLimit: true });
    });
    it('defaults now', () => expect(fiveTwentyFour([]).count).toBe(0));
  });

  describe('nextAnniversary', () => {
    it('first renewal one year after approval', () =>
      expect(nextAnniversary(d('2026-03-10'), d('2026-06-01')).toISOString().slice(0, 10)).toBe('2027-03-10'));
    it('this year when still ahead', () =>
      expect(nextAnniversary(d('2023-09-10'), d('2026-06-01')).toISOString().slice(0, 10)).toBe('2026-09-10'));
    it('next year when already passed', () =>
      expect(nextAnniversary(d('2023-02-10'), d('2026-06-01')).toISOString().slice(0, 10)).toBe('2027-02-10'));
    it('today counts as upcoming', () =>
      expect(nextAnniversary(d('2024-06-01'), new Date('2026-06-01T15:00:00Z')).toISOString().slice(0, 10)).toBe('2026-06-01'));
    it('Feb 29 approval → Feb 28 in non-leap years', () =>
      expect(nextAnniversary(d('2024-02-29'), d('2026-01-01')).toISOString().slice(0, 10)).toBe('2026-02-28'));
  });

  describe('upcomingRenewals', () => {
    const now = d('2026-06-01');
    const mk = (id: string, approved: string, fee: number, extra = {}) =>
      wc({ id, card: card({ id: `c${id}`, name: `Card ${id}`, annualFeeCents: fee }), approvedAt: d(approved), ...extra });
    it('lists fee cards renewing within the window, soonest first', () => {
      const res = upcomingRenewals(
        [mk('a', '2025-07-15', 9500), mk('b', '2025-06-10', 25000), mk('c', '2025-06-05', 0), mk('d', '2025-12-01', 9500), mk('e', '2025-06-20', 9500, { status: 'CLOSED' }), wc({ id: 'f', card: card({ id: 'f', annualFeeCents: 100 }) })],
        now,
        60,
      );
      expect(res.map((r) => r.walletCardId)).toEqual(['b', 'a']);
      expect(res[0]).toMatchObject({ daysUntil: 9, annualFeeCents: 25000, name: 'Card b' });
    });
    it('includes no-fee cards when asked and uses fee override & nickname', () => {
      const res = upcomingRenewals([mk('c', '2025-06-05', 0, { nickname: 'Freebie' }), mk('x', '2025-06-06', 9500, { annualFeeOverrideCents: 0 })], now, 60, true);
      expect(res.map((r) => r.name)).toEqual(['Freebie', 'Card x']);
      expect(res[1].annualFeeCents).toBe(0);
    });
    it('defaults', () => expect(upcomingRenewals([])).toEqual([]));
  });

  describe('bonusProgress', () => {
    const now = d('2026-06-01');
    const bonusCard = card({ id: 'bc', name: 'Bonus Card', bonusSpendCents: 400_000, bonusMonths: 3 });
    it('computes percent, deadline and risk', () => {
      const res = bonusProgress(
        [
          wc({ id: 'risk', card: bonusCard, approvedAt: d('2026-03-15'), bonusSpendCents: 100_000 }), // deadline 06-15, 14 days, 25%
          wc({ id: 'ok', card: bonusCard, approvedAt: d('2026-05-01'), bonusSpendCents: 350_000 }), // 88%
          wc({ id: 'done', card: bonusCard, approvedAt: d('2026-05-01'), bonusSpendCents: 400_000 }), // earned by spend
          wc({ id: 'flag', card: bonusCard, approvedAt: d('2026-05-01'), bonusEarned: true }),
          wc({ id: 'late', card: bonusCard, approvedAt: d('2025-01-01') }), // deadline passed
          wc({ id: 'nobonus', card: card({ id: 'nb' }), approvedAt: d('2026-05-01') }),
          wc({ id: 'applied', card: bonusCard, status: 'APPLIED', approvedAt: d('2026-05-01') }),
        ],
        now,
      );
      expect(res.map((b) => b.walletCardId)).toEqual(['risk', 'ok']);
      expect(res[0]).toMatchObject({ percent: 25, daysLeft: 14, atRisk: true, earned: false });
      expect(res[1]).toMatchObject({ percent: 88, atRisk: false });
    });
    it('clamps negative spend and caps percent', () => {
      const res = bonusProgress([wc({ id: 'neg', card: bonusCard, approvedAt: d('2026-05-20'), bonusSpendCents: -5 })], now);
      expect(res[0].spentCents).toBe(0);
    });
    it('defaults now', () => expect(bonusProgress([])).toEqual([]));
  });
});

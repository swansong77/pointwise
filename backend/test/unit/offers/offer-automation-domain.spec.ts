import { categoriesOf, effectiveValueCents, evaluateRules, Rule } from '../../../src/domain/offer-enrollment-rules';
import { contentHash, diffInventory, InvItem, inventoryHash, StoredItem } from '../../../src/domain/offer-snapshot-diff';
import { AutoFilter, daysLeft, decide, duplicateCounts, passesAutoFilter, scoreOffer, SmartContext } from '../../../src/domain/offer-smart-enroll';
import { healthAfterFailure, isDue, isStaleRun, lastBoundary, MAX_ATTEMPTS, nextRunAt, pacingDelayMs, retryDelay, tzOffsetMs, validTimezone, zonedToUtc } from '../../../src/domain/offer-sync-plan';

const NOW = new Date('2026-11-26T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const inv = (o: Partial<InvItem> = {}): InvItem => ({
  externalId: 'x1',
  cardKey: 'card-a',
  merchantText: 'Hilton',
  title: 'Spend $500, get $250 back',
  offerType: 'STATEMENT_CREDIT',
  valueCents: 25_000,
  percent: null,
  points: null,
  minSpendCents: 50_000,
  endsAt: day(30),
  enrolled: false,
  ...o,
});
const stored = (o: Partial<StoredItem> = {}): StoredItem => {
  const base = inv(o);
  return { ...base, id: o.id ?? 's1', status: o.status ?? 'AVAILABLE', contentHash: contentHash(base) };
};

describe('offer snapshot diff', () => {
  it('finds new, unchanged and updated offers', () => {
    const a = stored({ externalId: 'a' });
    const b = stored({ id: 's2', externalId: 'b' });
    const r = diffInventory([a, b], [inv({ externalId: 'a' }), inv({ externalId: 'b', valueCents: 30_000 }), inv({ externalId: 'c' })], NOW);
    expect(r.added.map((x) => x.externalId)).toEqual(['c']);
    expect(r.unchanged.map((x) => x.externalId)).toEqual(['a']);
    expect(r.updated).toHaveLength(1);
    expect(r.updated[0].changes).toEqual([{ field: 'valueCents', from: 25_000, to: 30_000 }]);
  });

  it('keeps the same offer on two cards as two items', () => {
    const r = diffInventory([stored({ cardKey: 'card-a' })], [inv({ cardKey: 'card-a' }), inv({ cardKey: 'card-b' })], NOW);
    expect(r.added.map((x) => x.cardKey)).toEqual(['card-b']);
    expect(r.unchanged).toHaveLength(1);
  });

  it('classifies what disappeared: expired, redeemed, removed', () => {
    const items = [
      stored({ id: '1', externalId: 'e', endsAt: day(-1) }),
      stored({ id: '2', externalId: 'r', status: 'ENROLLED' }),
      stored({ id: '3', externalId: 'm' }),
      stored({ id: '4', externalId: 'k1' }),
      stored({ id: '5', externalId: 'k2' }),
      stored({ id: '6', externalId: 'k3' }),
      stored({ id: '7', externalId: 'k4' }),
      stored({ id: '8', externalId: 'k5' }),
    ];
    const keep = ['k1', 'k2', 'k3', 'k4', 'k5'].map((id) => inv({ externalId: id }));
    const r = diffInventory(items, keep, NOW);
    expect(r.expired.map((x) => x.id)).toEqual(['1']);
    expect(r.redeemed.map((x) => x.id)).toEqual(['2']);
    expect(r.removed.map((x) => x.id)).toEqual(['3']);
    expect(r.suspicious).toBe(false);
  });

  it('does not apply mass removal when the inventory collapses', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => stored({ id, externalId: id }));
    const r = diffInventory(items, [inv({ externalId: 'a' })], NOW);
    expect(r.suspicious).toBe(true);
    expect(r.removed).toHaveLength(0);
    expect(r.warnings[0]).toMatch(/shrank from 6 to 1/);
  });

  it('still expires offers past their end date when the inventory collapses', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((id) => stored({ id, externalId: id }));
    items.push(stored({ id: 'old', externalId: 'old', endsAt: day(-2) }));
    const r = diffInventory(items, [], NOW);
    expect(r.suspicious).toBe(true);
    expect(r.expired.map((x) => x.id)).toEqual(['old']);
  });

  it('notices offers the issuer now shows as enrolled, and offers that came back', () => {
    const r = diffInventory([stored({ id: '1', externalId: 'a' }), stored({ id: '2', externalId: 'b', status: 'REMOVED' })], [inv({ externalId: 'a', enrolled: true }), inv({ externalId: 'b' })], NOW);
    expect(r.newlyEnrolled.map((x) => x.id)).toEqual(['1']);
    expect(r.reappeared.map((x) => x.id)).toEqual(['2']);
  });

  it('ignores offers that are already over, and duplicate ids', () => {
    const r = diffInventory([], [inv({ externalId: 'z', endsAt: day(-1) }), inv({ externalId: 'q' }), inv({ externalId: 'q', valueCents: 1 })], NOW);
    expect(r.added.map((x) => x.externalId)).toEqual(['q']);
    expect(r.added[0].valueCents).toBe(25_000);
    expect(r.warnings[0]).toMatch(/already ended/);
  });

  it('expires an offer that is still listed after its end date', () => {
    const r = diffInventory([stored({ externalId: 'a' })], [inv({ externalId: 'a', endsAt: day(-1) })], NOW);
    expect(r.expired.map((x) => x.externalId)).toEqual(['a']);
    expect(r.updated).toHaveLength(0);
  });

  it('does not bring back an offer that is shown again after it ended', () => {
    const r = diffInventory([stored({ status: 'EXPIRED' })], [inv({ endsAt: day(-3) })], NOW);
    expect(r.reappeared).toHaveLength(0);
  });

  it('hashes are stable, order independent and sensitive to content', () => {
    const a = inv({ externalId: 'a' });
    const b = inv({ externalId: 'b' });
    expect(inventoryHash([a, b])).toBe(inventoryHash([b, a]));
    expect(inventoryHash([a, b])).not.toBe(inventoryHash([a, inv({ externalId: 'b', valueCents: 1 })]));
    expect(inventoryHash([a])).not.toBe(inventoryHash([inv({ externalId: 'a', enrolled: true })]));
    expect(contentHash(a)).toBe(contentHash(inv({ title: ' Spend $500, get $250 back ' })));
  });
});

describe('enrollment rules', () => {
  const rule = (o: Partial<Rule>): Rule => ({ id: 'r', label: 'rule', kind: 'ALWAYS', matcher: 'MERCHANT', matcherValue: 'hilton', priority: 100, enabled: true, ...o });
  const ctx = { spendMerchants: new Set(['starbucks']), accountId: 'acc' };

  it('categorises offers by merchant and title words', () => {
    expect(categoriesOf(inv())).toContain('travel');
    expect(categoriesOf(inv({ merchantText: 'DraftKings', title: 'Bet $10' }))).toContain('gambling');
    expect(categoriesOf(inv({ merchantText: 'Coinbase', title: 'x' }))).toContain('crypto');
    expect(categoriesOf(inv({ merchantText: 'Netflix', title: 'x' }))).toContain('subscription');
    expect(categoriesOf(inv({ merchantText: 'Joe Pizza', title: 'x', category: 'Food' }))).toEqual(expect.arrayContaining(['food', 'dining']));
  });

  it('estimates value for percent and points offers', () => {
    expect(effectiveValueCents({ valueCents: 500, percent: null, points: null, minSpendCents: null })).toBe(500);
    expect(effectiveValueCents({ valueCents: 0, percent: 10, points: null, minSpendCents: 20_000 })).toBe(2_000);
    expect(effectiveValueCents({ valueCents: 0, percent: 5, points: null, minSpendCents: null })).toBe(500);
    expect(effectiveValueCents({ valueCents: 0, percent: null, points: 3_000, minSpendCents: null })).toBe(3_000);
    expect(effectiveValueCents({ valueCents: 0, percent: null, points: null, minSpendCents: null })).toBe(0);
  });

  it('applies always rules and never rules, and never wins', () => {
    expect(evaluateRules(inv(), [rule({})], ctx).verdict).toBe('ALWAYS');
    expect(evaluateRules(inv(), [], ctx).verdict).toBeNull();
    const both = evaluateRules(inv(), [rule({ priority: 1 }), rule({ id: 'n', kind: 'NEVER', matcher: 'CATEGORY', matcherValue: 'travel', priority: 999, label: 'no travel' })], ctx);
    expect(both.verdict).toBe('NEVER');
    expect(both.explanation).toMatch(/wins over an always-rule/);
  });

  it('supports every matcher', () => {
    expect(evaluateRules(inv(), [rule({ matcher: 'MIN_VALUE', matcherValue: '2500' })], ctx).verdict).toBe('ALWAYS');
    expect(evaluateRules(inv({ valueCents: 200 }), [rule({ matcher: 'MIN_VALUE', matcherValue: '2500' })], ctx).verdict).toBeNull();
    expect(evaluateRules(inv(), [rule({ matcher: 'OFFER_TYPE', matcherValue: 'statement_credit' })], ctx).verdict).toBe('ALWAYS');
    expect(evaluateRules(inv(), [rule({ matcher: 'KEYWORD', matcherValue: 'get $250' })], ctx).verdict).toBe('ALWAYS');
    expect(evaluateRules(inv({ merchantText: 'Starbucks' }), [rule({ matcher: 'SPEND_HISTORY', matcherValue: '' })], ctx).verdict).toBe('ALWAYS');
    expect(evaluateRules(inv(), [rule({ matcher: 'SPEND_HISTORY', matcherValue: '' })], ctx).verdict).toBeNull();
    expect(evaluateRules(inv(), [rule({ matcher: 'MERCHANT', matcherValue: '' })], ctx).verdict).toBeNull();
    expect(evaluateRules(inv({ merchantText: 'Hilton Hotels & Resorts' }), [rule({ matcherValue: 'hilton' })], ctx).verdict).toBe('ALWAYS');
  });

  it('honours scope and the enabled flag', () => {
    expect(evaluateRules(inv(), [rule({ enabled: false })], ctx).verdict).toBeNull();
    expect(evaluateRules(inv(), [rule({ accountId: 'other' })], ctx).verdict).toBeNull();
    expect(evaluateRules(inv(), [rule({ accountId: 'acc' })], ctx).verdict).toBe('ALWAYS');
    expect(evaluateRules(inv(), [rule({ walletCardId: 'card-b' })], ctx).verdict).toBeNull();
    expect(evaluateRules(inv(), [rule({ walletCardId: 'card-a' })], ctx).verdict).toBe('ALWAYS');
  });
});

describe('smart enrollment', () => {
  const base = (o: Partial<SmartContext> = {}): SmartContext => ({
    now: NOW,
    preferredMerchants: ['Hilton'],
    merchantSpendCount: new Map([['hilton', 4]]),
    merchantMembers: new Map([['hilton', 2]]),
    householdMembers: 2,
    goals: ['TRAVEL'],
    utilization: null,
    ...o,
  });
  const rctx = { spendMerchants: new Set<string>(), accountId: 'acc' };

  it('prioritizes a large offer from a preferred travel merchant', () => {
    const s = scoreOffer(inv({ endsAt: day(10) }), base());
    expect(s.overall).toBeGreaterThanOrEqual(85);
    expect(s.decision).toBe('SHOULD_PRIORITIZE');
    expect(s.reasons.join(' ')).toMatch(/A merchant you prefer/);
    expect(s.reasons.join(' ')).toMatch(/A travel offer/);
    expect(s.reasons.join(' ')).toMatch(/Ends in 10 day/);
  });

  it('ignores a small offer from an unknown merchant', () => {
    const s = scoreOffer(inv({ merchantText: 'Corner Coffee', title: '$2 back', valueCents: 200, minSpendCents: 1_000, endsAt: day(90) }), base({ preferredMerchants: [], merchantSpendCount: new Map(), merchantMembers: new Map() }));
    expect(s.overall).toBeLessThan(35);
    expect(s.decision).toBe('SHOULD_IGNORE');
  });

  it('scores an ended offer as zero and covers the score bands', () => {
    expect(scoreOffer(inv({ endsAt: day(-1) }), base()).overall).toBe(0);
    const ctx = base({ preferredMerchants: [], merchantSpendCount: new Map(), merchantMembers: new Map(), goals: [] });
    const s = (days: number | null, value: number) => scoreOffer(inv({ merchantText: 'Zed', title: 'x', valueCents: value, endsAt: days === null ? null : day(days) }), ctx).scores.expiration;
    expect([s(null, 1), s(5, 1), s(10, 1), s(20, 1), s(50, 1), s(200, 1)]).toEqual([40, 90, 75, 55, 40, 30]);
    expect(daysLeft(null, NOW)).toBeNull();
    expect(daysLeft(day(3), NOW)).toBe(3);
  });

  it('uses utilization, a large first purchase and household reach', () => {
    const ctx = base({ preferredMerchants: [], merchantSpendCount: new Map(), merchantMembers: new Map([['hilton', 1]]), utilization: 1 });
    const s = scoreOffer(inv({ minSpendCents: 50_000 }), ctx);
    expect(s.reasons.join(' ')).toMatch(/large first purchase/);
    expect(s.scores.household).toBe(65);
    expect(s.scores.likelihood).toBe(Math.round(Math.max(0, 25 * 0.7 + 30 - 15)));
  });

  it('modes: recommend only never enrolls; bulk approval recommends; auto needs a filter', () => {
    const item = inv({ endsAt: day(10) });
    expect(decide(item, 'RECOMMEND', {}, [], base(), rctx).action).toBe('RECOMMEND');
    expect(decide(item, 'BULK_APPROVAL', {}, [], base(), rctx).action).toBe('RECOMMEND');
    expect(decide(item, 'AUTO', {}, [], base(), rctx).action).toBe('RECOMMEND');
    const auto = decide(item, 'AUTO', { categories: ['travel'] }, [], base(), rctx);
    expect(auto.action).toBe('ENROLL_NOW');
    expect(auto.reason).toMatch(/filter/);
  });

  it('review and ignore bands', () => {
    const ctx = base({ preferredMerchants: [], merchantSpendCount: new Map(), merchantMembers: new Map(), goals: [] });
    const mid = decide(inv({ merchantText: 'Zed Shop', title: 'x', valueCents: 5_000, endsAt: day(20) }), 'AUTO', { allOffers: true }, [], ctx, rctx);
    expect(['REVIEW', 'IGNORE']).toContain(mid.action);
    const low = decide(inv({ merchantText: 'Zed Shop', title: 'x', valueCents: 100, endsAt: day(90) }), 'AUTO', { allOffers: true }, [], ctx, rctx);
    expect(low.action).toBe('IGNORE');
    expect(low.state).toBe('IGNORED');
    const review = decide(inv({ merchantText: 'Zed Shop', title: 'x', valueCents: 12_000, endsAt: day(20) }), 'RECOMMEND', {}, [], ctx, rctx);
    expect(review.action).toBe('REVIEW');
    expect(review.state).toBe('PENDING_REVIEW');
  });

  it('rules override the score: never ignores, always enrolls only in auto mode', () => {
    const never: Rule = { id: 'n', label: 'No gambling', kind: 'NEVER', matcher: 'CATEGORY', matcherValue: 'gambling', priority: 1, enabled: true };
    const always: Rule = { id: 'a', label: 'Coffee', kind: 'ALWAYS', matcher: 'MERCHANT', matcherValue: 'corner coffee', priority: 1, enabled: true };
    const bet = inv({ merchantText: 'DraftKings', title: 'Bet', valueCents: 50_000 });
    const d1 = decide(bet, 'AUTO', { allOffers: true }, [never], base(), rctx);
    expect(d1.action).toBe('IGNORE');
    expect(d1.ruleId).toBe('n');
    const coffee = inv({ merchantText: 'Corner Coffee', title: '$2', valueCents: 200 });
    expect(decide(coffee, 'AUTO', {}, [always], base(), rctx).action).toBe('ENROLL_NOW');
    const manual = decide(coffee, 'BULK_APPROVAL', {}, [always], base(), rctx);
    expect(manual.action).toBe('RECOMMEND');
    expect(manual.reason).toMatch(/bulk approval/);
    expect(decide(coffee, 'RECOMMEND', {}, [always], base(), rctx).reason).toMatch(/recommend only/);
  });

  it('auto filter combinations', () => {
    const item = inv({ endsAt: day(10) });
    const ctx = base();
    const sc = scoreOffer(item, ctx);
    const f = (x: AutoFilter) => passesAutoFilter(item, sc, x, ctx);
    expect(f({ allOffers: true })).toBe(true);
    expect(f({})).toBe(false);
    expect(f({ minScore: 10 })).toBe(false);
    expect(f({ minValueCents: 2_000 })).toBe(true);
    expect(f({ minValueCents: 90_000 })).toBe(false);
    expect(f({ preferredMerchants: ['Hilton'] })).toBe(true);
    expect(f({ preferredMerchants: ['Marriott'] })).toBe(false);
    expect(f({ matchSpendHistory: true })).toBe(true);
    expect(f({ categories: ['dining'] })).toBe(false);
    expect(f({ categories: ['travel'], minValueCents: 2_000, minScore: 50 })).toBe(true);
    expect(f({ categories: ['travel'], minScore: 101 })).toBe(false);
  });

  it('flags the same offer on several cards without merging them', () => {
    const rows = [{ ...inv({ cardKey: 'a' }), id: '1' }, { ...inv({ cardKey: 'b' }), id: '2' }, { ...inv({ merchantText: 'Other' }), id: '3' }];
    const d = duplicateCounts(rows);
    expect(d.get('1')).toBe(2);
    expect(d.get('2')).toBe(2);
    expect(d.has('3')).toBe(false);
  });
});

describe('sync plan', () => {
  const acct = { cadence: 'DAILY' as const, syncHour: 2, timezone: 'America/New_York' };

  it('computes time zone offsets and the 2 AM local instant', () => {
    expect(tzOffsetMs(new Date('2026-01-15T12:00:00Z'), 'America/New_York')).toBe(-5 * 3_600_000);
    expect(tzOffsetMs(new Date('2026-07-15T12:00:00Z'), 'America/New_York')).toBe(-4 * 3_600_000);
    expect(zonedToUtc(2026, 11, 26, 2, 'America/New_York').toISOString()).toBe('2026-11-26T07:00:00.000Z');
    expect(zonedToUtc(2026, 7, 4, 2, 'America/New_York').toISOString()).toBe('2026-07-04T06:00:00.000Z');
    expect(validTimezone('America/Chicago')).toBe(true);
    expect(validTimezone('Mars/Base')).toBe(false);
  });

  it('daily: boundary and next run around 2 AM local', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    expect(lastBoundary(acct, now)!.toISOString()).toBe('2026-11-26T07:00:00.000Z');
    expect(nextRunAt(acct, now)!.toISOString()).toBe('2026-11-27T07:00:00.000Z');
    const early = new Date('2026-11-26T05:00:00Z');
    expect(lastBoundary(acct, early)!.toISOString()).toBe('2026-11-25T07:00:00.000Z');
    expect(nextRunAt(acct, early)!.toISOString()).toBe('2026-11-26T07:00:00.000Z');
  });

  it('weekly runs on Monday and monthly on the 1st', () => {
    const now = new Date('2026-11-26T12:00:00Z'); // a Thursday
    expect(nextRunAt({ ...acct, cadence: 'WEEKLY' }, now)!.toISOString()).toBe('2026-11-30T07:00:00.000Z');
    expect(lastBoundary({ ...acct, cadence: 'WEEKLY' }, now)!.toISOString()).toBe('2026-11-23T07:00:00.000Z');
    expect(nextRunAt({ ...acct, cadence: 'MONTHLY' }, now)!.toISOString()).toBe('2026-12-01T07:00:00.000Z');
    expect(lastBoundary({ ...acct, cadence: 'MONTHLY' }, now)!.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    expect(nextRunAt({ ...acct, cadence: 'MANUAL' }, now)).toBeNull();
    expect(lastBoundary({ ...acct, cadence: 'MANUAL' }, now)).toBeNull();
  });

  it('is due once per boundary', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    expect(isDue(acct, null, now)).toBe(true);
    expect(isDue(acct, new Date('2026-11-26T07:05:00Z'), now)).toBe(false);
    expect(isDue(acct, new Date('2026-11-25T07:05:00Z'), now)).toBe(true);
    expect(isDue({ ...acct, cadence: 'MANUAL' }, null, now)).toBe(false);
  });

  it('retries transient failures with backoff and gives up', () => {
    expect(retryDelay('NETWORK', 1)).toBe(5 * 60_000);
    expect(retryDelay('SESSION_TIMEOUT', 2)).toBe(30 * 60_000);
    expect(retryDelay('NETWORK', MAX_ATTEMPTS)).toBeNull();
    expect(retryDelay('BAD_CREDENTIALS', 1)).toBeNull();
    expect(retryDelay('MFA_REQUIRED', 1)).toBeNull();
  });

  it('maps failures to account health and locks after repeated login failures', () => {
    expect(healthAfterFailure('BAD_CREDENTIALS', 1)).toBe('NEEDS_LOGIN');
    expect(healthAfterFailure('BAD_CREDENTIALS', 3)).toBe('LOCKED');
    expect(healthAfterFailure('LOCKED', 0)).toBe('LOCKED');
    expect(healthAfterFailure('MFA_REQUIRED', 0)).toBe('NEEDS_MFA');
    expect(healthAfterFailure('MFA_FAILED', 1)).toBe('NEEDS_MFA');
    expect(healthAfterFailure('SITE_CHANGED', 0)).toBe('ERROR');
    expect(healthAfterFailure('DISABLED', 0)).toBe('DISABLED');
    expect(healthAfterFailure('NETWORK', 0)).toBe('DEGRADED');
  });

  it('detects runs that never finished and paces accounts', () => {
    expect(isStaleRun(new Date(NOW.getTime() - 31 * 60_000), NOW)).toBe(true);
    expect(isStaleRun(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe(false);
    expect(isStaleRun(null, NOW)).toBe(false);
    expect(pacingDelayMs(0)).toBe(20_000);
    expect(pacingDelayMs(1)).toBe(60_000);
  });
});

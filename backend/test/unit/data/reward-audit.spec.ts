import { auditAll, auditCard, AuditCard, renderAudit } from '../../../src/domain/reward-audit';
import { auditCards } from '../../../src/seed/reward-audit-data';
import { RATE_CORRECTIONS, RATE_VERIFICATIONS } from '../../../src/seed/rate-verification';
import { CATEGORIES } from '../../../src/seed/categories';

const cur = new Set(['CASH', 'CHASE_UR']);
const card = (o: Partial<AuditCard> = {}): AuditCard => ({ slug: 'c', name: 'C', issuer: 'I', currency: 'CASH', feeDollars: 0, source: 'CURATED', rewards: [{ cat: 'everything-else', mult: 1, desc: '1% on everything' }], ...o });
const codes = (c: AuditCard) => auditCard(c, cur).map((f) => f.code);

describe('reward audit rules', () => {
  it('a clean card has no findings except that nothing is confirmed', () => {
    expect(codes(card())).toEqual(['UNVERIFIED']);
    expect(codes(card({ rewards: [{ cat: 'everything-else', mult: 1, desc: 'x', verifiedOn: '2026-11-26' }] }))).toEqual([]);
  });
  it('finds missing, removed and conditional base rates and empty cards', () => {
    expect(codes(card({ rewards: [] }))).toEqual(['NO_REWARDS']);
    expect(codes(card({ rewards: [{ cat: 'dining', mult: 3, desc: '3x dining' }] }))).toContain('NO_BASE');
    expect(codes(card({ curatedHadBase: true, rewards: [{ cat: 'dining', mult: 3, desc: '3x dining' }] }))).toContain('BASE_REMOVED');
    expect(codes(card({ rewards: [{ cat: 'everything-else', mult: 2, desc: 'x', conditional: true }] }))).toContain('NO_BASE');
  });
  it('finds impossible values, a cap without a period, caps with no base, combined caps and duplicates', () => {
    const c = codes(card({ rewards: [{ cat: 'everything-else', mult: 1, desc: 'b' }, { cat: 'gas', mult: 0, desc: 'x' }, { mult: 2, desc: 'nothing' }, { cat: 'dining', mult: 3, desc: 'd', cap: 1000 }, { cat: 'dining', mult: 3, desc: 'd', cap: 1000, capPeriod: 'YEAR' }] }));
    expect(c).toEqual(expect.arrayContaining(['BAD_MULTIPLIER', 'NO_TARGET', 'CAP_NO_PERIOD', 'DUPLICATE']));
    expect(codes(card({ rewards: [{ cat: 'dining', mult: 3, desc: '3x (combined $1,000 a year)', cap: 1000, capPeriod: 'YEAR' }] }))).toEqual(expect.arrayContaining(['CAP_NO_BASE', 'COMBINED_CAP']));
    expect(codes(card({ rewards: [{ cat: 'everything-else', mult: 1, desc: 'b' }, { cat: 'dining', mult: 3, desc: '3x combined with gas' }] }))).toContain('COMBINED_NO_CAP');
  });
  it('flags rates that look like a base but are not, very high category rates, and rates described as conditional', () => {
    expect(codes(card({ rewards: [{ cat: 'everything-else', mult: 5, desc: '5x on everything' }] }))).toContain('HIGH_BASE');
    expect(codes(card({ rewards: [{ cat: 'everything-else', mult: 5, desc: 'x', verifiedOn: '2026-11-26' }] }))).not.toContain('HIGH_BASE');
    const high = card({ rewards: [{ cat: 'everything-else', mult: 1, desc: 'b' }, { cat: 'airlines', mult: 7, desc: '7x airlines' }, { merchant: 'hilton', mult: 14, desc: '14x at Hilton' }] });
    expect(codes(high).filter((x) => x === 'HIGH_MULTIPLIER')).toHaveLength(1);
    const text = codes(card({ rewards: [{ cat: 'everything-else', mult: 1, desc: 'b' }, { cat: 'travel', mult: 5, desc: '5x through the Chase Travel portal' }, { cat: 'dining', mult: 3, desc: 'up to 5x at partner restaurants' }, { cat: 'gas', mult: 2, desc: 'choose your category' }] }));
    expect(text.filter((x) => x === 'TEXT_CONDITION')).toHaveLength(3);
    expect(codes(card({ rewards: [{ cat: 'everything-else', mult: 1, desc: 'b' }, { cat: 'travel', mult: 5, desc: '5x through the Chase Travel portal', conditional: true }] }))).not.toContain('TEXT_CONDITION');
  });
  it('flags a rate that is not above the base, and a currency without a valuation', () => {
    expect(codes(card({ rewards: [{ cat: 'everything-else', mult: 2, desc: 'b' }, { cat: 'dining', mult: 2, desc: '2x dining' }] }))).toContain('RATE_LE_BASE');
    expect(codes(card({ currency: 'MYSTERY' }))).toContain('NO_VALUATION');
  });
  it('summarises and renders a report', () => {
    const cards = [card({ slug: 'a', rewards: [{ cat: 'everything-else', mult: 1, desc: 'b', verifiedOn: '2026-11-26' }] }), card({ slug: 'b', rewards: [] }), card({ slug: 'c', rewards: [{ cat: 'everything-else', mult: 1, desc: 'b', verifiedOn: '2026-11-26' }, { cat: 'dining', mult: 3, desc: 'd' }] })];
    const a = auditAll(cards, ['CASH']);
    expect([a.cards, a.verifiedCards, a.partiallyVerified, a.unverifiedCards]).toEqual([3, 1, 1, 1]);
    const md = renderAudit(a, '2026-11-26', cards);
    expect(md).toMatch(/# Rewards audit/);
    expect(md).toMatch(/No earning rates at all/);
    expect(md).toMatch(/- `a` \(1 of 1 rates\)/);
  });
});

describe('the catalog\'s own rates', () => {
  const { cards, currencies } = auditCards();
  const result = auditAll(cards, currencies);
  // problems that are known and recorded in docs/rewards-audit.md: a card whose only base rate was removed for being doubtful
  const KNOWN_ERRORS = new Set(['amex-hilton-business:NO_BASE']);

  it('has no error that is not recorded as known', () => {
    const errors = result.findings.filter((f) => f.severity === 'error').map((f) => `${f.slug}:${f.code}`);
    expect(errors.filter((e) => !KNOWN_ERRORS.has(e))).toEqual([]);
  });
  it('no card has a capped rate without a period, a duplicate, or an unknown category', () => {
    const slugs = new Set(CATEGORIES.map((c) => c[0]));
    for (const c of cards) for (const r of c.rewards) if (r.cat) expect(slugs.has(r.cat)).toBe(true);
    expect(result.byCode.CAP_NO_PERIOD ?? 0).toBe(0);
    expect(result.byCode.DUPLICATE ?? 0).toBe(0);
  });
  it('every issuer-page check names a card and category that exist, and carries a page and a plausible rate', () => {
    const slugs = new Set(cards.map((c) => c.slug));
    const cats = new Set(CATEGORIES.map((c) => c[0]));
    for (const v of RATE_VERIFICATIONS) {
      expect(`${v.slug}:${slugs.has(v.slug)}`).toBe(`${v.slug}:true`);
      expect(v.url).toMatch(/^https:\/\//);
      expect(v.rates.length).toBeGreaterThan(0);
      for (const r of v.rates) {
        if (r.cat) expect(`${v.slug}:${r.cat}:${cats.has(r.cat)}`).toBe(`${v.slug}:${r.cat}:true`);
        expect(r.mult).toBeGreaterThan(0);
        expect(r.desc.length).toBeGreaterThan(8);
        if (r.cap) expect(r.capPeriod ?? 'YEAR').toMatch(/^(QUARTER|YEAR)$/);
      }
      // a confirmed card always states its base rate
      expect(`${v.slug}:${v.rates.some((r) => r.cat === 'everything-else' && !r.conditional)}`).toBe(`${v.slug}:true`);
    }
    for (const k of RATE_CORRECTIONS) expect(slugs.has(k.slug)).toBe(true);
  });
  it('the travel-portal rates are conditional, so they cannot win a category', () => {
    const csp = cards.find((c) => c.slug === 'chase-sapphire-preferred')!;
    expect(csp.rewards.find((r) => r.cat === 'travel' && r.mult === 5)?.conditional).toBe(true);
    expect(csp.rewards.find((r) => r.cat === 'travel' && r.mult === 2)?.conditional).toBeFalsy();
  });
  it('a listing that states category rates keeps the curated base rate', () => {
    expect(cards.find((c) => c.slug === 'navy-federal-flagship-rewards')!.rewards.some((r) => r.cat === 'everything-else')).toBe(true);
  });
});

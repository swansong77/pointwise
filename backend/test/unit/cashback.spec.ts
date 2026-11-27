import { freshness, parseRatesCsv, plannerRates, rankSites, rateReliability, readRateText, recommendCashback, siteHealth, SiteInfo, RateRow, UP_TO_FACTOR } from '../../src/domain/cashback';

const NOW = new Date('2026-12-01T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const site = (code: string, over: Partial<SiteInfo> = {}): SiteInfo => ({ code, name: code.toUpperCase(), kind: 'CASHBACK', homeUrl: `https://${code}.example.test`, pointCents: null, isActive: true, reachable: true, lastCheckedAt: daysAgo(0), failures: 0, ...over });
const rate = (siteCode: string, over: Partial<RateRow> = {}): RateRow => ({ site: siteCode, ratePercent: 2, pointsPerDollar: null, upTo: false, observedAt: daysAgo(1), expiresAt: null, method: 'MANUAL', source: 'test', conditions: null, ...over });
const input = (rates: RateRow[], sites: SiteInfo[], accounts: Record<string, string[]> = {}, amountCents = 50_000) => ({ amountCents, merchantName: 'Target', rates, sites, accounts: new Map(Object.entries(accounts)), payWith: 'Gold Card', now: NOW });

describe('TC-CB-READ: reading a rate from page text', () => {
  // the wording below is what real public store pages returned when checked
  it('takes the store-wide rate that is stated first, not a promotion mentioned later', () => {
    const r = readRateText('Target Coupons 1% Cash Back Here\'s how much you\'ll earn. Exclusive 7.5% Cash Back offer on select products');
    expect(r).toMatchObject({ ratePercent: 1, upTo: false, evidence: '1% Cash Back' });
    expect(r!.alsoSeen).toEqual(['7.5% Cash Back']);
  });
  it('reads "% of the price back" and marks "up to" as a best case', () => {
    expect(readRateText('Get 2% of the price back with our Target Cash Back offers')).toMatchObject({ ratePercent: 2, upTo: false });
    expect(readRateText('Get up to 9% of the price back with our Walmart Cash Back offers. 2% Cash Back on electronics')).toMatchObject({ ratePercent: 9, upTo: true });
  });
  it('knows a store with no cash back, and a points rate', () => {
    expect(readRateText('Walmart Coupons, Promo Codes & No Cash Back - November 2026 You’ll earn $5 on your first purchases')).toMatchObject({ ratePercent: 0, upTo: false });
    expect(readRateText('Earn 5 points per $1 at Hilton')).toMatchObject({ ratePercent: null, pointsPerDollar: 5 });
    expect(readRateText('Earn up to 10 miles per $1')).toMatchObject({ pointsPerDollar: 10, upTo: true });
  });
  it('finds nothing in text without a rate, and ignores nonsense numbers', () => {
    expect(readRateText('Welcome to our store. Free shipping on orders over $50.')).toBeNull();
    expect(readRateText('250% cash back!!')).toBeNull();
  });
});

describe('TC-CB-CSV: a rates spreadsheet', () => {
  it('reads rows, tolerates other header names, and reports bad rows by line without stopping', () => {
    const csv = ['Portal,Store,Cash Back,Expires,Terms', 'rakuten,target,2%,2026-12-31,new members', 'topcashback,walmart,up to 9%,,', 'bad,,5%,,', 'rakuten,costco,lots,,', 'rakuten,hilton,3,not-a-date,'].join('\n');
    const r = parseRatesCsv(csv);
    expect(r.rows.map((x) => [x.site, x.merchant, x.ratePercent, x.upTo])).toEqual([['rakuten', 'target', 2, false], ['topcashback', 'walmart', 9, true]]);
    expect(r.rows[0]).toMatchObject({ conditions: 'new members' });
    expect(r.rows[0].expiresAt?.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(r.errors.map((e) => e.line)).toEqual([4, 5, 6]);
  });
  it('needs the site, merchant and a rate column', () => {
    expect(parseRatesCsv('a,b\n1,2').errors[0].message).toMatch(/must name the columns/);
    expect(parseRatesCsv('').rows).toEqual([]);
  });
  it('reads a points column and quoted cells with commas', () => {
    const r = parseRatesCsv('site,merchant,points,conditions\nunited,"Hilton, Inc",5,"selected, brands"');
    expect(r.rows[0]).toMatchObject({ merchant: 'Hilton, Inc', pointsPerDollar: 5, ratePercent: null, conditions: 'selected, brands' });
  });
});

describe('TC-CB-TRUST: how far a rate and a site can be trusted', () => {
  it('ages a rate through fresh, recent, aging and stale', () => {
    expect([1, 3, 10, 25, 60].map((d) => freshness(daysAgo(d), NOW))).toEqual(['FRESH', 'FRESH', 'RECENT', 'AGING', 'STALE']);
  });
  it('trusts a recently read rate more than an old typed one, and an "up to" less, and an expired one not at all', () => {
    const base = { method: 'MANUAL', observedAt: daysAgo(1), upTo: false, expiresAt: null };
    expect(rateReliability({ ...base, method: 'AUTO' }, NOW)).toBeGreaterThan(rateReliability(base, NOW));
    expect(rateReliability({ ...base, observedAt: daysAgo(60) }, NOW)).toBeLessThan(rateReliability(base, NOW));
    expect(rateReliability({ ...base, upTo: true }, NOW)).toBeLessThan(rateReliability(base, NOW));
    expect(rateReliability({ ...base, expiresAt: daysAgo(1) }, NOW)).toBe(0);
  });
  it('calls a site down only after repeated failed checks, and unknown when it was not checked lately', () => {
    expect(siteHealth({ reachable: null, lastCheckedAt: null, failures: 0 }, NOW).state).toBe('UNKNOWN');
    expect(siteHealth({ reachable: true, lastCheckedAt: daysAgo(0), failures: 0 }, NOW).state).toBe('UP');
    expect(siteHealth({ reachable: true, lastCheckedAt: daysAgo(9), failures: 0 }, NOW).state).toBe('UNKNOWN');
    expect(siteHealth({ reachable: false, lastCheckedAt: daysAgo(0), failures: 1 }, NOW).state).toBe('UNKNOWN');
    expect(siteHealth({ reachable: false, lastCheckedAt: daysAgo(0), failures: 2 }, NOW).state).toBe('DOWN');
  });
});

describe('TC-CB-REC: which site to use', () => {
  const sites = [site('rakuten'), site('topcashback'), site('befrugal')];

  it('ranks by what the plan can count: a smaller sure rate can beat a bigger "up to"', () => {
    const r = rankSites(input([rate('rakuten', { ratePercent: 6 }), rate('topcashback', { ratePercent: 9, upTo: true })], sites));
    expect(r.map((x) => x.site)).toEqual(['rakuten', 'topcashback']);
    expect(r[1].expectedPercent).toBeCloseTo(9 * UP_TO_FACTOR);
    expect(r[0].expectedCents).toBe(3000);
    expect(r[1].label).toBe('up to 9% cash back');
  });

  it('recommends only the sites the household has an account on, and suggests a better one they could join', () => {
    const rec = recommendCashback(input([rate('rakuten', { ratePercent: 2 }), rate('topcashback', { ratePercent: 5 })], sites, { rakuten: ['Riley'] }));
    expect(rec.haveAccounts).toBe(true);
    expect(rec.pick).toMatchObject({ site: 'rakuten', holders: ['Riley'], expectedCents: 1000 });
    expect(rec.consider).toMatchObject({ site: 'topcashback', extraCents: 1500 });
    expect(rec.steps[0]).toContain('Riley has the account');
    expect(rec.steps.join(' ')).toContain('Pay with Gold Card');
  });

  it('with no accounts recorded it recommends the best site overall and asks which the household uses', () => {
    const rec = recommendCashback(input([rate('rakuten', { ratePercent: 2 }), rate('topcashback', { ratePercent: 5 })], sites));
    expect(rec.haveAccounts).toBe(false);
    expect(rec.pick?.site).toBe('topcashback');
    expect(rec.consider).toBeNull();
    expect(rec.warnings.join(' ')).toMatch(/does not know which of these sites you use/);
  });

  it('skips a site that looks down, an expired rate and a "no cash back" store', () => {
    const down = site('befrugal', { reachable: false, failures: 3 });
    const rec = recommendCashback(input([rate('befrugal', { ratePercent: 9 }), rate('rakuten', { ratePercent: 5, expiresAt: daysAgo(1) }), rate('topcashback', { ratePercent: 0 })], [down, ...sites.filter((x) => x.code !== 'befrugal')]));
    expect(rec.pick).toBeNull();
    expect(rec.ranked.find((r) => r.site === 'befrugal')).toMatchObject({ usable: false, health: 'DOWN' });
    expect(rec.ranked.find((r) => r.site === 'befrugal')!.warnings.join(' ')).toMatch(/unreachable/);
    expect(rec.ranked.find((r) => r.site === 'topcashback')!.label).toBe('no cash back');
    expect(rec.warnings.join(' ')).toMatch(/No usable cash-back rate/);
  });

  it('says so when a site the household uses has no rate for the store, and when nothing is on file', () => {
    const none = recommendCashback(input([], sites));
    expect(none.pick).toBeNull();
    expect(none.warnings[0]).toMatch(/No cash-back rate is on file for Target/);
    const notMine = recommendCashback(input([rate('topcashback', { ratePercent: 5 })], sites, { rakuten: ['Jo'] }));
    expect(notMine.pick).toBeNull();
    expect(notMine.consider?.site).toBe('topcashback');
    expect(notMine.warnings.join(' ')).toMatch(/None of the sites you use/);
  });

  it('values points by what a point is worth, and flags old rates', () => {
    const pts = site('airline', { kind: 'POINTS', pointCents: 1.5 });
    const r = rankSites(input([rate('airline', { ratePercent: null, pointsPerDollar: 4, observedAt: daysAgo(40) })], [pts]));
    expect(r[0]).toMatchObject({ percent: 6, expectedCents: 3000, freshness: 'STALE', label: '4 points per $1' });
    expect(r[0].warnings.join(' ')).toMatch(/40 days ago/);
  });

  it('gives the planner the rate it can count, for the sites the household uses', () => {
    const rec = recommendCashback(input([rate('rakuten', { ratePercent: 2 }), rate('topcashback', { ratePercent: 9, upTo: true })], sites, { topcashback: ['Jo'] }));
    const p = plannerRates(rec);
    expect(p).toHaveLength(1);
    expect(p[0].portal).toBe('TOPCASHBACK');
    expect(p[0].ratePercent).toBeCloseTo(5.4);
    expect(p[0].source).toMatch(/up to 9% cash back/);
  });

  it('never suggests applying, transferring, booking or cancelling', () => {
    const rec = recommendCashback(input([rate('rakuten')], sites, { rakuten: ['Jo'] }));
    expect(JSON.stringify(rec)).not.toMatch(/\b(apply now|transfer now|book now|cancel (your|the) (card|account))\b/i);
  });
});

import { monitorUrl, readComparisonText, siteCodeFor } from '../../src/domain/cashback';

describe('TC-CB-CMP: a comparison page (Cashback Monitor and similar)', () => {
  it('knows the names comparison pages use for the sites', () => {
    expect(siteCodeFor('Top Cashback')).toBe('topcashback');
    expect(siteCodeFor('TopCashback')).toBe('topcashback');
    expect(siteCodeFor('Mr. Rebates')).toBe('mrrebates');
    expect(siteCodeFor('ExtraBux')).toBe('extrabux');
    expect(siteCodeFor('Some Unknown Portal')).toBeNull();
  });

  it("builds a store's Cashback Monitor address from its name", () => {
    expect(monitorUrl('Target')).toBe('https://www.cashbackmonitor.com/cashback-store/target/');
    expect(monitorUrl("Macy's")).toBe('https://www.cashbackmonitor.com/cashback-store/macy-s/');
    expect(monitorUrl('Best Buy')).toBe('https://www.cashbackmonitor.com/cashback-store/best-buy/');
    expect(monitorUrl('AT&T')).toBe('https://www.cashbackmonitor.com/cashback-store/at-and-t/');
  });

  it('reads a table copied from a browser: a site and its rate on one line', () => {
    const r = readComparisonText('Cashback\nPortal\tRate\nShopBack\t5%\nTop Cashback\t2%\nBeFrugal\t1.5%\nRakuten\t1%*\nSome New Portal 3%');
    expect(r.rates.map((x) => [x.site, x.ratePercent, x.upTo])).toEqual([['shopback', 5, false], ['topcashback', 2, false], ['befrugal', 1.5, false], ['rakuten', 1, true]]);
    expect(r.rates[3].note).toMatch(/special rate for new members/);
    expect(r.unknown).toEqual(['Some New Portal']);
  });

  it('reads a rate on the line after the site name, up to the next site', () => {
    const r = readComparisonText('Mr. Rebates\n4%\nExtraBux\nUp to 6%\nBeFrugal\nnothing here\nSwagbucks\n2%');
    expect(r.rates.map((x) => [x.site, x.ratePercent, x.upTo])).toEqual([['mrrebates', 4, false], ['extrabux', 6, true], ['swagbucks', 2, false]]);
  });

  it('reads a saved page where sites are links and rates are blank, without inventing any', () => {
    const md = '[![](https://www.shopback.com/favicon.ico)](/go-to/ShopBack/target)\n[ShopBack](/go-to/ShopBack/target)\n[Top Cashback](/go-to/Top-Cashback/target)\n[Rakuten](/go-to/Rakuten/target)';
    expect(readComparisonText(md).rates).toEqual([]);
  });

  it('reads a points rate, keeps the first mention of a site, and ignores header lines', () => {
    const r = readComparisonText('Travel Miles/Points\nPortal Rate\nUnited Mileage Plus 2 mi./$\nRakuten 2%\nRakuten 9%');
    expect(r.rates.map((x) => [x.site, x.ratePercent, x.pointsPerDollar])).toEqual([['united-shopping', null, 2], ['rakuten', 2, null]]);
  });
});

import { readMonitorBest, readStorePage, slugOf, storeUrl } from '../../src/domain/cashback';

describe('TC-CB-PAGE: reading a public store page', () => {
  // the wording below is what real public store pages returned when they were checked
  const rakutenTarget = '<html><head><title>Target Coupons, Promo Codes &amp; 1% Cash Back - November 2026</title></head><body><div>Earn up to 40% Cash Back at over 3,500 stores</div><h1>Target</h1><p>1% Cash Back</p><p>Exclusive 7.5% Cash Back offer on select products</p></body></html>';

  it('addresses: the store\'s web address or its dashed name, only when the pattern has what it needs', () => {
    expect(storeUrl('https://www.rakuten.com/{host}', { name: 'Target', hosts: ['target.com'] })).toBe('https://www.rakuten.com/target.com');
    expect(storeUrl('https://www.rakuten.com/{host}', { name: 'Best Buy', hosts: ['bestbuy.com', 'bby.com'] })).toBe('https://www.rakuten.com/bby.com');
    expect(storeUrl('https://www.topcashback.com/{slug}/', { name: 'Best Buy', hosts: [] })).toBe('https://www.topcashback.com/best-buy/');
    expect(storeUrl('https://www.rakuten.com/{host}', { name: 'Target', hosts: [] })).toBeNull();
    expect(storeUrl(null, { name: 'Target', hosts: ['target.com'] })).toBeNull();
    expect(slugOf("Macy's")).toBe('macy-s');
  });

  it('takes the store rate from the page title, not the banner or a promotion on the page', () => {
    const r = readStorePage(rakutenTarget, 'Target')!;
    expect(r).toMatchObject({ ratePercent: 1, upTo: false, where: 'title' });
  });

  it('reads "No Cash Back" as zero, and "up to" from the main heading as a best case', () => {
    expect(readStorePage('<title>Walmart Coupons, Promo Codes &amp; No Cash Back - November 2026</title><p>You’ll earn $5 on your first purchases</p>', 'Walmart')).toMatchObject({ ratePercent: 0, where: 'title' });
    const tcb = '<title>Walmart Cash Back, Coupons | TopCashback</title><h1>Get <b>up to 9%</b> of the price back with our Walmart Cash Back offers</h1><span>2% Cash Back</span>';
    expect(readStorePage(tcb, 'Walmart')).toMatchObject({ ratePercent: 9, upTo: true, where: 'heading' });
    expect(readStorePage('<title>Target Cash Back | TopCashback</title><h1>Get 2% of the price back with our Target Cash Back offers</h1>', 'Target')).toMatchObject({ ratePercent: 2, upTo: false, where: 'heading' });
  });

  it('falls back to the text around the store name, never to a banner far from it', () => {
    const page = '<body><script>var a = "up to 40% Cash Back"</script><div>Earn up to 40% Cash Back at hundreds of stores!</div><div>Menu Home Stores</div><section>Target stores: <b>3% Cash Back</b> today</section></body>';
    expect(readStorePage(page, 'Target')).toMatchObject({ ratePercent: 3, where: 'text' });
    expect(readStorePage('<body><div>Earn up to 40% Cash Back at hundreds of stores!</div><div>Nothing else</div></body>', 'Target')).toBeNull();
    // the store's name followed straight away by the site's banner is not the store's rate
    expect(readStorePage('<html><head><title>Target Coupons</title></head><body><div>Earn up to 40% Cash Back at over 3,500 stores</div></body></html>', 'Target')).toBeNull();
    expect(readStorePage('<body><h2>Target</h2><p>Earn up to 8% Cash Back</p></body>', 'Target')).toBeNull();
  });

  it('does not take another store\'s title, and reads nothing from a page with no rate', () => {
    expect(readStorePage('<title>Other Store Coupons &amp; 8% Cash Back</title><p>nothing</p>', 'Target')).toBeNull();
    expect(readStorePage('<title>Target Coupons</title><h1>Target</h1><p>Free shipping on orders over $35</p>', 'Target')).toBeNull();
  });

  it('reads the best rate a comparison site headlines in its page title', () => {
    expect(readMonitorBest('<title>Target Cashback Comparison - 5% ($10**) - Cashback Monitor</title>')).toBe(5);
    expect(readMonitorBest('<title>Walmart Cash Back Rates 20% ($10**)</title>')).toBe(20);
    expect(readMonitorBest('<title>Some page with no rate</title>')).toBeNull();
    expect(readMonitorBest('no title here')).toBeNull();
  });
});

describe('TC-CB-BENCH: the comparison site as a cross-check', () => {
  const sites = [site('rakuten')];
  const base = (benchmark: { source: string; bestPercent: number; observedAt: Date; url: string } | null, amountCents = 50_000) => ({ ...input([rate('rakuten', { ratePercent: 2 })], sites, { rakuten: ['Jo'] }, amountCents), benchmark });
  const b = (bestPercent: number, ageDays = 1) => ({ source: 'Cashback Monitor', bestPercent, observedAt: daysAgo(ageDays), url: 'https://www.cashbackmonitor.com/cashback-store/target/' });

  it('warns when the comparison site shows a clearly higher best rate than anything on file', () => {
    const r = recommendCashback(base(b(5)));
    expect(r.benchmark).toMatchObject({ source: 'Cashback Monitor', bestPercent: 5 });
    expect(r.warnings.join(' ')).toMatch(/Cashback Monitor lists a best rate of 5% at Target across all sites; the best on file here is 2%/);
  });
  it('stays quiet when the difference is small, the amount is small, or the reading is old', () => {
    expect(recommendCashback(base(b(3))).warnings.join(' ')).not.toMatch(/Cashback Monitor lists/);
    expect(recommendCashback(base(b(5), 2_000)).warnings.join(' ')).not.toMatch(/Cashback Monitor lists/);
    const old = recommendCashback(base(b(5, 20)));
    expect(old.benchmark).toBeNull();
    expect(old.warnings.join(' ')).not.toMatch(/Cashback Monitor lists/);
    expect(recommendCashback(base(null)).benchmark).toBeNull();
  });
});

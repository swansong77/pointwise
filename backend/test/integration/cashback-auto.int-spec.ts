import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CashbackReadService, STOP_AFTER_FAILED_RUNS } from '../../src/cashback/cashback-read.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { api, bearer, createApp, login, register } from './helpers';

/** Automatic reading of public store pages: off by default, polite, bounded, and never at the expense of what was entered by hand. No site is contacted. */
const V = '/api/v1';
const prisma = new PrismaClient();
const DAY = 86_400_000;
let app: INestApplication;
let reader: CashbackReadService;
let admin: string;
let merchant: { id: string; name: string; slug: string };

type Fake = (url: string, init?: RequestInit) => { status: number; body?: string; headers?: Record<string, string> } | Error;
const seen: Array<{ url: string; headers: Record<string, string> }> = [];
let fake: Fake = () => ({ status: 404 });

function page(title: string) {
  return `<html><head><title>${title}</title></head><body><div>Earn up to 40% Cash Back at over 3,500 stores</div></body></html>`;
}

beforeAll(async () => {
  app = await createApp();
  reader = app.get(CashbackReadService);
  reader.minIntervalMs = 0;
  reader.sleep = async () => undefined;
  reader.fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    seen.push({ url: u, headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})) });
    const r = fake(u, init);
    if (r instanceof Error) throw r;
    return new Response(r.body ?? '', { status: r.status, headers: { 'content-type': 'text/html', ...(r.headers ?? {}) } });
  }) as typeof fetch;
  admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
  merchant = await prisma.merchant.findFirstOrThrow({ where: { slug: { not: 'hilton' } }, select: { id: true, name: true, slug: true }, orderBy: { slug: 'desc' } });
  await prisma.merchant.update({ where: { id: merchant.id }, data: { hosts: ['example-store.test'] } });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  seen.length = 0;
  fake = () => ({ status: 404 });
  await prisma.portalRate.deleteMany({ where: { OR: [{ merchantId: merchant.id }, { portal: { in: ['rakuten', 'topcashback'] } }] } });
  await prisma.merchantBenchmark.deleteMany({});
  await prisma.systemSetting.deleteMany({ where: { key: 'cashback' } });
  await prisma.cashbackSite.updateMany({ data: { autoRead: false, readFailures: 0, lastReadAt: null, lastReadNote: null } });
});

const put = (path: string, body: object, t = admin) => api(app).put(V + path).set(bearer(t)).send(body);
const post = (path: string, body: object = {}, t = admin) => api(app).post(V + path).set(bearer(t)).send(body);
/** a rate already on file for the store at a site: this is what makes the store worth reading */
const onFile = (site: string, ageDays: number, method = 'MANUAL', pct = 2) =>
  prisma.portalRate.upsert({ where: { portal_merchantId: { portal: site, merchantId: merchant.id } }, update: { ratePercent: pct, observedAt: new Date(Date.now() - ageDays * DAY), method }, create: { portal: site, merchantId: merchant.id, ratePercent: pct, source: 'test', observedAt: new Date(Date.now() - ageDays * DAY), method } });
const rateNow = () => prisma.portalRate.findUnique({ where: { portal_merchantId: { portal: 'rakuten', merchantId: merchant.id } } });
const STORE = 'https://www.rakuten.com/example-store.test';

describe('TC-CBA: turning reading on', () => {
  it('is off for every site, does nothing when off, and cannot be used before it is allowed', async () => {
    expect((await prisma.cashbackSite.count({ where: { autoRead: true } }))).toBe(0);
    await onFile('rakuten', 10);
    expect(await reader.runAll()).toBe(0);
    expect(seen).toHaveLength(0);
    await post('/admin/cashback/read', { site: 'rakuten', merchant: merchant.slug }).expect(400);
  });

  it('needs a store-page address on the site\'s own domain before it can be switched on, and only an administrator may', async () => {
    await put('/admin/cashback/sites/befrugal', { autoRead: true }).expect(400); // no address pattern
    await put('/admin/cashback/sites/rakuten', { storeUrlTemplate: 'https://evil.example.test/{host}' }).expect(400);
    await put('/admin/cashback/sites/rakuten', { storeUrlTemplate: 'http://www.rakuten.com/{host}' }).expect(400);
    await put('/admin/cashback/sites/rakuten', { storeUrlTemplate: 'https://www.rakuten.com/stores' }).expect(400); // nowhere for the store
    const ok = (await put('/admin/cashback/sites/rakuten', { autoRead: true }).expect(200)).body;
    expect(ok).toMatchObject({ autoRead: true, readFailures: 0 });
    const u = (await register(app)).token;
    await put('/admin/cashback/sites/rakuten', { autoRead: true }, u).expect(403);
    await post('/admin/cashback/read', { site: 'rakuten', merchant: merchant.slug }, u).expect(403);
  });
});

describe('TC-CBA: reading a site\'s store pages', () => {
  beforeEach(async () => {
    await put('/admin/cashback/sites/rakuten', { autoRead: true }).expect(200);
  });

  it('saves the rate it reads, as read automatically with where it came from, and is polite about it', async () => {
    await onFile('rakuten', 10);
    fake = (url) => (url.endsWith('/robots.txt') ? { status: 200, body: 'User-agent: *\nDisallow: /*-xfas\n' } : url === STORE ? { status: 200, body: page(`${merchant.name} Coupons, Promo Codes &amp; 3% Cash Back - December 2026`) } : { status: 404 });
    const s = await reader.readSite('rakuten');
    // other stores left by other tests are tried too and simply have no page here; only this one has a rate
    expect(s).toMatchObject({ saved: 1, errors: 0, blocked: 0 });
    expect(await rateNow()).toMatchObject({ method: 'AUTO', upTo: false });
    expect(Number((await rateNow())!.ratePercent)).toBe(3);
    expect((await rateNow())!.source).toContain(`read from ${STORE} (title: "3% Cash Back")`);
    // robots.txt asked first, the right address only, an agent that says what it is, and nothing that identifies anyone
    expect(seen[0].url).toBe('https://www.rakuten.com/robots.txt');
    expect(seen.map((x) => x.url)).toContain(STORE);
    expect(seen.every((x) => x.url.startsWith('https://www.rakuten.com/'))).toBe(true);
    for (const x of seen) {
      expect(x.headers['User-Agent']).toMatch(/^PointwiseBot\/1\.0/);
      expect(Object.keys(x.headers).map((k) => k.toLowerCase())).not.toEqual(expect.arrayContaining(['cookie', 'authorization']));
    }
    const site = await prisma.cashbackSite.findUniqueOrThrow({ where: { code: 'rakuten' } });
    expect(site.lastReadAt).toBeTruthy();
    expect(site.lastReadNote).toMatch(/\d+ stores? tried: 1 rate saved/);
    // the recommendation uses it, as a read rate
    const u = (await register(app)).token;
    const rec = (await api(app).get(`${V}/cashback/recommend?merchant=${merchant.slug}`).set(bearer(u)).expect(200)).body;
    expect(rec.pick).toMatchObject({ site: 'rakuten', method: 'AUTO' });
  });

  it('leaves a rate someone entered by hand in the last few days, and replaces an older one', async () => {
    await onFile('rakuten', 1, 'MANUAL', 7);
    fake = (url) => (url === STORE ? { status: 200, body: page(`${merchant.name} 3% Cash Back`) } : { status: 404 });
    expect(await reader.readSite('rakuten')).toMatchObject({ saved: 0, kept: 1 });
    expect(Number((await rateNow())!.ratePercent)).toBe(7);
    await onFile('rakuten', 6, 'MANUAL', 7);
    expect(await reader.readSite('rakuten')).toMatchObject({ saved: 1, kept: 0 });
    expect(Number((await rateNow())!.ratePercent)).toBe(3);
  });

  it('does not read the same store again within a day, and reads the stalest stores first, a few at a time', async () => {
    await onFile('rakuten', 10);
    fake = (url) => (url === STORE ? { status: 200, body: page(`${merchant.name} 3% Cash Back`) } : { status: 404 });
    await reader.readSite('rakuten');
    seen.length = 0;
    await reader.readSite('rakuten');
    expect(seen.map((x) => x.url)).not.toContain(STORE);
    reader.maxPerRun = 0;
    try {
      await onFile('rakuten', 10);
      expect(await reader.readSite('rakuten')).toMatchObject({ tried: 0 });
    } finally {
      reader.maxPerRun = 25;
    }
  });

  it('counts a missing page, a page with no rate, and a robots.txt refusal separately and never invents a rate', async () => {
    await onFile('rakuten', 10);
    fake = () => ({ status: 404 });
    expect(await reader.readSite('rakuten')).toMatchObject({ saved: 0, errors: 0 });
    expect((await prisma.portalRate.findUniqueOrThrow({ where: { portal_merchantId: { portal: 'rakuten', merchantId: merchant.id } } })).method).toBe('MANUAL');
    await onFile('rakuten', 10);
    fake = (url) => (url.endsWith('/robots.txt') ? { status: 404 } : { status: 200, body: page(`${merchant.name} Coupons`) });
    expect(await reader.readSite('rakuten')).toMatchObject({ saved: 0 });
    expect(((await rateNow())!).method).toBe('MANUAL');
    await onFile('rakuten', 10);
    fake = (url) => (url.endsWith('/robots.txt') ? { status: 200, body: 'User-agent: *\nDisallow: /example-store.test\n' } : { status: 200, body: page(`${merchant.name} 3% Cash Back`) });
    seen.length = 0;
    // a fresh robots.txt is asked for with each run's fetcher
    expect(await reader.readSite('rakuten')).toMatchObject({ saved: 0, blocked: 1 });
    expect(Number((await rateNow())!.ratePercent)).toBe(2);
    expect(seen.map((x) => x.url)).not.toContain(STORE);
  });

  it('never follows a redirect to another site', async () => {
    await onFile('rakuten', 10);
    fake = (url) => (url === STORE ? { status: 302, headers: { location: 'https://evil.example.test/x' } } : { status: 404 });
    const s = await reader.readSite('rakuten');
    expect(s).toMatchObject({ saved: 0, errors: 1 });
    expect(seen.some((x) => x.url.includes('evil.example.test'))).toBe(false);
  });

  it('switches itself off after repeated failed runs, and says so', async () => {
    fake = () => new Error('connect ETIMEDOUT');
    for (let i = 0; i < STOP_AFTER_FAILED_RUNS; i++) {
      await onFile('rakuten', 10);
      await reader.readSite('rakuten').catch(() => undefined);
    }
    const site = await prisma.cashbackSite.findUniqueOrThrow({ where: { code: 'rakuten' } });
    expect(site.autoRead).toBe(false);
    expect(site.lastReadNote).toMatch(/Stopped after 5 failed runs/);
    // turning it back on starts again from zero
    await put('/admin/cashback/sites/rakuten', { autoRead: true }).expect(200);
    expect((await prisma.cashbackSite.findUniqueOrThrow({ where: { code: 'rakuten' } })).readFailures).toBe(0);
  });

  it('the administrator can read one store now and sees exactly what was found', async () => {
    fake = (url) => (url === STORE ? { status: 200, body: `<title>${merchant.name} Coupons &amp; 4% Cash Back</title><p>Exclusive 9% Cash Back offer</p>` } : { status: 404 });
    const r = (await post('/admin/cashback/read', { site: 'rakuten', merchant: merchant.slug }).expect(200)).body;
    expect(r).toMatchObject({ url: STORE, saved: true, read: { ratePercent: 4, where: 'title', evidence: '4% Cash Back' } });
    expect(r.read.alsoSeen).toEqual([]);
    fake = () => ({ status: 200, body: '<title>Nothing</title>' });
    expect((await post('/admin/cashback/read', { site: 'rakuten', merchant: merchant.slug }).expect(200)).body).toMatchObject({ saved: false, reason: 'No rate was found on that page.' });
    await post('/admin/cashback/read', { site: 'rakuten', merchant: 'no-such-store' }).expect(400);
  });

  it('the scheduled job runs the reader and the daily list counts what it saved', async () => {
    await onFile('rakuten', 10);
    fake = (url) => (url === STORE ? { status: 200, body: page(`${merchant.name} 3% Cash Back`) } : { status: 404 });
    expect(await app.get(JobsService).run('cashback-rates')).toEqual({ job: 'cashback-rates', created: 1 });
  });
});

describe('TC-CBA: the comparison site as a cross-check', () => {
  const MONITOR = (name: string) => `https://www.cashbackmonitor.com/cashback-store/${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}/`;

  it('is off until the administrator turns it on, and only an administrator can', async () => {
    expect((await api(app).get(`${V}/admin/cashback/settings`).set(bearer(admin)).expect(200)).body).toEqual({ benchmark: false });
    await onFile('rakuten', 10);
    expect(await reader.runAll()).toBe(0);
    expect(seen).toHaveLength(0);
    const u = (await register(app)).token;
    await put('/admin/cashback/settings', { benchmark: true }, u).expect(403);
    expect((await put('/admin/cashback/settings', { benchmark: true }).expect(200)).body).toEqual({ benchmark: true });
  });

  it('reads the headline best rate only from its own address, saves it, and the recommendation warns when the rates on file are clearly lower', async () => {
    await put('/admin/cashback/settings', { benchmark: true }).expect(200);
    await onFile('rakuten', 1, 'MANUAL', 2);
    fake = (url) => (url === MONITOR(merchant.name) ? { status: 200, body: `<title>${merchant.name} Cashback Comparison - 5% ($10**) - Cashback Monitor</title>` } : { status: 404 });
    expect(await reader.runBenchmarks()).toBe(1);
    expect(seen.every((x) => x.url.startsWith('https://www.cashbackmonitor.com/'))).toBe(true);
    expect(seen.map((x) => x.url)).toContain(MONITOR(merchant.name));
    const row = await prisma.merchantBenchmark.findUniqueOrThrow({ where: { merchantId: merchant.id } });
    expect(Number(row.bestPercent)).toBe(5);
    const u = (await register(app)).token;
    const rec = (await api(app).get(`${V}/cashback/recommend?merchant=${merchant.slug}&amount=50000`).set(bearer(u)).expect(200)).body;
    expect(rec.benchmark).toMatchObject({ source: 'Cashback Monitor', bestPercent: 5 });
    expect(rec.warnings.join(' ')).toMatch(/Cashback Monitor lists a best rate of 5%.*the best on file here is 2%/);
    // a reading older than two weeks is not shown
    await prisma.merchantBenchmark.update({ where: { merchantId: merchant.id }, data: { observedAt: new Date(Date.now() - 20 * DAY) } });
    const old = (await api(app).get(`${V}/cashback/recommend?merchant=${merchant.slug}&amount=50000`).set(bearer(u)).expect(200)).body;
    expect(old.benchmark).toBeNull();
    // not re-read within three days; re-read once it is that old
    await prisma.merchantBenchmark.update({ where: { merchantId: merchant.id }, data: { observedAt: new Date() } });
    seen.length = 0;
    expect(await reader.runBenchmarks()).toBe(0);
    expect(seen.map((x) => x.url)).not.toContain(MONITOR(merchant.name));
  });
});

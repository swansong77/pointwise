import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PageFetcher } from '../catalog-refresh/fetcher';
import { PrismaService } from '../common/prisma.service';
import { readMonitorBest, readStorePage, slugOf, storeUrl } from '../domain/cashback';
import { CashbackService } from './cashback.service';

export const READER_AGENT = 'PointwiseBot/1.0 (+cash-back rate reader for a self-hosted PointWise; reads public store pages, never signs in)';
const DAY = 86_400_000;
const MONITOR = { host: 'cashbackmonitor.com', source: 'Cashback Monitor', pattern: (name: string) => `https://www.cashbackmonitor.com/cashback-store/${slugOf(name)}/` };
/** an automatic read that has failed this many runs in a row switches itself off, so a broken or blocked site is not hammered */
export const STOP_AFTER_FAILED_RUNS = 5;

export interface SiteReadSummary {
  site: string;
  tried: number;
  saved: number;
  kept: number;
  notFound: number;
  blocked: number;
  errors: number;
  note: string;
}

/**
 * Reads the PUBLIC store pages of the cash-back sites the administrator has allowed (off by default, per site), and, if enabled, the headline
 * best rate of a comparison site as a cross-check. It reuses the polite fetcher: https only, only the site's own address (every redirect
 * hop checked), robots.txt honoured, one request per host per interval, a size cap, no cookies, no sign-in, nothing about any member.
 * Only stores someone has planned a purchase at, or that already have a rate from the site, are read, a few at a time.
 */
@Injectable()
export class CashbackReadService {
  private readonly log = new Logger(CashbackReadService.name);
  /** replaceable in tests */
  fetchFn: typeof fetch = fetch;
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));
  minIntervalMs = Number(process.env.CASHBACK_READ_MIN_INTERVAL_MS ?? 5000);
  maxPerRun = Number(process.env.CASHBACK_READ_MAX ?? 25);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cashback: CashbackService,
  ) {}

  /** A fetcher that may only read from these domains (and subdomains) over https. */
  private fetcherFor(domains: string[]) {
    const validate = (raw: string): URL => {
      let u: URL;
      try {
        u = new URL(raw);
      } catch {
        throw new BadRequestException('Not a valid address');
      }
      if (u.protocol !== 'https:' || u.username || u.password) throw new BadRequestException('Only plain https addresses are read');
      if (!domains.some((d) => u.hostname === d || u.hostname.endsWith(`.${d}`))) throw new BadRequestException(`${u.hostname} is not an address this site may be read from`);
      return u;
    };
    return new PageFetcher(this.fetchFn, this.minIntervalMs, process.env, this.sleep, validate, READER_AGENT);
  }

  private domainOf(url: string): string {
    return new URL(url).hostname.replace(/^www\./, '');
  }

  /** Stores worth reading: where a purchase is planned, or that this site already has a rate for, the stalest first. */
  private async candidates(portal: string | null, now: Date, limit: number, freshHours: number) {
    const since = new Date(now.getTime() - 90 * DAY);
    const [planned, rated] = await Promise.all([
      this.prisma.plannedPurchase.findMany({ where: { merchantId: { not: null }, createdAt: { gte: since } }, select: { merchantId: true }, distinct: ['merchantId'], take: 200 }),
      this.prisma.portalRate.findMany({ where: portal ? { portal } : {}, select: { merchantId: true, observedAt: true, method: true } }),
    ]);
    const lastRead = new Map<string, Date>();
    for (const r of rated) if (r.method === 'AUTO' || !portal) lastRead.set(r.merchantId, r.observedAt > (lastRead.get(r.merchantId) ?? new Date(0)) ? r.observedAt : (lastRead.get(r.merchantId) as Date));
    const ids = [...new Set([...planned.map((p) => p.merchantId as string), ...rated.map((r) => r.merchantId)])];
    const merchants = await this.prisma.merchant.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, hosts: true } });
    const fresh = now.getTime() - freshHours * 3_600_000;
    return merchants
      .filter((m) => (lastRead.get(m.id)?.getTime() ?? 0) < fresh)
      .sort((a, b) => (lastRead.get(a.id)?.getTime() ?? 0) - (lastRead.get(b.id)?.getTime() ?? 0))
      .slice(0, limit);
  }

  // ───────────── a site's own store pages ─────────────

  async readSite(code: string, now = new Date()): Promise<SiteReadSummary> {
    const site = await this.prisma.cashbackSite.findUnique({ where: { code } });
    if (!site) throw new NotFoundException('Cash-back site not found');
    if (!site.autoRead || !site.storeUrlTemplate) throw new BadRequestException('Automatic reading is not switched on for this site.');
    const fetcher = this.fetcherFor([this.domainOf(site.homeUrl)]);
    const s: SiteReadSummary = { site: code, tried: 0, saved: 0, kept: 0, notFound: 0, blocked: 0, errors: 0, note: '' };
    const existing = new Map((await this.prisma.portalRate.findMany({ where: { portal: code } })).map((r) => [r.merchantId, r]));
    for (const m of await this.candidates(code, now, this.maxPerRun, 20)) {
      const url = storeUrl(site.storeUrlTemplate, m);
      if (!url) continue;
      s.tried++;
      try {
        const r = await fetcher.fetch(url);
        if (r.status === 'BLOCKED') {
          s.blocked++;
          continue;
        }
        const read = readStorePage(r.body ?? '', m.name);
        if (!read) {
          s.notFound++;
          continue;
        }
        const have = existing.get(m.id);
        // something typed or imported in the last few days is newer knowledge than a page read: leave it
        if (have && have.method !== 'AUTO' && now.getTime() - have.observedAt.getTime() < 3 * DAY) {
          s.kept++;
          continue;
        }
        await this.cashback.upsertRate(
          { site: code, merchant: m.id, ratePercent: read.ratePercent, pointsPerDollar: read.pointsPerDollar, upTo: read.upTo, conditions: read.alsoSeen.length ? `Also on the page: ${read.alsoSeen.join(', ')}` : null, source: `read from ${url} (${read.where}: "${read.evidence}")` },
          null,
          'AUTO',
          now,
        );
        s.saved++;
      } catch (e) {
        const msg = (e as Error).message;
        if (/HTTP 404|HTTP 410/.test(msg)) s.notFound++;
        else {
          s.errors++;
          this.log.warn(`read of ${url} failed: ${msg}`);
          // most of a run failing is a sign to stop for today, not to keep asking
          if (s.errors >= 3 && s.errors > s.saved + s.notFound) break;
        }
      }
    }
    s.note = `${s.tried} store${s.tried === 1 ? '' : 's'} tried: ${s.saved} rate${s.saved === 1 ? '' : 's'} saved, ${s.notFound} not found on the page, ${s.kept} kept (entered by hand lately), ${s.blocked} blocked by robots.txt, ${s.errors} failed`;
    const allFailed = s.tried > 0 && s.saved === 0 && s.notFound === 0 && s.kept === 0 && s.errors + s.blocked >= s.tried;
    const failures = allFailed ? site.readFailures + 1 : 0;
    const stop = failures >= STOP_AFTER_FAILED_RUNS;
    await this.prisma.cashbackSite.update({
      where: { id: site.id },
      data: { lastReadAt: now, lastReadNote: stop ? `Stopped after ${STOP_AFTER_FAILED_RUNS} failed runs in a row. ${s.note}` : s.note, readFailures: failures, ...(stop ? { autoRead: false } : {}) },
    });
    return s;
  }

  /** One store at one site, now: for the administrator to see what a read finds. Needs the site's automatic reading to be on. */
  async readOne(code: string, merchantRef: string, now = new Date()) {
    const site = await this.prisma.cashbackSite.findUnique({ where: { code } });
    if (!site) throw new NotFoundException('Cash-back site not found');
    if (!site.autoRead || !site.storeUrlTemplate) throw new BadRequestException('Switch on automatic reading for this site first.');
    const m = await this.prisma.merchant.findFirst({ where: { OR: [{ slug: merchantRef.toLowerCase() }, { name: { equals: merchantRef, mode: 'insensitive' } }] }, select: { id: true, name: true, hosts: true } });
    if (!m) throw new BadRequestException(`Unknown merchant "${merchantRef}".`);
    const url = storeUrl(site.storeUrlTemplate, m);
    if (!url) throw new BadRequestException(`${m.name} has no web address on file, so its page at ${site.name} cannot be found.`);
    const r = await this.fetcherFor([this.domainOf(site.homeUrl)]).fetch(url).catch((e: Error) => ({ status: 'ERROR' as const, body: undefined, reason: e.message }));
    if (r.status === 'BLOCKED') return { url, saved: false, read: null, reason: 'robots.txt does not allow reading that page.' };
    if (r.status === 'ERROR') return { url, saved: false, read: null, reason: (r as { reason?: string }).reason ?? 'The page could not be read.' };
    const read = readStorePage(r.body ?? '', m.name);
    if (!read) return { url, saved: false, read: null, reason: 'No rate was found on that page.' };
    await this.cashback.upsertRate({ site: code, merchant: m.id, ratePercent: read.ratePercent, pointsPerDollar: read.pointsPerDollar, upTo: read.upTo, conditions: read.alsoSeen.length ? `Also on the page: ${read.alsoSeen.join(', ')}` : null, source: `read from ${url} (${read.where}: "${read.evidence}")` }, null, 'AUTO', now);
    return { url, saved: true, read: { ratePercent: read.ratePercent, pointsPerDollar: read.pointsPerDollar, upTo: read.upTo, where: read.where, evidence: read.evidence, alsoSeen: read.alsoSeen }, reason: null };
  }

  // ───────────── the comparison site's headline ─────────────

  async runBenchmarks(now = new Date()): Promise<number> {
    const fetcher = this.fetcherFor([MONITOR.host]);
    const existing = new Map((await this.prisma.merchantBenchmark.findMany()).map((b) => [b.merchantId, b.observedAt]));
    const since = new Date(now.getTime() - 3 * DAY);
    const todo = (await this.candidates(null, now, this.maxPerRun * 2, 0)).filter((m) => (existing.get(m.id) ?? new Date(0)) < since).slice(0, this.maxPerRun);
    let saved = 0;
    for (const m of todo) {
      const url = MONITOR.pattern(m.name);
      try {
        const r = await fetcher.fetch(url);
        if (r.status !== 'OK') continue;
        const best = readMonitorBest(r.body ?? '');
        if (best == null) continue;
        await this.prisma.merchantBenchmark.upsert({ where: { merchantId: m.id }, update: { bestPercent: best, url, observedAt: now, source: MONITOR.source }, create: { merchantId: m.id, bestPercent: best, url, observedAt: now, source: MONITOR.source } });
        saved++;
      } catch (e) {
        this.log.warn(`benchmark read of ${url} failed: ${(e as Error).message}`);
      }
    }
    return saved;
  }

  /** The scheduled run: every site the administrator allowed, then the comparison headline if that is switched on. Returns rates saved. */
  async runAll(now = new Date()): Promise<number> {
    const sites = await this.prisma.cashbackSite.findMany({ where: { isActive: true, autoRead: true, storeUrlTemplate: { not: null } }, select: { code: true } });
    let saved = 0;
    for (const s of sites) {
      try {
        saved += (await this.readSite(s.code, now)).saved;
      } catch (e) {
        this.log.warn(`read of ${s.code} failed: ${(e as Error).message}`);
      }
    }
    if ((await this.cashback.getSettings()).benchmark) saved += await this.runBenchmarks(now);
    return saved;
  }
}

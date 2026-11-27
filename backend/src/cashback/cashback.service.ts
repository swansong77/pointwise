import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { CashbackRecommendation, monitorUrl, parseRatesCsv, RateRow, readComparisonText, readRateText, recommendCashback, siteHealth, SiteInfo } from '../domain/cashback';
import { assertPublicHost } from '../mailbox/host-guard';

const UA = 'PointWise-status/1.0 (self-hosted; checks that a public home page answers)';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Fetcher = (url: string) => Promise<{ status: number }>;

/** One GET of a public page, with a timeout. The body is never read: only whether the site answers. */
const defaultFetcher: Fetcher = async (url) => {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 10_000);
  try {
    const r = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctl.signal, headers: { 'user-agent': UA, accept: 'text/html' } });
    await r.body?.cancel().catch(() => undefined);
    return { status: r.status };
  } finally {
    clearTimeout(t);
  }
};

export interface RateInput {
  site: string;
  merchant: string;
  ratePercent?: number | null;
  pointsPerDollar?: number | null;
  upTo?: boolean;
  expiresAt?: Date | null;
  conditions?: string | null;
  source?: string | null;
}

/**
 * Cash-back and points shopping sites: one shared list kept by the administrator (status, rates), and which sites each household member
 * has an account on (no credentials, ever). The recommendation for a purchase is built from these by the pure rules in domain/cashback.ts.
 */
@Injectable()
export class CashbackService {
  private readonly log = new Logger(CashbackService.name);
  /** replaceable in tests */
  fetcher: Fetcher = defaultFetcher;

  constructor(private readonly prisma: PrismaService) {}

  // ───────────── sites and status ─────────────

  private info(s: { code: string; name: string; kind: string; homeUrl: string; pointCents: Prisma.Decimal | null; isActive: boolean; reachable: boolean | null; lastCheckedAt: Date | null; failures: number; autoRead?: boolean; lastReadAt?: Date | null }): SiteInfo {
    return { code: s.code, name: s.name, kind: s.kind as SiteInfo['kind'], homeUrl: s.homeUrl, pointCents: s.pointCents == null ? null : Number(s.pointCents), isActive: s.isActive, reachable: s.reachable, lastCheckedAt: s.lastCheckedAt, failures: s.failures, autoRead: s.autoRead, lastReadAt: s.lastReadAt };
  }

  /** Every site with its health, how many rates it has, and who in this household has an account there. */
  async sites(userId: string, now = new Date()) {
    const [sites, accounts, counts] = await Promise.all([
      this.prisma.cashbackSite.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
      this.prisma.userCashbackAccount.findMany({ where: { userId }, include: { profile: { select: { id: true, nickname: true } } } }),
      this.prisma.portalRate.groupBy({ by: ['portal'], where: { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }, _count: true, _max: { observedAt: true } }),
    ]);
    return sites.map((s) => {
      const h = siteHealth(this.info(s), now);
      const c = counts.find((x) => x.portal === s.code);
      return {
        code: s.code,
        name: s.name,
        kind: s.kind,
        homeUrl: s.homeUrl,
        notes: s.notes,
        health: h.state,
        healthNote: h.note,
        lastCheckedAt: s.lastCheckedAt,
        autoRead: s.autoRead,
        lastReadAt: s.lastReadAt,
        rates: c?._count ?? 0,
        ratesSeenAt: c?._max.observedAt ?? null,
        accounts: accounts.filter((a) => a.siteId === s.id).map((a) => ({ profileId: a.profileId, member: a.profile.nickname })),
      };
    });
  }

  /** The household member says they have (or no longer have) an account on a site. Never a username or password. */
  async setAccount(userId: string, siteCode: string, requestedProfileId: string | undefined, has: boolean) {
    const [site, profile] = await Promise.all([
      this.prisma.cashbackSite.findUnique({ where: { code: siteCode } }),
      this.prisma.profile.findFirst({ where: requestedProfileId ? { id: requestedProfileId, userId } : { userId, isPrimary: true }, select: { id: true } }),
    ]);
    if (!site) throw new NotFoundException('Cash-back site not found');
    if (!profile) throw new NotFoundException('Household member not found');
    const profileId = profile.id;
    if (has) await this.prisma.userCashbackAccount.upsert({ where: { profileId_siteId: { profileId, siteId: site.id } }, update: {}, create: { userId, profileId, siteId: site.id } });
    else await this.prisma.userCashbackAccount.deleteMany({ where: { userId, profileId, siteId: site.id } });
  }

  /** Light check that a site's public home page answers (one GET, body not read). A 4xx still means the site is up. */
  async checkSite(code: string, now = new Date()) {
    const s = await this.prisma.cashbackSite.findUnique({ where: { code } });
    if (!s) throw new NotFoundException('Cash-back site not found');
    let reachable = false;
    let httpStatus: number | null = null;
    let error: string | null = null;
    try {
      await assertPublicHost(new URL(s.homeUrl).hostname);
      const r = await this.fetcher(s.homeUrl);
      httpStatus = r.status;
      reachable = r.status < 500;
      if (!reachable) error = `The site answered with an error (${r.status}).`;
    } catch (e) {
      error = (e as Error).name === 'AbortError' ? 'The site did not answer within 10 seconds.' : (e as Error).message.slice(0, 200);
    }
    const row = await this.prisma.cashbackSite.update({
      where: { id: s.id },
      data: { lastCheckedAt: now, reachable, httpStatus, lastError: error, ...(reachable ? { lastOkAt: now, failures: 0 } : { failures: { increment: 1 } }) },
    });
    return { code, ...siteHealth(this.info(row), now), httpStatus };
  }

  /** The scheduled run: every active site, one after another. Returns how many answered. */
  async checkAll(now = new Date()): Promise<number> {
    const sites = await this.prisma.cashbackSite.findMany({ where: { isActive: true }, select: { code: true } });
    let up = 0;
    for (const s of sites) {
      try {
        if ((await this.checkSite(s.code, now)).state === 'UP') up++;
      } catch (e) {
        this.log.warn(`status check of ${s.code} failed: ${(e as Error).message}`);
      }
    }
    return up;
  }

  // ───────────── rates ─────────────

  private async merchantFor(ref: string) {
    const m = await this.prisma.merchant.findFirst({ where: UUID.test(ref) ? { id: ref } : { OR: [{ slug: ref.toLowerCase() }, { name: { equals: ref, mode: 'insensitive' } }] }, select: { id: true, name: true } });
    return m;
  }

  async upsertRate(input: RateInput, adminId: string | null, method: 'MANUAL' | 'CSV' | 'PASTE' | 'AUTO' = 'MANUAL', now = new Date()) {
    const site = await this.prisma.cashbackSite.findUnique({ where: { code: input.site } });
    if (!site) throw new BadRequestException(`Unknown site "${input.site}". Add it under Cash-back sites first.`);
    const merchant = await this.merchantFor(input.merchant);
    if (!merchant) throw new BadRequestException(`Unknown merchant "${input.merchant}".`);
    if (input.ratePercent == null && input.pointsPerDollar == null) throw new BadRequestException('Give a cash-back percent or points per dollar.');
    const data = {
      ratePercent: input.ratePercent ?? null,
      pointsPerDollar: input.pointsPerDollar ?? null,
      upTo: !!input.upTo,
      expiresAt: input.expiresAt ?? null,
      conditions: input.conditions ?? null,
      source: input.source ?? (method === 'MANUAL' ? 'entered by the administrator' : method === 'CSV' ? 'CSV import' : method === 'PASTE' ? 'pasted from the site' : 'read from the public page'),
      method,
      observedAt: now,
      updatedBy: adminId,
    };
    const existing = await this.prisma.portalRate.findUnique({ where: { portal_merchantId: { portal: site.code, merchantId: merchant.id } } });
    const row = await this.prisma.portalRate.upsert({ where: { portal_merchantId: { portal: site.code, merchantId: merchant.id } }, update: data, create: { portal: site.code, merchantId: merchant.id, ...data } });
    return { id: row.id, created: !existing, merchant: merchant.name, site: site.name };
  }

  async deleteRate(id: string) {
    const r = await this.prisma.portalRate.deleteMany({ where: { id } });
    if (!r.count) throw new NotFoundException('Rate not found');
  }

  async importCsv(text: string, adminId: string, now = new Date()) {
    const parsed = parseRatesCsv(text, now);
    let created = 0;
    let updated = 0;
    const errors = [...parsed.errors];
    for (const r of parsed.rows) {
      try {
        const x = await this.upsertRate({ site: r.site.toLowerCase(), merchant: r.merchant, ratePercent: r.ratePercent, pointsPerDollar: r.pointsPerDollar, upTo: r.upTo, expiresAt: r.expiresAt, conditions: r.conditions, source: r.source }, adminId, 'CSV', now);
        if (x.created) created++;
        else updated++;
      } catch (e) {
        errors.push({ line: r.line, message: (e as Error).message });
      }
    }
    return { created, updated, errors: errors.sort((a, b) => a.line - b.line) };
  }

  /** The text of a site's store page, pasted: the first stated rate is read and shown for confirmation before it is saved. */
  async pasteRate(input: { site: string; merchant: string; text: string; save: boolean }, adminId: string, now = new Date()) {
    const read = readRateText(input.text);
    if (!read) throw new BadRequestException('No cash-back rate was found in that text. Look for wording such as "5% Cash Back" or "up to 8%".');
    const preview = { ratePercent: read.ratePercent, pointsPerDollar: read.pointsPerDollar, upTo: read.upTo, evidence: read.evidence, alsoSeen: read.alsoSeen };
    if (!input.save) return { saved: false, ...preview };
    const x = await this.upsertRate({ site: input.site, merchant: input.merchant, ratePercent: read.ratePercent, pointsPerDollar: read.pointsPerDollar, upTo: read.upTo, source: `read from pasted text: "${read.evidence}"` }, adminId, 'PASTE', now);
    return { saved: true, ...preview, ...x };
  }

  /**
   * The text of a comparison page for ONE store (Cashback Monitor and similar): many sites, each with its rate. Shows what was read for each
   * site (and the names it did not know) and saves only when asked. Sites missing from this server's list are reported, not created.
   */
  async pasteComparison(input: { merchant: string; text: string; save: boolean }, adminId: string, now = new Date()) {
    const m = await this.merchantFor(input.merchant);
    if (!m) throw new BadRequestException(`Unknown merchant "${input.merchant}".`);
    const read = readComparisonText(input.text);
    if (!read.rates.length) throw new BadRequestException('No rates for a known site were found in that text. Paste the store page with each site name next to its rate.');
    const inList = new Set((await this.prisma.cashbackSite.findMany({ where: { code: { in: read.rates.map((r) => r.site) } }, select: { code: true } })).map((s) => s.code));
    const rates = read.rates.map((r) => ({ ...r, inList: inList.has(r.site) }));
    const preview = { merchant: m.name, rates, unknown: read.unknown, monitorUrl: monitorUrl(m.name) };
    if (!input.save) return { saved: false, ...preview };
    let created = 0;
    let updated = 0;
    for (const r of rates.filter((x) => x.inList)) {
      const x = await this.upsertRate({ site: r.site, merchant: m.id, ratePercent: r.ratePercent, pointsPerDollar: r.pointsPerDollar, upTo: r.upTo, conditions: r.note, source: 'read from a pasted comparison page' }, adminId, 'PASTE', now);
      if (x.created) created++;
      else updated++;
    }
    return { saved: true, created, updated, skipped: rates.filter((x) => !x.inList).map((x) => x.siteName), ...preview };
  }

  async listRates(filter: { site?: string; merchant?: string } = {}, now = new Date()) {
    const merchant = filter.merchant ? await this.merchantFor(filter.merchant) : null;
    const rows = await this.prisma.portalRate.findMany({
      where: { ...(filter.site ? { portal: filter.site } : {}), ...(merchant ? { merchantId: merchant.id } : filter.merchant ? { id: 'none' } : {}) },
      include: { merchant: { select: { name: true, slug: true } } },
      orderBy: [{ merchant: { name: 'asc' } }, { portal: 'asc' }],
      take: 500,
    });
    return rows.map((r) => ({ id: r.id, site: r.portal, merchant: r.merchant.name, merchantSlug: r.merchant.slug, ratePercent: r.ratePercent == null ? null : Number(r.ratePercent), pointsPerDollar: r.pointsPerDollar == null ? null : Number(r.pointsPerDollar), upTo: r.upTo, expiresAt: r.expiresAt, observedAt: r.observedAt, method: r.method, source: r.source, conditions: r.conditions, expired: !!r.expiresAt && r.expiresAt < now }));
  }

  // ───────────── the recommendation ─────────────

  /** Which site to use for a purchase at a merchant, from the household's accounts, the rates on file and each site's status. */
  async recommend(userId: string, merchant: { id: string; name: string }, amountCents: number, payWith: string | null = null, now = new Date()): Promise<CashbackRecommendation> {
    const [rates, sites, accounts] = await Promise.all([
      this.prisma.portalRate.findMany({ where: { merchantId: merchant.id, OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] } }),
      this.prisma.cashbackSite.findMany(),
      this.prisma.userCashbackAccount.findMany({ where: { userId }, include: { site: { select: { code: true } }, profile: { select: { nickname: true } } } }),
    ]);
    const known = new Map(sites.map((s) => [s.code, this.info(s)]));
    // a rate entered for a site that is not in the list (older data, or a one-off) still counts, as an unchecked site
    for (const r of rates) if (!known.has(r.portal)) known.set(r.portal, { code: r.portal, name: r.portal, kind: 'CASHBACK', homeUrl: '', pointCents: null, isActive: true, reachable: null, lastCheckedAt: null, failures: 0 });
    const held = new Map<string, string[]>();
    for (const a of accounts) held.set(a.site.code, [...(held.get(a.site.code) ?? []), a.profile.nickname]);
    const rows: RateRow[] = rates.map((r) => ({
      site: r.portal,
      ratePercent: r.ratePercent == null ? null : Number(r.ratePercent),
      pointsPerDollar: r.pointsPerDollar == null ? null : Number(r.pointsPerDollar),
      upTo: r.upTo,
      observedAt: r.observedAt,
      expiresAt: r.expiresAt,
      method: r.method,
      source: r.source,
      conditions: r.conditions,
    }));
    return recommendCashback({ amountCents, merchantName: merchant.name, rates: rows, sites: [...known.values()], accounts: held, payWith, now });
  }

  /** For the endpoint: resolve the merchant by id, slug or name. */
  async recommendFor(userId: string, merchantRef: string, amountCents: number, payWith: string | null, now = new Date()) {
    const m = await this.merchantFor(merchantRef);
    if (!m) throw new NotFoundException('Merchant not found');
    return { merchant: m, amountCents, monitorUrl: monitorUrl(m.name), ...(await this.recommend(userId, m, amountCents, payWith, now)) };
  }

  // ───────────── the list of sites (administrator) ─────────────

  adminSites() {
    return this.prisma.cashbackSite.findMany({ orderBy: { name: 'asc' } });
  }

  async upsertSite(code: string, data: { name?: string; kind?: 'CASHBACK' | 'POINTS'; homeUrl?: string; storeUrlTemplate?: string | null; pointCents?: number | null; notes?: string | null; isActive?: boolean; autoRead?: boolean }) {
    if (data.homeUrl) {
      try {
        const u = new URL(data.homeUrl);
        if (u.protocol !== 'https:') throw new Error('The address must start with https://');
      } catch (e) {
        throw new BadRequestException((e as Error).message.includes('https') ? (e as Error).message : 'That is not a web address.');
      }
    }
    const existing = await this.prisma.cashbackSite.findUnique({ where: { code } });
    if (!existing && !(data.name && data.homeUrl)) throw new BadRequestException('A new site needs a name and a home page address.');
    if (existing) return this.prisma.cashbackSite.update({ where: { code }, data });
    return this.prisma.cashbackSite.create({
      data: { code, name: data.name as string, homeUrl: data.homeUrl as string, kind: data.kind ?? 'CASHBACK', storeUrlTemplate: data.storeUrlTemplate ?? null, pointCents: data.pointCents ?? null, notes: data.notes ?? null, isActive: data.isActive ?? true, autoRead: data.autoRead ?? false },
    });
  }
}

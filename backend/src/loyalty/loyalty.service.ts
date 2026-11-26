import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LoyaltyEventKind, LoyaltyKind, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { evidenceHashOf, IngestResult, LoyaltyIngestService } from './loyalty-ingest.service';
import { ParsedObservation } from '../domain/loyalty-email';
import { freshness, Priority } from '../domain/loyalty-refresh';
import { refreshConfidence, SourceType } from '../domain/loyalty-provenance';
import { decryptSecret, encryptSecret } from '../common/crypto';
import { alertText, ExpiryPrediction, lotsFromEvents, predictExpiration, preservationAdvice } from '../domain/loyalty-expiration';
import { growthSummary, monthlyHistory, trackingTotals } from '../domain/loyalty-tracking';
import { Cert, certificateOpportunities, certState, checkFreeNight, Elite, eliteView, Member, membershipView, renewalCreditSuggestion, Stay } from '../domain/loyalty-assets';
import { buildForecast, ForecastItem, valueAssets, ValuedAccount, ValuedCert, ValuedMembership, ValuedStatus } from '../domain/loyalty-valuation';
import { bonusAdvice, bonusStats, BonusStats } from '../domain/transfer-bonus';
import { AwardOption, estimateAwardPoints, matchCertificates, rankAwardOptions, Region, TripInput } from '../domain/award-trip';
import { Balance, bonusActive, Currency, Partner, planAward, Program, transferOptions } from '../domain/travel';
import { AccountEventDto, AwardTripDto, BonusRecordDto, CertificateDto, CreateAccountDto, MembershipDto, StatusDto, UpdateAccountDto, UpdateCertificateDto, UpdateMembershipDto, UpdateStatusDto } from './loyalty.dto';

const DAY = 86_400_000;
const UNIT = (kind: string | null | undefined) => (kind === 'AIRLINE' ? 'miles' : 'points');
const date = (s?: string | null) => (s ? new Date(s) : null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** A card credit with value left, from the benefit tracker (cents). */
export interface CreditInfo {
  benefit: string;
  card: string;
  member: string | null;
  remainingCents: number;
  expiresAt: Date | null;
}

const ACTIVITY: LoyaltyEventKind[] = ['EARN', 'BONUS', 'PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'REDEEM'];
const INFLOW: LoyaltyEventKind[] = ['EARN', 'BONUS', 'PURCHASE', 'TRANSFER_IN'];
const OUTFLOW: LoyaltyEventKind[] = ['REDEEM', 'EXPIRE', 'TRANSFER_OUT'];

const accountInclude = {
  profile: { select: { id: true, nickname: true } },
  program: true,
  currency: true,
  events: { select: { kind: true, points: true, balanceAfter: true, occurredAt: true }, orderBy: { occurredAt: 'asc' as const } },
} satisfies Prisma.LoyaltyAccountInclude;
type AccountRow = Prisma.LoyaltyAccountGetPayload<{ include: typeof accountInclude }>;

/** Loyalty assets: accounts and balances, certificates, status, memberships, valuation, forecast, transfers, award trips. */
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: LoyaltyIngestService,
  ) {}

  // ───────────── helpers ─────────────

  private async profile(userId: string, id: string) {
    const p = await this.prisma.profile.findFirst({ where: { id, userId }, select: { id: true, nickname: true } });
    if (!p) throw new NotFoundException('Household member not found');
    return p;
  }

  private async memberNames(userId: string) {
    return new Map((await this.prisma.profile.findMany({ where: { userId }, select: { id: true, nickname: true } })).map((p) => [p.id, p.nickname]));
  }

  private async programByCode(code?: string | null) {
    if (!code) return null;
    const p = await this.prisma.loyaltyProgram.findUnique({ where: { code: code.toUpperCase() } });
    if (!p) throw new BadRequestException(`Unknown program "${code}"`);
    return p;
  }

  // ───────────── registry ─────────────

  async registry() {
    const [programs, currencies] = await Promise.all([this.prisma.loyaltyProgram.findMany({ where: { isActive: true }, orderBy: [{ kind: 'asc' }, { name: 'asc' }] }), this.prisma.rewardCurrency.findMany({ where: { isCash: false }, orderBy: { name: 'asc' } })]);
    const pol = (x: { policyType: string; policyMonths: number | null; resetConditions: string[]; policyVerified: boolean; policyNote: string | null }) => ({ type: x.policyType, months: x.policyMonths, resetConditions: x.resetConditions, verified: x.policyVerified, note: x.policyNote });
    return {
      programs: programs.map((p) => ({ code: p.code, name: p.name, kind: p.kind, centsPerPoint: Number(p.centsPerPoint), transferable: p.transferable, policy: pol(p) })),
      currencies: currencies.map((c) => ({ code: c.code, name: c.name, centsPerPoint: Number(c.centsPerPoint), policy: pol(c) })),
    };
  }

  // ───────────── accounts ─────────────

  private view(a: AccountRow, now: Date) {
    const src = a.program ?? a.currency;
    const cpp = Number(a.customCentsPerPoint ?? a.program?.centsPerPoint ?? a.currency?.centsPerPoint ?? 1);
    const kind = a.program?.kind ?? a.customKind ?? (a.currency ? 'OTHER' : 'OTHER');
    const name = a.program?.name ?? a.currency?.name ?? a.customName ?? 'Loyalty program';
    const lots = lotsFromEvents(a.events, a.balance);
    const prediction = predictExpiration({
      balance: a.balance,
      policyType: (src?.policyType ?? 'UNKNOWN') as never,
      policyMonths: src?.policyMonths ?? null,
      policyVerified: src?.policyVerified ?? false,
      policySource: src?.policySource ?? null,
      resetConditions: src?.resetConditions ?? [],
      lastActivityAt: a.lastActivityAt,
      expiresAtOverride: a.expiresAt,
      lots,
      centsPerPoint: cpp,
      now,
    });
    const oneYearAgo = new Date(now.getTime() - 365 * DAY);
    const recent = a.events.filter((e) => e.occurredAt >= oneYearAgo);
    const prov = (a.provenance ?? {}) as Record<string, { sourceType: SourceType; reliability: number; observedAt: string; verification: string }>;
    const observed = Object.values(prov).map((p) => new Date(p.observedAt).getTime());
    const lastObservedAt = observed.length ? new Date(Math.max(...observed)) : a.balance > 0 ? a.refreshedAt : null;
    const bal = prov.balance;
    const priority = a.refreshPriority as Priority;
    return {
      provenance: prov,
      balanceSource: (bal?.sourceType ?? a.balanceSource ?? (a.balance > 0 ? 'MANUAL' : null)) as SourceType | null,
      balanceReliability: bal?.reliability ?? (a.balance > 0 ? 25 : null),
      balanceObservedAt: bal ? new Date(bal.observedAt) : a.balanceObservedAt,
      balanceVerification: bal?.verification ?? 'UNVERIFIED',
      refreshConfidence: bal ? refreshConfidence(bal.reliability, new Date(bal.observedAt), now) : a.balance > 0 ? refreshConfidence(25, a.refreshedAt, now) : 0,
      lastObservedAt,
      lastSuccessfulRefreshAt: a.lastSuccessfulRefreshAt,
      nextRefreshAt: a.nextRefreshAt,
      refreshPriority: priority,
      freshness: freshness(lastObservedAt, priority, now),
      id: a.id,
      profileId: a.profileId,
      member: a.profile.nickname,
      programCode: a.program?.code ?? a.currency?.code ?? null,
      programName: name,
      kind,
      isBankCurrency: !!a.currency,
      unit: UNIT(kind),
      centsPerPoint: cpp,
      nickname: a.nickname,
      accountLast4: a.accountLast4,
      memberSince: a.memberSince,
      balance: a.balance,
      pendingBalance: a.pendingBalance,
      lifetimePoints: a.lifetimePoints,
      statusLevel: a.statusLevel,
      statusDeadline: a.statusDeadline,
      expiresAt: a.expiresAt,
      lastActivityAt: a.lastActivityAt,
      source: a.source,
      refreshedAt: a.refreshedAt,
      transferable: a.transferable ?? a.program?.transferable ?? !!a.currency,
      notes: a.notes,
      valueCents: Math.round(a.balance * cpp),
      policy: { type: src?.policyType ?? 'UNKNOWN', months: src?.policyMonths ?? null, resetConditions: src?.resetConditions ?? [], verified: src?.policyVerified ?? false, source: src?.policySource ?? null },
      prediction,
      expiredPoints: recent.filter((e) => e.kind === 'EXPIRE').reduce((s, e) => s + Math.abs(e.points), 0),
      redeemedPoints: recent.filter((e) => e.kind === 'REDEEM').reduce((s, e) => s + Math.abs(e.points), 0),
    };
  }

  private async rows(userId: string): Promise<AccountRow[]> {
    return this.prisma.loyaltyAccount.findMany({ where: { userId }, include: accountInclude, orderBy: [{ balance: 'desc' }] });
  }

  async accounts(userId: string, now = new Date()) {
    return (await this.rows(userId)).map((a) => this.view(a, now));
  }

  async createAccount(userId: string, dto: CreateAccountDto) {
    await this.profile(userId, dto.profileId);
    const given = [dto.programCode, dto.currencyCode, dto.customName].filter(Boolean).length;
    if (given !== 1) throw new BadRequestException('Give exactly one of programCode, currencyCode or customName');
    const program = await this.programByCode(dto.programCode);
    let currencyId: string | null = null;
    if (dto.currencyCode) {
      const c = await this.prisma.rewardCurrency.findUnique({ where: { code: dto.currencyCode.toUpperCase() } });
      if (!c || c.isCash) throw new BadRequestException(`Unknown points currency "${dto.currencyCode}"`);
      currencyId = c.id;
    }
    const balance = dto.balance ?? 0;
    const row = await this.prisma.loyaltyAccount.create({
      data: {
        userId,
        profileId: dto.profileId,
        programId: program?.id ?? null,
        currencyId,
        customName: dto.customName ?? null,
        customKind: dto.customName ? dto.customKind ?? 'OTHER' : null,
        customCentsPerPoint: dto.customName ? dto.customCentsPerPoint ?? 1 : null,
        nickname: dto.nickname ?? null,
        accountNumberEnc: dto.accountNumber ? encryptSecret(dto.accountNumber) : null,
        accountLast4: dto.accountNumber ? dto.accountNumber.slice(-4) : null,
        memberSince: date(dto.memberSince),
        balance,
        pendingBalance: dto.pendingBalance ?? 0,
        lifetimePoints: dto.lifetimePoints ?? balance,
        statusLevel: dto.statusLevel ?? null,
        statusDeadline: date(dto.statusDeadline),
        expiresAt: date(dto.expiresAt),
        lastActivityAt: date(dto.lastActivityAt),
        source: dto.source ?? 'MANUAL',
        transferable: dto.transferable ?? null,
        notes: dto.notes ?? null,
        provenance: Object.fromEntries(
          (['balance', 'pendingBalance', 'lifetimePoints', 'statusLevel', 'statusDeadline', 'expiresAt', 'lastActivityAt'] as const)
            .filter((f) => (dto as unknown as Record<string, unknown>)[f] != null && (dto as unknown as Record<string, unknown>)[f] !== 0)
            .map((f) => [f, { sourceType: 'MANUAL', reliability: 25, observedAt: new Date().toISOString(), verification: 'UNVERIFIED' }]),
        ) as Prisma.InputJsonValue,
        balanceSource: balance > 0 ? 'MANUAL' : null,
        balanceObservedAt: balance > 0 ? new Date() : null,
        refreshConfidence: balance > 0 ? 25 : 0,
        lastSuccessfulRefreshAt: new Date(),
        events: balance > 0 ? { create: [{ userId, kind: 'SNAPSHOT', points: 0, balanceAfter: balance, note: 'Opening balance' }] } : undefined,
      },
      include: accountInclude,
    });
    return this.view(row, new Date());
  }

  private async ownedAccount(userId: string, id: string): Promise<AccountRow> {
    const a = await this.prisma.loyaltyAccount.findFirst({ where: { id, userId }, include: accountInclude });
    if (!a) throw new NotFoundException('Account not found');
    return a;
  }

  /**
   * Manual edits go through the same funnel as every other source (source MANUAL, reliability 25), so they are
   * audited and a lower-confidence value never silently replaces a higher one. `force` records an explicit override.
   */
  async updateAccount(userId: string, id: string, dto: UpdateAccountDto) {
    const a = await this.ownedAccount(userId, id);
    const data: Prisma.LoyaltyAccountUpdateInput = {};
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    if (dto.accountNumber !== undefined) {
      data.accountNumberEnc = encryptSecret(dto.accountNumber);
      data.accountLast4 = dto.accountNumber.slice(-4);
    }
    if (dto.transferable !== undefined) data.transferable = dto.transferable;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (Object.keys(data).length) await this.prisma.loyaltyAccount.update({ where: { id }, data });
    const now = new Date();
    const obs: ParsedObservation[] = [];
    const push = (field: string, value: unknown, changed: boolean) => {
      if (changed) obs.push({ entity: 'ACCOUNT', field, value, rule: 'manual', ruleConfidence: 100, observedAt: now });
    };
    push('balance', dto.balance, dto.balance !== undefined && dto.balance !== a.balance);
    push('pendingBalance', dto.pendingBalance, dto.pendingBalance !== undefined && dto.pendingBalance !== a.pendingBalance);
    push('lifetimePoints', dto.lifetimePoints, dto.lifetimePoints !== undefined && dto.lifetimePoints !== a.lifetimePoints);
    push('statusLevel', dto.statusLevel, dto.statusLevel !== undefined && dto.statusLevel !== a.statusLevel);
    push('statusDeadline', date(dto.statusDeadline), dto.statusDeadline !== undefined);
    push('expiresAt', dto.expiresAt === null ? null : date(dto.expiresAt), dto.expiresAt !== undefined);
    push('lastActivityAt', date(dto.lastActivityAt), dto.lastActivityAt !== undefined);
    let outcome: IngestResult | null = null;
    if (obs.length) outcome = await this.ingest.apply({ userId, programCode: 'MANUAL', sourceType: 'MANUAL', method: 'manual-edit', evidenceHash: evidenceHashOf('manual', id, obs.map((o) => `${o.field}=${String(o.value)}`).join(','), now.getTime()), now, accountId: id, force: dto.force }, obs);
    const row = await this.ownedAccount(userId, id);
    return { ...this.view(row, new Date()), ingest: outcome };
  }

  async deleteAccount(userId: string, id: string) {
    await this.ownedAccount(userId, id);
    await this.prisma.loyaltyAccount.delete({ where: { id } });
  }

  /** Records a balance change. Earn, purchase, transfer and redeem count as activity for expiration unless set otherwise. */
  async addEvent(userId: string, id: string, dto: AccountEventDto) {
    const a = await this.ownedAccount(userId, id);
    const at = dto.occurredAt ? new Date(dto.occurredAt) : new Date();
    let delta = 0;
    let balance = a.balance;
    if (dto.kind === 'SNAPSHOT') balance = dto.balance ?? a.balance;
    else if (dto.kind === 'ADJUST') {
      if (dto.balance == null) throw new BadRequestException('ADJUST needs the new balance');
      delta = dto.balance - a.balance;
      balance = dto.balance;
    } else if (INFLOW.includes(dto.kind)) {
      delta = dto.points;
      balance = a.balance + dto.points;
    } else if (OUTFLOW.includes(dto.kind)) {
      if (dto.points > a.balance) throw new BadRequestException('That is more points than the account holds');
      delta = -dto.points;
      balance = a.balance - dto.points;
    }
    const data: Prisma.LoyaltyAccountUpdateInput = { balance, refreshedAt: new Date() };
    if (balance !== a.balance) {
      // the balance now comes from this manual entry
      data.provenance = { ...((a.provenance ?? {}) as Record<string, unknown>), balance: { sourceType: 'MANUAL', reliability: 25, observedAt: at.toISOString(), verification: 'UNVERIFIED' } } as Prisma.InputJsonValue;
      data.balanceSource = 'MANUAL';
      data.balanceObservedAt = at;
    }
    if (ACTIVITY.includes(dto.kind) && (!a.lastActivityAt || at > a.lastActivityAt)) data.lastActivityAt = at;
    if (['EARN', 'BONUS', 'PURCHASE'].includes(dto.kind)) data.lifetimePoints = a.lifetimePoints + dto.points;
    await this.prisma.$transaction([
      this.prisma.loyaltyEvent.create({ data: { userId, accountId: id, kind: dto.kind, points: delta, balanceAfter: balance, occurredAt: at, note: dto.note ?? null } }),
      this.prisma.loyaltyAccount.update({ where: { id }, data }),
    ]);
    return this.view(await this.ownedAccount(userId, id), new Date());
  }

  /** Balance history by month, category totals and growth for one account. */
  async history(userId: string, id: string, months = 12, now = new Date()) {
    const a = await this.ownedAccount(userId, id);
    const events = a.events.map((e) => ({ kind: e.kind, points: e.points, balanceAfter: e.balanceAfter, occurredAt: e.occurredAt }));
    const series = monthlyHistory(events, a.balance, now, Math.min(Math.max(months, 2), 60));
    return { account: this.view(a, now), months: series, growth: growthSummary(series), totals: trackingTotals(events, a.balance, a.pendingBalance), events: a.events.slice(-100).reverse() };
  }

  /** One row per account: expiry, risk, alert text and ways to keep the points alive. */
  async expirations(userId: string, now = new Date()) {
    const accts = (await this.accounts(userId, now)).filter((a) => a.balance > 0);
    const items = accts.map((a) => ({
      accountId: a.id,
      member: a.member,
      program: a.nickname ? `${a.programName} (${a.nickname})` : a.programName,
      unit: a.unit,
      balance: a.balance,
      valueCents: a.valueCents,
      prediction: a.prediction,
      policy: a.policy,
      message: a.prediction.level === 'NONE' || (a.prediction.level === 'LOW' && a.prediction.expiresAt == null) ? null : alertText(a.programName, a.unit, a.prediction),
      preservation: a.prediction.level === 'HIGH' || a.prediction.level === 'MEDIUM' || a.prediction.level === 'EXPIRED' ? preservationAdvice(a.kind, a.policy.resetConditions, a.prediction.daysLeft).slice(0, 5) : [],
    }));
    items.sort((x, y) => y.prediction.riskScore - x.prediction.riskScore || (x.prediction.daysLeft ?? 99_999) - (y.prediction.daysLeft ?? 99_999));
    return { generatedAt: now, atRiskPoints: items.filter((i) => i.prediction.level === 'HIGH' || i.prediction.level === 'EXPIRED').reduce((s, i) => s + i.prediction.atRiskPoints, 0), items };
  }

  // ───────────── certificates ─────────────

  private certDomain(c: Prisma.LoyaltyCertificateGetPayload<{ include: { profile: { select: { nickname: true } }; program: { select: { name: true } } } }>): Cert & { memberId: string; usedAt: Date | null } {
    return { id: c.id, category: c.category, name: c.name, program: c.program?.name ?? null, member: c.profile.nickname, memberId: c.profileId, status: c.status, quantity: c.quantity, issuedAt: c.issuedAt, expiresAt: c.expiresAt, pointCap: c.pointCap, eligible: c.eligible, blackout: c.blackout, restrictions: c.restrictions, transferable: c.transferable, potentialValueCents: c.potentialValueCents, usedAt: c.usedAt };
  }

  private async certRows(userId: string) {
    return this.prisma.loyaltyCertificate.findMany({ where: { userId }, include: { profile: { select: { nickname: true } }, program: { select: { name: true } } }, orderBy: [{ expiresAt: 'asc' }] });
  }

  async certificates(userId: string, category?: string, now = new Date()) {
    const rows = (await this.certRows(userId)).filter((c) => !category || c.category === category);
    return rows.map((c) => ({ ...this.certDomain(c), subtype: c.subtype, number: c.number, fareClasses: c.fareClasses, usageNote: c.usageNote, accountId: c.accountId, view: certState(c, now) }));
  }

  async createCertificate(userId: string, dto: CertificateDto) {
    await this.profile(userId, dto.profileId);
    const program = await this.programByCode(dto.programCode);
    if (dto.accountId) await this.ownedAccount(userId, dto.accountId);
    const issued = date(dto.issuedAt);
    const expires = date(dto.expiresAt);
    if (issued && expires && expires < issued) throw new BadRequestException('expiresAt must be after issuedAt');
    const row = await this.prisma.loyaltyCertificate.create({
      data: {
        userId, profileId: dto.profileId, programId: program?.id ?? null, accountId: dto.accountId ?? null, category: dto.category, subtype: dto.subtype ?? null, name: dto.name,
        number: dto.number ?? null, issuedAt: issued, expiresAt: expires, quantity: dto.quantity ?? 1, pointCap: dto.pointCap ?? null, restrictions: dto.restrictions ?? null,
        eligible: dto.eligible ?? [], blackout: dto.blackout ?? null, fareClasses: dto.fareClasses ?? null, transferable: dto.transferable ?? false, potentialValueCents: dto.potentialValueCents ?? 0,
      },
    });
    return row;
  }

  private async ownedCert(userId: string, id: string) {
    const c = await this.prisma.loyaltyCertificate.findFirst({ where: { id, userId }, include: { profile: { select: { nickname: true } }, program: { select: { name: true } } } });
    if (!c) throw new NotFoundException('Certificate not found');
    return c;
  }

  async updateCertificate(userId: string, id: string, dto: UpdateCertificateDto) {
    await this.ownedCert(userId, id);
    const data: Prisma.LoyaltyCertificateUpdateInput = {};
    if (dto.expiresAt !== undefined) data.expiresAt = date(dto.expiresAt);
    if (dto.quantity !== undefined) data.quantity = dto.quantity;
    if (dto.potentialValueCents !== undefined) data.potentialValueCents = dto.potentialValueCents;
    if (dto.restrictions !== undefined) data.restrictions = dto.restrictions;
    if (dto.blackout !== undefined) data.blackout = dto.blackout;
    if (dto.usageNote !== undefined) data.usageNote = dto.usageNote;
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.usedAt = dto.status === 'USED' ? new Date() : null;
    }
    return this.prisma.loyaltyCertificate.update({ where: { id }, data });
  }

  async deleteCertificate(userId: string, id: string) {
    await this.ownedCert(userId, id);
    await this.prisma.loyaltyCertificate.delete({ where: { id } });
  }

  /** Expiring and unused certificates, with the best qualifying hotel from the stays you give (or the stored value). */
  async certificateIntelligence(userId: string, stays: Stay[] = [], now = new Date()) {
    const certs = (await this.certRows(userId)).map((c) => this.certDomain(c));
    return certificateOpportunities(certs, stays, now);
  }

  async checkRedemption(userId: string, id: string, stays: Stay[], now = new Date()) {
    const c = this.certDomain(await this.ownedCert(userId, id));
    return stays.map((s) => ({ hotel: s.hotel, checkIn: day(s.checkIn), ...checkFreeNight(c, s, now) }));
  }

  // ───────────── elite status ─────────────

  private async statusRows(userId: string) {
    return this.prisma.eliteStatus.findMany({ where: { userId }, include: { profile: { select: { nickname: true } } }, orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }] });
  }

  private eliteDomain(s: Prisma.EliteStatusGetPayload<{ include: { profile: { select: { nickname: true } } } }>): Elite & { memberId: string } {
    return { id: s.id, program: s.programName, level: s.level, member: s.profile.nickname, memberId: s.profileId, periodStart: s.periodStart, expiresAt: s.expiresAt, metric: s.metric, progress: s.progress, required: s.required, maintained: s.maintained, valueCents: s.valueCents };
  }

  /** Every status row (the qualification history) with progress, renewal likelihood and actions; `current` marks the latest per member and program. */
  async statuses(userId: string, now = new Date()) {
    const rows = await this.statusRows(userId);
    const latest = new Map<string, string>();
    for (const r of rows) {
      const key = `${r.profileId}|${r.programName.toLowerCase()}`;
      if (!latest.has(key)) latest.set(key, r.id); // rows are newest first
    }
    return rows.map((r) => ({ ...this.eliteDomain(r), kind: r.kind, renewalRequirement: r.renewalRequirement, benefits: r.benefits, current: latest.get(`${r.profileId}|${r.programName.toLowerCase()}`) === r.id, view: eliteView(this.eliteDomain(r), now) }));
  }

  async createStatus(userId: string, dto: StatusDto) {
    await this.profile(userId, dto.profileId);
    const program = await this.programByCode(dto.programCode);
    if (dto.accountId) await this.ownedAccount(userId, dto.accountId);
    return this.prisma.eliteStatus.create({
      data: { userId, profileId: dto.profileId, programId: program?.id ?? null, accountId: dto.accountId ?? null, programName: dto.programName, kind: dto.kind, level: dto.level, periodStart: date(dto.periodStart), expiresAt: date(dto.expiresAt), metric: dto.metric ?? null, progress: dto.progress ?? 0, required: dto.required ?? 0, maintained: dto.maintained ?? false, renewalRequirement: dto.renewalRequirement ?? null, benefits: dto.benefits ?? [], valueCents: dto.valueCents ?? 0 },
    });
  }

  async updateStatus(userId: string, id: string, dto: UpdateStatusDto) {
    const s = await this.prisma.eliteStatus.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException('Status not found');
    return this.prisma.eliteStatus.update({ where: { id }, data: { ...(dto.level !== undefined && { level: dto.level }), ...(dto.expiresAt !== undefined && { expiresAt: date(dto.expiresAt) }), ...(dto.progress !== undefined && { progress: dto.progress }), ...(dto.required !== undefined && { required: dto.required }), ...(dto.maintained !== undefined && { maintained: dto.maintained }), ...(dto.valueCents !== undefined && { valueCents: dto.valueCents }) } });
  }

  async deleteStatus(userId: string, id: string) {
    const r = await this.prisma.eliteStatus.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Status not found');
  }

  // ───────────── memberships ─────────────

  private memberDomain(m: Prisma.MembershipGetPayload<{ include: { profile: { select: { nickname: true } } } }>): Member & { memberId: string } {
    return { id: m.id, kind: m.kind, name: m.name, member: m.profile.nickname, memberId: m.profileId, expiresAt: m.expiresAt, renewalAt: m.renewalAt, renewalCostCents: m.renewalCostCents, autoRenew: m.autoRenew, annualValueCents: m.annualValueCents };
  }

  async memberships(userId: string, credits: CreditInfo[] = [], now = new Date()) {
    const rows = await this.prisma.membership.findMany({ where: { userId }, include: { profile: { select: { nickname: true } } }, orderBy: [{ expiresAt: 'asc' }] });
    return rows.map((m) => {
      const d = this.memberDomain(m);
      const sug = renewalCreditSuggestion(d, credits.map((c) => ({ benefit: c.benefit, card: c.card, remainingCents: c.remainingCents })));
      return { ...d, joinedAt: m.joinedAt, memberLast4: m.memberLast4, benefits: m.benefits, renewalMethod: m.renewalMethod, linkedWalletCardId: m.linkedWalletCardId, notes: m.notes, view: membershipView(d, now), creditSuggestion: sug?.text ?? null };
    });
  }

  async createMembership(userId: string, dto: MembershipDto) {
    await this.profile(userId, dto.profileId);
    if (dto.linkedWalletCardId) {
      const wc = await this.prisma.walletCard.findFirst({ where: { id: dto.linkedWalletCardId, wallet: { userId } }, select: { id: true } });
      if (!wc) throw new BadRequestException('Linked card not found in your wallet');
    }
    return this.prisma.membership.create({
      data: { userId, profileId: dto.profileId, kind: dto.kind, name: dto.name, joinedAt: date(dto.joinedAt), renewalAt: date(dto.renewalAt), expiresAt: date(dto.expiresAt), memberNumberEnc: dto.memberNumber ? encryptSecret(dto.memberNumber) : null, memberLast4: dto.memberNumber ? dto.memberNumber.slice(-4) : null, benefits: dto.benefits ?? [], renewalCostCents: dto.renewalCostCents ?? 0, renewalMethod: dto.renewalMethod ?? null, autoRenew: dto.autoRenew ?? false, linkedWalletCardId: dto.linkedWalletCardId ?? null, annualValueCents: dto.annualValueCents ?? 0, notes: dto.notes ?? null },
      select: { id: true, kind: true, name: true, expiresAt: true, memberLast4: true },
    });
  }

  async updateMembership(userId: string, id: string, dto: UpdateMembershipDto) {
    const m = await this.prisma.membership.findFirst({ where: { id, userId } });
    if (!m) throw new NotFoundException('Membership not found');
    return this.prisma.membership.update({ where: { id }, data: { ...(dto.renewalAt !== undefined && { renewalAt: date(dto.renewalAt) }), ...(dto.expiresAt !== undefined && { expiresAt: date(dto.expiresAt) }), ...(dto.renewalCostCents !== undefined && { renewalCostCents: dto.renewalCostCents }), ...(dto.autoRenew !== undefined && { autoRenew: dto.autoRenew }), ...(dto.annualValueCents !== undefined && { annualValueCents: dto.annualValueCents }), ...(dto.linkedWalletCardId !== undefined && { linkedWalletCardId: dto.linkedWalletCardId }) }, select: { id: true, expiresAt: true, autoRenew: true } });
  }

  async deleteMembership(userId: string, id: string) {
    const r = await this.prisma.membership.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Membership not found');
  }

  /** The member number, decrypted for the owner only. */
  async revealMemberNumber(userId: string, id: string) {
    const m = await this.prisma.membership.findFirst({ where: { id, userId }, select: { memberNumberEnc: true } });
    if (!m) throw new NotFoundException('Membership not found');
    return { memberNumber: m.memberNumberEnc ? decryptSecret(m.memberNumberEnc) : null };
  }

  // ───────────── valuation, forecast, household ─────────────

  async valuation(userId: string, credits: CreditInfo[] = [], now = new Date()) {
    const [accts, certRows, statusList, memberList] = await Promise.all([this.accounts(userId, now), this.certRows(userId), this.statuses(userId, now), this.memberships(userId, [], now)]);
    const valued: ValuedAccount[] = accts.map((a) => ({ id: a.id, member: a.member, memberId: a.profileId, program: a.programName, unit: a.unit, balance: a.balance, pending: a.pendingBalance, centsPerPoint: a.centsPerPoint, prediction: a.prediction, expiredPoints: a.expiredPoints, redeemedPoints: a.redeemedPoints }));
    const certs: ValuedCert[] = certRows.map((c) => this.certDomain(c));
    const statuses: ValuedStatus[] = statusList.filter((s) => s.current).map((s) => ({ id: s.id, program: s.program, level: s.level, member: s.member, memberId: s.memberId, periodStart: s.periodStart, expiresAt: s.expiresAt, metric: s.metric, progress: s.progress, required: s.required, maintained: s.maintained, valueCents: s.valueCents, view: s.view }));
    const memberships = memberList.map((m) => ({ id: m.id, kind: m.kind, name: m.name, member: m.member, memberId: m.memberId, expiresAt: m.expiresAt, renewalAt: m.renewalAt, renewalCostCents: m.renewalCostCents, autoRenew: m.autoRenew, annualValueCents: m.annualValueCents })) as ValuedMembership[];
    return valueAssets({ now, accounts: valued, certificates: certs, statuses, memberships, unusedCreditsCents: credits.reduce((s, c) => s + c.remainingCents, 0) });
  }

  async forecast(userId: string, credits: CreditInfo[] = [], now = new Date()) {
    const [accts, certs, statusList, memberList] = await Promise.all([this.accounts(userId, now), this.certificates(userId, undefined, now), this.statuses(userId, now), this.memberships(userId, [], now)]);
    const items: ForecastItem[] = [];
    for (const a of accts) {
      const p: ExpiryPrediction = a.prediction;
      if (p.tranches.length)
        for (const t of p.tranches) items.push({ type: 'POINTS', label: `${a.programName} ${a.unit}`, member: a.member, date: t.date, valueCents: Math.round(t.points * a.centsPerPoint), detail: `${t.points.toLocaleString('en-US')} ${a.unit}` });
      else if (p.expiresAt && p.atRiskPoints > 0) items.push({ type: 'POINTS', label: `${a.programName} ${a.unit}`, member: a.member, date: p.expiresAt, valueCents: Math.round(p.atRiskPoints * a.centsPerPoint), detail: `${p.atRiskPoints.toLocaleString('en-US')} ${a.unit}, ${p.confidence}% confidence` });
    }
    for (const c of certs) if (c.expiresAt && c.view.effectiveStatus === 'AVAILABLE') items.push({ type: c.category, label: c.name, member: c.member, date: c.expiresAt, valueCents: c.potentialValueCents * Math.max(1, c.quantity) });
    for (const s of statusList) if (s.current && s.expiresAt && !s.maintained) items.push({ type: 'STATUS', label: `${s.program} ${s.level}`, member: s.member, date: s.expiresAt, valueCents: s.valueCents, detail: s.view.headline });
    for (const m of memberList) {
      const when = m.expiresAt ?? m.renewalAt;
      if (when) items.push({ type: 'MEMBERSHIP', label: m.name, member: m.member, date: when, valueCents: m.annualValueCents });
    }
    for (const c of credits) if (c.expiresAt && c.remainingCents > 0) items.push({ type: 'CREDIT', label: `${c.card}: ${c.benefit}`, member: c.member ?? '', date: c.expiresAt, valueCents: c.remainingCents });
    return buildForecast(items, now);
  }

  /** Everything at a glance. */
  async dashboard(userId: string, credits: CreditInfo[] = [], now = new Date()) {
    const [valuation, exp, certOps, statuses, members, fc] = await Promise.all([this.valuation(userId, credits, now), this.expirations(userId, now), this.certificateIntelligence(userId, [], now), this.statuses(userId, now), this.memberships(userId, credits, now), this.forecast(userId, credits, now)]);
    return {
      valuation,
      atRiskPoints: exp.atRiskPoints,
      expiringAccounts: exp.items.filter((i) => i.message && i.prediction.daysLeft != null && i.prediction.daysLeft <= 365).slice(0, 5),
      certificates: certOps.slice(0, 5),
      statuses: statuses.filter((s) => s.current && s.view.risk !== 'NONE').slice(0, 5),
      memberships: members.filter((m) => m.view.state === 'EXPIRING' || m.view.state === 'EXPIRED').slice(0, 5),
      nextThirtyDays: fc.buckets[0],
      overdue: fc.overdue,
    };
  }

  /** Per member and combined: assets, expirations and the best use of each bank balance. */
  async household(userId: string, credits: CreditInfo[] = [], now = new Date()) {
    const [valuation, accts, cat] = await Promise.all([this.valuation(userId, credits, now), this.accounts(userId, now), this.travelCatalog()]);
    const byCode = new Map(cat.currencies.map((c) => [c.code, c]));
    const transfers = accts
      .filter((a) => a.isBankCurrency && a.balance > 0 && a.programCode && byCode.has(a.programCode))
      .map((a) => {
        const best = transferOptions(byCode.get(a.programCode!)!, cat.partners, cat.programs, now)[0];
        return best ? { member: a.member, currency: a.programName, points: a.balance, program: best.program.name, bonusPercent: best.bonusPercent, centsPerPoint: best.centsPerPoint, upliftVsCash: best.upliftVsCash } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const expiring = accts.filter((a) => a.prediction.daysLeft != null && a.prediction.daysLeft <= 365 && a.prediction.atRiskPoints > 0).map((a) => ({ member: a.member, program: a.programName, atRiskPoints: a.prediction.atRiskPoints, daysLeft: a.prediction.daysLeft, level: a.prediction.level }));
    return { combined: { currentCents: valuation.currentCents, potentialCents: valuation.potentialCents, atRiskCents: valuation.atRiskCents, annualNetCents: valuation.annualNetCents, totalPoints: valuation.totalPoints }, members: valuation.members, expiring, transfers };
  }

  // ───────────── transfer partners and bonuses ─────────────

  private async travelCatalog() {
    const [cur, prog, part] = await Promise.all([this.prisma.rewardCurrency.findMany(), this.prisma.loyaltyProgram.findMany({ where: { isActive: true } }), this.prisma.transferPartner.findMany()]);
    const currencies: Currency[] = cur.map((c) => ({ id: c.id, code: c.code, name: c.name, centsPerPoint: Number(c.centsPerPoint), isCash: c.isCash, householdPooling: c.householdPooling, transferIncrement: c.transferIncrement }));
    const programs: Program[] = prog.map((p) => ({ id: p.id, code: p.code, name: p.name, kind: p.kind, centsPerPoint: Number(p.centsPerPoint), householdPooling: p.householdPooling }));
    const partners: Partner[] = part.map((p) => ({ currencyId: p.currencyId, programId: p.programId, ratioFrom: p.ratioFrom, ratioTo: p.ratioTo, transferDays: p.transferDays, bonusPercent: p.bonusPercent, bonusEndsAt: p.bonusEndsAt }));
    return { currencies, programs, partners };
  }

  /** Every transfer route with its ratio, current bonus, history statistics and a transfer / wait recommendation. */
  async transferRoutes(now = new Date()) {
    const [cat, records] = await Promise.all([this.travelCatalog(), this.prisma.transferBonusRecord.findMany({ orderBy: { startsAt: 'asc' } })]);
    const cur = new Map(cat.currencies.map((c) => [c.id, c]));
    const prog = new Map(cat.programs.map((p) => [p.id, p]));
    const rec = new Map<string, typeof records>();
    for (const r of records) rec.set(`${r.currencyId}|${r.programId}`, [...(rec.get(`${r.currencyId}|${r.programId}`) ?? []), r]);
    return cat.partners
      .map((p) => {
        const c = cur.get(p.currencyId)!;
        const g = prog.get(p.programId)!;
        const history = rec.get(`${p.currencyId}|${p.programId}`) ?? [];
        const stats: BonusStats = bonusStats(history);
        const active = bonusActive(p, now) ? p.bonusPercent : null;
        return { currency: c.code, currencyName: c.name, program: g.code, programName: g.name, ratio: `${p.ratioFrom}:${p.ratioTo}`, transferDays: p.transferDays, activeBonusPercent: active, bonusEndsAt: active ? p.bonusEndsAt : null, effectiveCentsPerPoint: Math.round((p.ratioTo / p.ratioFrom) * (1 + (active ?? 0) / 100) * g.centsPerPoint * 1000) / 1000, stats, advice: bonusAdvice(active, stats, now), history: history.slice(-12).reverse() };
      })
      .sort((a, b) => (b.activeBonusPercent ?? 0) - (a.activeBonusPercent ?? 0) || a.currencyName.localeCompare(b.currencyName) || a.programName.localeCompare(b.programName));
  }

  /** Logs the bonuses that are active right now as history (idempotent per route and start date). */
  async recordActiveBonuses(now = new Date()): Promise<number> {
    const active = await this.prisma.transferPartner.findMany({ where: { bonusPercent: { gt: 0 }, OR: [{ bonusEndsAt: null }, { bonusEndsAt: { gt: now } }] } });
    let n = 0;
    for (const p of active) {
      // the start is the day first seen unless a record for this bonus is already open
      const open = await this.prisma.transferBonusRecord.findFirst({ where: { currencyId: p.currencyId, programId: p.programId, bonusPercent: p.bonusPercent, OR: [{ endsAt: null }, { endsAt: { gt: now } }] } });
      if (open) {
        if (p.bonusEndsAt && (!open.endsAt || open.endsAt.getTime() !== p.bonusEndsAt.getTime())) await this.prisma.transferBonusRecord.update({ where: { id: open.id }, data: { endsAt: p.bonusEndsAt } });
        continue;
      }
      const startsAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      await this.prisma.transferBonusRecord.upsert({ where: { currencyId_programId_startsAt: { currencyId: p.currencyId, programId: p.programId, startsAt } }, update: {}, create: { currencyId: p.currencyId, programId: p.programId, bonusPercent: p.bonusPercent, startsAt, endsAt: p.bonusEndsAt, source: 'observed by PointWise' } });
      n++;
    }
    return n;
  }

  async addBonusRecord(dto: BonusRecordDto) {
    const [c, p] = await Promise.all([this.prisma.rewardCurrency.findUnique({ where: { code: dto.currency.toUpperCase() } }), this.prisma.loyaltyProgram.findUnique({ where: { code: dto.program.toUpperCase() } })]);
    if (!c || !p) throw new BadRequestException('Unknown currency or program');
    const startsAt = new Date(dto.startsAt);
    return this.prisma.transferBonusRecord.upsert({ where: { currencyId_programId_startsAt: { currencyId: c.id, programId: p.id, startsAt } }, update: { bonusPercent: dto.bonusPercent, endsAt: date(dto.endsAt), source: dto.source ?? 'admin' }, create: { currencyId: c.id, programId: p.id, bonusPercent: dto.bonusPercent, startsAt, endsAt: date(dto.endsAt), source: dto.source ?? 'admin' } });
  }

  // ───────────── award trips ─────────────

  private async balancesFor(userId: string, accts: Array<ReturnType<LoyaltyService['view']>>, cat: Awaited<ReturnType<LoyaltyService['travelCatalog']>>): Promise<Balance[]> {
    const progByCode = new Map(cat.programs.map((p) => [p.code, p]));
    const curByCode = new Map(cat.currencies.map((c) => [c.code, c]));
    const out: Balance[] = [];
    const seen = new Set<string>();
    for (const a of accts) {
      if (!a.programCode || a.balance <= 0) continue;
      const cur = a.isBankCurrency ? curByCode.get(a.programCode) : undefined;
      const pr = !a.isBankCurrency ? progByCode.get(a.programCode) : undefined;
      if (!cur && !pr) continue;
      out.push({ profileId: a.profileId, member: a.member, currencyId: cur?.id ?? null, programId: pr?.id ?? null, points: a.balance });
      seen.add(`${a.profileId}|${cur?.id ?? ''}|${pr?.id ?? ''}`);
    }
    // balances entered on the earlier Travel page still count when no account covers them
    const legacy = await this.prisma.loyaltyBalance.findMany({ where: { userId }, include: { profile: { select: { nickname: true } } } });
    for (const b of legacy) if (!seen.has(`${b.profileId}|${b.currencyId ?? ''}|${b.programId ?? ''}`)) out.push({ profileId: b.profileId, member: b.profile.nickname, currencyId: b.currencyId, programId: b.programId, points: b.points });
    return out;
  }

  async evaluateTrip(userId: string, dto: AwardTripDto, now = new Date()) {
    const from = new Date(dto.dateFrom);
    const to = new Date(dto.dateTo);
    if (to < from) throw new BadRequestException('dateTo must not be before dateFrom');
    const booker = dto.bookerProfileId ? (await this.profile(userId, dto.bookerProfileId)).id : undefined;
    const [accts, cat, certRows, records] = await Promise.all([this.accounts(userId, now), this.travelCatalog(), this.certRows(userId), this.prisma.transferBonusRecord.findMany()]);
    const balances = await this.balancesFor(userId, accts, cat);
    const region: Region = dto.region ?? 'LONG_HAUL';
    const estimated = dto.pointsNeeded == null;
    const pointsNeeded = dto.pointsNeeded ?? estimateAwardPoints(dto.cabin, region, dto.travelers ?? 1, true);
    const trip: TripInput = { destination: dto.destination, departs: from, returns: to, cabin: dto.cabin, airlinePrefs: dto.airlinePrefs ?? [], hotelPrefs: dto.hotelPrefs ?? [], now };

    // programs worth evaluating: airlines the household holds miles in or can transfer to, plus preferred ones
    const heldCurrencies = new Set(balances.filter((b) => b.currencyId).map((b) => b.currencyId!));
    const heldPrograms = new Set(balances.filter((b) => b.programId).map((b) => b.programId!));
    const reachable = new Set(cat.partners.filter((p) => heldCurrencies.has(p.currencyId)).map((p) => p.programId));
    const prefNorm = trip.airlinePrefs.map((p) => p.toLowerCase());
    const candidates = cat.programs.filter((p) => p.kind === 'AIRLINE' && (heldPrograms.has(p.id) || reachable.has(p.id) || prefNorm.some((x) => p.name.toLowerCase().includes(x) || p.code.toLowerCase().includes(x))));
    const accountsByProgram = new Map<string, number>();
    for (const a of accts) if (a.programCode && a.prediction.daysLeft != null && a.prediction.daysLeft <= 365) accountsByProgram.set(a.programCode, (accountsByProgram.get(a.programCode) ?? 0) + a.prediction.atRiskPoints);
    const histByRoute = new Map<string, typeof records>();
    for (const r of records) histByRoute.set(`${r.currencyId}|${r.programId}`, [...(histByRoute.get(`${r.currencyId}|${r.programId}`) ?? []), r]);
    const curById = new Map(cat.currencies.map((c) => [c.id, c]));
    const options: AwardOption[] = candidates.map((p) => {
      const plan = planAward({ programId: p.id, pointsNeeded, bookerProfileId: booker }, balances, cat.currencies, cat.partners, cat.programs, now);
      const transfers = plan.steps.filter((s) => s.kind === 'TRANSFER');
      let bonus: number | null = null;
      let advice = null;
      for (const s of transfers) {
        const c = cat.currencies.find((x) => x.code === s.from);
        const partner = c && cat.partners.find((x) => x.currencyId === c.id && x.programId === p.id);
        if (c && partner) {
          if (bonusActive(partner, now)) bonus = Math.max(bonus ?? 0, partner.bonusPercent);
          advice = advice ?? bonusAdvice(bonusActive(partner, now) ? partner.bonusPercent : null, bonusStats(histByRoute.get(`${c.id}|${p.id}`) ?? []), now);
        }
      }
      void curById;
      return { programCode: p.code, programName: p.name, kind: p.kind, pointsNeeded, covered: plan.covered, shortfall: plan.shortfall, costCents: plan.totalCostCents, maxTransferDays: plan.maxTransferDays, usesTransfer: transfers.length > 0, activeBonusPercent: bonus, bonusAdvice: advice, expiringPoints: accountsByProgram.get(p.code) ?? 0, summary: plan.summary };
    });
    const ranked = rankAwardOptions(options, trip);
    const certMatches = matchCertificates(certRows.map((c) => this.certDomain(c)), trip);
    const expiring = accts.filter((a) => a.prediction.level === 'HIGH' || a.prediction.level === 'EXPIRED').map((a) => ({ member: a.member, program: a.programName, atRiskPoints: a.prediction.atRiskPoints, daysLeft: a.prediction.daysLeft }));
    const result = {
      destination: dto.destination,
      region,
      cabin: dto.cabin,
      pointsNeeded,
      pointsEstimated: estimated,
      estimateNote: estimated ? 'No exact award price was given, so this uses a coarse planning estimate. Enter the price from the airline for a precise plan.' : null,
      options: ranked.slice(0, 6),
      certificates: certMatches,
      expiringAssets: expiring,
      hotelPrefs: trip.hotelPrefs,
      generatedAt: now,
    };
    let tripId: string | null = null;
    if (dto.save) {
      const row = await this.prisma.awardTrip.create({ data: { userId, destination: dto.destination, dateFrom: from, dateTo: to, cabin: dto.cabin, hotelPrefs: trip.hotelPrefs, airlinePrefs: trip.airlinePrefs, pointsNeeded, result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue } });
      tripId = row.id;
    }
    return { ...result, tripId };
  }

  async trips(userId: string) {
    return this.prisma.awardTrip.findMany({ where: { userId }, orderBy: { dateFrom: 'asc' }, take: 50 });
  }

  async deleteTrip(userId: string, id: string) {
    const r = await this.prisma.awardTrip.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Trip not found');
  }
}

export type { LoyaltyKind };

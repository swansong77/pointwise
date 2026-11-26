import { Injectable, Module, NotFoundException } from '@nestjs/common';
import { LoyaltyDataSource, LoyaltyEventKind, ObservationOutcome, Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { decideUpdate, FieldState, Incoming, refreshConfidence, SOURCE_RELIABILITY, SourceType } from '../domain/loyalty-provenance';
import { ParsedObservation } from '../domain/loyalty-email';
import { parseConditions } from '../domain/loyalty-conditions';

const ACCOUNT_FIELDS = ['balance', 'pendingBalance', 'lifetimePoints', 'statusLevel', 'statusDeadline', 'expiresAt', 'lastActivityAt'] as const;
type AccountField = (typeof ACCOUNT_FIELDS)[number];
const DATE_FIELDS = new Set<string>(['statusDeadline', 'expiresAt', 'lastActivityAt']);
const LOYALTY_SOURCE_OF: Record<SourceType, 'MANUAL' | 'IMPORT' | 'EMAIL'> = { OFFICIAL_API: 'IMPORT', AGGREGATOR: 'IMPORT', EMAIL: 'EMAIL', STATEMENT: 'IMPORT', EXTENSION: 'IMPORT', AI_DETECTED: 'IMPORT', MANUAL: 'MANUAL' };
const ACTIVITY_KINDS = new Set(['EARN', 'BONUS', 'PURCHASE', 'REDEEM', 'EXPIRE', 'TRANSFER_IN', 'TRANSFER_OUT', 'ADJUST']);

export interface IngestContext {
  userId: string;
  /** registry program code or bank currency code */
  programCode: string;
  sourceType: SourceType;
  /** parser rule set, extractor or import that produced the observations */
  method: string;
  /** hash of the message / statement / snapshot (no content is stored) */
  evidenceHash: string;
  /** digits the message mentions, to choose between several accounts of one program */
  memberDigits?: string | null;
  now: Date;
  /** overrides the source's default reliability */
  reliability?: number;
  /** the member explicitly overrides what is stored (manual edits) */
  force?: boolean;
  /** update this exact account instead of resolving one from the program (manual edits, custom programs) */
  accountId?: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
  outcome: ObservationOutcome;
  reason: string;
}

export interface IngestResult {
  accountId: string | null;
  program: string;
  /** why nothing could be applied */
  unmatched: string | null;
  observations: number;
  applied: number;
  confirmed: number;
  kept: number;
  conflicts: number;
  pending: number;
  duplicates: number;
  changes: FieldChange[];
}

export const evidenceHashOf = (...parts: Array<string | number | Date | null | undefined>): string =>
  createHash('sha256')
    .update(parts.map((p) => (p instanceof Date ? p.toISOString() : String(p ?? ''))).join('|'))
    .digest('hex');

type Prov = Record<string, { sourceType: SourceType; reliability: number; observedAt: string; verification: 'UNVERIFIED' | 'CROSS_CONFIRMED' }>;
const toJson = (v: unknown): Prisma.InputJsonValue => (v instanceof Date ? v.toISOString() : v === undefined ? null : (v as Prisma.InputJsonValue)) ?? Prisma.JsonNull as never;

/** The single funnel every loyalty observation passes through (email, statement, extension, manual, future APIs). */
@Injectable()
export class LoyaltyIngestService {
  constructor(private readonly prisma: PrismaService) {}

  private async accountFor(userId: string, programCode: string, digits?: string | null) {
    const code = programCode.toUpperCase();
    const accounts = await this.prisma.loyaltyAccount.findMany({ where: { userId, OR: [{ program: { code } }, { currency: { code } }] }, include: { program: { select: { name: true, kind: true } }, currency: { select: { name: true } } } });
    if (!accounts.length) return { account: null, why: `No ${code} account to update. Add the account first.` };
    if (digits) {
      const hit = accounts.filter((a) => a.accountLast4 && (a.accountLast4.toUpperCase().endsWith(digits.toUpperCase()) || digits.toUpperCase().endsWith(a.accountLast4.toUpperCase())));
      if (hit.length === 1) return { account: hit[0], why: null };
    }
    if (accounts.length === 1) return { account: accounts[0], why: null };
    return { account: null, why: `More than one ${code} account and the message does not say which (member digits ${digits ?? 'not found'}).` };
  }

  private async byId(userId: string, id: string) {
    const account = await this.prisma.loyaltyAccount.findFirst({ where: { id, userId }, include: { program: { select: { name: true, kind: true } }, currency: { select: { name: true } } } });
    return { account, why: account ? null : 'Account not found.' };
  }

  private currentState(a: { provenance: unknown; updatedAt: Date } & Record<string, unknown>, field: AccountField): FieldState | null {
    const raw = a[field];
    const empty = raw == null || raw === 0 || raw === '';
    const prov = ((a.provenance ?? {}) as Prov)[field];
    if (prov) return { value: raw, sourceType: prov.sourceType, reliability: prov.reliability, observedAt: new Date(prov.observedAt) };
    return empty ? null : { value: raw, sourceType: 'MANUAL', reliability: SOURCE_RELIABILITY.MANUAL, observedAt: a.updatedAt };
  }

  /** Applies a batch of observations for one program. Idempotent per evidence hash. */
  async apply(ctx: IngestContext, parsed: ParsedObservation[]): Promise<IngestResult> {
    // a status entity carries the level and deadline, so the plain account fields would only repeat them;
    // an observation cannot come from the future (a statement's period end may be ahead of today)
    const hasStatus = parsed.some((o) => o.entity === 'STATUS');
    const observations = parsed
      .filter((o) => !(hasStatus && o.entity === 'ACCOUNT' && (o.field === 'statusLevel' || o.field === 'statusDeadline')))
      .map((o) => (o.observedAt > ctx.now ? { ...o, observedAt: ctx.now } : o));
    const result: IngestResult = { accountId: null, program: ctx.programCode, unmatched: null, observations: observations.length, applied: 0, confirmed: 0, kept: 0, conflicts: 0, pending: 0, duplicates: 0, changes: [] };
    if (!observations.length) return result;
    const { account, why } = ctx.accountId
      ? await this.byId(ctx.userId, ctx.accountId)
      : await this.accountFor(ctx.userId, ctx.programCode, ctx.memberDigits);
    if (!account) {
      result.unmatched = why;
      await this.prisma.loyaltySyncRun.create({ data: { userId: ctx.userId, method: ctx.sourceType === 'EMAIL' ? 'EMAIL' : ctx.sourceType === 'STATEMENT' ? 'STATEMENT' : 'EXTENSION', trigger: 'EVENT', status: 'PARTIAL', finishedAt: new Date(), observations: observations.length, error: why } });
      return result;
    }
    result.accountId = account.id;
    const run = await this.prisma.loyaltySyncRun.create({ data: { userId: ctx.userId, accountId: account.id, method: ctx.sourceType === 'EMAIL' ? 'EMAIL' : ctx.sourceType === 'STATEMENT' ? 'STATEMENT' : ctx.sourceType === 'MANUAL' ? 'MANUAL' : 'EXTENSION', trigger: ctx.force ? 'MANUAL' : 'EVENT', status: 'OK' } });
    const reliability = ctx.reliability ?? SOURCE_RELIABILITY[ctx.sourceType];
    let acct = account;
    const prov: Prov = { ...((account.provenance ?? {}) as Prov) };
    const data: Prisma.LoyaltyAccountUpdateInput = {};
    let touched = false;
    let seq = 0;

    const log = async (o: ParsedObservation, entity: string, entityId: string | null, field: string, outcome: ObservationOutcome, reason: string, stored: unknown, discriminator = '') => {
      const dedupeKey = `${ctx.evidenceHash}:${entity}:${account.id}:${field}${discriminator}`.slice(0, 200);
      try {
        await this.prisma.loyaltyObservation.create({ data: { userId: ctx.userId, accountId: account.id, entity, entityId, field, value: toJson(o.value), sourceType: ctx.sourceType as LoyaltyDataSource, reliability, observedAt: o.observedAt, method: `${ctx.method}:${o.rule}`.slice(0, 80), evidenceHash: ctx.evidenceHash, dedupeKey, outcome, reason, storedValue: stored === undefined ? undefined : toJson(stored), resolvedAt: outcome === 'ACCEPTED' || outcome === 'CONFIRMED' ? ctx.now : null } });
        return true;
      } catch (e) {
        if ((e as { code?: string }).code === 'P2002') {
          result.duplicates++;
          return false;
        }
        throw e;
      }
    };
    const count = (o: ObservationOutcome) => {
      if (o === 'ACCEPTED') result.applied++;
      else if (o === 'CONFIRMED') result.confirmed++;
      else if (o === 'KEPT') result.kept++;
      else if (o === 'CONFLICT') result.conflicts++;
      else if (o === 'PENDING') result.pending++;
    };

    for (const o of observations) {
      if (o.entity === 'ACCOUNT' && (ACCOUNT_FIELDS as readonly string[]).includes(o.field)) {
        const field = o.field as AccountField;
        const incoming: Incoming = { value: o.value, sourceType: ctx.sourceType, reliability, observedAt: o.observedAt };
        const cur = this.currentState(acct as never, field);
        const decision = ctx.force ? { ...decideUpdate(field, null, incoming, ctx.now), action: 'ACCEPT' as const, reason: 'Member override.', verification: 'UNVERIFIED' as const } : decideUpdate(field, cur, incoming, ctx.now);
        const outcome: ObservationOutcome = decision.action === 'ACCEPT' ? 'ACCEPTED' : decision.action === 'CONFIRM' ? 'CONFIRMED' : decision.action === 'KEEP' ? 'KEPT' : decision.action === 'CONFLICT' ? 'CONFLICT' : 'PENDING';
        const fresh = await log(o, 'ACCOUNT', account.id, field, outcome, decision.reason, cur?.value);
        if (!fresh) continue;
        count(outcome);
        if (outcome === 'ACCEPTED' || outcome === 'CONFIRMED') {
          const next = decision.next!;
          prov[field] = { sourceType: next.sourceType, reliability: next.reliability, observedAt: next.observedAt.toISOString(), verification: decision.verification };
          touched = true;
          if (outcome === 'ACCEPTED') {
            const before = (acct as Record<string, unknown>)[field];
            (data as Record<string, unknown>)[field] = o.value;
            (acct as Record<string, unknown>)[field] = o.value;
            result.changes.push({ field, from: before, to: o.value, outcome, reason: decision.reason });
            if (field === 'balance' && typeof o.value === 'number' && o.value !== before) {
              const delta = o.value - (Number(before) || 0);
              await this.prisma.loyaltyEvent.create({ data: { userId: ctx.userId, accountId: account.id, kind: 'ADJUST', points: delta, balanceAfter: o.value, occurredAt: o.observedAt, note: `Balance from ${ctx.sourceType.toLowerCase()} (${ctx.method})` } });
              data.balanceSource = ctx.sourceType as LoyaltyDataSource;
              data.balanceObservedAt = o.observedAt;
            }
          }
        } else if (outcome === 'CONFLICT' || outcome === 'PENDING') {
          result.changes.push({ field, from: cur?.value, to: o.value, outcome, reason: decision.reason });
        }
      } else if (o.entity === 'ACCOUNT' && o.field === 'activity') {
        const v = o.value as { kind: string; points: number; occurredAt: Date; balanceAfter?: number; note?: string };
        if (!ACTIVITY_KINDS.has(v.kind)) continue;
        const fresh = await log(o, 'ACCOUNT', account.id, 'activity', 'ACCEPTED', `Recorded ${v.kind.toLowerCase()} of ${Math.abs(v.points).toLocaleString('en-US')}.`, undefined, `:${seq++}`);
        if (!fresh) continue;
        count('ACCEPTED');
        const signed = ['REDEEM', 'EXPIRE', 'TRANSFER_OUT'].includes(v.kind) ? -Math.abs(v.points) : v.points;
        await this.prisma.loyaltyEvent.create({ data: { userId: ctx.userId, accountId: account.id, kind: v.kind as LoyaltyEventKind, points: signed, balanceAfter: v.balanceAfter ?? Number((acct as { balance: number }).balance), occurredAt: v.occurredAt ?? o.observedAt, note: v.note ?? `From ${ctx.sourceType.toLowerCase()} (${ctx.method})` } });
        // activity resets the expiration clock for most programs, so the last activity date follows the newest one
        const when = v.occurredAt ?? o.observedAt;
        if (['EARN', 'BONUS', 'PURCHASE', 'TRANSFER_IN', 'TRANSFER_OUT', 'REDEEM'].includes(v.kind) && (!acct.lastActivityAt || when > acct.lastActivityAt)) {
          data.lastActivityAt = when;
          (acct as { lastActivityAt: Date | null }).lastActivityAt = when;
          prov.lastActivityAt = { sourceType: ctx.sourceType, reliability, observedAt: when.toISOString(), verification: 'UNVERIFIED' };
          touched = true;
        }
      } else if (o.entity === 'ACCOUNT' && o.field === 'expiringPoints') {
        const fresh = await log(o, 'ACCOUNT', account.id, 'expiringPoints', 'ACCEPTED', `${Number(o.value).toLocaleString('en-US')} points are due to expire (recorded as a notice).`, undefined);
        if (fresh) count('ACCEPTED');
      } else if (o.entity === 'CERTIFICATE') {
        await this.applyCertificate(ctx, acct, o, reliability, log, count, result);
      } else if (o.entity === 'STATUS') {
        await this.applyStatus(ctx, acct, o, reliability, log, count, result, data, prov);
        touched = true;
      }
    }

    const changed = result.applied + result.confirmed > 0;
    if (touched || changed) {
      const balProv = prov.balance;
      data.provenance = prov as unknown as Prisma.InputJsonValue;
      data.refreshedAt = ctx.now;
      data.source = LOYALTY_SOURCE_OF[ctx.sourceType];
      if (changed) data.lastSuccessfulRefreshAt = ctx.now;
      if (balProv) data.refreshConfidence = refreshConfidence(balProv.reliability, new Date(balProv.observedAt), ctx.now);
      await this.prisma.loyaltyAccount.update({ where: { id: account.id }, data });
    }
    await this.prisma.loyaltySyncRun.update({ where: { id: run.id }, data: { finishedAt: new Date(), observations: result.observations, changes: result.applied, status: result.duplicates === result.observations ? 'OK' : result.conflicts + result.pending > 0 ? 'PARTIAL' : 'OK', detail: { applied: result.applied, confirmed: result.confirmed, kept: result.kept, conflicts: result.conflicts, pending: result.pending, duplicates: result.duplicates } as Prisma.InputJsonValue } });
    return result;
  }

  private async applyCertificate(
    ctx: IngestContext,
    account: { id: string; profileId: string; programId: string | null },
    o: ParsedObservation,
    reliability: number,
    log: (o: ParsedObservation, entity: string, entityId: string | null, field: string, outcome: ObservationOutcome, reason: string, stored: unknown, discriminator?: string) => Promise<boolean>,
    count: (o: ObservationOutcome) => void,
    result: IngestResult,
  ) {
    const v = o.value as { category: 'FREE_NIGHT' | 'COMPANION' | 'UPGRADE'; name: string; expiresAt: Date | null; pointCap: number | null; quantity: number; number?: string | null; conditionsText?: string };
    const key = evidenceHashOf(ctx.programCode, v.category, v.expiresAt ? v.expiresAt.toISOString().slice(0, 10) : '', v.number ?? '').slice(0, 40);
    const existing = await this.prisma.loyaltyCertificate.findFirst({ where: { userId: ctx.userId, profileId: account.profileId, externalKey: key } });
    const conditions = v.conditionsText ? parseConditions(v.conditionsText) : null;
    const incoming: Incoming = { value: { category: v.category, expiresAt: v.expiresAt, pointCap: v.pointCap, quantity: v.quantity }, sourceType: ctx.sourceType, reliability, observedAt: o.observedAt };
    if (!existing) {
      const row = await this.prisma.loyaltyCertificate.create({
        data: { userId: ctx.userId, profileId: account.profileId, programId: account.programId, accountId: account.id, category: v.category, name: v.name, number: v.number ?? null, issuedAt: o.observedAt, expiresAt: v.expiresAt, quantity: v.quantity, pointCap: v.pointCap, restrictions: v.conditionsText ?? null, conditions: conditions ? (conditions.conditions as unknown as Prisma.InputJsonValue) : undefined, externalKey: key, source: ctx.sourceType as LoyaltyDataSource, reliability, observedAt: o.observedAt, verification: 'UNVERIFIED' },
      });
      const fresh = await log(o, 'CERTIFICATE', row.id, 'certificate', 'ACCEPTED', 'New certificate recorded.', undefined);
      if (fresh) {
        count('ACCEPTED');
        result.changes.push({ field: 'certificate', from: null, to: v.name, outcome: 'ACCEPTED', reason: 'New certificate recorded.' });
      }
      return;
    }
    const cur: FieldState = { value: { category: existing.category, expiresAt: existing.expiresAt, pointCap: existing.pointCap, quantity: existing.quantity }, sourceType: existing.source as SourceType, reliability: existing.reliability, observedAt: existing.observedAt ?? existing.createdAt };
    const decision = decideUpdate('certificate', cur, incoming, ctx.now);
    const outcome: ObservationOutcome = decision.action === 'ACCEPT' ? 'ACCEPTED' : decision.action === 'CONFIRM' ? 'CONFIRMED' : decision.action === 'KEEP' ? 'KEPT' : decision.action === 'CONFLICT' ? 'CONFLICT' : 'PENDING';
    const fresh = await log(o, 'CERTIFICATE', existing.id, 'certificate', outcome, decision.reason, cur.value);
    if (!fresh) return;
    count(outcome);
    if (outcome === 'ACCEPTED') await this.prisma.loyaltyCertificate.update({ where: { id: existing.id }, data: { expiresAt: v.expiresAt, pointCap: v.pointCap, quantity: v.quantity, source: ctx.sourceType as LoyaltyDataSource, reliability, observedAt: o.observedAt, verification: decision.verification } });
    else if (outcome === 'CONFIRMED') await this.prisma.loyaltyCertificate.update({ where: { id: existing.id }, data: { observedAt: o.observedAt, reliability: decision.next!.reliability, source: decision.next!.sourceType as LoyaltyDataSource, verification: decision.verification } });
  }

  private async applyStatus(
    ctx: IngestContext,
    account: { id: string; profileId: string; programId: string | null; program: { name: string; kind: string } | null; currency: { name: string } | null },
    o: ParsedObservation,
    reliability: number,
    log: (o: ParsedObservation, entity: string, entityId: string | null, field: string, outcome: ObservationOutcome, reason: string, stored: unknown, discriminator?: string) => Promise<boolean>,
    count: (o: ObservationOutcome) => void,
    result: IngestResult,
    data: Prisma.LoyaltyAccountUpdateInput,
    prov: Prov,
  ) {
    const v = o.value as { level: string; expiresAt: Date | null };
    const programName = account.program?.name ?? account.currency?.name ?? ctx.programCode;
    const latest = await this.prisma.eliteStatus.findFirst({ where: { userId: ctx.userId, profileId: account.profileId, programName }, orderBy: [{ expiresAt: 'desc' }, { createdAt: 'desc' }] });
    const cur: FieldState | null = latest ? { value: latest.level, sourceType: latest.source as SourceType, reliability: latest.reliability, observedAt: latest.observedAt ?? latest.createdAt } : null;
    const decision = ctx.force ? { ...decideUpdate('statusLevel', null, { value: v.level, sourceType: ctx.sourceType, reliability, observedAt: o.observedAt }, ctx.now), action: 'ACCEPT' as const, reason: 'Member override.', verification: 'UNVERIFIED' as const } : decideUpdate('statusLevel', cur, { value: v.level, sourceType: ctx.sourceType, reliability, observedAt: o.observedAt }, ctx.now);
    const outcome: ObservationOutcome = decision.action === 'ACCEPT' ? 'ACCEPTED' : decision.action === 'CONFIRM' ? 'CONFIRMED' : decision.action === 'KEEP' ? 'KEPT' : decision.action === 'CONFLICT' ? 'CONFLICT' : 'PENDING';
    const fresh = await log(o, 'STATUS', latest?.id ?? null, 'statusLevel', outcome, decision.reason, cur?.value);
    if (!fresh) return;
    count(outcome);
    if (outcome === 'ACCEPTED') {
      const kind = account.program?.kind === 'HOTEL' ? 'HOTEL' : account.program?.kind === 'AIRLINE' ? 'AIRLINE' : 'CARD';
      // a different level is a new qualification period; the earlier row stays as history
      if (!latest || latest.level.toLowerCase() !== v.level.toLowerCase()) {
        await this.prisma.eliteStatus.create({ data: { userId: ctx.userId, profileId: account.profileId, programId: account.programId, accountId: account.id, programName, kind, level: v.level, periodStart: o.observedAt, expiresAt: v.expiresAt, source: ctx.sourceType as LoyaltyDataSource, reliability, observedAt: o.observedAt, verification: decision.verification } });
        result.changes.push({ field: 'statusLevel', from: latest?.level ?? null, to: v.level, outcome, reason: decision.reason });
      } else await this.prisma.eliteStatus.update({ where: { id: latest.id }, data: { expiresAt: v.expiresAt ?? latest.expiresAt, source: ctx.sourceType as LoyaltyDataSource, reliability, observedAt: o.observedAt } });
      data.statusLevel = v.level;
      if (v.expiresAt) data.statusDeadline = v.expiresAt;
      prov.statusLevel = { sourceType: ctx.sourceType, reliability, observedAt: o.observedAt.toISOString(), verification: decision.verification };
    } else if (outcome === 'CONFIRMED' && latest) {
      await this.prisma.eliteStatus.update({ where: { id: latest.id }, data: { observedAt: o.observedAt, reliability: decision.next!.reliability, source: decision.next!.sourceType as LoyaltyDataSource, verification: decision.verification, ...(v.expiresAt ? { expiresAt: v.expiresAt } : {}) } });
      prov.statusLevel = { sourceType: decision.next!.sourceType, reliability: decision.next!.reliability, observedAt: o.observedAt.toISOString(), verification: decision.verification };
    } else if (outcome === 'CONFLICT' || outcome === 'PENDING') result.changes.push({ field: 'statusLevel', from: latest?.level, to: v.level, outcome, reason: decision.reason });
  }

  // ───────────── the member settles a conflict ─────────────

  async observations(userId: string, q: { outcome?: ObservationOutcome; accountId?: string; limit?: number } = {}) {
    return this.prisma.loyaltyObservation.findMany({ where: { userId, ...(q.outcome && { outcome: q.outcome }), ...(q.accountId && { accountId: q.accountId }) }, orderBy: { createdAt: 'desc' }, take: Math.min(q.limit ?? 100, 500), include: { account: { select: { nickname: true, program: { select: { name: true } }, currency: { select: { name: true } } } } } });
  }

  /** ACCEPT applies the stored observation value; REJECT dismisses it. Only conflicts and pending observations can be resolved. */
  async resolve(userId: string, id: string, decision: 'ACCEPT' | 'REJECT', now = new Date()) {
    const o = await this.prisma.loyaltyObservation.findFirst({ where: { id, userId } });
    if (!o) throw new NotFoundException('Observation not found');
    if (o.outcome !== 'CONFLICT' && o.outcome !== 'PENDING') return o;
    if (decision === 'REJECT') return this.prisma.loyaltyObservation.update({ where: { id }, data: { outcome: 'REJECTED', resolvedAt: now } });
    if (o.entity === 'ACCOUNT' && o.accountId && (ACCOUNT_FIELDS as readonly string[]).includes(o.field)) {
      const a = await this.prisma.loyaltyAccount.findFirst({ where: { id: o.accountId, userId } });
      if (a) {
        const value = DATE_FIELDS.has(o.field) && typeof o.value === 'string' ? new Date(o.value) : o.value;
        const prov = { ...((a.provenance ?? {}) as Prov), [o.field]: { sourceType: o.sourceType as SourceType, reliability: o.reliability, observedAt: o.observedAt.toISOString(), verification: 'CROSS_CONFIRMED' as const } };
        const extra: Prisma.LoyaltyAccountUpdateInput = {};
        if (o.field === 'balance' && typeof value === 'number') {
          await this.prisma.loyaltyEvent.create({ data: { userId, accountId: a.id, kind: 'ADJUST', points: value - a.balance, balanceAfter: value, occurredAt: o.observedAt, note: 'Balance confirmed by the member' } });
          extra.balanceSource = o.sourceType;
          extra.balanceObservedAt = o.observedAt;
        }
        await this.prisma.loyaltyAccount.update({ where: { id: a.id }, data: { [o.field]: value, provenance: prov as unknown as Prisma.InputJsonValue, refreshedAt: now, lastSuccessfulRefreshAt: now, ...extra } });
      }
    }
    return this.prisma.loyaltyObservation.update({ where: { id }, data: { outcome: 'ACCEPTED', resolvedAt: now } });
  }
}

@Module({ providers: [LoyaltyIngestService], exports: [LoyaltyIngestService] })
export class LoyaltyIngestModule {}

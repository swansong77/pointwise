import { BadRequestException, Inject, Injectable, Logger, NotFoundException, forwardRef } from '@nestjs/common';
import { OfferAccount, OfferEventType, OfferSource, OfferSyncRun, OfferSyncTrigger, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../common/prisma.service';
import { MerchantIdentity, isTrusted, resolveMerchant } from '../domain/merchant-resolve';
import { Rule } from '../domain/offer-enrollment-rules';
import { InvItem, StoredItem, contentHash, diffInventory, inventoryHash } from '../domain/offer-snapshot-diff';
import { AutoFilter, EnrollmentModeName, SmartContext, decide, duplicateCounts } from '../domain/offer-smart-enroll';
import { DAILY_RUN_CAP, FailureKind, MAX_ATTEMPTS, STALE_RUN_MS, healthAfterFailure, isDue, isStaleRun, pacingDelayMs, retryDelay } from '../domain/offer-sync-plan';
import { NotificationsService } from '../notifications/notifications.service';
import { ConnectorContext, ConnectorError, ConnectorRegistry, InventoryResult, OfferConnector, SessionBlob, connectorsEnabled } from './connector';
import { openCredentials, openSession, openText, redact, sealSession, sealText, sessionUsable } from './credential-vault';
import { EnrollmentService } from './enrollment.service';

export const CONNECTORS = 'OFFER_CONNECTORS';

type AccountFull = OfferAccount & { issuer: { id: string; name: string; offersUrl: string | null }; cards: Array<{ walletCardId: string; walletCard: { lastFour: string | null } }> };

/** A live connection to one account, kept for the length of one run so a sync can log in once and enroll in the same session. */
export interface Handle {
  connector: OfferConnector;
  session: SessionBlob;
  ctx: ConnectorContext;
}

export type LoginOutcome = { ok: true; handle: Handle } | { ok: false; kind: FailureKind; message: string; needsMfa?: boolean };

const SOURCE_BY_KIND: Record<string, OfferSource> = { MOCK: 'CONNECTOR', ISSUER_LOGIN: 'CONNECTOR', EXTENSION: 'EXTENSION', EMAIL: 'EMAIL', MANUAL: 'USER_ENTERED' };
const noWait = () => process.env.NODE_ENV === 'test' || process.env.OFFER_SYNC_PACING === 'off';

/**
 * The one pipeline for scheduled, manual and retried syncs and for snapshots pushed by the extension, email or a
 * paste: login, read the inventory and the enrollments, diff against the previous snapshot, score, decide, enroll
 * according to the member's mode and rules, notify. Every step is written to the OfferEvent audit trail.
 */
@Injectable()
export class OfferSyncService {
  private readonly logger = new Logger(OfferSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(CONNECTORS) private readonly registry: ConnectorRegistry,
    @Inject(forwardRef(() => EnrollmentService)) private readonly enrollment: EnrollmentService,
  ) {}

  // ───────────── helpers ─────────────

  async event(userId: string, type: OfferEventType, actor: 'USER' | 'SYSTEM' | 'AGENT', detail: Record<string, unknown>, ids: { offerId?: string | null; userOfferId?: string | null } = {}) {
    return this.prisma.offerEvent.create({ data: { userId, type, actor, detail: redact(detail) as Prisma.InputJsonValue, offerId: ids.offerId ?? null, userOfferId: ids.userOfferId ?? null } });
  }

  async audit(actorId: string, action: string, entity: string, entityId: string, diff?: Record<string, unknown>) {
    await this.prisma.auditLog.create({ data: { actorId, action, entity, entityId, diff: diff ? (redact(diff) as Prisma.InputJsonValue) : undefined } });
  }

  async loadAccount(userId: string, id: string): Promise<AccountFull> {
    const a = await this.prisma.offerAccount.findFirst({ where: { id, userId }, include: { issuer: { select: { id: true, name: true, offersUrl: true } }, cards: { include: { walletCard: { select: { lastFour: true } } } } } });
    if (!a) throw new NotFoundException('Offer account not found');
    return a;
  }

  connectorFor(a: { connectorKind: string; issuer: { name: string } }): OfferConnector | null {
    if (a.connectorKind === 'MOCK') return process.env.OFFER_MOCK_ENABLED === 'false' ? null : (this.registry.get('mock') ?? null);
    if (a.connectorKind === 'ISSUER_LOGIN') return this.registry.forIssuer(a.issuer.name) ?? null;
    return null;
  }

  /** Whether the server may log in to this account: a login connector, opted in, and (for real issuers) the server switch is on. */
  canLogin(a: { connectorKind: string; automationOptIn: boolean; credentialEnc: string | null; issuer: { name: string } }): { ok: boolean; reason?: string } {
    if (a.connectorKind !== 'MOCK' && a.connectorKind !== 'ISSUER_LOGIN') return { ok: false, reason: 'This account is fed by the extension, email or manual entry, not a server login.' };
    if (a.connectorKind === 'ISSUER_LOGIN' && !connectorsEnabled()) return { ok: false, reason: 'Issuer logins are switched off on this server (OFFER_CONNECTORS_ENABLED).' };
    if (!a.automationOptIn) return { ok: false, reason: 'Server-side login is not enabled for this account.' };
    if (!a.credentialEnc) return { ok: false, reason: 'No login is saved for this account.' };
    if (!this.connectorFor(a)) return { ok: false, reason: 'There is no connector for this issuer.' };
    return { ok: true };
  }

  private ctxFor(a: AccountFull): ConnectorContext {
    return { accountLabel: a.holderLabel, offersUrl: a.issuer.offersUrl };
  }

  /** Uses the stored session if it is still good, otherwise logs in. Never throws; reports why a login did not complete. */
  async ensureSession(a: AccountFull, now = new Date()): Promise<LoginOutcome> {
    const check = this.canLogin(a);
    if (!check.ok) return { ok: false, kind: 'DISABLED', message: check.reason! };
    if (a.lockedAt) return { ok: false, kind: 'LOCKED', message: 'This account is locked after repeated login failures. Re-enable it in Accounts.' };
    const connector = this.connectorFor(a)!;
    const ctx = this.ctxFor(a);
    if (a.sessionEnc) {
      try {
        const stored = openSession(a.sessionEnc);
        if (sessionUsable(stored, now)) return { ok: true, handle: { connector, session: stored, ctx } };
      } catch {
        // an unreadable blob is treated as no session
      }
    }
    const creds = openCredentials(a.credentialEnc!);
    let deviceTrust: string | undefined;
    try {
      deviceTrust = a.deviceTrustEnc ? openText(a.deviceTrustEnc) : undefined;
    } catch {
      deviceTrust = undefined;
    }
    try {
      const res = await connector.login(creds, ctx, deviceTrust);
      if (res.ok) {
        await this.prisma.offerAccount.update({ where: { id: a.id }, data: { sessionEnc: sealSession(res.session), sessionExpiresAt: new Date(res.session.expiresAt), lastLoginAt: now, failedLogins: 0, syncHealth: 'HEALTHY', lastError: null, deviceTrustEnc: res.session.deviceTrust ? sealText(res.session.deviceTrust) : a.deviceTrustEnc } });
        return { ok: true, handle: { connector, session: res.session, ctx } };
      }
      if (res.needsMfa) {
        await this.prisma.offerAccount.update({ where: { id: a.id }, data: { sessionEnc: sealSession(res.session), sessionExpiresAt: new Date(res.session.expiresAt), syncHealth: 'NEEDS_MFA', lastError: `Waiting for your ${res.method.toLowerCase()} verification code.` } });
        return { ok: false, kind: 'MFA_REQUIRED', needsMfa: true, message: `Enter the ${res.method === 'PASSKEY' ? 'passkey approval in your own browser' : 'verification code'} to continue.` };
      }
      await this.failAccount(a, res.kind, res.message);
      return { ok: false, kind: res.kind, message: res.message };
    } catch (e) {
      const kind = e instanceof ConnectorError ? e.kind : 'NETWORK';
      const message = e instanceof Error ? e.message : 'Login failed';
      await this.failAccount(a, kind, message);
      return { ok: false, kind, message };
    }
  }

  private async failAccount(a: Pick<OfferAccount, 'id' | 'failedLogins'>, kind: FailureKind, message: string) {
    const loginFailure = kind === 'BAD_CREDENTIALS' || kind === 'MFA_FAILED';
    const failed = a.failedLogins + (loginFailure ? 1 : 0);
    const health = healthAfterFailure(kind, failed);
    await this.prisma.offerAccount.update({ where: { id: a.id }, data: { failedLogins: failed, syncHealth: health, lastError: message.slice(0, 300), lockedAt: health === 'LOCKED' ? new Date() : undefined, sessionEnc: kind === 'SESSION_TIMEOUT' ? null : undefined } });
  }

  // ───────────── starting runs ─────────────

  /** Creates runs for one account or the whole household. With wait=true the runs are processed before returning. */
  async start(userId: string, opts: { accountId?: string; trigger?: OfferSyncTrigger; wait?: boolean; actor?: 'USER' | 'SYSTEM' }) {
    const where: Prisma.OfferAccountWhereInput = { userId, ...(opts.accountId ? { id: opts.accountId } : {}) };
    const accounts = await this.prisma.offerAccount.findMany({ where, include: { issuer: { select: { id: true, name: true, offersUrl: true } }, cards: { include: { walletCard: { select: { lastFour: true } } } } } });
    if (opts.accountId && accounts.length === 0) throw new NotFoundException('Offer account not found');
    const batchId = randomUUID();
    const runs: OfferSyncRun[] = [];
    const skipped: Array<{ accountId: string; holder: string; reason: string }> = [];
    for (const a of accounts) {
      const check = this.canLogin(a);
      if (!check.ok) {
        skipped.push({ accountId: a.id, holder: a.holderLabel, reason: check.reason! });
        continue;
      }
      runs.push(await this.prisma.offerSyncRun.create({ data: { userId, accountId: a.id, batchId, trigger: opts.trigger ?? 'MANUAL', status: 'QUEUED', progress: 'Waiting to start' } }));
    }
    await this.event(userId, 'SYNC', opts.actor ?? 'USER', { action: 'start', batchId, trigger: opts.trigger ?? 'MANUAL', accounts: runs.length, skipped: skipped.length });
    if (runs.length === 0 && opts.accountId && skipped.length) throw new BadRequestException(skipped[0].reason);
    const job = this.processBatch(runs.map((r) => r.id));
    if (opts.wait) await job;
    else void job.catch((e) => this.logger.error(`batch ${batchId} failed: ${e instanceof Error ? e.message : e}`));
    return { batchId, runs: runs.map((r) => r.id), skipped };
  }

  private async processBatch(runIds: string[]) {
    for (let i = 0; i < runIds.length; i++) {
      if (i > 0 && !noWait()) await new Promise((r) => setTimeout(r, pacingDelayMs(Math.random())));
      await this.processRun(runIds[i]);
    }
  }

  // ───────────── one run ─────────────

  async processRun(runId: string, now = new Date()): Promise<OfferSyncRun> {
    const run = await this.prisma.offerSyncRun.findUniqueOrThrow({ where: { id: runId } });
    if (!run.accountId) return run;
    const account = await this.prisma.offerAccount.findUnique({ where: { id: run.accountId }, include: { issuer: { select: { id: true, name: true, offersUrl: true } }, cards: { include: { walletCard: { select: { lastFour: true } } } } } });
    if (!account) return this.finish(run.id, 'FAILED', { error: 'The account was removed.' });
    const set = (progress: string, data: Prisma.OfferSyncRunUpdateInput = {}) => this.prisma.offerSyncRun.update({ where: { id: run.id }, data: { progress, ...data } });
    await set('Logging in', { status: 'RUNNING', startedAt: now });
    const login = await this.ensureSession(account, now);
    if (!login.ok) {
      await this.event(run.userId, 'SYNC', 'SYSTEM', { action: 'login-failed', accountId: account.id, kind: login.kind, message: login.message, runId });
      if (login.needsMfa) return this.finish(run.id, 'NEEDS_MFA', { error: login.message });
      await this.notifyFailure(run.userId, account, login.message, now);
      return this.finish(run.id, 'FAILED', { error: login.message, kind: login.kind });
    }
    let handle = login.handle;
    try {
      await set('Opening the offers page');
      await set('Reading the offer inventory');
      let inv: InventoryResult;
      try {
        inv = await handle.connector.fetchInventory(handle.session, handle.ctx);
      } catch (e) {
        // the issuer ended a session we thought was good: drop it and log in once more
        if (!(e instanceof ConnectorError) || e.kind !== 'SESSION_TIMEOUT') throw e;
        await this.prisma.offerAccount.update({ where: { id: account.id }, data: { sessionEnc: null, sessionExpiresAt: null } });
        const fresh = await this.ensureSession({ ...account, sessionEnc: null }, now);
        if (!fresh.ok) {
          if (fresh.needsMfa) return this.finish(run.id, 'NEEDS_MFA', { error: fresh.message });
          await this.notifyFailure(run.userId, account, fresh.message, now);
          return this.finish(run.id, 'FAILED', { error: fresh.message, kind: fresh.kind });
        }
        handle = fresh.handle;
        inv = await handle.connector.fetchInventory(handle.session, handle.ctx);
      }
      await set('Reading existing enrollments');
      const enrolled = await handle.connector.fetchEnrollments(handle.session, handle.ctx);
      const enrolledKeys = new Set(enrolled.map((e) => `${e.cardKey}|${e.externalId}`));
      const items = inv.items.map((i) => (enrolledKeys.has(`${i.cardKey}|${i.externalId}`) ? { ...i, enrolled: true } : i));
      await set('Comparing with the previous snapshot');
      const result = await this.applyInventory(account, { items, cards: inv.cards }, { source: 'CONNECTOR', actor: 'SYSTEM', run, now, handle });
      await this.prisma.offerAccount.update({ where: { id: account.id }, data: { lastSyncAt: now, syncHealth: result.warnings.length ? 'DEGRADED' : 'HEALTHY', lastError: null } });
      return this.finish(run.id, result.errors > 0 ? 'PARTIAL' : 'SUCCESS', { found: items.length, added: result.added, updated: result.updated, removed: result.removed, expired: result.expired, enrolled: result.enrolled, errors: result.errors, warnings: result.warnings.length, messages: result.warnings as never });
    } catch (e) {
      const kind: FailureKind = e instanceof ConnectorError ? e.kind : 'NETWORK';
      const message = e instanceof Error ? e.message : 'The sync failed';
      await this.failAccount(account, kind, message);
      await this.event(run.userId, 'SYNC', 'SYSTEM', { action: 'failed', accountId: account.id, kind, message, runId });
      const delay = retryDelay(kind, run.attempt);
      if (delay === null) await this.notifyFailure(run.userId, account, message, now);
      return this.finish(run.id, 'FAILED', { error: message, kind });
    }
  }

  private async finish(runId: string, status: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NEEDS_MFA', data: { error?: string; kind?: string; found?: number; added?: number; updated?: number; removed?: number; expired?: number; enrolled?: number; errors?: number; warnings?: number; messages?: Prisma.InputJsonValue }) {
    const { kind, ...rest } = data;
    const run = await this.prisma.offerSyncRun.update({ where: { id: runId }, data: { ...rest, status, finishedAt: new Date(), progress: status === 'SUCCESS' ? 'Done' : status === 'PARTIAL' ? 'Done with problems' : status === 'NEEDS_MFA' ? 'Waiting for your verification code' : 'Failed', ...(kind ? { messages: [{ kind }] as never } : {}) } });
    await this.event(run.userId, 'SYNC', 'SYSTEM', { action: 'finished', runId, status, found: run.found, added: run.added, updated: run.updated, removed: run.removed, expired: run.expired, enrolled: run.enrolled, errors: run.errors });
    return run;
  }

  // ───────────── the shared funnel ─────────────

  /** Applies an inventory (from a connector, the extension, an email or a paste) to the stored state of one account. */
  async applyInventory(account: AccountFull, inv: InventoryResult, opts: { source: OfferSource; actor: 'USER' | 'SYSTEM'; run?: OfferSyncRun; now?: Date; handle?: Handle; partial?: boolean }) {
    const now = opts.now ?? new Date();
    const userId = account.userId;
    const out = { added: 0, updated: 0, removed: 0, expired: 0, enrolled: 0, errors: 0, redeemed: 0, unchanged: 0, warnings: [] as string[], idempotent: false, newHighValue: 0, autoEnrolled: 0 };
    const hash = inventoryHash(inv.items);
    const last = await this.prisma.offerSnapshot.findFirst({ where: { accountId: account.id }, orderBy: { takenAt: 'desc' } });
    if (!opts.partial && last && last.hash === hash) {
      out.idempotent = true;
      out.unchanged = inv.items.length;
      await this.prisma.offerSnapshotItem.updateMany({ where: { accountId: account.id, status: { in: ['AVAILABLE', 'ENROLLED'] } }, data: { lastSeenAt: now } });
      return out;
    }
    const rows = await this.prisma.offerSnapshotItem.findMany({ where: { accountId: account.id } });
    const stored: StoredItem[] = rows.map((r) => this.toStored(r));
    const diff = diffInventory(stored, inv.items, now, { partial: opts.partial });
    out.warnings.push(...diff.warnings);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const merchants = await this.merchants();
    const cardOf = (cardKey: string, lastFour?: string | null) => this.resolveCard(account, cardKey, inv.cards, lastFour);
    const policy = await this.policy(userId);
    const rules = await this.rules(userId);
    const smart = await this.smartContext(userId, policy.filter, rules, now);
    const rctx = { spendMerchants: smart.spendMerchants, accountId: account.id };
    const mode = policy.mode;
    const toEnroll: string[] = [];
    const highValue: string[] = [];

    for (const item of diff.added) {
      const res = resolveMerchant(item.merchantText, merchants);
      const decision = decide(item, mode, policy.filter, rules, smart.ctx, rctx);
      const walletCardId = cardOf(item.cardKey);
      const row = await this.prisma.offerSnapshotItem.create({
        data: {
          userId, accountId: account.id, cardKey: item.cardKey, walletCardId, externalId: item.externalId, merchantText: item.merchantText, merchantId: isTrusted(res) ? res.merchantId : null, title: item.title, category: item.category ?? null,
          offerType: item.offerType, valueCents: item.valueCents, percent: item.percent, points: item.points, minSpendCents: item.minSpendCents, endsAt: item.endsAt,
          status: item.enrolled ? 'ENROLLED' : 'AVAILABLE', enrolledAt: item.enrolled ? now : null, decision: item.enrolled ? 'ENROLLED' : decision.state, score: decision.score.overall, scoreDetail: { ...decision.score } as unknown as Prisma.InputJsonValue,
          decisionReason: item.enrolled ? 'Already added on the issuer\'s site.' : decision.reason, ruleId: decision.ruleId, contentHash: contentHash(item), firstSeenAt: now, lastSeenAt: now,
        },
      });
      out.added++;
      await this.event(userId, 'DISCOVERED', opts.actor, { itemId: row.id, accountId: account.id, merchant: item.merchantText, valueCents: item.valueCents, endsAt: item.endsAt, enrolled: item.enrolled, source: opts.source, runId: opts.run?.id });
      if (item.enrolled) {
        await this.enrollment.ensureUserOffer(row.id, { by: 'SYSTEM', source: opts.source });
        out.enrolled++;
        continue;
      }
      await this.event(userId, 'DECISION', 'SYSTEM', { itemId: row.id, action: decision.action, score: decision.score.overall, decision: decision.score.decision, reasons: decision.score.reasons, reason: decision.reason, ruleId: decision.ruleId, mode });
      if (decision.action === 'ENROLL_NOW') toEnroll.push(row.id);
      if (decision.score.overall >= 85 && decision.action !== 'IGNORE') highValue.push(row.id);
    }
    out.newHighValue = highValue.length;

    for (const u of diff.updated) {
      await this.prisma.offerSnapshotItem.update({ where: { id: u.stored.id }, data: { merchantText: u.next.merchantText, title: u.next.title, offerType: u.next.offerType, valueCents: u.next.valueCents, percent: u.next.percent, points: u.next.points, minSpendCents: u.next.minSpendCents, endsAt: u.next.endsAt, contentHash: contentHash(u.next), lastSeenAt: now, ...(u.next.enrolled && u.stored.status === 'AVAILABLE' ? { status: 'ENROLLED' as const, enrolledAt: now, decision: 'ENROLLED' as const } : {}) } });
      out.updated++;
      await this.event(userId, 'UPDATED', opts.actor, { itemId: u.stored.id, accountId: account.id, changes: u.changes, runId: opts.run?.id });
    }
    for (const s of diff.unchanged) await this.prisma.offerSnapshotItem.update({ where: { id: s.id }, data: { lastSeenAt: now } });
    out.unchanged = diff.unchanged.length;

    for (const s of diff.newlyEnrolled) {
      await this.prisma.offerSnapshotItem.update({ where: { id: s.id }, data: { status: 'ENROLLED', enrolledAt: now, decision: byId.get(s.id)!.decision === 'APPROVED' ? 'ENROLLED' : 'ENROLLED', lastSeenAt: now } });
      await this.enrollment.ensureUserOffer(s.id, { by: 'SYSTEM', source: opts.source });
      await this.event(userId, 'ACTIVATED', opts.actor, { itemId: s.id, via: 'seen as enrolled on the issuer\'s site', accountId: account.id });
      out.enrolled++;
    }
    for (const s of diff.removed) {
      await this.prisma.offerSnapshotItem.update({ where: { id: s.id }, data: { status: 'REMOVED', removedAt: now } });
      await this.event(userId, 'REMOVED', opts.actor, { itemId: s.id, accountId: account.id, merchant: s.merchantText });
      out.removed++;
    }
    for (const s of diff.expired) {
      await this.prisma.offerSnapshotItem.update({ where: { id: s.id }, data: { status: 'EXPIRED' } });
      await this.event(userId, 'EXPIRED', opts.actor, { itemId: s.id, accountId: account.id, merchant: s.merchantText, enrolled: s.status === 'ENROLLED' });
      out.expired++;
    }
    for (const s of diff.redeemed) {
      await this.prisma.offerSnapshotItem.update({ where: { id: s.id }, data: { status: 'REDEEMED', removedAt: now } });
      await this.event(userId, 'REDEEMED', opts.actor, { itemId: s.id, accountId: account.id, merchant: s.merchantText, note: 'an enrolled offer is no longer shown; treated as used' });
      out.redeemed++;
    }
    for (const s of diff.reappeared) {
      const next = inv.items.find((i) => i.cardKey === s.cardKey && i.externalId === s.externalId)!;
      await this.prisma.offerSnapshotItem.update({ where: { id: s.id }, data: { status: next.enrolled ? 'ENROLLED' : 'AVAILABLE', removedAt: null, valueCents: next.valueCents, percent: next.percent, points: next.points, minSpendCents: next.minSpendCents, endsAt: next.endsAt, title: next.title, contentHash: contentHash(next), lastSeenAt: now } });
      await this.event(userId, 'UPDATED', opts.actor, { itemId: s.id, accountId: account.id, note: 'the offer is shown again' });
      out.updated++;
    }

    if (diff.suspicious) await this.event(userId, 'SYNC', 'SYSTEM', { action: 'suspicious-inventory', accountId: account.id, warnings: diff.warnings });
    await this.prisma.offerSnapshot.create({ data: { accountId: account.id, runId: opts.run?.id ?? null, source: opts.source, hash, itemCount: inv.items.length } });
    await this.flagDuplicates(userId);

    // enrollment: automatic mode enrolls what the member's rules and filter allow; other accounts queue it for the extension
    if (toEnroll.length) {
      const lo = this.canLogin(account).ok && opts.handle;
      if (lo) {
        const r = await this.enrollment.enroll(userId, toEnroll, { actor: 'SYSTEM', mode: 'AUTO', handle: opts.handle, now });
        out.enrolled += r.filter((x) => x.result === 'SUCCESS' || x.result === 'ALREADY_ADDED').length;
        out.autoEnrolled = r.filter((x) => x.result === 'SUCCESS' || x.result === 'ALREADY_ADDED').length;
        out.errors += r.filter((x) => x.result !== 'SUCCESS' && x.result !== 'ALREADY_ADDED').length;
      } else {
        await this.prisma.offerSnapshotItem.updateMany({ where: { id: { in: toEnroll } }, data: { decision: 'APPROVED', decisionReason: 'Queued: your browser extension adds it when you click Enroll selected.' } });
      }
    }
    await this.notifyChanges(userId, account, { highValue, newCount: out.added, autoEnrolled: out.autoEnrolled, now });
    return out;
  }

  private async flagDuplicates(userId: string) {
    const items = await this.prisma.offerSnapshotItem.findMany({ where: { userId, status: { in: ['AVAILABLE', 'ENROLLED'] } }, select: { id: true, merchantText: true, offerType: true, valueCents: true, percent: true, points: true, minSpendCents: true, endsAt: true } });
    const dup = duplicateCounts(items.map((i) => ({ ...i, percent: i.percent === null ? null : Number(i.percent) })));
    return dup;
  }

  private toStored(r: Prisma.OfferSnapshotItemGetPayload<object>): StoredItem {
    return { id: r.id, status: r.status, contentHash: r.contentHash, externalId: r.externalId, cardKey: r.cardKey, merchantText: r.merchantText, title: r.title, category: r.category, offerType: r.offerType, valueCents: r.valueCents, percent: r.percent === null ? null : Number(r.percent), points: r.points, minSpendCents: r.minSpendCents, endsAt: r.endsAt, enrolled: r.status === 'ENROLLED' };
  }

  /** Maps the issuer's own card key to one of the member's wallet cards on this account (by id, then last four). */
  private resolveCard(account: AccountFull, cardKey: string, cards: InventoryResult['cards'], lastFour?: string | null): string | null {
    const byId = account.cards.find((c) => c.walletCardId === cardKey);
    if (byId) return byId.walletCardId;
    const four = lastFour ?? cards.find((c) => c.cardKey === cardKey)?.lastFour ?? null;
    if (four) {
      const m = account.cards.filter((c) => c.walletCard.lastFour === four);
      if (m.length === 1) return m[0].walletCardId;
    }
    if (account.cards.length === 1 && cards.length <= 1) return account.cards[0].walletCardId;
    return null;
  }

  private async merchants(): Promise<MerchantIdentity[]> {
    return this.prisma.merchant.findMany({ select: { id: true, slug: true, name: true, hosts: true, aliases: true, mcc: true, parentCompany: true } });
  }

  async policy(userId: string): Promise<{ mode: EnrollmentModeName; filter: AutoFilter }> {
    const p = await this.prisma.enrollmentPolicy.findUnique({ where: { userId } });
    return { mode: p?.mode ?? 'RECOMMEND', filter: (p?.autoFilter ?? {}) as AutoFilter };
  }

  async rules(userId: string): Promise<Rule[]> {
    const rows = await this.prisma.enrollmentRule.findMany({ where: { userId } });
    return rows.map((r) => ({ id: r.id, label: r.label, kind: r.kind, matcher: r.matcher, matcherValue: r.matcherValue, accountId: r.accountId, walletCardId: r.walletCardId, priority: r.priority, enabled: r.enabled }));
  }

  /** Spend history, preferred merchants, goals and utilization for scoring. Only this user's data; nothing leaves the server. */
  async smartContext(userId: string, filter: AutoFilter, rules: Rule[], now: Date) {
    const since = new Date(now.getTime() - 365 * 86_400_000);
    const txns = await this.prisma.transaction.findMany({ where: { userId, kind: 'PURCHASE', occurredAt: { gte: since }, merchantId: { not: null } }, select: { merchantId: true, merchant: { select: { name: true } }, walletCard: { select: { profileId: true } } }, take: 5000 });
    const count = new Map<string, number>();
    const members = new Map<string, Set<string>>();
    for (const t of txns) {
      const key = (t.merchant?.name ?? '').toLowerCase().replace(/[^a-z0-9+.& ]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (!key) continue;
      count.set(key, (count.get(key) ?? 0) + 1);
      members.set(key, (members.get(key) ?? new Set()).add(t.walletCard.profileId ?? 'self'));
    }
    const profiles = await this.prisma.profile.findMany({ where: { userId }, select: { goals: true } });
    const total = await this.prisma.userOffer.count({ where: { walletCard: { wallet: { userId } } } });
    const redeemed = await this.prisma.userOffer.count({ where: { walletCard: { wallet: { userId } }, status: 'REDEEMED' } });
    const preferred = [...(filter.preferredMerchants ?? []), ...rules.filter((r) => r.kind === 'ALWAYS' && r.matcher === 'MERCHANT' && r.enabled).map((r) => r.matcherValue)];
    const ctx: SmartContext = { now, preferredMerchants: preferred, merchantSpendCount: count, merchantMembers: new Map([...members].map(([k, v]) => [k, v.size])), householdMembers: Math.max(1, profiles.length), goals: [...new Set(profiles.flatMap((p) => p.goals))], utilization: total >= 3 ? redeemed / total : null };
    return { ctx, spendMerchants: new Set(count.keys()) };
  }

  // ───────────── MFA ─────────────

  /** Completes a sync that stopped for a verification code, then runs it again. */
  async submitMfa(userId: string, accountId: string, code: string, wait = true) {
    const a = await this.loadAccount(userId, accountId);
    if (!a.sessionEnc) throw new BadRequestException('No verification is pending for this account.');
    const connector = this.connectorFor(a);
    if (!connector) throw new BadRequestException('There is no connector for this account.');
    const pending = openSession(a.sessionEnc);
    if (!pending.pendingMfa) throw new BadRequestException('No verification is pending for this account.');
    const res = await connector.submitMfa(pending, code.trim(), this.ctxFor(a));
    if (!res.ok) {
      const kind = 'kind' in res ? res.kind : 'MFA_FAILED';
      const message = 'message' in res ? res.message : 'That code was not accepted.';
      await this.failAccount(a, kind, message);
      await this.event(userId, 'SYNC', 'USER', { action: 'mfa-failed', accountId });
      return { ok: false as const, message, health: healthAfterFailure(kind, a.failedLogins + 1) };
    }
    await this.prisma.offerAccount.update({ where: { id: a.id }, data: { sessionEnc: sealSession(res.session), sessionExpiresAt: new Date(res.session.expiresAt), lastLoginAt: new Date(), failedLogins: 0, syncHealth: 'HEALTHY', lastError: null, deviceTrustEnc: res.session.deviceTrust ? sealText(res.session.deviceTrust) : a.deviceTrustEnc } });
    await this.event(userId, 'SYNC', 'USER', { action: 'mfa-ok', accountId });
    const started = await this.start(userId, { accountId, trigger: 'MANUAL', wait });
    return { ok: true as const, ...started };
  }

  // ───────────── scheduled work ─────────────

  /** Starts scheduled runs for every login account that is due (daily at its local hour, weekly, monthly). */
  async runDue(now: Date, onlyUserId?: string): Promise<number> {
    const accounts = await this.prisma.offerAccount.findMany({ where: { ...(onlyUserId ? { userId: onlyUserId } : {}), connectorKind: { in: ['MOCK', 'ISSUER_LOGIN'] }, automationOptIn: true, cadence: { not: 'MANUAL' }, lockedAt: null }, include: { issuer: { select: { id: true, name: true, offersUrl: true } }, cards: { include: { walletCard: { select: { lastFour: true } } } } } });
    let n = 0;
    for (const a of accounts) {
      if (!this.canLogin(a).ok) continue;
      const lastScheduled = await this.prisma.offerSyncRun.findFirst({ where: { accountId: a.id, trigger: 'SCHEDULED' }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      if (!isDue(a, lastScheduled?.createdAt ?? null, now)) continue;
      const today = await this.prisma.offerSyncRun.count({ where: { accountId: a.id, createdAt: { gte: new Date(now.getTime() - 86_400_000) } } });
      if (today >= DAILY_RUN_CAP) continue;
      const run = await this.prisma.offerSyncRun.create({ data: { userId: a.userId, accountId: a.id, trigger: 'SCHEDULED', status: 'QUEUED', progress: 'Waiting to start' } });
      if (n > 0 && !noWait()) await new Promise((r) => setTimeout(r, pacingDelayMs(Math.random())));
      await this.processRun(run.id, now);
      n++;
    }
    return n;
  }

  /** Re-runs failed runs whose failure was transient, after the backoff delay. */
  async retryFailed(now: Date, onlyUserId?: string): Promise<number> {
    const failed = await this.prisma.offerSyncRun.findMany({ where: { ...(onlyUserId ? { userId: onlyUserId } : {}), status: 'FAILED', attempt: { lt: MAX_ATTEMPTS }, finishedAt: { gte: new Date(now.getTime() - 6 * 3_600_000) }, accountId: { not: null } }, orderBy: { finishedAt: 'asc' }, take: 50 });
    let n = 0;
    for (const f of failed) {
      const kind = ((f.messages as Array<{ kind?: FailureKind }> | null)?.[0]?.kind ?? 'NETWORK') as FailureKind;
      const delay = retryDelay(kind, f.attempt);
      if (delay === null || f.finishedAt!.getTime() + delay > now.getTime()) continue;
      const later = await this.prisma.offerSyncRun.count({ where: { accountId: f.accountId, createdAt: { gt: f.createdAt } } });
      if (later > 0) continue;
      const run = await this.prisma.offerSyncRun.create({ data: { userId: f.userId, accountId: f.accountId, trigger: 'RETRY', attempt: f.attempt + 1, status: 'QUEUED', progress: 'Retrying' } });
      await this.processRun(run.id, now);
      n++;
    }
    return n;
  }

  /** Marks runs that started but never finished as failed so the dashboard does not show them as running forever. */
  async recoverStale(now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - STALE_RUN_MS);
    const stuck = await this.prisma.offerSyncRun.findMany({ where: { OR: [{ status: 'RUNNING', startedAt: { lt: cutoff } }, { status: 'QUEUED', createdAt: { lt: cutoff } }] } });
    let n = 0;
    for (const r of stuck) {
      if (r.status === 'RUNNING' && !isStaleRun(r.startedAt, now)) continue;
      await this.prisma.offerSyncRun.update({ where: { id: r.id }, data: { status: 'FAILED', finishedAt: now, error: 'The run did not finish and was closed.', progress: 'Failed', messages: [{ kind: 'NETWORK' }] as never } });
      n++;
    }
    return n;
  }

  // ───────────── notifications ─────────────

  private async wants(userId: string): Promise<boolean> {
    const p = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return p?.offerAutomation ?? true;
  }

  private async notifyChanges(userId: string, account: AccountFull, c: { highValue: string[]; newCount: number; autoEnrolled: number; now: Date }) {
    if (!(await this.wants(userId))) return;
    const day = c.now.toISOString().slice(0, 10);
    if (c.highValue.length) await this.notifications.notify(userId, 'OFFER_NEW_HIGH_VALUE', `${c.highValue.length} new high-value offer(s) on ${account.holderLabel}`, 'Review them in your Offer Inbox.', '/offers/automation', `offer-hv:${account.id}:${day}:${c.highValue.length}`);
    if (c.autoEnrolled) await this.notifications.notify(userId, 'OFFER_AUTO_ENROLLED', `${c.autoEnrolled} offer(s) added automatically`, `PointWise added them on ${account.holderLabel} according to your rules.`, '/offers/automation', `offer-auto:${account.id}:${day}:${c.autoEnrolled}`);
  }

  async notifyFailure(userId: string, account: Pick<AccountFull, 'id' | 'holderLabel'>, message: string, now: Date) {
    if (!(await this.wants(userId))) return;
    await this.notifications.notify(userId, 'OFFER_SYNC_FAILED', `Offer sync failed for ${account.holderLabel}`, message.slice(0, 200), '/offers/automation', `offer-sync-fail:${account.id}:${now.toISOString().slice(0, 10)}`);
  }
}

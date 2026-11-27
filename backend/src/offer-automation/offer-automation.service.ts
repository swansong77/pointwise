import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { OfferEventType, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PAT_PREFIX, hashToken } from '../common/pat';
import { PrismaService } from '../common/prisma.service';
import { daysLeft, duplicateCounts } from '../domain/offer-smart-enroll';
import { InvItem } from '../domain/offer-snapshot-diff';
import { parseOfferText } from '../domain/offer-import';
import { nextRunAt, validTimezone } from '../domain/offer-sync-plan';
import { normalizeMerchant } from '../domain/offer-enrollment-rules';
import { WalletService } from '../wallet/wallet.service';
import { CONNECTORS, OfferSyncService } from './offer-sync.service';
import { ConnectorRegistry, connectorsEnabled } from './connector';
import { credentialHint, sealCredentials } from './credential-vault';
import { ISSUER_FLOWS } from './issuer-flows';
import { CreateOfferAccountDto, EnrollResultsDto, IngestSnapshotDto, InboxQuery, PolicyDto, RuleDto, UpdateOfferAccountDto } from './offer-automation.dto';
import { EnrollmentService } from './enrollment.service';

export const EXTENSION_SCOPE = 'offers:ingest';
const MAX_ACTIVE_TOKENS = 5;

const HISTORY_TYPES: OfferEventType[] = ['DISCOVERED', 'UPDATED', 'REMOVED', 'EXPIRED', 'REDEEMED', 'ACTIVATED', 'AUTO_ENROLLED', 'ENROLL_ATTEMPT', 'DECISION', 'SYNC', 'RULE_CHANGED', 'IMPORTED'];

/** Accounts, rules, policy, the offer inbox and dashboards, and the extension and paste intake. */
@Injectable()
export class OfferAutomationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly sync: OfferSyncService,
    private readonly enrollment: EnrollmentService,
    @Inject(CONNECTORS) private readonly registry: ConnectorRegistry,
  ) {}

  // ───────────── accounts ─────────────

  private flowFor(issuerName: string) {
    const n = issuerName.toLowerCase();
    return ISSUER_FLOWS.find((f) => f.issuers.some((i) => i.toLowerCase() === n));
  }

  /** An account as the API shows it: never any credential, session or device-trust data. */
  async view(a: Prisma.OfferAccountGetPayload<{ include: { issuer: { select: { id: true; name: true; offersUrl: true } }; cards: true } }>, now = new Date()) {
    const flow = this.flowFor(a.issuer.name);
    const check = this.sync.canLogin({ ...a, issuer: a.issuer });
    return {
      id: a.id,
      issuer: { id: a.issuer.id, name: a.issuer.name, offersUrl: a.issuer.offersUrl },
      profileId: a.profileId,
      holderLabel: a.holderLabel,
      connectorKind: a.connectorKind,
      hasCredential: !!a.credentialEnc,
      credentialRef: a.credentialRef,
      mfaMethod: a.mfaMethod,
      syncHealth: a.syncHealth,
      lastLoginAt: a.lastLoginAt,
      lastSyncAt: a.lastSyncAt,
      lastError: a.lastError,
      locked: !!a.lockedAt,
      automationOptIn: a.automationOptIn,
      optInAckAt: a.optInAckAt,
      cadence: a.cadence,
      syncHour: a.syncHour,
      timezone: a.timezone,
      nextRunAt: check.ok ? nextRunAt(a, now) : null,
      canSync: check.ok,
      cannotSyncBecause: check.ok ? null : check.reason,
      walletCardIds: a.cards.map((c) => c.walletCardId),
      connector: { verified: a.connectorKind === 'MOCK', unverifiedFlow: !!flow, termsNote: flow?.termsNote ?? null, serverSwitchOn: connectorsEnabled() },
    };
  }

  private include() {
    return { issuer: { select: { id: true, name: true, offersUrl: true } }, cards: true } as const;
  }

  async accounts(userId: string) {
    const rows = await this.prisma.offerAccount.findMany({ where: { userId }, include: this.include(), orderBy: { createdAt: 'asc' } });
    return Promise.all(rows.map((r) => this.view(r)));
  }

  private async assertCards(userId: string, ids: string[] | undefined) {
    for (const id of ids ?? []) await this.wallet.assertOwned(userId, id);
  }

  async createAccount(userId: string, dto: CreateOfferAccountDto) {
    const issuer = await this.prisma.issuer.findUnique({ where: { id: dto.issuerId } });
    if (!issuer) throw new NotFoundException('Issuer not found');
    if (dto.profileId) {
      const p = await this.prisma.profile.findFirst({ where: { id: dto.profileId, userId } });
      if (!p) throw new ForbiddenException('Not your household member');
    }
    await this.assertCards(userId, dto.walletCardIds);
    const tz = dto.timezone ?? 'America/New_York';
    if (!validTimezone(tz)) throw new BadRequestException('Unknown time zone');
    const login = dto.connectorKind === 'MOCK' || dto.connectorKind === 'ISSUER_LOGIN';
    if (dto.connectorKind === 'ISSUER_LOGIN' && !this.flowFor(issuer.name)) throw new BadRequestException(`There is no connector for ${issuer.name}. Use the extension, email or manual entry.`);
    if (dto.connectorKind === 'MOCK' && process.env.OFFER_MOCK_ENABLED === 'false') throw new BadRequestException('The mock issuer is switched off.');
    if (login && (!dto.username || !dto.password)) throw new BadRequestException('A username and password are needed for a server-side login.');
    if (dto.automationOptIn && !dto.ackTermsRisk) throw new BadRequestException('Confirm that you have read the terms-risk note before turning on server-side login.');
    const a = await this.prisma.offerAccount.create({
      data: {
        userId, issuerId: issuer.id, profileId: dto.profileId ?? null, holderLabel: dto.holderLabel, connectorKind: dto.connectorKind,
        credentialEnc: login ? sealCredentials({ username: dto.username!, password: dto.password! }) : null,
        credentialRef: login ? credentialHint(dto.username!) : null,
        mfaMethod: dto.mfaMethod ?? 'NONE', cadence: dto.cadence ?? 'DAILY', syncHour: dto.syncHour ?? 2, timezone: tz,
        automationOptIn: !!dto.automationOptIn, optInAckAt: dto.automationOptIn ? new Date() : null,
        syncHealth: login ? (dto.automationOptIn ? 'HEALTHY' : 'DISABLED') : 'HEALTHY',
        cards: { create: (dto.walletCardIds ?? []).map((walletCardId) => ({ walletCardId })) },
      },
      include: this.include(),
    });
    await this.sync.audit(userId, 'offer-account.create', 'OfferAccount', a.id, { issuer: issuer.name, connectorKind: dto.connectorKind, holder: dto.holderLabel, optIn: !!dto.automationOptIn, credential: login ? 'stored encrypted' : 'none' });
    return this.view(a);
  }

  async updateAccount(userId: string, id: string, dto: UpdateOfferAccountDto) {
    const a = await this.sync.loadAccount(userId, id);
    const data: Prisma.OfferAccountUpdateInput = {};
    const changed: Record<string, unknown> = {};
    if (dto.holderLabel !== undefined) (data.holderLabel = dto.holderLabel), (changed.holderLabel = dto.holderLabel);
    if (dto.mfaMethod !== undefined) (data.mfaMethod = dto.mfaMethod), (changed.mfaMethod = dto.mfaMethod);
    if (dto.cadence !== undefined) (data.cadence = dto.cadence), (changed.cadence = dto.cadence);
    if (dto.syncHour !== undefined) (data.syncHour = dto.syncHour), (changed.syncHour = dto.syncHour);
    if (dto.timezone !== undefined) {
      if (!validTimezone(dto.timezone)) throw new BadRequestException('Unknown time zone');
      data.timezone = dto.timezone;
      changed.timezone = dto.timezone;
    }
    if (dto.username !== undefined || dto.password !== undefined) {
      if (!dto.username || !dto.password) throw new BadRequestException('Send the username and password together.');
      if (a.connectorKind !== 'MOCK' && a.connectorKind !== 'ISSUER_LOGIN') throw new BadRequestException('This account does not use a login.');
      data.credentialEnc = sealCredentials({ username: dto.username, password: dto.password });
      data.credentialRef = credentialHint(dto.username);
      data.sessionEnc = null;
      data.sessionExpiresAt = null;
      data.deviceTrustEnc = null;
      data.failedLogins = 0;
      data.lockedAt = null;
      changed.credential = 'replaced (encrypted)';
    }
    if (dto.automationOptIn !== undefined) {
      if (dto.automationOptIn && !dto.ackTermsRisk && !a.optInAckAt) throw new BadRequestException('Confirm that you have read the terms-risk note before turning on server-side login.');
      data.automationOptIn = dto.automationOptIn;
      if (dto.automationOptIn && dto.ackTermsRisk) data.optInAckAt = new Date();
      if (!dto.automationOptIn) {
        data.sessionEnc = null;
        data.sessionExpiresAt = null;
        data.syncHealth = 'DISABLED';
      }
      changed.automationOptIn = dto.automationOptIn;
    }
    if (dto.unlock) {
      data.lockedAt = null;
      data.failedLogins = 0;
      data.syncHealth = a.automationOptIn ? 'HEALTHY' : 'DISABLED';
      data.lastError = null;
      changed.unlock = true;
    }
    if (dto.walletCardIds) {
      await this.assertCards(userId, dto.walletCardIds);
      await this.prisma.offerAccountCard.deleteMany({ where: { accountId: id } });
      await this.prisma.offerAccountCard.createMany({ data: dto.walletCardIds.map((walletCardId) => ({ accountId: id, walletCardId })) });
      changed.walletCardIds = dto.walletCardIds.length;
    }
    const upd = await this.prisma.offerAccount.update({ where: { id }, data, include: this.include() });
    await this.sync.audit(userId, 'offer-account.update', 'OfferAccount', id, changed);
    return this.view(upd);
  }

  /** Forgets the stored login, session and device trust; the account stays and can be fed by other sources. */
  async disconnect(userId: string, id: string) {
    await this.sync.loadAccount(userId, id);
    await this.prisma.offerAccount.update({ where: { id }, data: { credentialEnc: null, credentialRef: null, sessionEnc: null, sessionExpiresAt: null, deviceTrustEnc: null, automationOptIn: false, syncHealth: 'DISABLED', failedLogins: 0, lockedAt: null } });
    await this.sync.audit(userId, 'offer-account.disconnect', 'OfferAccount', id, { credential: 'deleted' });
    return { ok: true };
  }

  async deleteAccount(userId: string, id: string) {
    await this.sync.loadAccount(userId, id);
    await this.prisma.offerAccount.delete({ where: { id } });
    await this.sync.audit(userId, 'offer-account.delete', 'OfferAccount', id);
  }

  // ───────────── rules and policy ─────────────

  rules(userId: string) {
    return this.prisma.enrollmentRule.findMany({ where: { userId }, orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] });
  }

  private ruleValue(dto: RuleDto): string {
    const v = dto.matcherValue.trim();
    if (!v && dto.matcher !== 'SPEND_HISTORY') throw new BadRequestException('A rule needs a value.');
    if (dto.matcher === 'MIN_VALUE' && !/^\d+$/.test(v)) throw new BadRequestException('A minimum value is a whole number of cents.');
    if (dto.matcher === 'OFFER_TYPE' && !['STATEMENT_CREDIT', 'CASHBACK_PERCENT', 'POINTS_BONUS', 'SPEND_GET', 'PORTAL_RATE', 'COUPON'].includes(v.toUpperCase())) throw new BadRequestException('Unknown offer type.');
    return dto.matcher === 'CATEGORY' ? v.toLowerCase() : v;
  }

  async createRule(userId: string, dto: RuleDto) {
    if (dto.accountId) await this.sync.loadAccount(userId, dto.accountId);
    if (dto.walletCardId) await this.wallet.assertOwned(userId, dto.walletCardId);
    const r = await this.prisma.enrollmentRule.create({ data: { userId, label: dto.label, kind: dto.kind, matcher: dto.matcher, matcherValue: this.ruleValue(dto), accountId: dto.accountId ?? null, walletCardId: dto.walletCardId ?? null, priority: dto.priority ?? 100, enabled: dto.enabled ?? true } });
    await this.sync.audit(userId, 'enrollment-rule.create', 'EnrollmentRule', r.id, { label: r.label, kind: r.kind, matcher: r.matcher, value: r.matcherValue });
    await this.sync.event(userId, 'RULE_CHANGED', 'USER', { ruleId: r.id, action: 'created', label: r.label, kind: r.kind });
    return r;
  }

  async updateRule(userId: string, id: string, dto: RuleDto) {
    const cur = await this.prisma.enrollmentRule.findFirst({ where: { id, userId } });
    if (!cur) throw new NotFoundException('Rule not found');
    const r = await this.prisma.enrollmentRule.update({ where: { id }, data: { label: dto.label, kind: dto.kind, matcher: dto.matcher, matcherValue: this.ruleValue(dto), accountId: dto.accountId ?? null, walletCardId: dto.walletCardId ?? null, priority: dto.priority ?? cur.priority, enabled: dto.enabled ?? cur.enabled } });
    await this.sync.audit(userId, 'enrollment-rule.update', 'EnrollmentRule', id, { label: r.label, kind: r.kind });
    await this.sync.event(userId, 'RULE_CHANGED', 'USER', { ruleId: id, action: 'updated', label: r.label });
    return r;
  }

  async deleteRule(userId: string, id: string) {
    const r = await this.prisma.enrollmentRule.deleteMany({ where: { id, userId } });
    if (!r.count) throw new NotFoundException('Rule not found');
    await this.sync.audit(userId, 'enrollment-rule.delete', 'EnrollmentRule', id);
    await this.sync.event(userId, 'RULE_CHANGED', 'USER', { ruleId: id, action: 'deleted' });
  }

  async policy(userId: string) {
    const p = await this.sync.policy(userId);
    return { mode: p.mode, autoFilter: p.filter };
  }

  async setPolicy(userId: string, dto: PolicyDto) {
    const filter = (dto.autoFilter ?? {}) as Prisma.InputJsonValue;
    await this.prisma.enrollmentPolicy.upsert({ where: { userId }, update: { mode: dto.mode, autoFilter: filter }, create: { userId, mode: dto.mode, autoFilter: filter } });
    await this.sync.audit(userId, 'enrollment-policy.set', 'EnrollmentPolicy', userId, { mode: dto.mode, autoFilter: dto.autoFilter ?? {} });
    await this.sync.event(userId, 'RULE_CHANGED', 'USER', { action: 'policy', mode: dto.mode });
    return this.policy(userId);
  }

  // ───────────── inbox and dashboards ─────────────

  async inbox(userId: string, q: InboxQuery, now = new Date()) {
    const tab = q.tab ?? 'all';
    const soon = new Date(now.getTime() + 14 * 86_400_000);
    const where: Prisma.OfferSnapshotItemWhereInput = { userId, ...(q.accountId ? { accountId: q.accountId } : {}), ...(q.profileId ? { account: { profileId: q.profileId } } : {}) };
    const byTab: Record<string, Prisma.OfferSnapshotItemWhereInput> = {
      all: { status: { in: ['AVAILABLE', 'ENROLLED'] } },
      new: { status: 'AVAILABLE', decision: { in: ['NEW', 'RECOMMENDED'] } },
      review: { status: 'AVAILABLE', decision: 'PENDING_REVIEW' },
      queued: { status: 'AVAILABLE', decision: 'APPROVED' },
      enrolled: { status: 'ENROLLED' },
      auto: { status: 'ENROLLED', autoEnrolled: true },
      expiring: { status: { in: ['AVAILABLE', 'ENROLLED'] }, endsAt: { gte: now, lte: soon } },
      redeemed: { status: 'REDEEMED' },
      history: { status: { in: ['REMOVED', 'EXPIRED', 'REDEEMED'] } },
    };
    const rows = await this.prisma.offerSnapshotItem.findMany({ where: { ...where, ...byTab[tab] }, include: { account: { select: { id: true, holderLabel: true, profileId: true, issuer: { select: { name: true } } } } }, orderBy: [{ score: 'desc' }, { endsAt: 'asc' }], take: 500 });
    const dup = duplicateCounts(rows.map((r) => ({ id: r.id, merchantText: r.merchantText, offerType: r.offerType, valueCents: r.valueCents, percent: r.percent === null ? null : Number(r.percent), points: r.points, minSpendCents: r.minSpendCents, endsAt: r.endsAt })));
    const cards = await this.prisma.walletCard.findMany({ where: { id: { in: rows.map((r) => r.walletCardId).filter((x): x is string => !!x) } }, select: { id: true, lastFour: true, nickname: true, card: { select: { name: true } } } });
    const cardName = new Map(cards.map((c) => [c.id, `${c.nickname || c.card.name}${c.lastFour ? ` ··${c.lastFour}` : ''}`]));
    return rows.map((r) => ({
      id: r.id, accountId: r.accountId, holder: r.account.holderLabel, issuer: r.account.issuer.name, profileId: r.account.profileId,
      walletCardId: r.walletCardId, card: r.walletCardId ? (cardName.get(r.walletCardId) ?? null) : null,
      merchant: r.merchantText, title: r.title, category: r.category, offerType: r.offerType, valueCents: r.valueCents, percent: r.percent === null ? null : Number(r.percent), points: r.points, minSpendCents: r.minSpendCents,
      endsAt: r.endsAt, daysLeft: daysLeft(r.endsAt, now), status: r.status, decision: r.decision, reason: r.decisionReason, score: r.score, scoreDetail: r.scoreDetail, autoEnrolled: r.autoEnrolled,
      sameOfferOnCards: dup.get(r.id) ?? 1, firstSeenAt: r.firstSeenAt, enrolledAt: r.enrolledAt,
    }));
  }

  async counts(userId: string, now = new Date()) {
    const soon = new Date(now.getTime() + 14 * 86_400_000);
    const c = (where: Prisma.OfferSnapshotItemWhereInput) => this.prisma.offerSnapshotItem.count({ where: { userId, ...where } });
    const [fresh, review, queued, enrolled, auto, expiring, redeemed, all] = await Promise.all([
      c({ status: 'AVAILABLE', decision: { in: ['NEW', 'RECOMMENDED'] } }), c({ status: 'AVAILABLE', decision: 'PENDING_REVIEW' }), c({ status: 'AVAILABLE', decision: 'APPROVED' }), c({ status: 'ENROLLED' }), c({ status: 'ENROLLED', autoEnrolled: true }),
      c({ status: { in: ['AVAILABLE', 'ENROLLED'] }, endsAt: { gte: now, lte: soon } }), c({ status: 'REDEEMED' }), c({ status: { in: ['AVAILABLE', 'ENROLLED'] } }),
    ]);
    return { all, new: fresh, review, queued, enrolled, auto, expiring, redeemed };
  }

  /** Every offer-related event for the member: discovery, decisions, enrollments, removals, expirations, rule changes, syncs. */
  async history(userId: string, opts: { type?: string; limit?: number }) {
    const types = opts.type ? HISTORY_TYPES.filter((t) => t === opts.type) : HISTORY_TYPES;
    return this.prisma.offerEvent.findMany({ where: { userId, type: { in: types } }, orderBy: { createdAt: 'desc' }, take: Math.min(opts.limit ?? 100, 500) });
  }

  async attempts(userId: string, itemId?: string) {
    return this.prisma.enrollmentAttempt.findMany({ where: { userId, ...(itemId ? { itemId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200, include: { item: { select: { merchantText: true, title: true } } } });
  }

  /** What offers have saved and could still save. Realized savings come from statement credits that were matched to the offer. */
  async savings(userId: string, now = new Date()) {
    const enrolled = await this.prisma.offerSnapshotItem.findMany({ where: { userId, status: { in: ['ENROLLED', 'REDEEMED'] } }, select: { id: true, valueCents: true, status: true, userOfferId: true, endsAt: true, autoEnrolled: true } });
    const uoIds = enrolled.map((e) => e.userOfferId).filter((x): x is string => !!x);
    const used = uoIds.length ? await this.prisma.userOffer.findMany({ where: { id: { in: uoIds } }, select: { id: true, amountUsedCents: true, status: true } }) : [];
    const realized = used.reduce((s, u) => s + u.amountUsedCents, 0);
    const potential = enrolled.filter((e) => e.status === 'ENROLLED' && (!e.endsAt || e.endsAt > now)).reduce((s, e) => s + e.valueCents, 0);
    const missedRows = await this.prisma.offerSnapshotItem.findMany({ where: { userId, status: 'EXPIRED', decision: { in: ['RECOMMENDED', 'PENDING_REVIEW', 'NEW'] }, valueCents: { gte: 1_000 } }, select: { valueCents: true } });
    const available = await this.prisma.offerSnapshotItem.findMany({ where: { userId, status: 'AVAILABLE', decision: { in: ['RECOMMENDED', 'PENDING_REVIEW', 'APPROVED'] } }, select: { valueCents: true } });
    return {
      realizedCents: realized,
      enrolledPotentialCents: potential,
      notYetAddedCents: available.reduce((s, a) => s + a.valueCents, 0),
      missedCents: missedRows.reduce((s, m) => s + m.valueCents, 0),
      enrolledCount: enrolled.length,
      autoEnrolledCount: enrolled.filter((e) => e.autoEnrolled).length,
      note: 'Realized savings are statement credits matched to an offer; potential is the value of offers you are enrolled in that have not ended.',
    };
  }

  async syncDashboard(userId: string, batchId?: string) {
    const runs = await this.prisma.offerSyncRun.findMany({ where: { userId, ...(batchId ? { batchId } : {}) }, orderBy: { createdAt: 'desc' }, take: batchId ? 50 : 40, include: { account: { select: { holderLabel: true, issuer: { select: { name: true } } } } } });
    const totals = runs.reduce((t, r) => ({ found: t.found + r.found, added: t.added + r.added, errors: t.errors + r.errors, warnings: t.warnings + r.warnings, processed: t.processed + (['SUCCESS', 'PARTIAL', 'FAILED', 'NEEDS_MFA'].includes(r.status) ? 1 : 0) }), { found: 0, added: 0, errors: 0, warnings: 0, processed: 0 });
    return {
      accounts: batchId ? undefined : await this.accounts(userId),
      runs: runs.map((r) => ({ id: r.id, batchId: r.batchId, accountId: r.accountId, holder: r.account?.holderLabel ?? null, issuer: r.account?.issuer.name ?? null, trigger: r.trigger, status: r.status, attempt: r.attempt, found: r.found, added: r.added, updated: r.updated, removed: r.removed, expired: r.expired, enrolled: r.enrolled, errors: r.errors, warnings: r.warnings, progress: r.progress, error: r.error, startedAt: r.startedAt, finishedAt: r.finishedAt, createdAt: r.createdAt })),
      totals,
      done: runs.length > 0 && runs.every((r) => ['SUCCESS', 'PARTIAL', 'FAILED', 'NEEDS_MFA'].includes(r.status)),
    };
  }

  // ───────────── extension and paste intake ─────────────

  async createExtensionToken(userId: string, name = 'Offers extension') {
    const count = await this.prisma.personalAccessToken.count({ where: { userId, revokedAt: null, scopes: { has: EXTENSION_SCOPE } } });
    if (count >= MAX_ACTIVE_TOKENS) throw new BadRequestException(`Maximum of ${MAX_ACTIVE_TOKENS} active extension tokens`);
    const token = PAT_PREFIX + randomBytes(32).toString('base64url');
    const row = await this.prisma.personalAccessToken.create({ data: { userId, name: name.slice(0, 60), prefix: token.slice(0, PAT_PREFIX.length + 6), tokenHash: hashToken(token), scopes: [EXTENSION_SCOPE], expiresAt: new Date(Date.now() + 90 * 86_400_000) } });
    await this.sync.audit(userId, 'offer-token.create', 'PersonalAccessToken', row.id, { scope: EXTENSION_SCOPE });
    return { id: row.id, name: row.name, token, expiresAt: row.expiresAt, scopes: row.scopes };
  }

  /** Resolves an offers:ingest bearer token to its owner, or null. Updates lastUsedAt at most once a minute. */
  async verifyToken(token: string | undefined): Promise<string | null> {
    if (!token || !token.startsWith(PAT_PREFIX) || token.length > 200) return null;
    const row = await this.prisma.personalAccessToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { deletedAt: true } } } });
    if (!row || row.revokedAt || (row.expiresAt && row.expiresAt < new Date()) || row.user.deletedAt || !row.scopes.includes(EXTENSION_SCOPE)) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) await this.prisma.personalAccessToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
    return row.userId;
  }

  extensionTokens(userId: string) {
    return this.prisma.personalAccessToken.findMany({ where: { userId, revokedAt: null, scopes: { has: EXTENSION_SCOPE } }, select: { id: true, name: true, prefix: true, lastUsedAt: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }

  async revokeExtensionToken(userId: string, id: string) {
    const r = await this.prisma.personalAccessToken.updateMany({ where: { id, userId, revokedAt: null, scopes: { has: EXTENSION_SCOPE } }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('Token not found');
    await this.sync.audit(userId, 'offer-token.revoke', 'PersonalAccessToken', id);
  }

  /** Turns the visible text of an offers page (or pasted offers) into inventory rows. */
  parseText(text: string, cardKey: string): InvItem[] {
    const parsed = parseOfferText(text, 300);
    const seen = new Set<string>();
    const out: InvItem[] = [];
    for (const p of parsed.offers) {
      const end = p.endsAt ? p.endsAt.toISOString().slice(0, 10) : '';
      const externalId = createHash('sha1').update([normalizeMerchant(p.merchantText), p.offerType, p.valueCents, p.percent ?? '', p.points ?? '', p.minSpendCents ?? '', end].join('|')).digest('hex').slice(0, 20);
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      out.push({ externalId, cardKey, merchantText: p.merchantText, title: p.raw.slice(0, 140), category: null, offerType: p.offerType, valueCents: p.valueCents, percent: p.percent, points: p.points, minSpendCents: p.minSpendCents, endsAt: p.endsAt, enrolled: /\b(added|enrolled|activated)\b/i.test(p.raw) });
    }
    return out;
  }

  private async accountForIngest(userId: string, dto: { accountId?: string; issuer?: string }) {
    if (dto.accountId) return this.sync.loadAccount(userId, dto.accountId);
    if (!dto.issuer) throw new BadRequestException('Say which account or issuer this page belongs to.');
    const a = await this.prisma.offerAccount.findFirst({ where: { userId, issuer: { name: { equals: dto.issuer, mode: 'insensitive' } }, connectorKind: { in: ['EXTENSION', 'MANUAL', 'EMAIL'] } }, include: { issuer: { select: { id: true, name: true, offersUrl: true } }, cards: { include: { walletCard: { select: { lastFour: true } } } } } });
    if (!a) throw new NotFoundException('No extension account for that issuer. Add one under Accounts first.');
    return a;
  }

  /** The extension (or a paste) hands over the text of an offers page. The text is parsed and discarded. */
  async ingestSnapshot(userId: string, dto: IngestSnapshotDto, via: 'EXTENSION' | 'USER_ENTERED' | 'EMAIL' = 'EXTENSION') {
    const account = await this.accountForIngest(userId, dto);
    const cardKey = dto.lastFour ? (account.cards.filter((c) => c.walletCard.lastFour === dto.lastFour)[0]?.walletCardId ?? '') : account.cards.length === 1 ? account.cards[0].walletCardId : '';
    const items = this.parseText(dto.text, cardKey);
    if (items.length === 0) return { accepted: false, reason: 'No offers were recognised on this page.', found: 0, toAdd: [] as Array<{ externalId: string; cardKey: string }> };
    const result = await this.sync.applyInventory(account, { items, cards: [] }, { source: via, actor: via === 'USER_ENTERED' ? 'USER' : 'SYSTEM', partial: via === 'EMAIL' });
    await this.prisma.offerAccount.update({ where: { id: account.id }, data: { lastSyncAt: new Date(), syncHealth: 'HEALTHY', lastError: null } });
    await this.sync.event(userId, 'SYNC', via === 'USER_ENTERED' ? 'USER' : 'SYSTEM', { action: 'snapshot', accountId: account.id, via, found: items.length, pageHash: dto.pageHash ?? null });
    return { accepted: true, found: items.length, added: result.added, updated: result.updated, removed: result.removed, expired: result.expired, unchanged: result.unchanged, idempotent: result.idempotent, warnings: result.warnings, toAdd: await this.queueFor(userId, account.id) };
  }

  /**
   * An offer-alert email from an issuer. It lists only some offers, so it adds and updates but never removes. Returns a
   * note for the mailbox log, or null when the member has no email account for this issuer or the mail has no offers.
   */
  async ingestFromMail(userId: string, issuerName: string, text: string, profileId: string | null = null): Promise<string | null> {
    const account = await this.prisma.offerAccount.findFirst({ where: { userId, ...(profileId && { profileId }), connectorKind: 'EMAIL', issuer: { name: { equals: issuerName, mode: 'insensitive' } } }, select: { id: true } });
    if (!account) return null;
    const r = await this.ingestSnapshot(userId, { accountId: account.id, text }, 'EMAIL');
    if (!r.accepted) return null;
    return `offer email read: ${r.found} offer(s), ${r.added} new`;
  }

  /** Offers approved for the extension to add in the member's own browser. */
  async queueFor(userId: string, accountId: string) {
    const rows = await this.prisma.offerSnapshotItem.findMany({ where: { userId, accountId, status: 'AVAILABLE', decision: 'APPROVED' }, select: { externalId: true, cardKey: true, merchantText: true } });
    return rows;
  }

  /** The extension reports what happened after the member clicked Enroll selected. */
  async enrollResults(userId: string, dto: EnrollResultsDto) {
    await this.sync.loadAccount(userId, dto.accountId);
    const out: Array<{ externalId: string; result: string }> = [];
    for (const r of dto.results) {
      const item = await this.prisma.offerSnapshotItem.findFirst({ where: { userId, accountId: dto.accountId, externalId: r.externalId, cardKey: r.cardKey } });
      if (!item) {
        out.push({ externalId: r.externalId, result: 'UNKNOWN' });
        continue;
      }
      if (r.outcome === 'FAILURE') {
        await this.prisma.offerSnapshotItem.update({ where: { id: item.id }, data: { decision: 'FAILED', decisionReason: (r.message ?? 'The page did not accept it.').slice(0, 200) } });
        await this.prisma.enrollmentAttempt.create({ data: { userId, itemId: item.id, accountId: dto.accountId, mode: 'BULK_APPROVAL', actor: 'USER', result: 'FAILURE', detail: { message: r.message ?? null, via: 'extension' } } });
        await this.sync.event(userId, 'ENROLL_ATTEMPT', 'USER', { itemId: item.id, result: 'FAILURE', via: 'extension', message: r.message ?? null });
        out.push({ externalId: r.externalId, result: 'FAILURE' });
        continue;
      }
      await this.enrollment.markEnrolled(userId, item.id, 'EXTENSION');
      out.push({ externalId: r.externalId, result: r.outcome });
    }
    return { results: out };
  }
}

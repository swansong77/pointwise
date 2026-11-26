import { BadRequestException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { EnrollResult, EnrollmentMode, OfferSource, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { redact } from './credential-vault';
import { Handle, OfferSyncService } from './offer-sync.service';

export interface EnrollItemResult {
  itemId: string;
  result: EnrollResult | 'QUEUED';
  message?: string;
}

/**
 * Enrolls offers and verifies the outcome. Server-side accounts add the offer through their connector and the result
 * is checked by reading the enrollments back; accounts fed by the extension, email or hand queue the offer for the
 * member's own browser. Every attempt is recorded (EnrollmentAttempt) and audited (OfferEvent). Enrollments are always
 * tied to the item's own card: an offer on two cards is two enrollments.
 */
@Injectable()
export class EnrollmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => OfferSyncService)) private readonly sync: OfferSyncService,
  ) {}

  /** Creates the Offer and UserOffer rows for an enrolled item so the rest of PointWise (missed offers, activation checks) sees it. */
  async ensureUserOffer(itemId: string, opts: { by: 'SYSTEM' | 'USER'; source: OfferSource }): Promise<string | null> {
    const item = await this.prisma.offerSnapshotItem.findUnique({ where: { id: itemId }, include: { account: { select: { id: true, issuerId: true } } } });
    if (!item || !item.walletCardId) return null;
    if (item.userOfferId) return item.userOfferId;
    const wc = await this.prisma.walletCard.findUnique({ where: { id: item.walletCardId }, select: { cardId: true } });
    const ref = `${item.accountId}|${item.cardKey}|${item.externalId}`;
    let offer = await this.prisma.offer.findFirst({ where: { sourceRef: ref, source: opts.source } });
    if (!offer) {
      offer = await this.prisma.offer.create({
        data: { title: `${item.merchantText}: ${item.title}`.slice(0, 140), description: item.title.slice(0, 500), kind: item.percent ? 'PERCENT' : item.points ? 'POINTS' : 'CASH', valueCents: item.valueCents, percent: item.percent, points: item.points, minSpendCents: item.minSpendCents, endsAt: item.endsAt, merchantId: item.merchantId, issuerId: item.account.issuerId, cardId: wc?.cardId ?? null, isCustom: true, createdById: item.userId, source: opts.source, sourceRef: ref, reliability: opts.source === 'CONNECTOR' ? 90 : 70, offerType: item.offerType, verification: 'UNVERIFIED', enrollmentRequired: true },
      });
    }
    const verifier = opts.source === 'EXTENSION' ? 'EXTENSION' : opts.source === 'CONNECTOR' ? 'CONNECTOR' : 'MANUAL';
    const uo = await this.prisma.userOffer.upsert({
      where: { walletCardId_offerId: { walletCardId: item.walletCardId, offerId: offer.id } },
      update: { activationStatus: 'ACTIVATED', activatedAt: new Date(), activationVerifiedBy: verifier },
      create: { walletCardId: item.walletCardId, offerId: offer.id, activationStatus: 'ACTIVATED', activatedAt: new Date(), activationVerifiedBy: verifier },
    });
    await this.prisma.offerSnapshotItem.update({ where: { id: itemId }, data: { userOfferId: uo.id } });
    return uo.id;
  }

  private async record(userId: string, item: { id: string; accountId: string; merchantText: string }, mode: EnrollmentMode, actor: 'USER' | 'SYSTEM' | 'AGENT', result: EnrollResult, detail: Record<string, unknown>) {
    await this.prisma.enrollmentAttempt.create({ data: { userId, itemId: item.id, accountId: item.accountId, mode, actor, result, detail: redact(detail) as Prisma.InputJsonValue } });
    const type = result === 'SUCCESS' || result === 'ALREADY_ADDED' ? (actor === 'SYSTEM' ? 'AUTO_ENROLLED' : 'ACTIVATED') : 'ENROLL_ATTEMPT';
    await this.sync.event(userId, type, actor === 'AGENT' ? 'AGENT' : actor, { itemId: item.id, accountId: item.accountId, merchant: item.merchantText, result, mode, ...detail });
  }

  /**
   * Tries to enroll the given items. `handle` lets a sync reuse the session it just opened. Items the user does not own
   * are rejected. Returns one result per item.
   */
  async enroll(userId: string, itemIds: string[], opts: { actor: 'USER' | 'SYSTEM' | 'AGENT'; mode: EnrollmentMode; handle?: Handle; now?: Date }): Promise<EnrollItemResult[]> {
    const now = opts.now ?? new Date();
    const items = await this.prisma.offerSnapshotItem.findMany({ where: { id: { in: itemIds }, userId } });
    if (items.length !== new Set(itemIds).size) throw new NotFoundException('One or more offers were not found');
    const out: EnrollItemResult[] = [];
    const byAccount = new Map<string, typeof items>();
    for (const i of items) byAccount.set(i.accountId, [...(byAccount.get(i.accountId) ?? []), i]);

    for (const [accountId, group] of byAccount) {
      const account = await this.sync.loadAccount(userId, accountId);
      const live = group.filter((i) => i.status === 'AVAILABLE');
      for (const i of group.filter((x) => x.status !== 'AVAILABLE')) out.push({ itemId: i.id, result: i.status === 'ENROLLED' ? 'ALREADY_ADDED' : 'FAILURE', message: i.status === 'ENROLLED' ? 'Already added.' : `The offer is ${i.status.toLowerCase()}.` });
      if (!live.length) continue;

      if (!this.sync.canLogin(account).ok) {
        // extension, email and manual accounts: queue for the member's own browser
        await this.prisma.offerSnapshotItem.updateMany({ where: { id: { in: live.map((i) => i.id) } }, data: { decision: 'APPROVED', decisionReason: 'Approved: your browser extension adds it when you click Enroll selected, or add it on the issuer\'s page and mark it done.' } });
        for (const i of live) {
          await this.sync.event(userId, 'DECISION', opts.actor === 'AGENT' ? 'AGENT' : opts.actor, { itemId: i.id, action: 'approved', queued: true, mode: opts.mode });
          out.push({ itemId: i.id, result: 'QUEUED', message: 'Waiting for your browser.' });
        }
        continue;
      }

      let handle = opts.handle && opts.handle.ctx.accountLabel === account.holderLabel ? opts.handle : undefined;
      if (!handle) {
        const login = await this.sync.ensureSession(account, now);
        if (!login.ok) {
          const result: EnrollResult = login.needsMfa || login.kind === 'MFA_FAILED' ? 'MFA_FAILURE' : login.kind === 'SESSION_TIMEOUT' ? 'SESSION_TIMEOUT' : 'FAILURE';
          for (const i of live) {
            await this.prisma.offerSnapshotItem.update({ where: { id: i.id }, data: { decision: 'FAILED', decisionReason: login.message.slice(0, 200) } });
            await this.record(userId, i, opts.mode, opts.actor, result, { message: login.message });
            out.push({ itemId: i.id, result, message: login.message });
          }
          await this.notifyFailure(userId, account.holderLabel, live.length, login.message, now);
          continue;
        }
        handle = login.handle;
      }

      const outcomes = new Map<string, { outcome: EnrollResult; message?: string }>();
      for (const i of live) {
        try {
          const r = await handle.connector.enroll(handle.session, { externalId: i.externalId, cardKey: i.cardKey }, handle.ctx);
          outcomes.set(i.id, { outcome: r.outcome, message: r.message });
        } catch (e) {
          outcomes.set(i.id, { outcome: 'FAILURE', message: e instanceof Error ? e.message : 'The request failed' });
        }
      }
      // the issuer ended the session behind our back: log in once more and retry what timed out
      const timedOut = live.filter((i) => outcomes.get(i.id)?.outcome === 'SESSION_TIMEOUT');
      if (timedOut.length) {
        await this.prisma.offerAccount.update({ where: { id: account.id }, data: { sessionEnc: null, sessionExpiresAt: null } });
        const fresh = await this.sync.ensureSession({ ...account, sessionEnc: null }, now);
        if (fresh.ok) {
          handle = fresh.handle;
          for (const i of timedOut) {
            try {
              const r = await handle.connector.enroll(handle.session, { externalId: i.externalId, cardKey: i.cardKey }, handle.ctx);
              outcomes.set(i.id, { outcome: r.outcome, message: r.message });
            } catch (e) {
              outcomes.set(i.id, { outcome: 'FAILURE', message: e instanceof Error ? e.message : 'The request failed' });
            }
          }
        } else {
          for (const i of timedOut) outcomes.set(i.id, { outcome: fresh.needsMfa ? 'MFA_FAILURE' : 'SESSION_TIMEOUT', message: fresh.message });
        }
      }
      // verification: read the enrollments back; a click that is not shown as added is only a partial success
      let verified: Set<string> | null = null;
      try {
        verified = new Set((await handle.connector.fetchEnrollments(handle.session, handle.ctx)).map((e) => `${e.cardKey}|${e.externalId}`));
      } catch {
        verified = null;
      }
      const failures: string[] = [];
      for (const i of live) {
        const o = outcomes.get(i.id)!;
        let result: EnrollResult = o.outcome;
        let message = o.message;
        if ((o.outcome === 'SUCCESS' || o.outcome === 'ALREADY_ADDED') && verified && !verified.has(`${i.cardKey}|${i.externalId}`)) {
          result = 'PARTIAL';
          message = 'The issuer accepted the request but the offer is not shown as added yet.';
        }
        const ok = result === 'SUCCESS' || result === 'ALREADY_ADDED';
        await this.prisma.offerSnapshotItem.update({
          where: { id: i.id },
          data: ok ? { status: 'ENROLLED', enrolledAt: now, decision: opts.actor === 'SYSTEM' ? 'AUTO_ENROLLED' : 'ENROLLED', autoEnrolled: opts.actor === 'SYSTEM', decisionReason: result === 'ALREADY_ADDED' ? 'It was already added.' : opts.actor === 'SYSTEM' ? 'Added automatically.' : 'Added.' } : { decision: result === 'PARTIAL' ? 'APPROVED' : 'FAILED', decisionReason: (message ?? 'Not added').slice(0, 200) },
        });
        if (ok) await this.ensureUserOffer(i.id, { by: opts.actor === 'SYSTEM' ? 'SYSTEM' : 'USER', source: 'CONNECTOR' });
        else failures.push(`${i.merchantText}: ${message ?? result}`);
        await this.record(userId, i, opts.mode, opts.actor, result, { message, verified: verified ? verified.has(`${i.cardKey}|${i.externalId}`) : null });
        if (ok) await this.prisma.enrollmentAttempt.updateMany({ where: { itemId: i.id, result }, data: { verifiedBy: 'CONNECTOR' } });
        out.push({ itemId: i.id, result, message });
      }
      if (failures.length) await this.notifyFailure(userId, account.holderLabel, failures.length, failures[0], now);
    }
    return out;
  }

  /** Approves offers for enrollment (bulk approval) and enrolls them. */
  async approve(userId: string, itemIds: string[]) {
    if (!itemIds.length) throw new BadRequestException('Choose at least one offer');
    return this.enroll(userId, itemIds, { actor: 'USER', mode: 'BULK_APPROVAL' });
  }

  /** The member added the offer on the issuer's own site and tells PointWise; recorded like any other enrollment. */
  async markEnrolled(userId: string, itemId: string, via: 'MANUAL' | 'EXTENSION' = 'MANUAL') {
    const item = await this.prisma.offerSnapshotItem.findFirst({ where: { id: itemId, userId } });
    if (!item) throw new NotFoundException('Offer not found');
    if (item.status === 'ENROLLED') return { itemId, result: 'ALREADY_ADDED' as const };
    await this.prisma.offerSnapshotItem.update({ where: { id: itemId }, data: { status: 'ENROLLED', enrolledAt: new Date(), decision: 'ENROLLED', decisionReason: via === 'EXTENSION' ? 'Added from your browser.' : 'You marked it added.' } });
    await this.ensureUserOffer(itemId, { by: 'USER', source: via === 'EXTENSION' ? 'EXTENSION' : 'USER_ENTERED' });
    await this.record(userId, item, 'RECOMMEND', 'USER', 'SUCCESS', { via });
    return { itemId, result: 'SUCCESS' as const };
  }

  async ignore(userId: string, itemIds: string[], reason?: string) {
    const r = await this.prisma.offerSnapshotItem.updateMany({ where: { id: { in: itemIds }, userId, status: 'AVAILABLE' }, data: { decision: 'IGNORED', decisionReason: (reason ?? 'You chose to ignore it.').slice(0, 200) } });
    for (const id of itemIds) await this.sync.event(userId, 'DECISION', 'USER', { itemId: id, action: 'ignored', reason: reason?.slice(0, 200) ?? null });
    return { updated: r.count };
  }

  private async notifyFailure(userId: string, holder: string, count: number, message: string, now: Date) {
    const p = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    if (p && !p.offerAutomation) return;
    await this.notifications.notify(userId, 'OFFER_ENROLL_FAILED', `${count} offer(s) could not be added on ${holder}`, message.slice(0, 200), '/offers/automation', `offer-enroll-fail:${holder}:${now.toISOString().slice(0, 13)}`);
  }
}

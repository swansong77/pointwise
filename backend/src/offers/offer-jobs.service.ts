import { Injectable } from '@nestjs/common';
import { Module } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { NotificationsModule, NotificationsService } from '../notifications/notifications.service';
import { OfferCoreService } from './offer-core.service';

const DAY = 86_400_000;
const FAIL_AFTER_DAYS = 14;
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Scheduled work for merchant offers. Idempotent: events and notifications are deduplicated. */
@Injectable()
export class OfferJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly core: OfferCoreService,
  ) {}

  private async log(userId: string, type: 'ACTIVATION_VERIFIED' | 'ACTIVATION_FAILED' | 'MISSED_DETECTED', detail: Record<string, unknown>, offerId: string, userOfferId?: string) {
    await this.prisma.offerEvent.create({ data: { userId, type, actor: 'SYSTEM', detail: detail as never, offerId, userOfferId: userOfferId ?? null } });
  }

  /**
   * Closes the loop on assisted activation: an offer the user marked activated is confirmed when a matching
   * statement credit posts (→ verified, reliability lifts to account-data level), and flagged when spending
   * met the terms but no credit appeared after 14 days.
   */
  async verifyActivations(now: Date): Promise<number> {
    const rows = await this.prisma.userOffer.findMany({
      where: { status: 'ACTIVE', activationStatus: 'ACTIVATED', activationVerifiedBy: 'MANUAL', activatedAt: { not: null }, offer: { merchantId: { not: null } } },
      include: { offer: { include: { merchant: { select: { id: true, name: true } } } }, walletCard: { include: { wallet: { select: { userId: true } } } } },
      take: 500,
    });
    let n = 0;
    for (const r of rows) {
      const userId = r.walletCard.wallet.userId;
      const since = r.activatedAt!;
      const name = r.offer.merchant!.name.toLowerCase();
      const credits = await this.prisma.transaction.findMany({ where: { walletCardId: r.walletCardId, kind: 'CREDIT', occurredAt: { gte: since } }, select: { id: true, amountCents: true, merchantId: true, description: true, occurredAt: true } });
      const lo = Math.round(r.offer.valueCents * 0.9);
      const hi = Math.round(r.offer.valueCents * 1.1);
      const credit = credits.find((c) => (c.merchantId === r.offer.merchantId || (c.description ?? '').toLowerCase().includes(name)) && (r.offer.valueCents === 0 || (c.amountCents >= lo && c.amountCents <= hi)));
      if (credit) {
        await this.prisma.$transaction([
          this.prisma.userOffer.update({ where: { id: r.id }, data: { activationVerifiedBy: 'STATEMENT' } }),
          this.prisma.offer.update({ where: { id: r.offerId }, data: { verification: 'VERIFIED', lastValidatedAt: now } }),
        ]);
        await this.log(userId, 'ACTIVATION_VERIFIED', { transactionId: credit.id, creditCents: credit.amountCents, creditedOn: day(credit.occurredAt), basis: 'statement credit matched merchant and amount' }, r.offerId, r.id);
        n++;
        continue;
      }
      const purchases = await this.prisma.transaction.findMany({ where: { walletCardId: r.walletCardId, kind: 'PURCHASE', merchantId: r.offer.merchantId, occurredAt: { gte: since, ...(r.offer.endsAt ? { lte: r.offer.endsAt } : {}) } }, select: { id: true, amountCents: true, occurredAt: true } });
      const spend = purchases.reduce((s, p) => s + p.amountCents, 0);
      const last = purchases.reduce<Date | null>((m, p) => (!m || p.occurredAt > m ? p.occurredAt : m), null);
      const met = purchases.length > 0 && (r.offer.minSpendCents == null || spend >= r.offer.minSpendCents);
      if (met && last && now.getTime() - last.getTime() > FAIL_AFTER_DAYS * DAY) {
        await this.prisma.userOffer.update({ where: { id: r.id }, data: { activationStatus: 'FAILED' } });
        await this.log(userId, 'ACTIVATION_FAILED', { reason: 'terms met but no statement credit after 14 days', spendCents: spend, transactionIds: purchases.map((p) => p.id).slice(0, 20), lastPurchase: day(last) }, r.offerId, r.id);
        n++;
      }
    }
    return n;
  }

  /** Daily: tell people about expiring offers worth acting on and newly found missed value (once each). */
  async scanOpportunities(now: Date): Promise<number> {
    const users = await this.prisma.user.findMany({ where: { wallet: { cards: { some: { status: 'APPROVED' } } } }, select: { id: true, notificationPrefs: { select: { offerExpiring: true, offerAlerts: true } } }, take: 1000 });
    let n = 0;
    for (const u of users) {
      if (u.notificationPrefs?.offerExpiring !== false) {
        const { items } = await this.core.opportunities(u.id, now);
        for (const o of items.filter((x) => !x.activated && x.daysLeft != null && x.daysLeft <= 7 && x.score >= 50 && x.expectedValueCents >= 500).slice(0, 3)) {
          await this.notifications.notify(u.id, 'OFFER_EXPIRING', `${o.merchant ?? 'Offer'}: ${usd(o.expectedValueCents)} expected, ${o.daysLeft} day(s) left`, `${o.title}. Opportunity score ${o.score}/100 (confidence ${o.confidence}%). Activate it before it ends.`, '/offers/intel', `offer-opp:${o.offerId}:${day(now)}`);
          n++;
        }
      }
      const missed = await this.core.missed(u.id, now);
      for (const m of missed.items.filter((x) => x.cause !== 'BELOW_MIN_SPEND' && x.lostCents >= 500)) {
        const seen = await this.prisma.offerEvent.count({ where: { userId: u.id, offerId: m.offerId, type: 'MISSED_DETECTED', createdAt: { gte: new Date(now.getTime() - 30 * DAY) } } });
        if (seen) continue;
        await this.log(u.id, 'MISSED_DETECTED', { cause: m.cause, lostCents: m.lostCents, spendCents: m.spendCents, transactionIds: m.transactionIds, confidence: m.confidence, evidence: m.evidence, action: m.action }, m.offerId);
        if (u.notificationPrefs?.offerAlerts !== false) {
          await this.notifications.notify(u.id, 'OFFER_ALERT', `Missed ${usd(m.lostCents)} at ${m.offer.merchant ?? 'a merchant'}`, `${m.evidence.join('; ')}. ${m.action}`, '/offers/intel', `missed:${m.offerId}:${m.cause}`);
        }
        n++;
      }
    }
    return n;
  }
}

@Module({ imports: [NotificationsModule], providers: [OfferCoreService, OfferJobsService], exports: [OfferCoreService, OfferJobsService] })
export class OfferCoreModule {}

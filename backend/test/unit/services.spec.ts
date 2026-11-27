import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WalletService } from '../../src/wallet/wallet.service';
import { OffersService } from '../../src/offers/offers.service';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { JobsService } from '../../src/jobs/jobs.service';
import { configMock, createPrismaMock, PrismaMock } from './prisma-mock';

const DAY = 86_400_000;
const PRO = { plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: null };
const FREE = { plan: 'FREE', status: 'ACTIVE', currentPeriodEnd: null };

describe('WalletService', () => {
  let prisma: PrismaMock;
  let svc: WalletService;
  beforeEach(() => {
    prisma = createPrismaMock();
    svc = new WalletService(prisma as never);
    prisma.wallet.upsert.mockResolvedValue({ id: 'w1' });
  });

  it('add: enforces free plan card limit', async () => {
    prisma.creditCard.findUnique.mockResolvedValue({ id: 'c', isActive: true });
    prisma.walletCard.count.mockResolvedValue(5);
    prisma.subscription.findUnique.mockResolvedValue(FREE);
    await expect(svc.add('u', { cardId: 'c' })).rejects.toThrow(/limit/);
  });
  it('add: pro has no limit and defaults status/cardholder', async () => {
    prisma.creditCard.findUnique.mockResolvedValue({ id: 'c', isActive: true });
    prisma.walletCard.count.mockResolvedValue(50);
    prisma.subscription.findUnique.mockResolvedValue(PRO);
    prisma.walletCard.create.mockResolvedValue({ id: 'wc', cardId: 'c' });
    prisma.benefit.findMany.mockResolvedValue([]);
    await svc.add('u', { cardId: 'c', approvedAt: '2026-01-01' });
    expect(prisma.walletCard.create.mock.calls[0][0].data).toMatchObject({ status: 'APPROVED', cardholder: 'PRIMARY', sortOrder: 50 });
    expect(prisma.benefit.findMany).toHaveBeenCalledWith({ where: { cardId: 'c', isActive: true } });
  });
  it('add: copies catalog benefits unless trackBenefits is false', async () => {
    prisma.creditCard.findUnique.mockResolvedValue({ id: 'c', isActive: true });
    prisma.walletCard.count.mockResolvedValue(0);
    prisma.subscription.findUnique.mockResolvedValue(PRO);
    prisma.walletCard.create.mockResolvedValue({ id: 'wc', cardId: 'c' });
    prisma.benefit.findMany.mockResolvedValue([{ id: 'b1', name: 'Credit', kind: 'CREDIT', period: 'ANNUAL', periodMonths: 12, basis: 'CALENDAR', amountPerPeriodCents: 100 }]);
    prisma.userBenefit.createMany.mockResolvedValue({ count: 1 });
    await svc.add('u', { cardId: 'c' });
    expect(prisma.userBenefit.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ walletCardId: 'wc', benefitId: 'b1', name: 'Credit' }] });
    prisma.userBenefit.createMany.mockClear();
    await svc.add('u', { cardId: 'c', trackBenefits: false });
    expect(prisma.userBenefit.createMany).not.toHaveBeenCalled();
  });
  it('add/update: a child member can only hold authorized-user cards', async () => {
    prisma.creditCard.findUnique.mockResolvedValue({ id: 'c', isActive: true });
    prisma.walletCard.count.mockResolvedValue(0);
    prisma.subscription.findUnique.mockResolvedValue(PRO);
    prisma.profile.findUnique.mockResolvedValue({ id: 'kid', userId: 'u', relationship: 'CHILD' });
    await expect(svc.add('u', { cardId: 'c', profileId: 'kid' })).rejects.toThrow(/authorized-user/);
    prisma.walletCard.findUnique.mockResolvedValue({ id: 'wc', profileId: 'kid', cardholder: 'AUTHORIZED_USER', wallet: { userId: 'u' } });
    await expect(svc.update('u', 'wc', { cardholder: 'PRIMARY' })).rejects.toThrow(/authorized-user/);
  });
  it('add: rejects inactive/unknown card and foreign profile', async () => {
    prisma.walletCard.count.mockResolvedValue(0);
    prisma.subscription.findUnique.mockResolvedValue(FREE);
    prisma.creditCard.findUnique.mockResolvedValueOnce(null);
    await expect(svc.add('u', { cardId: 'c' })).rejects.toBeInstanceOf(NotFoundException);
    prisma.creditCard.findUnique.mockResolvedValueOnce({ id: 'c', isActive: true });
    prisma.profile.findUnique.mockResolvedValueOnce({ userId: 'someone-else' });
    await expect(svc.add('u', { cardId: 'c', profileId: 'p' })).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('assertOwned: 404 and 403', async () => {
    prisma.walletCard.findUnique.mockResolvedValueOnce(null);
    await expect(svc.assertOwned('u', 'x')).rejects.toBeInstanceOf(NotFoundException);
    prisma.walletCard.findUnique.mockResolvedValueOnce({ wallet: { userId: 'other' } });
    await expect(svc.assertOwned('u', 'x')).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('update: validates closedAt after approvedAt and sets closedAt on close', async () => {
    prisma.walletCard.findUnique.mockResolvedValue({ wallet: { userId: 'u' } });
    await expect(svc.update('u', 'x', { approvedAt: '2026-05-01', closedAt: '2026-01-01' })).rejects.toBeInstanceOf(BadRequestException);
    prisma.walletCard.update.mockResolvedValue({});
    await svc.update('u', 'x', { status: 'CLOSED' });
    expect(prisma.walletCard.update.mock.calls[0][0].data.closedAt).toBeInstanceOf(Date);
    await svc.update('u', 'x', { approvedAt: null, nickname: null });
    expect(prisma.walletCard.update.mock.calls[1][0].data).toMatchObject({ approvedAt: null, nickname: null });
  });
  it('reorder: rejects foreign ids', async () => {
    prisma.walletCard.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    await expect(svc.reorder('u', ['a', 'z'])).rejects.toBeInstanceOf(ForbiddenException);
    prisma.walletCard.update.mockResolvedValue({});
    await svc.reorder('u', ['b', 'a']);
    expect(prisma.walletCard.update).toHaveBeenCalledTimes(2);
  });
  it('pin: requires exactly one target', async () => {
    await expect(svc.pin('u', { walletCardId: 'w' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.pin('u', { walletCardId: 'w', categoryId: 'c', merchantId: 'm' })).rejects.toBeInstanceOf(BadRequestException);
    prisma.walletCard.findUnique.mockResolvedValue({ wallet: { userId: 'u' } });
    prisma.categoryPin.upsert.mockResolvedValue({});
    await svc.pin('u', { walletCardId: 'w', merchantId: 'm' });
    expect(prisma.categoryPin.upsert.mock.calls[0][0].where).toEqual({ userId_merchantId: { userId: 'u', merchantId: 'm' } });
  });
  it('valuations map', async () => {
    prisma.userValuation.findMany.mockResolvedValue([{ currencyId: 'c1', centsPerPoint: '1.8' }]);
    await expect(svc.valuations('u')).resolves.toEqual({ c1: 1.8 });
  });
});

describe('OffersService', () => {
  let prisma: PrismaMock;
  let wallet: { assertOwned: jest.Mock; walletId: jest.Mock };
  let svc: OffersService;
  beforeEach(() => {
    prisma = createPrismaMock();
    wallet = { assertOwned: jest.fn().mockResolvedValue({ cardId: 'c' }), walletId: jest.fn().mockResolvedValue('w1') };
    svc = new OffersService(prisma as never, wallet as never);
    prisma.analyticsEvent.create.mockResolvedValue({});
  });

  it('addToCard: enforces offer limit on free plan', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 'o', isActive: true, isCustom: false, endsAt: null });
    prisma.subscription.findUnique.mockResolvedValue(FREE);
    prisma.userOffer.count.mockResolvedValue(20);
    await expect(svc.addToCard('u', { offerId: 'o', walletCardId: 'w' })).rejects.toThrow(/offer limit/);
  });
  it('addToCard: rejects expired, inactive, and other users\' custom offers', async () => {
    prisma.offer.findUnique.mockResolvedValueOnce({ id: 'o', isActive: true, isCustom: false, endsAt: new Date(Date.now() - DAY) });
    await expect(svc.addToCard('u', { offerId: 'o', walletCardId: 'w' })).rejects.toThrow(/expired/);
    prisma.offer.findUnique.mockResolvedValueOnce({ id: 'o', isActive: false });
    await expect(svc.addToCard('u', { offerId: 'o', walletCardId: 'w' })).rejects.toBeInstanceOf(NotFoundException);
    prisma.offer.findUnique.mockResolvedValueOnce({ id: 'o', isActive: true, isCustom: true, createdById: 'other' });
    await expect(svc.addToCard('u', { offerId: 'o', walletCardId: 'w' })).rejects.toBeInstanceOf(NotFoundException);
  });
  it('addToCard: success', async () => {
    prisma.offer.findUnique.mockResolvedValue({ id: 'o', isActive: true, isCustom: false, endsAt: null });
    prisma.subscription.findUnique.mockResolvedValue(PRO);
    prisma.userOffer.count.mockResolvedValue(500);
    prisma.userOffer.create.mockResolvedValue({ id: 'uo' });
    await expect(svc.addToCard('u', { offerId: 'o', walletCardId: 'w' })).resolves.toEqual({ id: 'uo' });
  });
  it('createCustom: validates kind-specific fields and dates', async () => {
    const base = { walletCardId: 'w', title: 'T', valueCents: 100 };
    await expect(svc.createCustom('u', { ...base, kind: 'CASH', startsAt: '2026-05-01', endsAt: '2026-04-01' })).rejects.toThrow(/after/);
    await expect(svc.createCustom('u', { ...base, kind: 'PERCENT' })).rejects.toThrow(/percent/);
    await expect(svc.createCustom('u', { ...base, kind: 'POINTS' })).rejects.toThrow(/points/);
    prisma.subscription.findUnique.mockResolvedValue(PRO);
    prisma.userOffer.count.mockResolvedValue(0);
    prisma.offer.create.mockResolvedValue({ id: 'o' });
    prisma.userOffer.create.mockResolvedValue({ id: 'uo' });
    await svc.createCustom('u', { ...base, kind: 'CASH', endsAt: '2027-01-01' });
    expect(prisma.offer.create.mock.calls[0][0].data).toMatchObject({ isCustom: true, createdById: 'u', isRepeatable: false });
  });
  it('update: applies usage + snooze and enforces ownership', async () => {
    const offer = { kind: 'CASH', valueCents: 1000, startsAt: null, endsAt: new Date(Date.now() + 10 * DAY), isRepeatable: false, maxTimes: null };
    prisma.userOffer.findUnique.mockResolvedValueOnce(null);
    await expect(svc.update('u', 'x', {})).rejects.toBeInstanceOf(NotFoundException);
    prisma.userOffer.findUnique.mockResolvedValueOnce({ walletCard: { wallet: { userId: 'other' } } });
    await expect(svc.update('u', 'x', {})).rejects.toBeInstanceOf(ForbiddenException);
    const row = { id: 'x', status: 'ACTIVE', amountUsedCents: 0, timesUsed: 0, snoozedUntil: null, redeemedAt: null, isFavorite: false, offer, walletCard: { wallet: { userId: 'u' } } };
    prisma.userOffer.findUnique.mockResolvedValue(row);
    prisma.userOffer.update.mockResolvedValue({});
    await svc.update('u', 'x', { amountUsedCents: 1000, isFavorite: true });
    expect(prisma.userOffer.update.mock.calls[0][0].data).toMatchObject({ status: 'REDEEMED', isFavorite: true });
    await svc.update('u', 'x', { snoozedUntil: new Date(Date.now() + 2 * DAY).toISOString() });
    expect(prisma.userOffer.update.mock.calls[1][0].data.snoozedUntil).toBeInstanceOf(Date);
    await svc.update('u', 'x', { snoozedUntil: null });
    expect(prisma.userOffer.update.mock.calls[2][0].data.snoozedUntil).toBeNull();
  });
  it('mine: filters by status and hides snoozed', async () => {
    const mk = (id: string, endsIn: number | null, extra: Record<string, unknown> = {}) => ({
      id, status: 'ACTIVE', amountUsedCents: 0, timesUsed: 0, snoozedUntil: null, redeemedAt: null, isFavorite: false, addedAt: new Date(),
      offer: { title: id, kind: 'CASH', valueCents: 100, startsAt: null, endsAt: endsIn === null ? null : new Date(Date.now() + endsIn * DAY), isRepeatable: false, maxTimes: null },
      ...extra,
    });
    prisma.userOffer.findMany.mockResolvedValue([mk('a', 5), mk('b', -1), mk('c', 2, { snoozedUntil: new Date(Date.now() + DAY) }), mk('d', null, { status: 'REDEEMED' })]);
    expect((await svc.mine('u', { status: 'ACTIVE', sort: 'endDate' })).map((o) => o.id)).toEqual(['a']);
    expect((await svc.mine('u', { status: 'ACTIVE', sort: 'endDate', includeSnoozed: true })).map((o) => o.id)).toEqual(['c', 'a']);
    expect((await svc.mine('u', { status: 'EXPIRED', sort: 'endDate' })).map((o) => o.id)).toEqual(['b']);
    expect((await svc.mine('u', { status: 'ALL', sort: 'alphabetical' })).map((o) => o.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('remove deletes custom offer definitions too', async () => {
    prisma.userOffer.findUnique.mockResolvedValue({ offerId: 'o', offer: { isCustom: true }, walletCard: { wallet: { userId: 'u' } } });
    prisma.userOffer.delete.mockResolvedValue({});
    prisma.offer.delete.mockResolvedValue({});
    await svc.remove('u', 'x');
    expect(prisma.offer.delete).toHaveBeenCalledWith({ where: { id: 'o' } });
  });
  it('eligible: matches card- and issuer-level offers not yet added', async () => {
    prisma.walletCard.findMany.mockResolvedValue([
      { id: 'w1', nickname: null, card: { id: 'c1', issuerId: 'i1', name: 'Card1' }, userOffers: [{ offerId: 'o-added' }] },
    ]);
    prisma.offer.findMany.mockResolvedValue([
      { id: 'o-card', cardId: 'c1', issuerId: 'i1' },
      { id: 'o-issuer', cardId: null, issuerId: 'i1' },
      { id: 'o-added', cardId: null, issuerId: 'i1' },
      { id: 'o-other', cardId: 'c9', issuerId: 'i1' },
    ]);
    const res = await svc.eligible('u');
    expect(res.map((r) => r.offer.id)).toEqual(['o-card', 'o-issuer']);
  });
});

describe('SubscriptionsService', () => {
  let prisma: PrismaMock;
  beforeEach(() => {
    prisma = createPrismaMock();
    prisma.subscription.upsert.mockResolvedValue({ plan: 'PRO', status: 'ACTIVE', currentPeriodEnd: null });
    prisma.analyticsEvent.create.mockResolvedValue({});
  });
  it('checkout with mock provider activates PRO; annual starts trialing', async () => {
    const svc = new SubscriptionsService(prisma as never, configMock({ BILLING_PROVIDER: 'mock' }) as never);
    await svc.checkout('u', 'year');
    expect(prisma.subscription.upsert.mock.calls[0][0].update).toMatchObject({ plan: 'PRO', status: 'TRIALING', interval: 'year' });
    await svc.checkout('u', 'lifetime');
    expect(prisma.subscription.upsert.mock.calls[2][0].update).toMatchObject({ status: 'ACTIVE', currentPeriodEnd: null });
  });
  it('checkout with unconfigured provider fails', async () => {
    const svc = new SubscriptionsService(prisma as never, configMock({ BILLING_PROVIDER: 'stripe' }) as never);
    await expect(svc.checkout('u', 'month')).rejects.toBeInstanceOf(BadRequestException);
  });
  it('cancel / resume rules', async () => {
    const svc = new SubscriptionsService(prisma as never, configMock() as never);
    prisma.subscription.findUnique.mockResolvedValueOnce(null);
    await expect(svc.cancel('u')).rejects.toThrow(/No active/);
    prisma.subscription.findUnique.mockResolvedValueOnce({ plan: 'PRO', interval: 'lifetime' });
    await expect(svc.cancel('u')).rejects.toThrow(/Lifetime/);
    prisma.subscription.findUnique.mockResolvedValueOnce({ plan: 'PRO', interval: 'month' });
    prisma.subscription.update.mockResolvedValue({});
    await svc.cancel('u');
    expect(prisma.subscription.update.mock.calls[0][0].data).toEqual({ status: 'CANCELED', cancelAtPeriodEnd: true });
    prisma.subscription.findUnique.mockResolvedValueOnce({ status: 'ACTIVE' });
    await expect(svc.resume('u')).rejects.toThrow(/Nothing/);
    prisma.subscription.findUnique.mockResolvedValueOnce({ status: 'CANCELED', currentPeriodEnd: new Date(Date.now() + DAY) });
    await svc.resume('u');
    expect(prisma.subscription.update.mock.calls[1][0].data).toEqual({ status: 'ACTIVE', cancelAtPeriodEnd: false });
  });
});

describe('NotificationsService', () => {
  it('notify upserts by dedupe key, creates otherwise; markRead 404s', async () => {
    const prisma = createPrismaMock();
    const svc = new NotificationsService(prisma as never);
    prisma.notification.upsert.mockResolvedValue({});
    prisma.notification.create.mockResolvedValue({});
    await svc.notify('u', 'SYSTEM', 't', 'b', '/x', 'k1');
    expect(prisma.notification.upsert.mock.calls[0][0].where).toEqual({ userId_dedupeKey: { userId: 'u', dedupeKey: 'k1' } });
    await svc.notify('u', 'SYSTEM', 't', 'b');
    expect(prisma.notification.create).toHaveBeenCalled();
    prisma.notification.updateMany.mockResolvedValue({ count: 0 });
    await expect(svc.markRead('u', 'n')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('JobsService', () => {
  let prisma: PrismaMock;
  let notifications: { notify: jest.Mock };
  let mail: { send: jest.Mock };
  let jobs: JobsService;
  const now = new Date('2026-06-15T12:00:00Z');
  beforeEach(() => {
    prisma = createPrismaMock();
    notifications = { notify: jest.fn().mockResolvedValue({}) };
    mail = { send: jest.fn().mockResolvedValue(true) };
    jobs = new JobsService(prisma as never, notifications as never, mail as never);
  });

  it('scan-expiring-offers notifies within each user window with a dedupe key', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([{ userId: 'u', expiringDays: 7 }]);
    const mk = (id: string, days: number) => ({
      id, status: 'ACTIVE', amountUsedCents: 0, timesUsed: 0, snoozedUntil: null, redeemedAt: null,
      offer: { title: id, kind: 'CASH', valueCents: 100, startsAt: null, endsAt: new Date(now.getTime() + days * DAY), isRepeatable: false, maxTimes: null },
      walletCard: { nickname: null, card: { name: 'Gold' } },
    });
    prisma.userOffer.findMany.mockResolvedValue([mk('soon', 1), mk('later', 30)]);
    const res = await jobs.run('scan-expiring-offers', now);
    expect(res).toEqual({ job: 'scan-expiring-offers', created: 1 });
    expect(notifications.notify).toHaveBeenCalledWith('u', 'OFFER_EXPIRING', 'Offer expiring in 1 day', expect.stringContaining('Gold'), '/offers', 'expiring:soon:2026-06-16', { profileId: undefined });
  });

  it('scan-renewals and scan-bonus-deadlines', async () => {
    prisma.notificationPreference.findMany.mockResolvedValue([{ userId: 'u' }]);
    const card = { id: 'c', name: 'Gold', color: '#000', type: 'PERSONAL', annualFeeCents: 25000, bonusSpendCents: 400000, bonusMonths: 3, bonusPoints: 1, currency: { id: 'x', code: 'X', centsPerPoint: 1, isCash: true }, rewards: [] };
    prisma.wallet.findMany.mockResolvedValue([
      {
        userId: 'u',
        cards: [
          { id: 'r', nickname: null, status: 'APPROVED', approvedAt: new Date('2025-06-25T00:00:00Z'), closedAt: null, annualFeeOverrideCents: null, bonusEarned: true, bonusSpendCents: 0, selectedCategoryIds: [], card },
          { id: 'b', nickname: null, status: 'APPROVED', approvedAt: new Date('2026-04-01T00:00:00Z'), closedAt: null, annualFeeOverrideCents: null, bonusEarned: false, bonusSpendCents: 1000, selectedCategoryIds: [], card },
        ],
      },
    ]);
    expect((await jobs.run('scan-renewals', now)).created).toBe(1);
    expect(notifications.notify.mock.calls[0][1]).toBe('CARD_RENEWAL');
    expect((await jobs.run('scan-bonus-deadlines', now)).created).toBe(1);
    expect(notifications.notify.mock.calls[1][1]).toBe('BONUS_DEADLINE');
  });

  it('match-offer-alerts', async () => {
    prisma.offer.findMany.mockResolvedValue([{ id: 'o1', title: 'Coffee deal', description: null, valueCents: 500, issuerId: 'i' }, { id: 'o2', title: 'Hotel deal', description: 'x', valueCents: 500, issuerId: 'i' }]);
    prisma.offerAlert.findMany.mockResolvedValue([{ id: 'a', userId: 'u', keywords: ['coffee'], issuerIds: [], minValueCents: null }]);
    expect((await jobs.run('match-offer-alerts', now)).created).toBe(1);
    expect(notifications.notify.mock.calls[0][3]).toBe('A new offer matches your alert.');
  });

  it('expire-offers', async () => {
    prisma.userOffer.updateMany.mockResolvedValue({ count: 4 });
    expect((await jobs.run('expire-offers', now)).created).toBe(4);
  });

  it('email-digest groups by user and marks emailed only on success', async () => {
    prisma.notification.findMany.mockResolvedValue([
      { id: 'n1', userId: 'u1', title: 'A', body: 'a', user: { email: 'u1@x' } },
      { id: 'n2', userId: 'u1', title: 'B', body: 'b', user: { email: 'u1@x' } },
      { id: 'n3', userId: 'u2', title: 'C', body: 'c', user: { email: 'u2@x' } },
    ]);
    mail.send.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    prisma.notification.updateMany.mockResolvedValue({});
    expect((await jobs.run('email-digest', now)).created).toBe(1);
    expect(mail.send).toHaveBeenCalledWith('u1@x', 'PointWise: 2 updates', expect.stringContaining('• A'));
    expect(mail.send).toHaveBeenCalledWith('u2@x', 'PointWise: 1 update', expect.any(String));
    expect(prisma.notification.updateMany).toHaveBeenCalledTimes(1);
  });
});

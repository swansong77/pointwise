import { BadRequestException } from '@nestjs/common';
import { DeliveryProcessor, DeliveryService, isAllowedPushEndpoint, NotificationDispatcher, PushService } from '../../../src/notifications/delivery';
import { plainCell, readUpload } from '../../../src/portfolio/imports';
import { trackerXlsx } from '../../fixtures/tracker';
import { createPrismaMock, PrismaMock } from '../prisma-mock';

jest.mock('web-push', () => ({ setVapidDetails: jest.fn(), sendNotification: jest.fn() }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const webpush = require('web-push') as { setVapidDetails: jest.Mock; sendNotification: jest.Mock };

describe('push endpoint allow-list (SSRF guard)', () => {
  it.each([
    ['https://fcm.googleapis.com/fcm/send/abc', true],
    ['https://updates.push.services.mozilla.com/wpush/v2/x', true],
    ['https://wns2-par02p.notify.windows.com/w/?token=x', true],
    ['https://web.push.apple.com/abc', true],
    ['http://fcm.googleapis.com/x', false],
    ['https://fcm.googleapis.com:8443/x', false],
    ['https://169.254.169.254/latest/meta-data', false],
    ['https://evil.com/fcm.googleapis.com', false],
    ['https://fcm.googleapis.com.evil.com/x', false],
    ['not a url', false],
  ])('%s → %s', (url, ok) => expect(isAllowedPushEndpoint(url)).toBe(ok));
});

describe('PushService', () => {
  let prisma: PrismaMock;
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    jest.clearAllMocks();
  });

  it('disabled without VAPID keys', async () => {
    prisma = createPrismaMock();
    delete process.env.VAPID_PUBLIC_KEY;
    const p = new PushService(prisma as never);
    expect(p.publicKey).toBeNull();
    expect(await p.send('u', { title: 't', body: 'b' })).toBe(false);
    await expect(p.subscribe('u', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } })).rejects.toThrow(BadRequestException);
  });

  it('subscribes allowed endpoints, sends, prunes expired subscriptions', async () => {
    prisma = createPrismaMock();
    process.env.VAPID_PUBLIC_KEY = 'pub';
    process.env.VAPID_PRIVATE_KEY = 'priv';
    const p = new PushService(prisma as never);
    expect(webpush.setVapidDetails).toHaveBeenCalledWith('mailto:alerts@pointwise.local', 'pub', 'priv');
    await expect(p.subscribe('u', { endpoint: 'https://internal.local/x', keys: { p256dh: 'a', auth: 'b' } })).rejects.toThrow(/Unsupported push service/);
    expect(await p.subscribe('u', { endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } })).toEqual({ subscribed: true });
    expect(prisma.notificationPreference.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { benefitPush: true } }));

    prisma.pushSubscription.findMany.mockResolvedValue([
      { id: 's1', endpoint: 'https://fcm.googleapis.com/ok', p256dh: 'a', auth: 'b' },
      { id: 's2', endpoint: 'https://fcm.googleapis.com/gone', p256dh: 'a', auth: 'b' },
      { id: 's3', endpoint: 'https://fcm.googleapis.com/flaky', p256dh: 'a', auth: 'b' },
      { id: 's4', endpoint: 'https://internal.local/x', p256dh: 'a', auth: 'b' },
    ]);
    prisma.pushSubscription.delete.mockResolvedValue({});
    webpush.sendNotification.mockImplementation(async (sub: { endpoint: string }) => {
      if (sub.endpoint.endsWith('/gone')) throw Object.assign(new Error('gone'), { statusCode: 410 });
      if (sub.endpoint.endsWith('/flaky')) throw Object.assign(new Error('boom'), { statusCode: 500 });
      return {};
    });
    expect(await p.send('u', { title: 't', body: 'b', link: '/benefits' })).toBe(true);
    expect(webpush.sendNotification).toHaveBeenCalledTimes(3);
    expect(prisma.pushSubscription.delete).toHaveBeenCalledWith({ where: { id: 's2' } });
    await p.unsubscribe('u', 'https://fcm.googleapis.com/ok');
    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u', endpoint: 'https://fcm.googleapis.com/ok' } });
  });
});

describe('DeliveryService / dispatcher / processor', () => {
  let prisma: PrismaMock;
  const mail = { send: jest.fn() };
  const push = { send: jest.fn() };
  let svc: DeliveryService;
  beforeEach(() => {
    prisma = createPrismaMock();
    svc = new DeliveryService(prisma as never, mail as never, push as never);
    prisma.benefitNotification.update.mockResolvedValue({});
    mail.send.mockReset();
    push.send.mockReset();
  });

  it('email: sends with an absolute link and records success', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@b.c', deletedAt: null });
    mail.send.mockResolvedValue(true);
    expect(await svc.deliver({ benefitNotificationId: 'bn', userId: 'u', channel: 'EMAIL', title: 'T', body: 'B', link: '/benefits' })).toBe(true);
    expect(mail.send).toHaveBeenCalledWith('a@b.c', 'PointWise: T', expect.stringContaining('/benefits'));
    expect(prisma.benefitNotification.update).toHaveBeenCalledWith({ where: { id: 'bn' }, data: { success: true } });
  });

  it('email: deleted users are skipped; push delegates to PushService', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@b.c', deletedAt: new Date() });
    expect(await svc.deliver({ userId: 'u', channel: 'EMAIL', title: 'T', body: 'B' })).toBe(false);
    expect(mail.send).not.toHaveBeenCalled();
    push.send.mockResolvedValue(true);
    expect(await svc.deliver({ userId: 'u', channel: 'PUSH', title: 'T', body: 'B' })).toBe(true);
  });

  it('dispatcher queues with retries, or delivers inline without a queue', async () => {
    const queue = { add: jest.fn() };
    await new NotificationDispatcher(svc, queue as never).dispatch({ userId: 'u', channel: 'PUSH', title: 'T', body: 'B' });
    expect(queue.add).toHaveBeenCalledWith('deliver', expect.any(Object), expect.objectContaining({ attempts: 3 }));
    push.send.mockResolvedValue(false);
    await new NotificationDispatcher(svc).dispatch({ userId: 'u', channel: 'PUSH', title: 'T', body: 'B' });
    expect(push.send).toHaveBeenCalled();
  });

  it('processor throws on failed email (BullMQ retries) but not on push', async () => {
    const proc = new DeliveryProcessor(svc);
    prisma.user.findUnique.mockResolvedValue({ email: 'a@b.c', deletedAt: null });
    mail.send.mockResolvedValue(false);
    await expect(proc.process({ data: { userId: 'u', channel: 'EMAIL', title: 'T', body: 'B' } } as never)).rejects.toThrow(/email not sent/);
    push.send.mockResolvedValue(false);
    await expect(proc.process({ data: { userId: 'u', channel: 'PUSH', title: 'T', body: 'B' } } as never)).resolves.toBe(false);
  });
});

describe('upload reading', () => {
  it('plainCell flattens exceljs values', () => {
    expect(plainCell({ formula: 'SUM(A1)', result: 5 })).toBe(5);
    expect(plainCell({ richText: [{ text: 'a' }, { text: 'b' }] })).toBe('ab');
    expect(plainCell({ text: 'link', hyperlink: 'https://x' })).toBe('link');
    expect(plainCell({ error: '#REF!' })).toBeNull();
    expect(plainCell({})).toBeNull();
    expect(plainCell(undefined)).toBeNull();
    const d = new Date();
    expect(plainCell(d)).toBe(d);
  });

  it('reads xlsx (sheet names, 1-based rows, formula results) and csv', async () => {
    const sheets = await readUpload(await trackerXlsx(), 'tracker.xlsx');
    expect(sheets.map((s) => s.name)).toEqual(['Benefits', 'Cards', 'Dropdown options']);
    expect(sheets[0].rows[0]).toEqual(['Credit value available', 1830]);
    expect(sheets[1].rows[0][0]).toBe('Owner');
    const csv = await readUpload(Buffer.from('Card,Last 4\nA,1234\n'), 'cards.csv');
    expect(csv).toEqual([{ name: 'cards', rows: [['Card', 'Last 4'], ['A', '1234']] }]);
  });

  it('rejects binary text, unsupported names and corrupt zips', async () => {
    await expect(readUpload(Buffer.from('a\u0000b'), 'x.csv')).rejects.toThrow(/not text/);
    await expect(readUpload(Buffer.from('a'), 'x.pdf')).rejects.toThrow(/xlsx workbook or a .csv/);
    await expect(readUpload(Buffer.from('PK\u0003\u0004nope'), 'x.xlsx')).rejects.toThrow(/Could not read/);
  });
});

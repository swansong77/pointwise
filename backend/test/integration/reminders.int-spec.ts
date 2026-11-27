import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register } from './helpers';
import { RemindersService } from '../../src/reminders/reminders.module';

/** Reminders and the actions offered with search answers (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let otherId: string;
const DAY = 86_400_000;
const get = (path: string, t = token) => api(app).get(V + path).set(bearer(t));
const post = (path: string, body: object, t = token) => api(app).post(V + path).set(bearer(t)).send(body);
const iso = (days: number) => new Date(Date.now() + days * DAY).toISOString();

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  const b = await register(app);
  token = a.token;
  other = b.token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  otherId = (await prisma.user.findFirstOrThrow({ where: { email: b.email } })).id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('TC-REMIND: reminders', () => {
  it('creates, lists, de-duplicates and deletes, privately', async () => {
    const due = iso(5);
    const r = (await post('/reminders', { title: 'Use the Hilton credit', dueAt: due, link: '/offers/expirations' }).expect(201)).body;
    expect(r).toMatchObject({ title: 'Use the Hilton credit', status: 'PENDING', link: '/offers/expirations' });
    const again = (await post('/reminders', { title: 'Use the Hilton credit', dueAt: due }).expect(201)).body;
    expect(again.id).toBe(r.id);
    expect((await get('/reminders').expect(200)).body.map((x: any) => x.id)).toEqual([r.id]);
    expect((await get('/reminders', other).expect(200)).body).toEqual([]);
    await api(app).delete(V + '/reminders/' + r.id).set(bearer(other)).expect(404);
    await api(app).delete(V + '/reminders/' + r.id).set(bearer(token)).expect(204);
    expect((await get('/reminders').expect(200)).body).toEqual([]);
  });

  it('rejects bad input: past dates, other-site links, empty titles, too far ahead', async () => {
    await post('/reminders', { title: 'x', dueAt: iso(-3) }).expect(400);
    await post('/reminders', { title: 'x', dueAt: iso(3), link: 'https://evil.test' }).expect(400);
    await post('/reminders', { title: 'x', dueAt: iso(3), link: 'javascript:alert(1)' }).expect(400);
    await post('/reminders', { title: '   ', dueAt: iso(3) }).expect(400);
    await post('/reminders', { title: 'x', dueAt: iso(2000) }).expect(400);
    await post('/reminders', { title: 'x', dueAt: 'soon' }).expect(400);
    await api(app).post(V + '/reminders').send({ title: 'x', dueAt: iso(3) }).expect(401);
  });

  it('the daily job turns due reminders into one notification each, and is safe to run twice', async () => {
    const svc = app.get(RemindersService);
    const due = await prisma.reminder.create({ data: { userId, title: 'Certificate ends soon', dueAt: new Date(Date.now() - 1000), link: '/loyalty' } });
    const later = await prisma.reminder.create({ data: { userId, title: 'Not yet', dueAt: new Date(Date.now() + 3 * DAY) } });
    const otherDue = await prisma.reminder.create({ data: { userId: otherId, title: 'Other member', dueAt: new Date(Date.now() - 1000) } });
    expect(await svc.dispatchDue(new Date())).toBeGreaterThanOrEqual(2);
    expect(await svc.dispatchDue(new Date())).toBe(0);
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: due.id } })).status).toBe('SENT');
    expect((await prisma.reminder.findUniqueOrThrow({ where: { id: later.id } })).status).toBe('PENDING');
    const mine = await prisma.notification.findMany({ where: { userId, type: 'REMINDER' } });
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ title: 'Reminder', body: 'Certificate ends soon', link: '/loyalty' });
    const theirs = await prisma.notification.findMany({ where: { userId: otherId, type: 'REMINDER' } });
    expect(theirs).toHaveLength(1);
    expect(otherDue.userId).toBe(otherId);
    const inbox = (await get('/notifications').expect(200)).body;
    expect(JSON.stringify(inbox)).toContain('Certificate ends soon');
    expect(JSON.stringify(inbox)).not.toContain('Other member');
  });

  it('caps pending reminders', async () => {
    const t = (await register(app)).token;
    const uid = (await prisma.user.findFirstOrThrow({ orderBy: { createdAt: 'desc' } })).id;
    await prisma.reminder.createMany({ data: Array.from({ length: 100 }, (_, i) => ({ userId: uid, title: 'r' + i, dueAt: new Date(Date.now() + DAY) })) });
    await post('/reminders', { title: 'one more', dueAt: iso(4) }, t).expect(400);
  });

  it('is part of the member export', async () => {
    await post('/reminders', { title: 'Exported reminder', dueAt: iso(9) }).expect(201);
    const exp = JSON.parse((await get('/me/data-export').expect(200)).text);
    expect(JSON.stringify(exp.models.Reminder)).toContain('Exported reminder');
  });
});

describe('TC-ACT: actions offered with answers run on the existing endpoints', () => {
  it('a shopping answer offers "save as plan", and running it creates the planned purchase', async () => {
    await post('/subscription/checkout', { interval: 'month' }).expect(201);
    const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
    await post('/wallet/cards', { cardId: gold.id }).expect(201);
    const a = (await post('/search/ask', { q: 'What card should I use at Costco for $1,500?' }).expect(201)).body.answer;
    const save = a.calls.find((c: any) => c.kind === 'SAVE_PLAN');
    expect(save).toMatchObject({ method: 'POST', path: '/offers/intel/plan', confirm: null });
    await post(save.path, save.body).expect(201);
    const planned = await prisma.plannedPurchase.findMany({ where: { userId } });
    expect(planned.some((p) => p.amountCents === 150000)).toBe(true);
  });

  it('every offered call is on the allow-list and "Sync offers" offers nothing without a connected account', async () => {
    const a = (await post('/search/ask', { q: 'Sync offers' }).expect(201)).body.answer;
    expect(a.intent).toBe('SYNC_OFFERS');
    expect(a.calls).toEqual([]);
    for (const q of ['Show all Hilton offers', "What's expiring?", 'Flight to Hawaii next month']) {
      const r = (await post('/search/ask', { q }).expect(201)).body.answer;
      for (const c of r.calls) expect(c.path).toMatch(/^\/(offers\/intel\/(plan|activation\/[0-9a-f-]{36})|loyalty\/award-trips|reminders|offer-automation\/(sync|items\/[0-9a-f-]{36}\/mark-enrolled))$/);
    }
  });
});

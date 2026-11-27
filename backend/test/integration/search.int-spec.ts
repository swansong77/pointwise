import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register } from './helpers';
import { defaultProviderFactory } from '../../src/ai/providers';
import { ModelRouter } from '../../src/ai/router';
import { ChatRequest } from '../../src/ai/types';

/**
 * Universal search: suggestions as you type and answers in plain language, over the caller's own data only, with no model involved.
 * All data is synthetic.
 */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let aCard: string;
let spouseId: string;

const DAY = 86_400_000;
const us = (days: number) => {
  const d = new Date(Date.now() + days * DAY);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const get = (path: string, t = token) => api(app).get(V + path).set(bearer(t));
const post = (path: string, body: object, t = token) => api(app).post(V + path).set(bearer(t)).send(body);
const ask = async (q: string, slots?: object, t = token) => (await post('/search/ask', { q, ...(slots ? { slots } : {}) }, t).expect(201)).body;
const suggest = async (q: string, t = token) => (await get('/search/suggest?q=' + encodeURIComponent(q), t).expect(200)).body;

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  token = a.token;
  other = (await register(app)).token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  await post('/subscription/checkout', { interval: 'month' }).expect(201);
  spouseId = (await post('/household/members', { nickname: 'Riley', relationship: 'SPOUSE' }).expect(201)).body.id;
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  const voyager = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'northwind-voyager' } });
  aCard = (await post('/wallet/cards', { cardId: gold.id }).expect(201)).body.id;
  await post('/wallet/cards', { cardId: voyager.id, profileId: spouseId }).expect(201);
  await post('/household/members', { nickname: 'Sam', relationship: 'CHILD', birthYear: 2012 }).expect(201);
  await post('/offers/intel/import', { walletCardId: aCard, text: 'Hilton: Spend $500, get $100 back, expires ' + us(10) }).expect(201);
  const primary = await prisma.profile.findFirstOrThrow({ where: { userId, isPrimary: true } });
  await prisma.loyaltyCertificate.create({ data: { userId, profileId: primary.id, category: 'FREE_NIGHT', name: 'Hyatt free night', expiresAt: new Date(Date.now() + 40 * DAY), potentialValueCents: 25_000, eligible: ['Hyatt'] } });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('TC-SRCH: suggestions as you type', () => {
  it('offers example questions before anything is typed', async () => {
    const r = await suggest('');
    expect(r.suggestions.length).toBeGreaterThanOrEqual(6);
    expect(r.suggestions.every((s: any) => s.type === 'EXAMPLE' && s.query)).toBe(true);
  });
  it('finds the household’s own things and the catalog, forgives typos and reads nicknames', async () => {
    const hil = await suggest('hilton');
    const labels = hil.suggestions.map((s: any) => s.label).join(' | ');
    expect(labels).toMatch(/Hilton/);
    expect(hil.suggestions.some((s: any) => s.kind === 'Offer')).toBe(true);
    expect((await suggest('hiltn')).suggestions.some((s: any) => /Hilton/.test(s.label))).toBe(true);
    expect((await suggest('free night')).suggestions.some((s: any) => s.kind === 'Certificate')).toBe(true);
    expect((await suggest('riley')).suggestions.some((s: any) => s.kind === 'Household member')).toBe(true);
  });
  it('says how a question is read, before it is asked', async () => {
    const r = await suggest('Costco $1500');
    expect(r.understood).toMatchObject({ intent: 'SHOPPING' });
    expect(r.suggestions[0]).toMatchObject({ type: 'QUERY', query: 'Costco $1500' });
  });
  it('never shows another household’s things', async () => {
    const r = await suggest('hyatt free night', other);
    expect(r.suggestions.some((s: any) => s.kind === 'Certificate' || s.kind === 'Offer' || s.kind === 'Your card')).toBe(false);
    expect((await suggest('riley', other)).suggestions.some((s: any) => s.kind === 'Household member')).toBe(false);
  });
});

describe('TC-SRCH: answers', () => {
  it('"What card should I use at Costco for $1,500?" runs the planner and explains', async () => {
    const r = await ask('What card should I use at Costco for $1,500?');
    expect(r.answer).toMatchObject({ intent: 'SHOPPING', unanswered: false });
    expect(r.answer.summary).toMatch(/Best:/);
    expect(r.answer.confidence).toBeGreaterThan(40);
    expect(r.answer.evidence.length).toBeGreaterThan(0);
    expect(r.answer.related.some((x: any) => x.type === 'CARD' && x.href.startsWith('/wallet/'))).toBe(true);
    expect(r.answer.actions[0].href).toBe('/offers/plan');
    expect(r.answer.understood).toEqual(expect.arrayContaining([{ type: 'merchant', label: 'Costco' }, { type: 'amount', label: '$1,500' }]));
  });
  it('a hotel stay with an amount is planned, with the offer and who should pay', async () => {
    const r = await ask('Hilton stay $1200');
    expect(r.answer.intent).toBe('TRAVEL');
    expect(r.answer.summary).toMatch(/Best:/);
    expect(r.answer.reasoning.join(' ')).toMatch(/Hilton|offer/i);
    expect(r.slots).toMatchObject({ intent: 'TRAVEL', amountCents: 120_000 });
  });
  it('follow-ups keep the context: "What if my spouse pays?" and "It will cost $2,000"', async () => {
    const first = await ask('What card should I use for a Hilton stay?');
    expect(first.slots.intent).not.toBeNull();
    const second = await ask('It will cost $2,000', first.slots);
    expect(second.usedFollowUp).toBe(true);
    expect(second.answer.summary).toMatch(/Best:/);
    expect(second.answer.understood).toEqual(expect.arrayContaining([{ type: 'amount', label: '$2,000' }]));
    const third = await ask('What if my spouse pays?', second.slots);
    expect(third.usedFollowUp).toBe(true);
    expect(third.answer.understood).toEqual(expect.arrayContaining([{ type: 'member', label: 'Riley' }]));
    expect(third.answer.reasoning.join(' ') + third.answer.sections.map((s: any) => s.lines.join(' ')).join(' ')).toMatch(/Riley/);
  });
  it('"Show all Hilton offers" lists the offers with the cardholder and state', async () => {
    const r = await ask('Show all Hilton offers');
    expect(r.answer.intent).toBe('OFFER_SEARCH');
    expect(r.answer.related.some((x: any) => x.type === 'OFFER' && /Hilton/.test(x.title))).toBe(true);
    expect(r.answer.sections[0].lines.join(' ')).toMatch(/Hilton/);
  });
  it('"What offers expire this month?" and "What\'s expiring?" use the expiry engines', async () => {
    const m = await ask('What offers expire this month?');
    expect(m.answer.intent).toBe('EXPIRATION_REVIEW');
    expect(m.answer.summary.length).toBeGreaterThan(5);
    const all = await ask("What's expiring?");
    expect(all.answer.sections.length).toBeGreaterThanOrEqual(1);
  });
  it('certificates, points, 5/24, next card, benefits and annual fees each reach their engine', async () => {
    const cert = await ask('Which free night certificates expire next?');
    expect(cert.answer.intent).toBe('CERTIFICATE_REVIEW');
    expect(cert.answer.related.some((x: any) => x.type === 'CERTIFICATE' && /Hyatt/.test(x.title))).toBe(true);
    expect((await ask('How many points do I have?')).answer.intent).toBe('POINTS_LOOKUP');
    expect((await ask('What is my current 5/24 status?')).answer.summary).toMatch(/5\/24/);
    expect((await ask('What card should I get next?')).answer.intent).toBe('CARD_RECOMMENDATION');
    expect((await ask('Review benefits')).answer.intent).toBe('BENEFIT_LOOKUP');
    expect((await ask('Review annual fees')).answer.intent).toBe('ANNUAL_FEE_REVIEW');
    expect((await ask('Analyze household portfolio')).answer.intent).toBe('PORTFOLIO_REVIEW');
  });
  it('travel without an amount gathers offers, certificates, points and transfer bonuses and asks for the amount', async () => {
    const r = await ask('Hilton Chicago 3 nights');
    expect(r.answer.intent).toBe('TRAVEL');
    expect(r.answer.sections.length).toBeGreaterThanOrEqual(3);
    expect(r.answer.warnings.join(' ')).toMatch(/amount/);
    expect(r.answer.followUps).toContain('Hilton $1,200');
  });
  it('a question it cannot read is not guessed at', async () => {
    const r = await ask('purple monkey');
    expect(r.answer).toMatchObject({ unanswered: true, confidence: 0 });
    expect(r.answer.followUps.length).toBeGreaterThan(2);
    expect(r.slots.intent).toBeNull(); // nothing to remember
  });
  it('is the caller’s own data only', async () => {
    const r = await ask('Show all Hilton offers', undefined, other);
    expect(r.answer.related.filter((x: any) => x.type === 'OFFER')).toEqual([]);
    const c = await ask('Which free night certificates expire next?', undefined, other);
    expect(c.answer.related.filter((x: any) => x.type === 'CERTIFICATE')).toEqual([]);
  });
  it('rejects empty and oversized questions and slots it does not understand', async () => {
    await post('/search/ask', { q: '' }).expect(400);
    await post('/search/ask', { q: 'x'.repeat(301) }).expect(400);
    const r = await ask('How many points do I have?', { intent: 'DROP TABLE', merchant: { name: 5 } });
    expect(r.answer.intent).toBe('POINTS_LOOKUP');
    await api(app).post(V + '/search/ask').send({ q: 'hello' }).expect(401);
  });
});

describe('TC-SRCH: privacy and performance', () => {
  it('answering questions never sends anything to an AI provider', async () => {
    const router = app.get(ModelRouter);
    const seen: ChatRequest[] = [];
    const original = router.factory;
    router.factory = (p) => {
      const inner = defaultProviderFactory(p);
      return { kind: inner.kind, chat: (req: ChatRequest) => (seen.push(JSON.parse(JSON.stringify(req))), inner.chat(req)) };
    };
    try {
      for (const q of ['What card should I use at Costco for $1,500?', 'Hilton stay $1200', 'How many points do I have?', 'What is my current 5/24 status?', 'Which free night certificates expire next?', 'my card is 4111 1111 1111 1111 and email me@example.com, what is my 5/24?']) await ask(q);
      await suggest('hilton');
    } finally {
      router.factory = original;
    }
    expect(seen).toEqual([]);
  });
  it('a repeated question is answered from the cache, and suggestions are quick', async () => {
    const q = 'What card should I use at Costco for $1,500?';
    await ask(q);
    const again = await ask(q);
    expect(again.cached).toBe(true);
    expect(again.tookMs).toBeLessThan(500);
    await suggest('hilton');
    const s = await suggest('hilton');
    expect(s.tookMs).toBeLessThan(500);
    const first = await ask('Show all Hilton offers');
    expect(first.tookMs).toBeLessThan(2000);
  });
  it('a lookup is not a decision: it leaves no recommendation in the audit trail', async () => {
    const before = await prisma.offerEvent.count({ where: { userId, type: 'RECOMMENDED' } });
    await ask('Marriott stay $900');
    await ask('Best card for Disney tickets $400');
    expect(await prisma.offerEvent.count({ where: { userId, type: 'RECOMMENDED' } })).toBe(before);
  });
});

const del = (path: string, t = token) => api(app).delete(V + path).set(bearer(t));
const book = async () => (await get('/search/dashboard').expect(200)).body;

describe('TC-SRCH2: travel', () => {
  it('a flight with dates runs the award planner and says what it assumed', async () => {
    const r = await ask('Flight to Hawaii next month');
    expect(r.answer.intent).toBe('TRAVEL');
    expect(r.answer.title).toBe('Flight to Hawaii');
    expect(r.answer.sections.map((x: any) => x.heading)).toEqual(expect.arrayContaining(['Award options', 'Best card for flights', 'Transfer bonuses']));
    expect(r.answer.warnings.join(' ')).toMatch(/Assumed economy/);
    expect(r.answer.warnings.join(' ')).toMatch(/Assumed a 7-day trip/);
  });
  it('a flight without dates asks for them', async () => {
    const r = await ask('Flight to Hawaii');
    expect(r.answer.warnings.join(' ')).toMatch(/dates/);
    expect(r.answer.followUps).toContain('Hawaii in January');
    expect(r.answer.sections.map((x: any) => x.heading)).not.toContain('Award options');
  });
  it('a family member’s trip shows their points and the household’s', async () => {
    const r = await ask('My son needs a flight to New York');
    expect(r.answer.understood).toEqual(expect.arrayContaining([{ type: 'member', label: 'Sam' }, { type: 'destination', label: 'New York' }]));
    expect(r.answer.sections.map((x: any) => x.heading).join(' ')).toMatch(/Sam/);
  });
});

describe('TC-SRCH2: the conversation is remembered on the server', () => {
  it('a follow-up works with only the conversation id, no slots from the browser', async () => {
    const first = await ask('What card should I use for a Hilton stay?');
    expect(first.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    const second = (await post('/search/ask', { q: 'It will cost $2,500', sessionId: first.sessionId }).expect(201)).body;
    expect(second.sessionId).toBe(first.sessionId);
    expect(second.usedFollowUp).toBe(true);
    expect(second.answer.understood).toEqual(expect.arrayContaining([{ type: 'amount', label: '$2,500' }]));
    const third = (await post('/search/ask', { q: 'What if my spouse pays?', sessionId: second.sessionId }).expect(201)).body;
    expect(third.usedFollowUp).toBe(true);
    expect(third.answer.understood).toEqual(expect.arrayContaining([{ type: 'member', label: 'Riley' }]));
    const row = await prisma.searchSession.findUniqueOrThrow({ where: { id: first.sessionId } });
    expect((row.turns as unknown[]).length).toBe(3);
  });
  it('someone else’s conversation, an unknown one and an idle one are not used', async () => {
    const mine = await ask('What card should I use for a Hilton stay?');
    // another member naming this conversation gets a fresh one and no context
    const theirs = (await post('/search/ask', { q: 'It will cost $2,500', sessionId: mine.sessionId }, other).expect(201)).body;
    expect(theirs.sessionId).not.toBe(mine.sessionId);
    expect(theirs.usedFollowUp).toBe(false);
    const unknown = (await post('/search/ask', { q: 'It will cost $2,500', sessionId: '00000000-0000-4000-8000-000000000000' }).expect(201)).body;
    expect(unknown.usedFollowUp).toBe(false);
    await prisma.searchSession.update({ where: { id: mine.sessionId }, data: { updatedAt: new Date(Date.now() - 2 * DAY) } });
    const idle = (await post('/search/ask', { q: 'It will cost $2,500', sessionId: mine.sessionId }).expect(201)).body;
    expect(idle.usedFollowUp).toBe(false);
    await post('/search/ask', { q: 'hi', sessionId: 'not-a-uuid' }).expect(400);
  });
});

describe('TC-SRCH2: history, saved searches and the dashboard', () => {
  it('counts what was asked, without card numbers or e-mail addresses', async () => {
    const before = (await prisma.searchEntry.findFirst({ where: { userId, query: 'How many points do I have?', kind: 'HISTORY' } }))?.uses ?? 0;
    await ask('How many points do I have?');
    await ask('How many points do I have?');
    await ask('my card is 4111 1111 1111 1111 and email me@example.com, what is my 5/24?');
    const rows = await prisma.searchEntry.findMany({ where: { userId, kind: 'HISTORY' } });
    const points = rows.find((r) => r.query === 'How many points do I have?')!;
    expect(points.uses).toBe(before + 2);
    expect(JSON.stringify(rows)).not.toContain('4111');
    expect(JSON.stringify(rows)).not.toContain('me@example.com');
    expect(rows.some((r) => r.query.includes('[number removed]'))).toBe(true);
    // a question that could not be read is not kept
    await ask('purple monkey');
    expect(await prisma.searchEntry.count({ where: { userId, query: 'purple monkey' } })).toBe(0);
  });
  it('shows most common, recent, favourite merchants and recommendations on the dashboard', async () => {
    await ask('What card should I use at Costco for $1,500?');
    await ask('What card should I use at Costco for $1,500?');
    const d = await book();
    expect(d.mostCommon.map((x: any) => x.query)).toEqual(expect.arrayContaining(['How many points do I have?', 'What card should I use at Costco for $1,500?']));
    expect(d.recent.length).toBeGreaterThan(3);
    expect(d.favoriteMerchants.map((m: any) => m.name)).toContain('Costco');
    expect(d.recentRecommendations.some((x: any) => x.intent === 'SHOPPING')).toBe(true);
    expect(d.recentCards.length).toBeGreaterThan(0);
    expect(d.totals.questions).toBeGreaterThan(5);
    expect(d).toHaveProperty('recentPlans');
    expect(d).toHaveProperty('recentTrips');
  });
  it('saves, lists, checks and removes a search; saved searches lead the empty bar', async () => {
    const saved = (await post('/search/saved', { query: 'What card should I use at Costco for $1,500?', name: 'Costco run' }).expect(201)).body;
    expect(saved).toMatchObject({ kind: 'SAVED', name: 'Costco run', intent: 'SHOPPING' });
    expect((await get('/search/saved').expect(200)).body.map((x: any) => x.id)).toContain(saved.id);
    expect((await get('/search/saved/check?q=' + encodeURIComponent('what card should I use at Costco for $1,500')).expect(200)).body.saved.id).toBe(saved.id);
    const empty = await suggest('');
    expect(empty.suggestions[0]).toMatchObject({ type: 'SAVED', label: 'Costco run', query: 'What card should I use at Costco for $1,500?' });
    expect(empty.suggestions.some((s: any) => s.type === 'RECENT')).toBe(true);
    expect((await get('/search/dashboard').expect(200)).body.saved.map((x: any) => x.id)).toContain(saved.id);
    await del('/search/entries/' + saved.id).expect(204);
    expect((await get('/search/saved').expect(200)).body).toEqual([]);
    await del('/search/entries/' + saved.id).expect(404);
    await post('/search/saved', { query: '' }).expect(400);
  });
  it('is private: another member sees none of it and cannot remove it', async () => {
    const d = (await get('/search/dashboard', other).expect(200)).body;
    const theirs = JSON.stringify(d);
    // the other member asked a couple of questions of their own, but none of mine, and has saved nothing
    expect(theirs).not.toContain('Costco');
    expect(theirs).not.toContain('[number removed]');
    expect(d.saved).toEqual([]);
    const mine = await prisma.searchEntry.findFirstOrThrow({ where: { userId, kind: 'HISTORY' } });
    await del('/search/entries/' + mine.id, other).expect(404);
    expect(await prisma.searchEntry.findUnique({ where: { id: mine.id } })).not.toBeNull();
  });
  it('clearing the history leaves saved searches, and the questions go from the member export', async () => {
    await post('/search/saved', { query: 'Review annual fees' }).expect(201);
    const exp = JSON.parse((await get('/me/data-export').expect(200)).text);
    expect(Object.keys(exp.models)).toContain('SearchEntry');
    expect(exp.models.SearchEntry.some((e: any) => e.query === 'Review annual fees' && e.kind === 'SAVED')).toBe(true);
    expect(Object.keys(exp.models)).not.toContain('SearchSession'); // a conversation's memory is not exported
    const r = (await del('/search/history').expect(200)).body;
    expect(r.removed).toBeGreaterThan(3);
    expect(await prisma.searchEntry.count({ where: { userId, kind: 'HISTORY' } })).toBe(0);
    expect(await prisma.searchEntry.count({ where: { userId, kind: 'SAVED' } })).toBe(1);
  });
  it('keeps history to the newest 200 and saved searches to 50', async () => {
    await prisma.searchEntry.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ userId, query: 'old ' + i, normalized: 'old ' + i, kind: 'HISTORY' as const, lastUsedAt: new Date(Date.now() - (300 - i) * 1000) })) });
    await ask('How many points do I have?');
    expect(await prisma.searchEntry.count({ where: { userId, kind: 'HISTORY' } })).toBe(200);
    await prisma.searchEntry.createMany({ data: Array.from({ length: 49 }, (_, i) => ({ userId, query: 'saved ' + i, normalized: 'saved ' + i, kind: 'SAVED' as const })) });
    await post('/search/saved', { query: 'the fifty-first' }).expect(400);
  });
});

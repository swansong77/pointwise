import { INestApplication } from '@nestjs/common';
import { api, bearer, createApp, login, register } from './helpers';

/** Phase E: streamed assistant answers (SSE) and the admin operations endpoints. */
const V = '/api/v1';
let app: INestApplication;

beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
});

type Ev = { type: string; [k: string]: unknown };
const parseSse = (raw: string): Ev[] =>
  raw
    .split('\n\n')
    .filter((b) => b.trim())
    .map((b) => {
      const ev = /^event: (.+)$/m.exec(b)?.[1];
      const data = JSON.parse(/^data: (.+)$/m.exec(b)?.[1] ?? '{}') as Ev;
      expect(data.type).toBe(ev);
      return data;
    });

const stream = (token: string, body: Record<string, unknown>) =>
  api(app)
    .post(`${V}/ai/chat/stream`)
    .set(bearer(token))
    .send(body)
    .buffer(true)
    .parse((res, cb) => {
      let s = '';
      res.on('data', (c: Buffer) => (s += c.toString()));
      res.on('end', () => cb(null, s));
    });

describe('POST /ai/chat/stream (server-sent events)', () => {
  let token: string;
  beforeAll(async () => {
    token = await login(app, 'family@pointwise.local', 'Family12345!');
    await api(app).put(`${V}/ai/settings`).set(bearer(token)).send({ consent: true }).expect(200);
  });

  it('streams start → tool progress → private answer → done with the full result', async () => {
    const res = await stream(token, { message: 'What is my current 5/24 status?' }).expect(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['cache-control']).toMatch(/no-transform/);
    const events = parseSse(res.body as string);
    expect(events.map((e) => e.type)).toEqual(['start', 'tool', 'tool', 'reset', 'delta', 'done']);
    expect(events[1]).toMatchObject({ name: 'get_five24_status', status: 'running' });
    expect(events[2]).toMatchObject({ name: 'get_five24_status', status: 'done' });
    expect(events[4].text).toContain('Jordan: 5/24');
    const done = events[5].result as { answer: string; private: boolean; conversationId: string };
    expect(done).toMatchObject({ private: true, conversationId: events[0].conversationId });
    expect(done.answer).toBe(events[4].text);
  });

  it('streams a catalog answer from the model word by word', async () => {
    const events = parseSse((await stream(token, { message: 'Compare Contoso Gold versus Northwind Voyager Reserve' }).expect(200)).body as string);
    const deltas = events.filter((e) => e.type === 'delta');
    expect(deltas.length).toBeGreaterThan(3);
    const text = deltas.map((d) => d.text).join('');
    const done = events.at(-1)!;
    expect(done.type).toBe('done');
    expect(text).toBe((done.result as { answer: string }).answer);
  });

  it('reports errors as an error event (consent, validation, auth)', async () => {
    const u = await register(app);
    const events = parseSse((await stream(u.token, { message: 'hi' }).expect(200)).body as string);
    expect(events).toEqual([{ type: 'error', status: 403, message: expect.stringMatching(/Turn on the AI assistant/) }]);
    await stream(token, { message: '' }).expect(400);
    await api(app).post(`${V}/ai/chat/stream`).send({ message: 'hi' }).expect(401);
  });
});

describe('admin operations', () => {
  it('health: dependencies, queue, schedulers, AI models, MCP and card sources', async () => {
    const admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
    const h = await api(app).get(`${V}/admin/ops/health`).set(bearer(admin)).expect(200);
    expect(['ok', 'degraded']).toContain(h.body.status);
    expect(h.body.dependencies).toMatchObject({ database: { ok: true }, redis: { ok: true } });
    expect(h.body.queue.counts).toEqual(expect.objectContaining({ waiting: expect.any(Number), failed: expect.any(Number) }));
    expect(Array.isArray(h.body.queue.schedulers)).toBe(true);
    expect(h.body.ai.models.length).toBeGreaterThan(0);
    expect(h.body.ai.models[0]).toEqual(expect.objectContaining({ circuit: expect.stringMatching(/OPEN|CLOSED/), requests24h: expect.any(Number) }));
    expect(h.body.process).toEqual(expect.objectContaining({ uptimeSec: expect.any(Number), node: expect.stringMatching(/^v/) }));
    expect(JSON.stringify(h.body)).not.toMatch(/apiKeyEnc|password/i);
    const logs = await api(app).get(`${V}/admin/ops/logs`).query({ limit: 20 }).set(bearer(admin)).expect(200);
    expect(logs.body.length).toBeLessThanOrEqual(20);
    for (const e of logs.body) expect(['error', 'warn', 'info']).toContain(e.level);
    await api(app).get(`${V}/admin/ops/logs`).query({ limit: 0 }).set(bearer(admin)).expect(400);
  });

  it('is admin-only', async () => {
    const u = await register(app);
    await api(app).get(`${V}/admin/ops/health`).set(bearer(u.token)).expect(403);
    await api(app).get(`${V}/admin/ops/logs`).expect(401);
  });
});

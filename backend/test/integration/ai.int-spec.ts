import { INestApplication } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PrismaClient } from '@prisma/client';
import { AddressInfo } from 'net';
import { api, bearer, createApp, login, register } from './helpers';
import { ModelRouter } from '../../src/ai/router';
import { defaultProviderFactory } from '../../src/ai/providers';
import { ChatRequest } from '../../src/ai/types';

/** AI platform: consent, agent runtime with Pointwise tools (offline demo model), actions, admin, MCP. */
const V = '/api/v1';
let app: INestApplication;
let baseUrl: string;
const prisma = new PrismaClient();
const DAY = 86_400_000;

beforeAll(async () => {
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const consent = (token: string) => api(app).put(`${V}/ai/settings`).set(bearer(token)).send({ consent: true }).expect(200);
const chat = (token: string, message: string, extra: Record<string, unknown> = {}) => api(app).post(`${V}/ai/chat`).set(bearer(token)).send({ message, ...extra });
const cardId = async (slug: string) => (await prisma.creditCard.findUniqueOrThrow({ where: { slug } })).id;

describe('consent, models and agents', () => {
  it('requires consent before any data goes to a model', async () => {
    const u = await register(app);
    const t = bearer(u.token);
    await chat(u.token, 'What is my current 5/24 status?').expect(403);
    const s = await api(app).get(`${V}/ai/settings`).set(t).expect(200);
    expect(s.body).toMatchObject({ consented: false, monthTokens: 0 });
    expect((await consent(u.token)).body.consented).toBe(true);
    const models = await api(app).get(`${V}/ai/models`).set(t).expect(200);
    // no provider keys in tests → only the offline demo model is usable
    expect(models.body).toEqual([expect.objectContaining({ displayName: 'Demo model (offline, no AI)', demo: true, providerKind: 'MOCK' })]);
    const agents = await api(app).get(`${V}/ai/agents`).set(t).expect(200);
    // the list has no guaranteed order, so compare as a set
    expect(agents.body.map((a: { key: string }) => a.key).sort()).toEqual(
      [
        'assistant',
        'card-strategy',
        'five24-planning',
        'travel-rewards',
        'benefit-utilization',
        'application-timing',
        'annual-fee-review',
        'family-portfolio',
        'offer-monitoring',
        'spending',
        'card-comparison',
        'portfolio-review',
        'offer-discovery',
        'merchant-intelligence',
        'reward-optimization',
        'travel-offer',
        'shopping-offer',
        'family-optimization',
        'offer-audit',
      ].sort(),
    );
    await api(app).put(`${V}/ai/settings`).set(t).send({ preferredModelId: '00000000-0000-4000-8000-000000000000' }).expect(404);
    await api(app).put(`${V}/ai/settings`).set(t).send({ preferredModelId: models.body[0].id }).expect(200);
    await api(app).put(`${V}/ai/settings`).set(t).send({ consent: false }).expect(200);
    await chat(u.token, 'hi').expect(403);
  });
});

describe('assistant answers the spec questions from Pointwise data (family account)', () => {
  let token: string;
  beforeAll(async () => {
    token = await login(app, 'family@pointwise.local', 'Family12345!');
    await consent(token);
  });

  it('"What is my current 5/24 status?" → tool call + grounded answer, conversation stored', async () => {
    const r = await chat(token, 'What is my current 5/24 status?').expect(200);
    expect(r.body.trace).toEqual([expect.objectContaining({ tool: 'get_five24_status', ok: true })]);
    expect(r.body.answer).toContain('Jordan: 5/24');
    expect(r.body.answer).toContain('Riley: 3/24 (under 5/24)');
    expect(r.body.model).toMatchObject({ demo: true });
    expect(r.body.disclaimer).toMatch(/not financial advice/);
    const conv = await api(app).get(`${V}/ai/conversations/${r.body.conversationId}`).set(bearer(token)).expect(200);
    expect(conv.body.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(JSON.stringify(conv.body)).not.toContain('"native"');
    // follow-up in the same conversation
    const r2 = await chat(token, 'Which family member should apply next?', { conversationId: r.body.conversationId }).expect(200);
    expect(r2.body.conversationId).toBe(r.body.conversationId);
  });

  it.each([
    ['What benefits expire in the next 30 days?', 'get_benefit_summary', /Benefits: \$/],
    ['What benefits have I not used this year?', 'get_benefit_summary', /Available:/],
    ['Which card should I use at Costco?', 'best_card_for', /Best for/],
    ['What cards should I cancel?', 'get_renewals', /.+/],
    ['What card should I open next?', 'recommend_next_card', /first-year value ~\$[\d,]+, then ~-?\$[\d,]+\/yr/],
    ['Who should apply for Northwind ShopNow Card?', 'recommend_next_card', /^Riley should apply for Northwind ShopNow Card/],
    ['What card should I open next for Riley?', 'recommend_next_card', /^Top cards for Riley \(3\/24\)/],
    ['How do I book an award of 60,000 points on SkyHigh?', 'plan_award', /^Covered: use 12,500 SKYHIGH from Jordan/],
    ['Show transfer partners for CONTOSO_PTS', 'get_transfer_partners', /Contoso Points → AeroLink Rewards: 1\.3:1/],
    ['Does the Northwind Voyager Reserve include lounge access?', 'search_card_terms', /Northwind Voyager Reserve \(feature\): "Airport lounge access"/],
    ['How much value have I received from my cards?', 'get_portfolio_value', /Household: fees/],
    ['Compare Contoso Gold versus Northwind Voyager Reserve', 'compare_cards', /Contoso Gold: fee \$250.*Northwind Voyager Reserve: fee \$550/],
    ['Compare Contoso Gold versus Imaginary Card', 'compare_cards', /Not in the catalog: Imaginary Card/],
    ['Tell me about my Contoso Gold card', 'get_card_details', /Contoso Gold: fee \$250; 2 tracked benefits/],
    ['Tell me about my Unicorn card', 'get_card_details', /No card matching/],
    ['Best transfer partners for my points?', 'get_transfer_options', /Best use: AeroLink Rewards/],
    ['What are my point valuations?', 'get_point_valuations', /¢\/pt/],
    ['Any offer this week?', 'get_offers', /.+/],
  ])('%s', async (q, tool, re) => {
    const r = await chat(token, q).expect(200);
    expect(r.body.trace[0]).toMatchObject({ tool });
    expect(r.body.answer).toMatch(re);
  });

  it('task endpoints route to the right agent; unknown task 404', async () => {
    const r = await api(app).post(`${V}/ai/recommend`).set(bearer(token)).send({}).expect(200);
    expect(r.body.agent).toBe('card-strategy');
    const p = await api(app).post(`${V}/ai/portfolio-review`).set(bearer(token)).send({ message: 'Show my household' }).expect(200);
    expect(p.body.agent).toBe('family-portfolio');
    expect(p.body.trace[0].tool).toBe('get_household');
    await api(app).post(`${V}/ai/does-not-exist`).set(bearer(token)).send({}).expect(404);
    await chat(token, 'hi', { agent: 'nope' }).expect(404);
    await chat(token, '').expect(400);
  });

  it('usage is recorded per request', async () => {
    const u = await api(app).get(`${V}/ai/usage`).set(bearer(token)).expect(200);
    expect(u.body.monthRequests).toBeGreaterThan(5);
    expect(u.body.monthTokens).toBeGreaterThan(0);
    expect((await api(app).get(`${V}/ai/conversations`).set(bearer(token)).expect(200)).body.length).toBeGreaterThan(0);
  });

  it('spec alias routes', async () => {
    expect((await api(app).get(`${V}/524-status`).set(bearer(token)).expect(200)).body.members).toHaveLength(3);
    expect((await api(app).get(`${V}/family-dashboard`).set(bearer(token)).expect(200)).body.household.name).toBe('The Rivera household');
  });
});

describe('privacy boundary: no user card data is sent to an AI provider', () => {
  it('captures every provider request across user-data and catalog questions — none contains household data', async () => {
    const token = await login(app, 'family@pointwise.local', 'Family12345!');
    await consent(token);
    const router = app.get(ModelRouter);
    const seen: ChatRequest[] = [];
    const original = router.factory;
    router.factory = (p) => {
      const inner = defaultProviderFactory(p);
      return { kind: inner.kind, chat: (req: ChatRequest) => (seen.push(JSON.parse(JSON.stringify(req))), inner.chat(req)) };
    };
    try {
      const a = await chat(token, 'What is my current 5/24 status?').expect(200);
      expect(a.body).toMatchObject({ private: true });
      expect(a.body.answer).toContain('Jordan: 5/24'); // the user sees it…
      await chat(token, 'What benefits have I not used this year?', { conversationId: a.body.conversationId }).expect(200);
      await chat(token, 'How much value have I received from my cards?', { conversationId: a.body.conversationId }).expect(200);
      await chat(token, 'Show my household', { conversationId: a.body.conversationId }).expect(200);
      expect((await chat(token, 'Who should apply for Northwind ShopNow Card?', { conversationId: a.body.conversationId }).expect(200)).body).toMatchObject({ private: true });
      await chat(token, 'Best transfer partners for my points?', { conversationId: a.body.conversationId }).expect(200);
      await chat(token, 'How do I book an award of 60,000 points on SkyHigh?', { conversationId: a.body.conversationId }).expect(200);
      expect((await chat(token, 'Show transfer partners for CONTOSO_PTS', { conversationId: a.body.conversationId }).expect(200)).body).toMatchObject({ private: false });
      const pub = await chat(token, 'Compare Contoso Gold versus Northwind Voyager Reserve', { conversationId: a.body.conversationId }).expect(200);
      expect(pub.body).toMatchObject({ private: false });
      await chat(token, 'my card is 4111 1111 1111 1111, email jordan@example.com — what is my 5/24?', { conversationId: a.body.conversationId }).expect(200);
    } finally {
      router.factory = original;
    }
    const sent = JSON.stringify(seen);
    expect(seen.length).toBeGreaterThan(6);
    // …but the provider never does
    for (const secret of ['Jordan', 'Riley', 'Sam (', 'Rivera', '5/24 (', 'Train tickets', 'effective value $', '4111', 'jordan@example.com', '7001', '31005', '85,000', '64,000', '12,500', 'first-year ~']) {
      expect(sent).not.toContain(secret);
    }
    // public catalog results may be sent
    expect(sent).toContain('Contoso Gold: fee $250');
    // MCP-style user tools never return results to the model
    expect(seen.every((r) => r.messages.every((m) => m.role !== 'tool' || m.results.every((x) => ['search_card_catalog', 'compare_cards', 'get_transfer_partners', 'search_card_terms'].includes(x.name) || x.name.startsWith('mcp_'))))).toBe(true);
  });
});

describe('write actions need user confirmation', () => {
  it('logging benefit usage creates a pending action; confirm executes once; others cannot touch it', async () => {
    const u = await register(app);
    await api(app).post(`${V}/subscription/checkout`).set(bearer(u.token)).send({ interval: 'month' }).expect(201);
    const opened = new Date(Date.now() - 100 * DAY).toISOString().slice(0, 10);
    await api(app).post(`${V}/wallet/cards`).set(bearer(u.token)).send({ cardId: await cardId('northwind-voyager-reserve'), approvedAt: opened }).expect(201);
    await consent(u.token);
    const r = await chat(u.token, 'Log $5 of my Dining credit').expect(200);
    expect(r.body.pendingActions).toHaveLength(1);
    expect(r.body.pendingActions[0].summary).toMatch(/Log \$5 used on "Dining credit"/);
    const before = (await api(app).get(`${V}/benefits`).set(bearer(u.token))).body.find((b: { name: string }) => b.name === 'Dining credit');
    expect(before.currentPeriod.usedCents).toBe(0); // nothing happened yet
    expect((await api(app).get(`${V}/ai/actions`).set(bearer(u.token)).expect(200)).body).toHaveLength(1);

    const other = await register(app);
    await api(app).post(`${V}/ai/actions/${r.body.pendingActions[0].id}/confirm`).set(bearer(other.token)).expect(404);

    const c = await api(app).post(`${V}/ai/actions/${r.body.pendingActions[0].id}/confirm`).set(bearer(u.token)).expect(200);
    expect(c.body.summary).toMatch(/Logged \$5 on Dining credit/);
    await api(app).post(`${V}/ai/actions/${r.body.pendingActions[0].id}/confirm`).set(bearer(u.token)).expect(409);
    const after = (await api(app).get(`${V}/benefits`).set(bearer(u.token))).body.find((b: { name: string }) => b.name === 'Dining credit');
    expect(after.currentPeriod.usedCents).toBe(500);

    const r2 = await chat(u.token, 'Log $3 of my Dining credit').expect(200);
    const rej = await api(app).post(`${V}/ai/actions/${r2.body.pendingActions[0].id}/reject`).set(bearer(u.token)).expect(200);
    expect(rej.body.status).toBe('REJECTED');
  });
});

describe('limits and isolation', () => {
  it('monthly token budget, conversation IDOR, deletion', async () => {
    const u = await register(app);
    await consent(u.token);
    const r = await chat(u.token, 'What is my current 5/24 status?').expect(200);
    const other = await register(app);
    await consent(other.token);
    await api(app).get(`${V}/ai/conversations/${r.body.conversationId}`).set(bearer(other.token)).expect(404);
    await chat(other.token, 'hi', { conversationId: r.body.conversationId }).expect(404);
    await api(app).delete(`${V}/ai/conversations/${r.body.conversationId}`).set(bearer(other.token)).expect(404);
    await api(app).delete(`${V}/ai/conversations/${r.body.conversationId}`).set(bearer(u.token)).expect(204);
    await prisma.aiSettings.update({ where: { userId: u.userId }, data: { monthlyTokenBudget: 1 } });
    await chat(u.token, 'What is my current 5/24 status?').expect(429);
  });
});

describe('admin: providers, models, agents, usage', () => {
  let admin: string;
  beforeAll(async () => {
    admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
  });

  it('non-admins are refused', async () => {
    const u = await register(app);
    await api(app).get(`${V}/admin/ai/providers`).set(bearer(u.token)).expect(403);
    await api(app).get(`${V}/admin/mcp/servers`).set(bearer(u.token)).expect(403);
  });

  it('API keys are write-only and encrypted; providers/models CRUD; test call', async () => {
    const list = await api(app).get(`${V}/admin/ai/providers`).set(bearer(admin)).expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(10);
    expect(JSON.stringify(list.body)).not.toContain('apiKeyEnc');
    const p = await api(app).post(`${V}/admin/ai/providers`).set(bearer(admin)).send({ name: `Test provider ${Date.now()}`, kind: 'OPENAI_COMPATIBLE', baseUrl: 'https://llm.example.com/v1' }).expect(201);
    await api(app).put(`${V}/admin/ai/providers/${p.body.id}/key`).set(bearer(admin)).send({ apiKey: 'sk-test-secret-123456' }).expect(204);
    const row = await prisma.aiProvider.findUniqueOrThrow({ where: { id: p.body.id } });
    expect(row.apiKeyEnc).toMatch(/^v1\./);
    expect(row.apiKeyEnc).not.toContain('sk-test-secret');
    const again = await api(app).get(`${V}/admin/ai/providers`).set(bearer(admin)).expect(200);
    const mine = again.body.find((x: { id: string }) => x.id === p.body.id);
    expect(mine).toMatchObject({ hasStoredKey: true, usable: false }); // disabled until enabled
    expect(JSON.stringify(again.body)).not.toContain('sk-test-secret');
    const audit = await prisma.auditLog.findMany({ where: { entityId: p.body.id } });
    expect(JSON.stringify(audit)).not.toContain('sk-test-secret');
    await api(app).post(`${V}/admin/ai/providers`).set(bearer(admin)).send({ name: 'x', kind: 'NOPE' }).expect(400);

    const m = await api(app)
      .post(`${V}/admin/ai/models`)
      .set(bearer(admin))
      .send({ providerId: p.body.id, modelId: 'test-model', displayName: 'Test model', inputPrice: 1, outputPrice: 2, capabilities: ['tools'] })
      .expect(201);
    await api(app).post(`${V}/admin/ai/models`).set(bearer(admin)).send({ providerId: p.body.id, modelId: 'x', displayName: 'x', capabilities: ['telepathy'] }).expect(400);
    await api(app).patch(`${V}/admin/ai/models/${m.body.id}`).set(bearer(admin)).send({ displayName: 'Renamed' }).expect(200);
    await api(app).post(`${V}/admin/ai/models/${m.body.id}/test`).set(bearer(admin)).expect(400); // provider disabled
    const demo = (await api(app).get(`${V}/admin/ai/models`).set(bearer(admin))).body.find((x: { modelId: string }) => x.modelId === 'pointwise-demo');
    const t = await api(app).post(`${V}/admin/ai/models/${demo.id}/test`).set(bearer(admin)).expect(200);
    expect(t.body.ok).toBe(true);
    await api(app).delete(`${V}/admin/ai/models/${m.body.id}`).set(bearer(admin)).expect(204);
    await api(app).delete(`${V}/admin/ai/providers/${p.body.id}/key`).set(bearer(admin)).expect(204);
    await api(app).delete(`${V}/admin/ai/providers/${p.body.id}`).set(bearer(admin)).expect(204);
    await api(app).delete(`${V}/admin/ai/providers/${p.body.id}`).set(bearer(admin)).expect(404);
  });

  it('agent updates are validated', async () => {
    const agents = await api(app).get(`${V}/admin/ai/agents`).set(bearer(admin)).expect(200);
    expect(agents.body).toHaveLength(19);
    await api(app).patch(`${V}/admin/ai/agents/offer-monitoring`).set(bearer(admin)).send({ tools: ['rm_rf'] }).expect(400);
    await api(app).patch(`${V}/admin/ai/agents/offer-monitoring`).set(bearer(admin)).send({ modelChain: ['00000000-0000-4000-8000-000000000000'] }).expect(400);
    await api(app).patch(`${V}/admin/ai/agents/offer-monitoring`).set(bearer(admin)).send({ maxSteps: 99 }).expect(400);
    await api(app).patch(`${V}/admin/ai/agents/nope`).set(bearer(admin)).send({ enabled: true }).expect(404);
    const ok = await api(app).patch(`${V}/admin/ai/agents/offer-monitoring`).set(bearer(admin)).send({ maxSteps: 4, effort: 'low' }).expect(200);
    expect(ok.body).toMatchObject({ maxSteps: 4, effort: 'low' });
    expect((await api(app).get(`${V}/admin/ai/tools`).set(bearer(admin)).expect(200)).body.find((x: { name: string }) => x.name === 'log_benefit_usage')).toMatchObject({ readOnly: false, requiresConfirmation: true });
  });

  it('usage and cost tracking', async () => {
    const u = await api(app).get(`${V}/admin/ai/usage?days=7`).set(bearer(admin)).expect(200);
    expect(u.body.totals.requests).toBeGreaterThan(0);
    expect(u.body.byModel.length).toBeGreaterThan(0);
    expect(u.body.byAgent.map((a: { agent: string }) => a.agent)).toContain('assistant');
    expect(u.body.daily.length).toBeGreaterThan(0);
  });
});

describe('Pointwise MCP server + admin MCP registry', () => {
  let familyPat: string;
  let tokenId: string;
  let familyToken: string;

  const mcpClient = async (token?: string) => {
    const client = new Client({ name: 'test', version: '1' });
    const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} } });
    await client.connect(transport);
    return client;
  };

  beforeAll(async () => {
    familyToken = await login(app, 'family@pointwise.local', 'Family12345!');
    const t = await api(app).post(`${V}/me/tokens`).set(bearer(familyToken)).send({ name: 'Claude desktop', expiresInDays: 30 }).expect(201);
    familyPat = t.body.token;
    tokenId = t.body.id;
    expect(familyPat).toMatch(/^pw_pat_/);
  });

  it('exposes only public catalog tools — no user card data reaches the AI app', async () => {
    const client = await mcpClient(familyPat);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['compare_cards', 'get_card_offer_history', 'get_transfer_partners', 'search_card_catalog', 'search_card_terms']);
    const r = await client.callTool({ name: 'search_card_catalog', arguments: { query: 'Contoso' } });
    expect((r.content as Array<{ text: string }>)[0].text).toContain('Contoso Gold');
    expect((r.content as Array<{ text: string }>)[0].text).not.toContain('already held');
    const blocked = await client.callTool({ name: 'get_five24_status', arguments: {} });
    expect(blocked.isError).toBe(true);
    expect(JSON.stringify(blocked)).not.toContain('Jordan');
    await client.close();
    const list = await api(app).get(`${V}/me/tokens`).set(bearer(familyToken)).expect(200);
    expect(list.body[0]).toMatchObject({ name: 'Claude desktop', scopes: ['mcp:read'] });
    expect(JSON.stringify(list.body)).not.toContain(familyPat);
  });

  it('rejects missing, wrong and access-JWT credentials', async () => {
    const res = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
    const jwt = await fetch(`${baseUrl}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${familyToken}`, 'Content-Type': 'application/json' }, body: '{}' });
    expect(jwt.status).toBe(401); // session JWTs are not MCP tokens
    await expect(mcpClient('pw_pat_wrong')).rejects.toThrow();
  });

  it('admin registers it as an external MCP server: health, tool discovery, approval, agent attach', async () => {
    const admin = await login(app, 'admin@pointwise.local', 'Admin12345!');
    await api(app).post(`${V}/admin/mcp/servers`).set(bearer(admin)).send({ name: 'evil', url: 'http://evil.example.com/mcp' }).expect(400);
    await api(app).post(`${V}/admin/mcp/servers`).set(bearer(admin)).send({ name: 'meta', url: 'https://169.254.169.254/mcp' }).expect(400);
    const name = `self${Date.now() % 100000}`;
    const s = await api(app).post(`${V}/admin/mcp/servers`).set(bearer(admin)).send({ name, url: `${baseUrl}/mcp`, authType: 'BEARER', authSecret: familyPat, status: 'ACTIVE' }).expect(201);
    expect(JSON.stringify(s.body)).not.toContain(familyPat);
    const check = await api(app).post(`${V}/admin/mcp/servers/${s.body.id}/check`).set(bearer(admin)).expect(200);
    expect(check.body.health).toBe('UP');
    const servers = await api(app).get(`${V}/admin/mcp/servers`).set(bearer(admin)).expect(200);
    const server = servers.body.find((x: { id: string }) => x.id === s.body.id);
    expect(server).toMatchObject({ health: 'UP', hasSecret: true });
    const tool = server.tools.find((t: { name: string }) => t.name === 'search_card_catalog');
    expect(tool).toMatchObject({ enabled: false, approved: false, readOnly: true });
    await api(app).patch(`${V}/admin/mcp/tools/${tool.id}`).set(bearer(admin)).send({ approve: true, enabled: true }).expect(200);
    await api(app).patch(`${V}/admin/ai/agents/family-portfolio`).set(bearer(admin)).send({ mcpToolIds: [tool.id] }).expect(200);
    const agent = (await api(app).get(`${V}/admin/ai/agents`).set(bearer(admin))).body.find((a: { key: string }) => a.key === 'family-portfolio');
    expect(agent.mcpToolIds).toEqual([tool.id]);
    // a definition change invalidates the approval
    await prisma.mcpTool.update({ where: { id: tool.id }, data: { descriptionHash: 'changed' } });
    const after = (await api(app).get(`${V}/admin/mcp/servers`).set(bearer(admin))).body.find((x: { id: string }) => x.id === s.body.id);
    expect(after.tools.find((t: { id: string }) => t.id === tool.id)).toMatchObject({ approved: false, changedSinceApproval: true });
    // write tools cannot be attached
    await prisma.mcpTool.update({ where: { id: tool.id }, data: { readOnly: false } });
    await api(app).patch(`${V}/admin/ai/agents/family-portfolio`).set(bearer(admin)).send({ mcpToolIds: [tool.id] }).expect(400);
    await api(app).patch(`${V}/admin/ai/agents/family-portfolio`).set(bearer(admin)).send({ mcpToolIds: [] }).expect(200);
    await api(app).patch(`${V}/admin/mcp/servers/${s.body.id}`).set(bearer(admin)).send({ status: 'DISABLED' }).expect(200);
    await api(app).delete(`${V}/admin/mcp/servers/${s.body.id}`).set(bearer(admin)).expect(204);
    // health job runs
    await api(app).post(`${V}/admin/jobs/check-mcp-servers/run`).set(bearer(admin)).expect(201);
  });

  it('revoked tokens stop working', async () => {
    await api(app).delete(`${V}/me/tokens/${tokenId}`).set(bearer(familyToken)).expect(204);
    await expect(mcpClient(familyPat)).rejects.toThrow();
    await api(app).delete(`${V}/me/tokens/${tokenId}`).set(bearer(familyToken)).expect(404);
  });
});

import Anthropic from '@anthropic-ai/sdk';
import { ApiError } from '@google/genai';
import OpenAI from 'openai';
import { AnthropicProvider } from '../../../src/ai/providers/anthropic';
import { GeminiProvider } from '../../../src/ai/providers/gemini';
import { MockProvider } from '../../../src/ai/providers/mock';
import { OpenAiProvider } from '../../../src/ai/providers/openai';
import { defaultProviderFactory, isUsable, resolveApiKey } from '../../../src/ai/providers';
import { ChatMessage, ChatRequest, isRetryableStatus, ProviderError, safeParseArgs, zeroUsage } from '../../../src/ai/types';
import { encryptSecret } from '../../../src/common/crypto';

const tools = [{ name: 'get_five24_status', description: 'd', inputSchema: { type: 'object' as const, properties: { member: { type: 'string' } } } }];
const history: ChatMessage[] = [
  { role: 'user', text: 'What is my 5/24?' },
  { role: 'assistant', text: 'Checking', toolCalls: [{ id: 't1', name: 'get_five24_status', input: {} }] },
  { role: 'tool', results: [{ toolCallId: 't1', name: 'get_five24_status', content: '{"summary":"4/24"}' }, { toolCallId: 't2', name: 'x', content: 'boom', isError: true }] },
];
const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({ model: 'm', system: 'sys', messages: history, tools, maxTokens: 1000, ...over });

describe('types helpers', () => {
  it('retryable statuses', () => {
    expect([undefined, 408, 409, 429, 500, 503].map(isRetryableStatus)).toEqual([true, true, true, true, true, true]);
    expect([400, 401, 403, 404, 422].map(isRetryableStatus)).toEqual([false, false, false, false, false]);
  });
  it('safeParseArgs', () => {
    expect(safeParseArgs('{"a":1}')).toEqual({ a: 1 });
    expect(safeParseArgs({ b: 2 })).toEqual({ b: 2 });
    expect(safeParseArgs('[1]')).toEqual({});
    expect(safeParseArgs('not json')).toEqual({});
    expect(safeParseArgs('')).toEqual({});
    expect(safeParseArgs(null)).toEqual({});
    expect(zeroUsage()).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});

describe('AnthropicProvider', () => {
  const make = (response: unknown, err?: unknown) => {
    const create = jest.fn(async () => {
      if (err) throw err;
      return response;
    });
    const client = { beta: { messages: { create } } } as unknown as Anthropic;
    return { p: new AnthropicProvider({ apiKey: 'k', client }), create };
  };

  it('maps messages, tools, effort, caching and fallbacks; parses tool use and usage', async () => {
    const { p, create } = make({
      model: 'claude-opus-5-5',
      stop_reason: 'tool_use',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Let me check.' }, { type: 'tool_use', id: 'tu1', name: 'get_five24_status', input: { member: 'Jordan' } }],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80, cache_creation_input_tokens: 5 },
    });
    const r = await p.chat(req({ model: 'claude-opus-5-5', effort: 'medium', capabilities: ['effort', 'fallbacks'] }));
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).toMatchObject({
      model: 'claude-opus-5-5',
      max_tokens: 1000,
      output_config: { effort: 'medium' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: 'sys', cache_control: { type: 'ephemeral' } }],
    });
    expect((params.tools as unknown[])[0]).toEqual({ name: 'get_five24_status', description: 'd', input_schema: tools[0].inputSchema });
    expect(params.tool_choice).toBeUndefined(); // never forced (400 on Opus 5.5 / Sonnet 5.5)
    const msgs = params.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[1].content).toEqual([{ type: 'text', text: 'Checking' }, { type: 'tool_use', id: 't1', name: 'get_five24_status', input: {} }]);
    expect(msgs[2].content).toEqual([
      { type: 'tool_result', tool_use_id: 't1', content: '{"summary":"4/24"}' },
      { type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true },
    ]);
    expect(r).toMatchObject({ text: 'Let me check.', stopReason: 'tool_use', toolCalls: [{ id: 'tu1', name: 'get_five24_status', input: { member: 'Jordan' } }], usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 5 }, servedModel: 'claude-opus-5-5' });
    expect(r.native?.provider).toBe('ANTHROPIC');
  });

  it('omits effort/fallbacks without the capability and replays native content for the same model', async () => {
    const { p, create } = make({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 } });
    const native = [{ type: 'thinking', thinking: 'x', signature: 's' }, { type: 'tool_use', id: 't1', name: 'get_five24_status', input: {} }];
    const msgs: ChatMessage[] = [history[0], { ...(history[1] as Extract<ChatMessage, { role: 'assistant' }>), native: { provider: 'ANTHROPIC', model: 'claude-haiku-5-5', content: native } }, history[2]];
    const r = await p.chat(req({ model: 'claude-haiku-5-5', messages: msgs, effort: 'low', tools: [] }));
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params.output_config).toBeUndefined();
    expect(params.fallbacks).toBeUndefined();
    expect(params.tools).toBeUndefined();
    expect((params.messages as Array<{ content: unknown }>)[1].content).toBe(native);
    expect(r).toMatchObject({ stopReason: 'end', usage: { cacheReadTokens: 0, cacheWriteTokens: 0 } });
  });

  it.each([
    ['max_tokens', 'max_tokens'],
    ['refusal', 'refusal'],
    ['pause_turn', 'pause'],
    ['stop_sequence', 'other'],
  ])('stop reason %s → %s', async (sr, mapped) => {
    const { p } = make({ model: 'm', stop_reason: sr, content: [], usage: { input_tokens: 0, output_tokens: 0 } });
    expect((await p.chat(req({ tools: [] }))).stopReason).toBe(mapped);
  });

  it('assistant turns without text or tools get a placeholder block', () => {
    const m = AnthropicProvider.toMessages([{ role: 'user', text: 'a' }, { role: 'assistant', text: '', toolCalls: [] }], 'x');
    expect(m[1].content).toEqual([{ type: 'text', text: '…' }]);
  });

  it('maps SDK errors to retryable / non-retryable ProviderErrors', async () => {
    const headers = new Headers();
    const rate = new Anthropic.RateLimitError(429, { error: {} }, 'slow down', headers);
    const bad = new Anthropic.BadRequestError(400, { error: {} }, 'bad', headers);
    const conn = new Anthropic.APIConnectionError({ message: 'offline' });
    await expect(make(null, rate).p.chat(req())).rejects.toMatchObject({ retryable: true, status: 429, code: 'http_429' });
    await expect(make(null, bad).p.chat(req())).rejects.toMatchObject({ retryable: false, status: 400 });
    await expect(make(null, conn).p.chat(req())).rejects.toMatchObject({ retryable: true, code: 'connection' });
    await expect(make(null, new Error('weird')).p.chat(req())).rejects.toBeInstanceOf(ProviderError);
  });
});

describe('OpenAiProvider (OpenAI, Azure, compatible, Ollama)', () => {
  const make = (kind: 'OPENAI' | 'OPENAI_COMPATIBLE', response: unknown, err?: unknown) => {
    const create = jest.fn(async () => {
      if (err) throw err;
      return response;
    });
    const client = { chat: { completions: { create } } } as unknown as OpenAI;
    return { p: new OpenAiProvider(kind, { client }), create };
  };
  const completion = (message: object, finish: string) => ({ model: 'gpt', choices: [{ message, finish_reason: finish }], usage: { prompt_tokens: 50, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 30 } } });

  it('first-party: system message, function tools, max_completion_tokens, reasoning_effort, tool calls', async () => {
    const { p, create } = make('OPENAI', completion({ content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_five24_status', arguments: '{"member":"Riley"}' } }] }, 'tool_calls'));
    const r = await p.chat(req({ effort: 'high', capabilities: ['effort'] }));
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).toMatchObject({ max_completion_tokens: 1000, reasoning_effort: 'high' });
    const msgs = params.messages as Array<Record<string, unknown>>;
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' });
    expect(msgs[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_five24_status', arguments: '{}' } }] });
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 't1', content: '{"summary":"4/24"}' });
    expect(msgs[4]).toEqual({ role: 'tool', tool_call_id: 't2', content: 'ERROR: boom' });
    expect(r).toMatchObject({ stopReason: 'tool_use', toolCalls: [{ id: 'c1', input: { member: 'Riley' } }], usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 30 } });
  });

  it('compatible servers get max_tokens and no reasoning_effort; finish reasons map', async () => {
    const { p, create } = make('OPENAI_COMPATIBLE', completion({ content: 'hello' }, 'stop'));
    const r = await p.chat(req({ tools: [], effort: 'high', capabilities: [] }));
    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).toMatchObject({ max_tokens: 1000 });
    expect(params.reasoning_effort).toBeUndefined();
    expect(params.tools).toBeUndefined();
    expect(r).toMatchObject({ text: 'hello', stopReason: 'end' });
    expect((await make('OPENAI', completion({ content: 'x' }, 'length')).p.chat(req())).stopReason).toBe('max_tokens');
    expect(await make('OPENAI', completion({ content: null, refusal: 'no' }, 'content_filter')).p.chat(req())).toMatchObject({ stopReason: 'refusal', text: 'no' });
    expect(await make('OPENAI', { model: 'g', choices: [] }).p.chat(req())).toMatchObject({ stopReason: 'other', text: '', usage: { inputTokens: 0 } });
  });

  it('maps errors', async () => {
    const err = new OpenAI.APIError(503, { message: 'down' }, 'down', new Headers());
    await expect(make('OPENAI', null, err).p.chat(req())).rejects.toMatchObject({ retryable: true, status: 503 });
    await expect(make('OPENAI', null, new OpenAI.APIConnectionError({ message: 'x' })).p.chat(req())).rejects.toMatchObject({ code: 'connection' });
    await expect(make('OPENAI', null, new Error('?')).p.chat(req())).rejects.toMatchObject({ code: 'unknown' });
  });

  it('constructs real clients for each kind', () => {
    expect(new OpenAiProvider('OLLAMA', {}).kind).toBe('OLLAMA');
    expect(new OpenAiProvider('AZURE_OPENAI', { apiKey: 'k', baseUrl: 'https://x.openai.azure.com' }).kind).toBe('AZURE_OPENAI');
    expect(new OpenAiProvider('OPENAI', { apiKey: 'k' }).kind).toBe('OPENAI');
  });
});

describe('GeminiProvider', () => {
  const make = (response: unknown, err?: unknown) => {
    const generateContent = jest.fn(async () => {
      if (err) throw err;
      return response;
    });
    return { p: new GeminiProvider({ apiKey: 'k', models: { generateContent } as never }), generateContent };
  };

  it('maps contents, function declarations and function calls (ids generated when absent)', async () => {
    const { p, generateContent } = make({
      candidates: [{ finishReason: 'STOP', content: { role: 'model', parts: [{ text: 'thinking', thought: true }, { text: 'ok' }, { functionCall: { name: 'get_five24_status', args: { member: 'Sam' } }, thoughtSignature: 'sig' }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3, thoughtsTokenCount: 2, cachedContentTokenCount: 4 },
      modelVersion: 'gemini-x',
    });
    const r = await p.chat(req({ model: 'gemini-x' }));
    const arg = (generateContent.mock.calls[0] as unknown[])[0] as { contents: Array<{ role: string; parts: unknown[] }>; config: Record<string, unknown> };
    expect(arg.config).toMatchObject({ systemInstruction: 'sys', maxOutputTokens: 1000, tools: [{ functionDeclarations: [{ name: 'get_five24_status', parametersJsonSchema: tools[0].inputSchema }] }] });
    expect(arg.contents[1]).toEqual({ role: 'model', parts: [{ text: 'Checking' }, { functionCall: { id: 't1', name: 'get_five24_status', args: {} } }] });
    expect(arg.contents[2].parts[1]).toEqual({ functionResponse: { id: 't2', name: 'x', response: { error: 'boom' } } });
    expect(r.text).toBe('ok');
    expect(r.stopReason).toBe('tool_use');
    expect(r.toolCalls[0]).toMatchObject({ name: 'get_five24_status', input: { member: 'Sam' } });
    expect(r.toolCalls[0].id).toBeTruthy();
    expect(r.usage).toEqual({ inputTokens: 12, outputTokens: 5, cacheReadTokens: 4, cacheWriteTokens: 0 });
    const native = r.native?.content as { parts: Array<{ functionCall?: { id: string }; thoughtSignature?: string }> };
    expect(native.parts[2]).toMatchObject({ thoughtSignature: 'sig', functionCall: { id: r.toolCalls[0].id } });
    // native content is replayed for the same model
    const replay = GeminiProvider.toContents([{ role: 'user', text: 'q' }, { role: 'assistant', text: '', toolCalls: [], native: r.native }], 'gemini-x');
    expect(replay[1]).toBe(r.native?.content);
  });

  it.each([
    ['MAX_TOKENS', 'max_tokens'],
    ['SAFETY', 'refusal'],
    ['OTHER', 'other'],
  ])('finish %s → %s', async (fr, mapped) => {
    expect((await make({ candidates: [{ finishReason: fr, content: { parts: [] } }] }).p.chat(req({ tools: [] }))).stopReason).toBe(mapped);
  });

  it('maps ApiError and unknown errors; empty response', async () => {
    await expect(make(null, new ApiError({ message: 'quota', status: 429 })).p.chat(req())).rejects.toMatchObject({ retryable: true, status: 429 });
    await expect(make(null, new ApiError({ message: 'bad', status: 400 })).p.chat(req())).rejects.toMatchObject({ retryable: false });
    await expect(make(null, new Error('net')).p.chat(req())).rejects.toMatchObject({ code: 'connection' });
    expect(await make({}).p.chat(req())).toMatchObject({ text: '', stopReason: 'other', usage: { inputTokens: 0 } });
    expect(GeminiProvider.toContents([{ role: 'assistant', text: '', toolCalls: [] }], 'm')[0]).toEqual({ role: 'model', parts: [{ text: '…' }] });
  });
});

describe('MockProvider (deterministic demo model)', () => {
  const p = new MockProvider();
  const ask = (text: string, t = ['get_five24_status', 'get_benefit_summary', 'best_card_for', 'compare_cards', 'get_renewals', 'search_card_catalog', 'get_household', 'get_point_valuations', 'get_portfolio_value', 'get_offers', 'log_benefit_usage']) =>
    p.chat({ model: 'pointwise-demo', system: '', maxTokens: 1, tools: t.map((name) => ({ name, description: '', inputSchema: { type: 'object', properties: {} } })), messages: [{ role: 'user', text }] });

  it.each([
    ['What is my current 5/24 status?', 'get_five24_status', {}],
    ['Which family member should apply next?', 'get_five24_status', {}],
    ['What benefits expire in the next 30 days?', 'get_benefit_summary', { status: 'expiring', withinDays: 30 }],
    ['What benefits have I not used this year?', 'get_benefit_summary', { status: 'available' }],
    ['Which card should I use at Costco?', 'best_card_for', { query: 'Costco' }],
    ['Compare Sapphire Reserve versus Amex Platinum', 'compare_cards', { cards: ['Sapphire Reserve', 'Amex Platinum'] }],
    ['What cards should I cancel?', 'get_renewals', {}],
    ['What card should I open next?', 'search_card_catalog', {}],
    ['Show my household', 'get_household', {}],
    ['Best transfer partners for my points?', 'get_point_valuations', {}],
    ['How much value have I received from my Gold card?', 'get_portfolio_value', {}],
    ['Any offer this week', 'get_offers', {}],
    ['Log $15 of my Dining credit', 'log_benefit_usage', { amountDollars: 15 }],
  ])('%s → %s', async (q, tool, args) => {
    const r = await ask(q);
    expect(r.toolCalls[0]).toMatchObject({ name: tool, input: args });
  });

  const D = ['recommend_next_card', 'plan_award', 'get_transfer_partners', 'get_transfer_options', 'get_five24_status', 'search_card_catalog', 'get_point_valuations', 'search_card_terms'];
  it.each([
    ['Who should apply for the Northwind Voyager?', 'recommend_next_card', { card: 'Northwind Voyager' }],
    ['What card should I open next for Riley?', 'recommend_next_card', { member: 'Riley' }],
    ['Which card should we open next?', 'recommend_next_card', { member: '' }],
    ['How do I book an award of 60,000 points on SkyHigh?', 'plan_award', { program: 'SkyHigh', points: 60_000 }],
    ['Redeem 45k with AeroLink Rewards', 'plan_award', { program: 'AeroLink Rewards', points: 45_000 }],
    ['Show transfer partners for CONTOSO_PTS', 'get_transfer_partners', { currency: 'CONTOSO_PTS' }],
    ['Best transfer partners for my points?', 'get_transfer_options', {}],
    ['What should I do with my miles?', 'get_transfer_options', {}],
    ['Does the Northwind Voyager Reserve include lounge access?', 'search_card_terms', { query: 'lounge access', card: 'Northwind Voyager Reserve' }],
    ['Which cards have trip delay insurance?', 'search_card_terms', { query: 'trip delay insurance' }],
  ])('Phase D: %s → %s', async (q, tool, args) => {
    const r = await ask(q, D);
    expect(r.toolCalls[0]).toMatchObject({ name: tool, input: args });
  });

  it('award without a program or number still routes, with empty arguments', async () => {
    expect((await ask('book award 5 please', D)).toolCalls[0].input).toEqual({ program: '', points: 5 });
  });

  it('answers without tools when nothing matches or the tool is not allowed', async () => {
    expect((await ask('hello there')).text).toMatch(/I can answer/);
    expect((await ask('What is my 5/24?', ['get_offers'])).toolCalls).toEqual([]);
    expect((await ask('compare these', ['compare_cards'])).toolCalls[0].input).toEqual({ cards: [] });
  });

  it('summarises tool results (and errors), and can simulate failures', async () => {
    const base = { model: 'm', system: '', maxTokens: 1, tools: [] };
    const r = await p.chat({ ...base, messages: [{ role: 'tool', results: [{ toolCallId: '1', name: 'a', content: '{"summary":"Jordan: 5/24"}' }, { toolCallId: '2', name: 'b', content: 'nope', isError: true }, { toolCallId: '3', name: 'c', content: 'plain text' }, { toolCallId: '4', name: 'd', content: '{"x":1}' }] }] });
    expect(r.text).toBe("Jordan: 5/24\nI couldn't get that (b): nope\nplain text\n{\"x\":1}");
    const failing = new MockProvider({ failWith: new ProviderError('down', 'http_503', true, 503) });
    await expect(failing.chat({ ...base, messages: [] })).rejects.toMatchObject({ status: 503 });
  });
});

describe('provider factory & key resolution', () => {
  const KEY = 'unit-test-token-encryption-key-0123456789';
  const OLD = process.env.TOKEN_ENC_KEY;
  beforeAll(() => (process.env.TOKEN_ENC_KEY = KEY));
  afterAll(() => (process.env.TOKEN_ENC_KEY = OLD));
  const row = (over: object = {}) => ({ id: 'p', kind: 'ANTHROPIC' as const, baseUrl: null, apiVersion: null, apiKeyEnc: null, apiKeyEnv: null, status: 'ACTIVE' as const, ...over });

  it('stored key wins over the env var; env var used otherwise', () => {
    expect(resolveApiKey(row({ apiKeyEnc: encryptSecret('db-key'), apiKeyEnv: 'X' }), { X: 'env-key' })).toBe('db-key');
    expect(resolveApiKey(row({ apiKeyEnv: 'X' }), { X: 'env-key' })).toBe('env-key');
    expect(resolveApiKey(row({ apiKeyEnv: 'X' }), {})).toBeNull();
  });

  it('usability rules', () => {
    expect(isUsable(row({ status: 'DISABLED', apiKeyEnv: 'X' }), { X: 'k' })).toBe(false);
    expect(isUsable(row({ apiKeyEnv: 'X' }), { X: 'k' })).toBe(true);
    expect(isUsable(row(), {})).toBe(false);
    expect(isUsable(row({ kind: 'MOCK' }), { AI_ENABLE_MOCK: 'true' })).toBe(true);
    expect(isUsable(row({ kind: 'MOCK' }), {})).toBe(false);
    expect(isUsable(row({ kind: 'OLLAMA' }), {})).toBe(true);
    expect(isUsable(row({ kind: 'OPENAI_COMPATIBLE', apiKeyEnv: 'X' }), { X: 'k' })).toBe(false); // needs baseUrl
    expect(isUsable(row({ kind: 'AZURE_OPENAI', apiKeyEnv: 'X' }), { X: 'k' })).toBe(false);
    expect(isUsable(row({ apiKeyEnc: 'v1.corrupt.x.y' }), {})).toBe(false);
  });

  it('builds the right adapter per kind', () => {
    process.env.T_KEY = 'k';
    expect(defaultProviderFactory(row({ apiKeyEnv: 'T_KEY' })).kind).toBe('ANTHROPIC');
    expect(defaultProviderFactory(row({ kind: 'GEMINI', apiKeyEnv: 'T_KEY' })).kind).toBe('GEMINI');
    expect(defaultProviderFactory(row({ kind: 'MOCK' })).kind).toBe('MOCK');
    expect(defaultProviderFactory(row({ kind: 'OLLAMA' })).kind).toBe('OLLAMA');
    expect(defaultProviderFactory(row({ kind: 'OPENAI_COMPATIBLE', baseUrl: 'https://api.x.ai/v1', apiKeyEnv: 'T_KEY' })).kind).toBe('OPENAI_COMPATIBLE');
  });
});

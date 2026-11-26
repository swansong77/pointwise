import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { AnthropicProvider } from '../../../src/ai/providers/anthropic';
import { MockProvider } from '../../../src/ai/providers/mock';
import { OpenAiProvider } from '../../../src/ai/providers/openai';
import { ModelRouter, ModelRow } from '../../../src/ai/router';
import { ChatRequest, ChatResponse, LlmProvider, ProviderError } from '../../../src/ai/types';
import { createPrismaMock } from '../prisma-mock';

const tools = [{ name: 'plan_award', description: 'd', inputSchema: { type: 'object' as const, properties: { points: { type: 'number' } } } }];
const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({ model: 'm', system: 'sys', messages: [{ role: 'user', text: 'hi' }], tools, maxTokens: 100, ...over });

describe('AnthropicProvider.chatStream', () => {
  const final = {
    model: 'claude-opus-5-5',
    stop_reason: 'tool_use',
    content: [{ type: 'text', text: 'Planning.' }, { type: 'tool_use', id: 't1', name: 'plan_award', input: { points: 60000 } }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };

  it('emits text deltas, returns the final message, and streams tool inputs eagerly', async () => {
    const handlers: Record<string, (d: string) => void> = {};
    const stream = jest.fn(() => ({
      on: (ev: string, fn: (d: string) => void) => {
        handlers[ev] = fn;
      },
      finalMessage: async () => {
        handlers.text?.('Plan');
        handlers.text?.('ning.');
        return final;
      },
    }));
    const p = new AnthropicProvider({ apiKey: 'k', client: { beta: { messages: { stream } } } as unknown as Anthropic });
    const deltas: string[] = [];
    const r = await p.chatStream(req(), (d) => deltas.push(d));
    expect(deltas).toEqual(['Plan', 'ning.']);
    expect(r).toMatchObject({ text: 'Planning.', stopReason: 'tool_use', toolCalls: [{ id: 't1', name: 'plan_award', input: { points: 60000 } }], usage: { cacheReadTokens: 0 } });
    const params = (stream.mock.calls[0] as unknown[])[0] as { tools: Array<Record<string, unknown>> };
    expect(params.tools[0]).toMatchObject({ name: 'plan_award', eager_input_streaming: true });
    // non-streamed requests never set it
    expect((AnthropicProvider.params(req()).tools as unknown as Array<Record<string, unknown>>)[0].eager_input_streaming).toBeUndefined();
  });

  it('maps stream failures (API errors, unparseable tool input) to provider errors', async () => {
    const failing = (err: unknown) =>
      new AnthropicProvider({
        apiKey: 'k',
        client: {
          beta: {
            messages: {
              stream: () => ({
                on: () => undefined,
                finalMessage: async () => {
                  throw err;
                },
              }),
            },
          },
        } as unknown as Anthropic,
      });
    await expect(failing(new Anthropic.APIError(529, undefined, 'overloaded', new Headers())).chatStream(req(), () => undefined)).rejects.toMatchObject({ code: 'http_529', retryable: true });
    await expect(failing(new SyntaxError('Unexpected token in JSON')).chatStream(req(), () => undefined)).rejects.toMatchObject({ code: 'unknown', retryable: true });
  });
});

describe('OpenAiProvider.chatStream', () => {
  async function* chunks(list: unknown[]) {
    for (const c of list) yield c;
  }
  it('accumulates content and tool-call fragments by index; reads usage from the last chunk', async () => {
    const create = jest.fn(async () =>
      chunks([
        { model: 'gpt-x', choices: [{ delta: { content: 'Hel' } }] },
        { model: 'gpt-x', choices: [{ delta: { content: 'lo', tool_calls: [{ index: 0, id: 'c1', function: { name: 'plan_', arguments: '{"poi' } }] } }] },
        { model: 'gpt-x', choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'award', arguments: 'nts":5}' } }, { index: 1, function: { name: 'x', arguments: '' } }] }, finish_reason: 'tool_calls' }] },
        { model: '', choices: [], usage: { prompt_tokens: 7, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } } },
      ]),
    );
    const p = new OpenAiProvider('OPENAI', { client: { chat: { completions: { create } } } as unknown as OpenAI });
    const deltas: string[] = [];
    const r = await p.chatStream(req({ effort: 'low', capabilities: ['effort'] }), (d) => deltas.push(d));
    expect(deltas).toEqual(['Hel', 'lo']);
    expect(r).toMatchObject({ text: 'Hello', stopReason: 'tool_use', servedModel: 'gpt-x', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 2 } });
    expect(r.toolCalls).toEqual([
      { id: 'c1', name: 'plan_award', input: { points: 5 } },
      { id: 'call_1', name: 'x', input: {} },
    ]);
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({ stream: true, stream_options: { include_usage: true }, max_completion_tokens: 100, reasoning_effort: 'low' });
  });

  it('finish reasons and errors', async () => {
    const run = async (finish: string | null, kind: 'OPENAI' | 'OLLAMA' = 'OLLAMA') => {
      const create = jest.fn(async () => chunks([{ model: 'm', choices: [{ delta: { content: 'x' }, finish_reason: finish }] }]));
      const p = new OpenAiProvider(kind, { client: { chat: { completions: { create } } } as unknown as OpenAI });
      const r = await p.chatStream(req({ tools: [] }), () => undefined);
      return { r, params: (create.mock.calls[0] as unknown[])[0] as Record<string, unknown> };
    };
    expect((await run('stop')).r.stopReason).toBe('end');
    expect((await run('length')).r.stopReason).toBe('max_tokens');
    expect((await run('content_filter')).r.stopReason).toBe('refusal');
    const other = await run(null);
    expect(other.r).toMatchObject({ stopReason: 'other', usage: { inputTokens: 0 } });
    expect(other.params).toMatchObject({ max_tokens: 100 });
    const broken = new OpenAiProvider('OPENAI', { client: { chat: { completions: { create: async () => Promise.reject(new OpenAI.APIConnectionError({ message: 'reset' })) } } } as unknown as OpenAI });
    await expect(broken.chatStream(req(), () => undefined)).rejects.toMatchObject({ code: 'connection' });
  });
});

describe('MockProvider.chatStream', () => {
  it('streams the answer word by word', async () => {
    const p = new MockProvider();
    const deltas: string[] = [];
    const r = await p.chatStream({ ...req({ tools: [] }), messages: [{ role: 'tool', results: [{ toolCallId: '1', name: 'a', content: '{"summary":"Jordan is 5/24"}' }] }] }, (d) => deltas.push(d));
    expect(deltas).toEqual(['Jordan ', 'is ', '5/24']);
    expect(r.text).toBe('Jordan is 5/24');
    const none: string[] = [];
    await p.chatStream({ ...req({ tools }), messages: [{ role: 'user', text: 'book award 5' }] }, (d) => none.push(d));
    expect(none).toEqual([]);
  });
});

describe('ModelRouter streaming', () => {
  const model = (id: string): ModelRow => ({
    id,
    modelId: id,
    displayName: id,
    capabilities: [],
    inputPrice: null,
    outputPrice: null,
    cacheReadPrice: null,
    status: 'ACTIVE',
    provider: { id: `p-${id}`, name: 'P', kind: 'MOCK', baseUrl: null, apiVersion: null, apiKeyEnc: null, apiKeyEnv: null, status: 'ACTIVE' },
  });
  const ok: ChatResponse = { text: 'Answer', toolCalls: [], stopReason: 'end', usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } };
  const sinkLog = () => {
    const log: string[] = [];
    return { log, sink: { text: (d: string) => log.push(`+${d}`), reset: () => log.push('reset') } };
  };
  const r0 = { system: 's', messages: [{ role: 'user' as const, text: 'hi' }], tools: [], maxTokens: 10 };

  it('resets streamed text when a model fails mid-stream and the next one answers', async () => {
    const prisma = createPrismaMock();
    prisma.aiUsage.create.mockResolvedValue({});
    const router = new ModelRouter(prisma as never);
    const half: LlmProvider = {
      kind: 'MOCK',
      chat: jest.fn(),
      chatStream: async (_r, onText) => {
        onText('Half an ans');
        throw new ProviderError('dropped', 'connection', true);
      },
    };
    const whole: LlmProvider = { kind: 'MOCK', chat: async () => ok }; // no streaming → emitted as one chunk
    router.factory = (p) => (p.id === 'p-a' ? half : whole);
    const { log, sink } = sinkLog();
    const r = await router.chat([model('a'), model('b')], r0, { userId: 'u', agentKey: 'assistant' }, sink);
    expect(r.model.id).toBe('b');
    expect(log).toEqual(['+Half an ans', 'reset', '+Answer']);
  });

  it('a failure before any text needs no reset; without a sink providers are not streamed', async () => {
    const prisma = createPrismaMock();
    prisma.aiUsage.create.mockResolvedValue({});
    const router = new ModelRouter(prisma as never);
    const chatStream = jest.fn(async () => Promise.reject(new ProviderError('busy', 'http_529', true)));
    const chat = jest.fn(async () => ok);
    router.factory = (p) => (p.id === 'p-a' ? { kind: 'MOCK', chat: jest.fn(), chatStream } : { kind: 'MOCK', chat, chatStream: jest.fn(async () => ({ ...ok, text: '' })) });
    const { log, sink } = sinkLog();
    await router.chat([model('a'), model('b')], r0, { userId: 'u', agentKey: 'assistant' }, sink);
    expect(log).toEqual([]);
    await router.chat([model('b')], r0, { userId: 'u', agentKey: 'assistant' });
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

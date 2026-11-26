/*
 * Opt-in live smoke test for real AI providers. NEVER runs in CI or the default test commands:
 * it is skipped unless LIVE_AI_SMOKE=1, and each provider only runs when its key is set.
 *
 *   LIVE_AI_SMOKE=1 ANTHROPIC_API_KEY=… npm run test:live
 *
 * Each provider gets two tiny requests (a one-word reply and one tool call, ~200 tokens), streamed
 * and non-streamed. Only synthetic text is sent — never user data.
 */
import { AnthropicProvider } from '../../src/ai/providers/anthropic';
import { GeminiProvider } from '../../src/ai/providers/gemini';
import { OpenAiProvider } from '../../src/ai/providers/openai';
import { ChatRequest, LlmProvider } from '../../src/ai/types';

const enabled = process.env.LIVE_AI_SMOKE === '1';
const tool = { name: 'get_weather', description: 'Weather for a city', inputSchema: { type: 'object' as const, properties: { city: { type: 'string' } }, required: ['city'] } };

const providers: Array<{ name: string; key?: string; make: () => LlmProvider; model: string }> = [
  { name: 'Anthropic', key: process.env.ANTHROPIC_API_KEY, make: () => new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY! }), model: process.env.LIVE_ANTHROPIC_MODEL ?? 'claude-haiku-5-5' },
  { name: 'OpenAI', key: process.env.OPENAI_API_KEY, make: () => new OpenAiProvider('OPENAI', { apiKey: process.env.OPENAI_API_KEY }), model: process.env.LIVE_OPENAI_MODEL ?? 'gpt-4o-mini' },
  { name: 'Gemini', key: process.env.GEMINI_API_KEY, make: () => new GeminiProvider({ apiKey: process.env.GEMINI_API_KEY! }), model: process.env.LIVE_GEMINI_MODEL ?? 'gemini-2.5-flash' },
];

const base = (model: string, over: Partial<ChatRequest> = {}): ChatRequest => ({ model, system: 'You are a test harness. Be brief.', messages: [{ role: 'user', text: 'Reply with the single word OK.' }], tools: [], maxTokens: 64, ...over });

for (const p of providers) {
  const d = enabled && p.key ? describe : describe.skip;
  d(`live: ${p.name}`, () => {
    jest.setTimeout(60_000);
    it('answers a one-word prompt', async () => {
      const r = await p.make().chat(base(p.model));
      expect(r.text.toUpperCase()).toContain('OK');
      expect(r.usage.outputTokens).toBeGreaterThan(0);
    });
    it('calls a tool, streamed', async () => {
      const provider = p.make();
      const req = base(p.model, { tools: [tool], maxTokens: 256, messages: [{ role: 'user', text: 'What is the weather in Paris? Use the tool.' }] });
      const deltas: string[] = [];
      const r = provider.chatStream ? await provider.chatStream(req, (t) => deltas.push(t)) : await provider.chat(req);
      expect(r.toolCalls[0]).toMatchObject({ name: 'get_weather' });
      expect(String(r.toolCalls[0].input.city)).toMatch(/paris/i);
    });
  });
}

if (!enabled) it('live provider smoke tests are skipped (set LIVE_AI_SMOKE=1 to run them)', () => expect(enabled).toBe(false));

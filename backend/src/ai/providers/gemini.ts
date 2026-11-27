import { ApiError, Content, GoogleGenAI, Part } from '@google/genai';
import { randomUUID } from 'crypto';
import { ChatMessage, ChatRequest, ChatResponse, LlmProvider, ProviderError, StopReason, isRetryableStatus } from '../types';

/** Minimal slice of the SDK the adapter uses (lets tests inject a fake). */
export interface GeminiModels {
  generateContent: GoogleGenAI['models']['generateContent'];
}

/**
 * Google Gemini adapter (@google/genai). Model turns from the same model are sent back with their
 * original parts (thought signatures on function calls must round-trip).
 */
export class GeminiProvider implements LlmProvider {
  readonly kind = 'GEMINI' as const;
  private readonly models: GeminiModels;

  constructor(opts: { apiKey: string; models?: GeminiModels }) {
    this.models = opts.models ?? new GoogleGenAI({ apiKey: opts.apiKey }).models;
  }

  static toContents(messages: ChatMessage[], model: string): Content[] {
    const out: Content[] = [];
    for (const m of messages) {
      if (m.role === 'user') out.push({ role: 'user', parts: [{ text: m.text }] });
      else if (m.role === 'assistant') {
        if (m.native && m.native.provider === 'GEMINI' && m.native.model === model) {
          out.push(m.native.content as Content);
          continue;
        }
        const parts: Part[] = [];
        if (m.text) parts.push({ text: m.text });
        for (const c of m.toolCalls) parts.push({ functionCall: { id: c.id, name: c.name, args: c.input } });
        out.push({ role: 'model', parts: parts.length ? parts : [{ text: '…' }] });
      } else {
        out.push({
          role: 'user',
          parts: m.results.map((r) => ({ functionResponse: { id: r.toolCallId, name: r.name, response: r.isError ? { error: r.content } : { result: r.content } } })),
        });
      }
    }
    return out;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (req.serverTools?.length) throw new ProviderError('Web search tools are only available with Claude models', 'unsupported', false);
    let res: Awaited<ReturnType<GeminiModels['generateContent']>>;
    try {
      res = await this.models.generateContent({
        model: req.model,
        contents: GeminiProvider.toContents(req.messages, req.model),
        config: {
          systemInstruction: req.system,
          maxOutputTokens: req.maxTokens,
          ...(req.temperature != null && !req.capabilities?.includes('effort') && { temperature: req.temperature }),
          ...(req.tools.length && {
            tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.inputSchema })) }],
          }),
        },
      });
    } catch (e) {
      throw GeminiProvider.toProviderError(e);
    }
    const candidate = res.candidates?.[0];
    const parts = candidate?.content?.parts ?? [];
    const text = parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
    const toolCalls = parts
      .filter((p) => p.functionCall?.name)
      .map((p) => ({ id: p.functionCall?.id || randomUUID(), name: p.functionCall?.name as string, input: (p.functionCall?.args ?? {}) as Record<string, unknown> }));
    const fr = String(candidate?.finishReason ?? '');
    const stopReason: StopReason = toolCalls.length
      ? 'tool_use'
      : fr === 'STOP'
        ? 'end'
        : fr === 'MAX_TOKENS'
          ? 'max_tokens'
          : ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(fr)
            ? 'refusal'
            : 'other';
    // keep ids we generated so tool results can reference them
    const nativeParts = parts.map((p) => {
      if (!p.functionCall) return p;
      const call = toolCalls.find((c) => c.name === p.functionCall?.name && (!p.functionCall?.id || c.id === p.functionCall.id));
      return { ...p, functionCall: { ...p.functionCall, id: call?.id ?? p.functionCall.id } };
    });
    return {
      text,
      toolCalls,
      stopReason,
      usage: {
        inputTokens: res.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0),
        cacheReadTokens: res.usageMetadata?.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
      },
      native: { provider: 'GEMINI', model: req.model, content: { role: 'model', parts: nativeParts } },
      servedModel: res.modelVersion ?? req.model,
    };
  }

  static toProviderError(e: unknown): ProviderError {
    if (e instanceof ApiError) return new ProviderError(e.message, `http_${e.status}`, isRetryableStatus(e.status), e.status);
    return new ProviderError((e as Error)?.message ?? 'unknown error', 'connection', true);
  }
}

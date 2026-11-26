import OpenAI, { AzureOpenAI } from 'openai';
import { ChatMessage, ChatRequest, ChatResponse, LlmProvider, ProviderError, ProviderKind, StopReason, isRetryableStatus, safeParseArgs } from '../types';

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * OpenAI Chat Completions adapter. Also serves every provider that exposes the same API shape:
 * Azure OpenAI (AzureOpenAI client: endpoint + apiVersion + deployment name as model),
 * xAI Grok, Mistral, DeepSeek, OpenRouter (OPENAI_COMPATIBLE with a baseUrl) and Ollama (/v1).
 */
export class OpenAiProvider implements LlmProvider {
  private readonly client: OpenAI;

  constructor(
    readonly kind: Extract<ProviderKind, 'OPENAI' | 'AZURE_OPENAI' | 'OPENAI_COMPATIBLE' | 'OLLAMA'>,
    opts: { apiKey?: string | null; baseUrl?: string | null; apiVersion?: string | null; client?: OpenAI },
  ) {
    if (opts.client) this.client = opts.client;
    else if (kind === 'AZURE_OPENAI') {
      this.client = new AzureOpenAI({ apiKey: opts.apiKey ?? undefined, endpoint: opts.baseUrl ?? undefined, apiVersion: opts.apiVersion ?? '2024-10-21', maxRetries: 1, timeout: 120_000 });
    } else {
      this.client = new OpenAI({
        apiKey: opts.apiKey || (kind === 'OLLAMA' ? 'ollama' : undefined),
        baseURL: opts.baseUrl ?? (kind === 'OLLAMA' ? 'http://localhost:11434/v1' : undefined),
        maxRetries: 1,
        timeout: 120_000,
      });
    }
  }

  static toMessages(system: string, messages: ChatMessage[]): Msg[] {
    const out: Msg[] = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'user') out.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant') {
        out.push({
          role: 'assistant',
          content: m.text || null,
          ...(m.toolCalls.length && {
            tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.input) } })),
          }),
        });
      } else {
        for (const r of m.results) out.push({ role: 'tool', tool_call_id: r.toolCallId, content: r.isError ? `ERROR: ${r.content}` : r.content });
      }
    }
    return out;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    if (req.serverTools?.length) throw new ProviderError('Web search tools are only available with Claude models', 'unsupported', false);
    const firstParty = this.kind === 'OPENAI' || this.kind === 'AZURE_OPENAI';
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: req.model,
      messages: OpenAiProvider.toMessages(req.system, req.messages),
      ...(req.tools.length && {
        tools: req.tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown> } })),
      }),
      // first-party reasoning models use max_completion_tokens; compatible servers still expect max_tokens
      ...(firstParty ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
      ...(req.effort && req.capabilities?.includes('effort') && { reasoning_effort: req.effort }),
    };
    let res: OpenAI.Chat.Completions.ChatCompletion;
    try {
      res = await this.client.chat.completions.create(params);
    } catch (e) {
      throw OpenAiProvider.toProviderError(e);
    }
    const choice = res.choices[0];
    const toolCalls = (choice?.message.tool_calls ?? [])
      .filter((c): c is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => c.type === 'function')
      .map((c) => ({ id: c.id, name: c.function.name, input: safeParseArgs(c.function.arguments) }));
    const fr = choice?.finish_reason;
    const stopReason: StopReason = toolCalls.length || fr === 'tool_calls' ? 'tool_use' : fr === 'stop' ? 'end' : fr === 'length' ? 'max_tokens' : fr === 'content_filter' ? 'refusal' : 'other';
    return {
      text: choice?.message.content ?? (choice?.message as { refusal?: string } | undefined)?.refusal ?? '',
      toolCalls,
      stopReason,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
        cacheReadTokens: res.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: 0,
      },
      servedModel: res.model,
    };
  }

  /** Streams content deltas; tool-call fragments are accumulated by index. */
  async chatStream(req: ChatRequest, onText: (delta: string) => void): Promise<ChatResponse> {
    const firstParty = this.kind === 'OPENAI' || this.kind === 'AZURE_OPENAI';
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: req.model,
      messages: OpenAiProvider.toMessages(req.system, req.messages),
      stream: true,
      stream_options: { include_usage: true },
      ...(req.tools.length && {
        tools: req.tools.map((t) => ({ type: 'function' as const, function: { name: t.name, description: t.description, parameters: t.inputSchema as unknown as Record<string, unknown> } })),
      }),
      ...(firstParty ? { max_completion_tokens: req.maxTokens } : { max_tokens: req.maxTokens }),
      ...(req.effort && req.capabilities?.includes('effort') && { reasoning_effort: req.effort }),
    };
    let text = '';
    let finish: string | null = null;
    let model = req.model;
    let usage: OpenAI.Completions.CompletionUsage | undefined;
    const calls: Array<{ id: string; name: string; args: string }> = [];
    try {
      const stream = await this.client.chat.completions.create(params);
      for await (const chunk of stream) {
        model = chunk.model || model;
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices[0];
        if (!choice) continue;
        const d = choice.delta;
        if (d?.content) {
          text += d.content;
          onText(d.content);
        }
        for (const tc of d?.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { id: '', name: '', args: '' });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name += tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
        }
        if (choice.finish_reason) finish = choice.finish_reason;
      }
    } catch (e) {
      throw OpenAiProvider.toProviderError(e);
    }
    const toolCalls = calls.filter((c) => c && c.name).map((c, i) => ({ id: c.id || `call_${i}`, name: c.name, input: safeParseArgs(c.args) }));
    const stopReason: StopReason = toolCalls.length || finish === 'tool_calls' ? 'tool_use' : finish === 'stop' ? 'end' : finish === 'length' ? 'max_tokens' : finish === 'content_filter' ? 'refusal' : 'other';
    return {
      text,
      toolCalls,
      stopReason,
      usage: { inputTokens: usage?.prompt_tokens ?? 0, outputTokens: usage?.completion_tokens ?? 0, cacheReadTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0, cacheWriteTokens: 0 },
      servedModel: model,
    };
  }

  static toProviderError(e: unknown): ProviderError {
    if (e instanceof OpenAI.APIConnectionError) return new ProviderError(e.message, 'connection', true);
    if (e instanceof OpenAI.APIError) {
      const status = e.status ?? undefined;
      return new ProviderError(e.message, `http_${status ?? 'unknown'}`, isRetryableStatus(status), status);
    }
    return new ProviderError((e as Error)?.message ?? 'unknown error', 'unknown', true);
  }
}

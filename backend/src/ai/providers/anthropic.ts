import Anthropic from "@anthropic-ai/sdk";
import {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  LlmProvider,
  ProviderError,
  StopReason,
  ToolCall,
  WebPage,
  isRetryableStatus,
} from "../types";

/**
 * Claude adapter (official @anthropic-ai/sdk).
 * - Uses the beta Messages endpoint so the server-side refusal fallback (`fallbacks: "default"`)
 *   can be enabled for models that support it (capability "fallbacks").
 * - Thinking is left at the model default (adaptive on current models); depth is set with
 *   `output_config.effort` for models with the "effort" capability.
 * - Tool choice stays `auto` (forced tool choice returns 400 on Opus 5.5 / Sonnet 5.5).
 * - Stable prefix (tools + system) is cached; assistant turns from the same model are sent back
 *   unchanged (native content), which keeps thinking blocks valid.
 */
export class AnthropicProvider implements LlmProvider {
  readonly kind = "ANTHROPIC" as const;
  private readonly client: Anthropic;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string | null;
    client?: Anthropic;
  }) {
    this.client =
      opts.client ??
      new Anthropic({
        apiKey: opts.apiKey,
        baseURL: opts.baseUrl ?? undefined,
        maxRetries: 1,
        timeout: 120_000,
      });
  }

  static toMessages(
    messages: ChatMessage[],
    model: string,
  ): Anthropic.Beta.BetaMessageParam[] {
    const out: Anthropic.Beta.BetaMessageParam[] = [];
    for (const m of messages) {
      if (m.role === "user") out.push({ role: "user", content: m.text });
      else if (m.role === "assistant") {
        if (
          m.native &&
          m.native.provider === "ANTHROPIC" &&
          m.native.model === model
        ) {
          out.push({
            role: "assistant",
            content: m.native.content as Anthropic.Beta.BetaContentBlockParam[],
          });
          continue;
        }
        const blocks: Anthropic.Beta.BetaContentBlockParam[] = [];
        if (m.text) blocks.push({ type: "text", text: m.text });
        for (const c of m.toolCalls)
          blocks.push({
            type: "tool_use",
            id: c.id,
            name: c.name,
            input: c.input,
          });
        out.push({
          role: "assistant",
          content: blocks.length ? blocks : [{ type: "text", text: "…" }],
        });
      } else {
        out.push({
          role: "user",
          content: m.results.map((r) => ({
            type: "tool_result" as const,
            tool_use_id: r.toolCallId,
            content: r.content,
            ...(r.isError && { is_error: true }),
          })),
        });
      }
    }
    return out;
  }

  /** Request parameters. Streamed requests set `eager_input_streaming` on each tool (inputs are validated by the tool handlers). */
  static params(
    req: ChatRequest,
    streaming = false,
  ): Anthropic.Beta.MessageCreateParamsNonStreaming {
    const caps = req.capabilities ?? [];
    const fallbacks = caps.includes("fallbacks");
    return {
      model: req.model,
      max_tokens: req.maxTokens,
      ...(req.temperature != null && !caps.includes("effort") && { temperature: req.temperature }),
      system: [
        {
          type: "text",
          text: req.system,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: AnthropicProvider.toMessages(req.messages, req.model),
      ...((req.tools.length || req.serverTools?.length) && {
        tools: [
          ...req.tools.map((t): Anthropic.Beta.BetaToolUnion => ({
            name: t.name,
            description: t.description,
            input_schema: t.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
            ...(streaming && { eager_input_streaming: true }),
          })),
          ...(req.serverTools ?? []).map(AnthropicProvider.serverTool),
        ],
      }),
      ...(req.effort &&
        caps.includes("effort") && { output_config: { effort: req.effort } }),
      ...(fallbacks && {
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default" as const,
      }),
    };
  }

  /** Web search / fetch restricted to the given domains. Fetch runs directly (not via code) so its document text is returned for evidence checks. */
  static serverTool(
    s: NonNullable<ChatRequest["serverTools"]>[number],
  ): Anthropic.Beta.BetaToolUnion {
    if (s.kind === "web_search")
      return {
        type: "web_search_20260209",
        name: "web_search",
        allowed_domains: s.allowedDomains,
        max_uses: s.maxUses,
      };
    return {
      type: "web_fetch_20260209",
      name: "web_fetch",
      allowed_domains: s.allowedDomains,
      max_uses: s.maxUses,
      allowed_callers: ["direct"],
      max_content_tokens: 30_000,
    };
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await this.client.beta.messages.create(
        AnthropicProvider.params(req),
        req.timeoutMs ? { timeout: req.timeoutMs } : undefined,
      );
    } catch (e) {
      throw AnthropicProvider.toProviderError(e);
    }
    return AnthropicProvider.toResponse(res);
  }

  /** Streams text deltas; finalMessage() resolves with the complete message (or rejects on error / unparseable tool input). */
  async chatStream(
    req: ChatRequest,
    onText: (delta: string) => void,
  ): Promise<ChatResponse> {
    let res: Anthropic.Beta.BetaMessage;
    try {
      const stream = this.client.beta.messages.stream(
        AnthropicProvider.params(req, true),
      );
      stream.on("text", (delta) => onText(delta));
      res = await stream.finalMessage();
    } catch (e) {
      throw AnthropicProvider.toProviderError(e);
    }
    return AnthropicProvider.toResponse(res);
  }

  static toResponse(res: Anthropic.Beta.BetaMessage): ChatResponse {
    let text = "";
    const toolCalls: ToolCall[] = [];
    const webPages: WebPage[] = [];
    for (const b of res.content) {
      if (b.type === "text") text += b.text;
      else if (b.type === "tool_use")
        toolCalls.push({
          id: b.id,
          name: b.name,
          input: (b.input ?? {}) as Record<string, unknown>,
        });
      else if (
        b.type === "web_search_tool_result" &&
        Array.isArray(b.content)
      ) {
        for (const r of b.content)
          webPages.push({ url: r.url, title: r.title, via: "search" });
      } else if (
        b.type === "web_fetch_tool_result" &&
        b.content.type === "web_fetch_result"
      ) {
        const src = b.content.content.source;
        webPages.push({
          url: b.content.url,
          title: b.content.content.title,
          text: src.type === "text" ? src.data : undefined,
          via: "fetch",
        });
      }
    }
    const stopReason: StopReason =
      res.stop_reason === "tool_use"
        ? "tool_use"
        : res.stop_reason === "end_turn"
          ? "end"
          : res.stop_reason === "max_tokens"
            ? "max_tokens"
            : res.stop_reason === "refusal"
              ? "refusal"
              : res.stop_reason === "pause_turn"
                ? "pause"
                : "other";
    const stu = res.usage.server_tool_use;
    return {
      text,
      toolCalls,
      stopReason,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        cacheReadTokens: res.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0,
      },
      native: { provider: "ANTHROPIC", model: res.model, content: res.content },
      servedModel: res.model,
      ...(webPages.length && { webPages }),
      ...(stu && {
        serverToolUse: {
          webSearch: stu.web_search_requests ?? 0,
          webFetch: stu.web_fetch_requests ?? 0,
        },
      }),
    };
  }

  static toProviderError(e: unknown): ProviderError {
    if (e instanceof Anthropic.APIConnectionError)
      return new ProviderError(e.message, "connection", true);
    if (e instanceof Anthropic.APIError) {
      const status = e.status ?? undefined;
      return new ProviderError(
        e.message,
        `http_${status ?? "unknown"}`,
        isRetryableStatus(status),
        status,
      );
    }
    return new ProviderError(
      (e as Error)?.message ?? "unknown error",
      "unknown",
      true,
    );
  }
}

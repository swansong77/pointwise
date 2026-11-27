/**
 * Provider-neutral chat types. Every provider adapter maps these to and from its own API, so the
 * agent runtime, router and tools never depend on a specific vendor SDK.
 */

export type ProviderKind =
  | "ANTHROPIC"
  | "OPENAI"
  | "AZURE_OPENAI"
  | "GEMINI"
  | "OPENAI_COMPATIBLE"
  | "OLLAMA"
  | "MOCK";

export interface JsonSchemaObject {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

/** Provider-native assistant content kept so the same provider can receive it back unchanged (e.g. Claude thinking blocks). */
export interface NativeContent {
  provider: ProviderKind;
  model: string;
  content: unknown;
}

/** `private` marks turns that contain user data — never replayed to a model (see ai/privacy.ts). */
export type ChatMessage =
  | { role: "user"; text: string; private?: boolean }
  | {
      role: "assistant";
      text: string;
      toolCalls: ToolCall[];
      native?: NativeContent;
      private?: boolean;
    }
  | { role: "tool"; results: ToolResult[]; private?: boolean };

export type Effort = "low" | "medium" | "high";

/**
 * Provider-hosted tools (currently Claude web search / web fetch). Only used by the admin card-research
 * agent; the domain allow-list is enforced by the provider. Never used in user chats.
 */
export interface ServerToolSpec {
  kind: "web_search" | "web_fetch";
  allowedDomains: string[];
  maxUses: number;
}

/** A page a server tool returned: search hit (title/url) or fetched document (with its text). */
export interface WebPage {
  url: string;
  title?: string | null;
  text?: string;
  via: "search" | "fetch";
}

export interface ChatRequest {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
  maxTokens: number;
  effort?: Effort | null;
  /** model capabilities from the registry (e.g. "effort", "fallbacks") */
  capabilities?: string[];
  /** provider-hosted tools (web search/fetch); providers without them reject the request */
  serverTools?: ServerToolSpec[];
  /** per-request timeout override (server-tool turns can take minutes) */
  timeoutMs?: number;
  /** 0..1, the member's preference; ignored by models that reason with an effort level, which reject it */
  temperature?: number;
}

/** `pause`: a long server-tool turn paused; send the assistant turn back to continue it. */
export type StopReason =
  "end" | "tool_use" | "max_tokens" | "refusal" | "pause" | "other";

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  stopReason: StopReason;
  usage: Usage;
  native?: NativeContent;
  /** the model that actually answered (differs from the request when a provider-side fallback ran) */
  servedModel?: string;
  /** pages returned by server tools in this turn */
  webPages?: WebPage[];
  /** server tool requests billed in this turn */
  serverToolUse?: { webSearch: number; webFetch: number };
}

export interface LlmProvider {
  readonly kind: ProviderKind;
  chat(req: ChatRequest): Promise<ChatResponse>;
  /** Same as chat, emitting answer text as it is generated (optional; the router falls back to chat). */
  chatStream?(
    req: ChatRequest,
    onText: (delta: string) => void,
  ): Promise<ChatResponse>;
}

/** Receives streamed text; `reset` discards text from an attempt that failed over to another model. */
export interface TextSink {
  text(delta: string): void;
  reset(): void;
}

/** Normalised provider failure. `retryable` drives failover to the next model in the chain. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const zeroUsage = (): Usage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

/** HTTP status → retryable? (429, 408, 409 and 5xx are transient; 4xx config errors are not). */
export function isRetryableStatus(status: number | undefined): boolean {
  if (status == null) return true; // network / timeout
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export function safeParseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw))
    return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const v = JSON.parse(raw);
      return v && typeof v === "object" && !Array.isArray(v) ? v : {};
    } catch {
      return {};
    }
  }
  return {};
}

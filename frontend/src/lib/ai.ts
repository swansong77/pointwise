/** Types and pure helpers for the AI assistant and admin pages. */

export interface AiModelOption {
  id: string;
  displayName: string;
  provider: string;
  providerKind: string;
  capabilities: string[];
  demo: boolean;
}

export interface AgentOption {
  key: string;
  name: string;
  description: string;
}

export interface AiSettings {
  consented: boolean;
  consentedAt: string | null;
  preferredModelId: string | null;
  classifyMerchants?: boolean;
  monthTokens: number;
  monthBudget: number;
  monthCostUsd: number;
  monthRequests: number;
}

export interface TraceEntry {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
  external?: boolean;
  pendingActionId?: string;
}

export interface ChatResult {
  conversationId: string;
  agent: string;
  answer: string;
  refused: boolean;
  /** true when the answer used the user's own data — computed by PointWise, never sent to the AI provider */
  private: boolean;
  model: {
    id: string;
    displayName: string;
    provider: string;
    demo: boolean;
  } | null;
  trace: TraceEntry[];
  pendingActions: Array<{ id: string; summary: string }>;
  disclaimer: string;
}

export interface ChatTurn {
  id: string;
  question: string;
  result?: ChatResult;
  error?: string;
  /** streamed text and tool progress while the answer is being generated */
  live?: {
    text: string;
    tools: Array<{ name: string; status: 'running' | 'done' | 'error' }>;
  };
}

export const SUGGESTED_QUESTIONS = [
  'What benefits have I not used this year?',
  'Which card should I use at Costco?',
  'Which family member should apply next?',
  'Best transfer partners for my points?',
  'What is my current 5/24 status?',
  'What benefits expire in the next 30 days?',
  'What card should I open next?',
  'What cards should I cancel?',
  'How much value have I received from my cards?',
];

export const TOOL_LABEL: Record<string, string> = {
  get_five24_status: '5/24 status',
  get_benefit_summary: 'Benefits',
  get_portfolio_value: 'Portfolio value',
  get_card_details: 'Card details',
  get_household: 'Household',
  best_card_for: 'Best card',
  search_card_catalog: 'Card catalog',
  compare_cards: 'Card comparison',
  get_renewals: 'Annual fees',
  get_point_valuations: 'Point valuations',
  get_offers: 'Offers',
  log_benefit_usage: 'Log benefit use',
  get_card_offer_history: 'Offer history',
  recommend_next_card: 'Next-card scorer',
  get_transfer_options: 'Transfer options',
  plan_award: 'Award planner',
  get_transfer_partners: 'Transfer partners',
  search_card_terms: 'Card fine print',
};

export function toolLabel(name: string): string {
  if (name.startsWith('mcp_')) return `External: ${name.slice(4)}`;
  return TOOL_LABEL[name] ?? name;
}

/** "12,345 / 2,000,000 tokens (1 %)" */
export function budgetLabel(used: number, budget: number): string {
  const pctUsed = budget > 0 ? Math.min(100, Math.round((used / budget) * 100)) : 0;
  return `${used.toLocaleString('en-US')} / ${budget.toLocaleString('en-US')} tokens (${pctUsed}%)`;
}

export function usd(n: number): string {
  return n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`;
}

/** Splits an answer into paragraphs/bullets for rendering without HTML injection. */
export function answerLines(text: string): Array<{ bullet: boolean; text: string }> {
  return text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const m = /^\s*(?:[•\-*]|\d+\.)\s+(.*)$/.exec(l);
      return m ? { bullet: true, text: m[1] } : { bullet: false, text: l.trim() };
    });
}

// ───────────── streaming (POST /ai/chat/stream, server-sent events) ─────────────

export type StreamEvent =
  | { type: 'start'; conversationId: string; agent: string }
  | { type: 'delta'; text: string }
  | { type: 'reset' }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error' }
  | { type: 'done'; result: ChatResult }
  | { type: 'error'; status: number; message: string };

/** Parses complete SSE blocks from a buffer; returns the events and the unfinished remainder. */
export function parseSse(buffer: string): {
  events: StreamEvent[];
  rest: string;
} {
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? '';
  const events: StreamEvent[] = [];
  for (const b of blocks) {
    const data = b
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as StreamEvent);
    } catch {
      /* ignore malformed block */
    }
  }
  return { events, rest };
}

/** Live state of a streamed answer: text so far and tool progress. */
export interface StreamState {
  text: string;
  tools: Array<{ name: string; status: 'running' | 'done' | 'error' }>;
}

export function applyStreamEvent(s: StreamState, e: StreamEvent): StreamState {
  switch (e.type) {
    case 'delta':
      return { ...s, text: s.text + e.text };
    case 'reset':
      return { ...s, text: '' };
    case 'tool': {
      const i = s.tools.findIndex((t) => t.name === e.name && t.status === 'running');
      if (e.status !== 'running' && i >= 0)
        return {
          ...s,
          tools: s.tools.map((t, j) => (j === i ? { ...t, status: e.status } : t)),
        };
      return { ...s, tools: [...s.tools, { name: e.name, status: e.status }] };
    }
    default:
      return s;
  }
}

/**
 * Streams a chat turn. Resolves with the final result; throws ApiLikeError on an error event or
 * HTTP failure. `onEvent` receives every event as it arrives.
 */
export async function streamChat(body: Record<string, unknown>, token: string | undefined, onEvent: (e: StreamEvent) => void, fetchFn: typeof fetch = fetch): Promise<ChatResult> {
  const res = await fetchFn('/api/v1/ai/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    let msg = res.statusText || 'Request failed';
    try {
      const j = (await res.json()) as { message?: string | string[] };
      msg = Array.isArray(j.message) ? j.message.join(', ') : (j.message ?? msg);
    } catch {
      /* not JSON */
    }
    throw new StreamError(res.status, msg);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += decoder.decode(value, { stream: true });
    const parsed = parseSse(done ? `${buf}\n\n` : buf);
    buf = parsed.rest;
    for (const e of parsed.events) {
      onEvent(e);
      if (e.type === 'done') return e.result;
      if (e.type === 'error') throw new StreamError(e.status, e.message);
    }
    if (done) break;
  }
  throw new StreamError(502, 'The answer stream ended unexpectedly.');
}

export class StreamError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

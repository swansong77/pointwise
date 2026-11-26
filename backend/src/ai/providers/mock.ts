import {
  ChatRequest,
  ChatResponse,
  LlmProvider,
  ProviderError,
  ToolCall,
} from "../types";

/**
 * Deterministic offline "model" for tests, CI and keyless demos (enabled with AI_ENABLE_MOCK=true).
 * It picks a tool by keywords, then answers from the tool's `summary`. Not an LLM — answers are
 * labelled as demo output in the UI.
 */
const RULES: Array<{
  re: RegExp;
  tool: string;
  args?: (q: string) => Record<string, unknown>;
}> = [
  {
    re: /5\s*\/\s*24|five.?twenty.?four|apply next|application timing/i,
    tool: "get_five24_status",
  },
  {
    re: /fine print|card terms|\bterms\b|lounge|insurance|protection|does (?:the )?[A-Z][\w ]+? (?:include|cover|have|offer)/i,
    tool: "search_card_terms",
    args: termsArgs,
  },
  { re: /log|record|i used/i, tool: "log_benefit_usage", args: logArgs },
  {
    re: /expire|expiring/i,
    tool: "get_benefit_summary",
    args: () => ({ status: "expiring", withinDays: 30 }),
  },
  {
    re: /benefit|credit|unused|not used/i,
    tool: "get_benefit_summary",
    args: (q) => ({
      status: /not used|unused|missed/i.test(q) ? "available" : "available",
    }),
  },
  { re: /compare|versus|\bvs\.?\b/i, tool: "compare_cards", args: compareArgs },
  { re: /cancel|annual fee|renew|keep/i, tool: "get_renewals" },
  {
    re: /(use|card) (at|for) (.+)/i,
    tool: "best_card_for",
    args: (q) => ({ query: /(?:at|for) ([^?.!]+)/i.exec(q)?.[1]?.trim() ?? q }),
  },
  {
    re: /who should (apply|open|get)/i,
    tool: "recommend_next_card",
    args: (q) => ({
      card: /(?:apply for|open|get) (?:the )?(.+?)[?.!]*$/i.exec(q)?.[1] ?? "",
    }),
  },
  {
    re: /open next|new card|next card|which card should (?:i|we|each of us) (open|get)|recommend/i,
    tool: "recommend_next_card",
    args: (q) => ({ member: /for (\w+)\b/i.exec(q)?.[1] ?? "" }),
  },
  {
    re: /open next|new card|which card should i (open|get)|recommend/i,
    tool: "search_card_catalog",
    args: () => ({}),
  },
  {
    re: /(?:award|book|redeem).*?(\d[\d,]*)\s*(?:k\b)?/i,
    tool: "plan_award",
    args: awardArgs,
  },
  {
    re: /transfer partners? (?:for|of) [A-Z][A-Z_]{2,}/,
    tool: "get_transfer_partners",
    args: (q) => ({
      currency: /(?:for|of) ([A-Z][A-Z_]{2,})/.exec(q)?.[1] ?? "",
    }),
  },
  { re: /transfer|my points|my miles/i, tool: "get_transfer_options" },
  {
    re: /tell me about|details (?:of|for|on)/i,
    tool: "get_card_details",
    args: (q) => ({
      card:
        /(?:about|of|for|on) (?:my )?(.+?)(?: card)?[?.!]*$/i.exec(q)?.[1] ?? q,
    }),
  },
  { re: /household|family|spouse/i, tool: "get_household" },
  {
    re: /transfer|points|miles|travel|valuation/i,
    tool: "get_point_valuations",
  },
  { re: /value|worth|getting enough|how much/i, tool: "get_portfolio_value" },
  {
    re: /offer history|good (?:welcome )?offer|elevated/i,
    tool: "get_card_offer_history",
    args: (q) => ({
      card:
        /(?:of|for|on|is the) (?:the )?(.+?)(?: (?:offer|card|a good).*)?[?.!]*$/i.exec(
          q,
        )?.[1] ?? q,
    }),
  },
  { re: /offer/i, tool: "get_offers" },
];

function termsArgs(q: string) {
  const card =
    /(?:[Dd]oes|[Dd]o) (?:the |my )?([A-Z][\w]*(?: [A-Z][\w]*)*)/.exec(q)?.[1];
  const what =
    /(?:include|cover|have|offer|about|for|mention)s? (.+?)[?.!]*$/i.exec(
      q,
    )?.[1] ?? q;
  return {
    query: what.replace(/^(?:any |a |an )/i, ""),
    ...(card && { card }),
  };
}

function awardArgs(q: string) {
  const m = /(\d[\d,]*)\s*(k\b)?/i.exec(q);
  const n = m ? Number(m[1].replace(/,/g, "")) * (m[2] ? 1000 : 1) : 0;
  const program =
    /(?:on|with|in|using) ([A-Z][\w]+(?: [A-Z][\w]+)?)/.exec(q)?.[1] ?? "";
  return { program, points: n };
}

function compareArgs(q: string) {
  const m = /compare (.+?) (?:versus|vs\.?|and|with) (.+?)[?.!]*$/i.exec(q);
  return { cards: m ? [m[1].trim(), m[2].trim()] : [] };
}

function logArgs(q: string) {
  const amount = /\$?(\d+(?:\.\d{1,2})?)/.exec(q)?.[1];
  const benefit = /(?:of|on|from) (?:my )?(.+?)(?: on | from |$)/i.exec(q)?.[1];
  return { benefit: benefit ?? q, amountDollars: amount ? Number(amount) : 0 };
}

/**
 * Card research (tests / keyless demo): a fixed answer pointing at MOCK_RESEARCH_BASE_URL. It includes
 * one off-domain card and one fact that is not on the page, so the evidence checks have something to drop.
 */
const LEAD_URL =
  "https://www.doctorofcredit.com/pointwise-demo-elevated-offer/";

function mockResearch(
  q: string,
  usage: ChatResponse["usage"],
  model: string,
): ChatResponse {
  const base = (
    process.env.MOCK_RESEARCH_BASE_URL ?? "https://www.chase.com/pointwise-demo"
  ).replace(/\/+$/, "");
  const issuer = /^Issuer: (.+)$/m.exec(q)?.[1]?.trim() ?? "Demo Bank";
  const name =
    /^Card: (.+)$/m.exec(q)?.[1]?.trim() ?? `${issuer} Everyday Research Card`;
  const news = /^Task: scan card news/m.test(q);
  const leadsAllowed = /Lead sites you may read/.test(q);
  const input = {
    cards: [
      {
        name,
        issuer,
        network: "VISA",
        type: "PERSONAL",
        productUrl: `${base}/research-card`,
        rewardsProgram: "Research Points",
        facts: [
          { field: "annualFeeCents", value: 9500, evidence: "$95 annual fee" },
          // news scan: a "fact" quoted from the lead article, not the issuer page — must be dropped
          ...(news
            ? [
                {
                  field: "bonusAmount",
                  value: 100000,
                  evidence: "Earn 100,000 bonus points",
                },
              ]
            : []),
          {
            field: "bonusType",
            value: "POINTS",
            evidence: "Earn 60,000 bonus points",
          },
          {
            field: "bonusAmount",
            value: 60000,
            evidence: "Earn 60,000 bonus points",
          },
          {
            field: "bonusSpendCents",
            value: 400000,
            evidence:
              "after you spend $4,000 on purchases in the first 3 months",
          },
          {
            field: "bonusMonths",
            value: 3,
            evidence:
              "after you spend $4,000 on purchases in the first 3 months",
          },
          {
            field: "foreignTxFee",
            value: false,
            evidence: "No foreign transaction fees",
          },
          {
            field: "authorizedUserFeeCents",
            value: 0,
            evidence: "this fact is not on the page",
          },
        ],
        rewards: [
          {
            category: "dining",
            rate: 3,
            description: "3X points on dining",
            evidence: "3X points on dining at restaurants",
          },
          {
            category: "groceries",
            rate: 2,
            description: "2X points at grocery stores",
            evidence: "2X points at grocery stores",
          },
          {
            category: "everything-else",
            rate: 10,
            description: "10X everywhere",
            evidence: "10X points on everything",
          },
        ],
        features: [
          {
            text: "No foreign transaction fees",
            evidence: "No foreign transaction fees",
          },
        ],
        // leads: only links on lead sites are kept
        ...(leadsAllowed && {
          leads: [
            { url: LEAD_URL, title: "Elevated offer (demo lead)" },
            {
              url: "https://some-other-blog.example/post",
              title: "not a lead site",
            },
          ],
        }),
      },
      {
        name: "Copycat Card",
        issuer,
        network: "VISA",
        productUrl: "https://aggregator.example/copycat",
      },
    ],
    notes: "Demo research result (offline model).",
  };
  return {
    text: "",
    toolCalls: [{ id: "mock_research", name: "submit_card_research", input }],
    stopReason: "tool_use",
    usage,
    servedModel: model,
    webPages: [
      {
        url: `${base}/research-card`,
        title: `${name} | ${issuer}`,
        via: "search",
      },
      ...(leadsAllowed
        ? [
            {
              url: LEAD_URL,
              title: "Elevated offer (demo lead)",
              text: "Earn 100,000 bonus points with this targeted elevated offer.",
              via: "fetch" as const,
            },
          ]
        : []),
    ],
    serverToolUse: { webSearch: 1, webFetch: 1 },
  };
}

export class MockProvider implements LlmProvider {
  readonly kind = "MOCK" as const;
  calls = 0;

  constructor(private readonly opts: { failWith?: ProviderError } = {}) {}

  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.calls++;
    if (this.opts.failWith) throw this.opts.failWith;
    const last = req.messages[req.messages.length - 1];
    const usage = {
      inputTokens: Math.ceil(JSON.stringify(req.messages).length / 4),
      outputTokens: 40,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    };
    if (last?.role === "tool") {
      const lines = last.results.map((r) => {
        if (r.isError) return `I couldn't get that (${r.name}): ${r.content}`;
        try {
          const parsed = JSON.parse(r.content) as { summary?: string };
          return parsed.summary ?? r.content.slice(0, 500);
        } catch {
          return r.content.slice(0, 500);
        }
      });
      return {
        text: lines.join("\n"),
        toolCalls: [],
        stopReason: "end",
        usage,
        servedModel: req.model,
      };
    }
    const q = last?.role === "user" ? last.text : "";
    const available = new Set(req.tools.map((t) => t.name));
    if (available.has("submit_card_research"))
      return mockResearch(q, usage, req.model);
    const rule = RULES.find((r) => r.re.test(q) && available.has(r.tool));
    if (!rule) {
      return {
        text: 'I can answer questions about your cards, benefits, 5/24 status, household and rewards. Try "What is my current 5/24 status?"',
        toolCalls: [],
        stopReason: "end",
        usage,
        servedModel: req.model,
      };
    }
    const call: ToolCall = {
      id: `mock_${this.calls}`,
      name: rule.tool,
      input: rule.args ? rule.args(q) : {},
    };
    return {
      text: "",
      toolCalls: [call],
      stopReason: "tool_use",
      usage,
      servedModel: req.model,
    };
  }

  /** Emits the answer in word-sized chunks, like a real streaming model. */
  async chatStream(
    req: ChatRequest,
    onText: (delta: string) => void,
  ): Promise<ChatResponse> {
    const r = await this.chat(req);
    for (const piece of r.text.match(/\S+\s*/g) ?? []) onText(piece);
    return r;
  }
}

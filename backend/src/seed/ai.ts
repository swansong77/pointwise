/* eslint-disable no-console */
/**
 * AI platform seed (idempotent, create-only: admin edits are never overwritten).
 * Keys are never seeded — providers read them from environment variables (apiKeyEnv) or an admin
 * stores one encrypted via the admin API. Only Anthropic (if ANTHROPIC_API_KEY is set) and the demo
 * mock provider (if AI_ENABLE_MOCK=true) are usable out of the box; the rest start disabled.
 */
import { AiProviderKind, PrismaClient } from "@prisma/client";
import { AGENT_DEFAULTS } from "../ai/agents";

interface P {
  name: string;
  kind: AiProviderKind;
  apiKeyEnv?: string;
  baseUrl?: string;
  apiVersion?: string;
  active: boolean;
  models: Array<{
    modelId: string;
    displayName: string;
    ctx?: number;
    out?: number;
    price?: [number, number, number | null];
    caps: string[];
    active?: boolean;
  }>;
}

const CLAUDE_CAPS = [
  "tools",
  "vision",
  "thinking",
  "effort",
  "fallbacks",
  "caching",
  "web_search",
];

export const PROVIDERS: P[] = [
  {
    name: "Anthropic",
    kind: "ANTHROPIC",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    active: true,
    models: [
      {
        modelId: "claude-opus-5-5",
        displayName: "Claude Opus 5.5",
        ctx: 1_000_000,
        out: 128_000,
        price: [4, 20, 0.2],
        caps: CLAUDE_CAPS,
      },
      {
        modelId: "claude-sonnet-5-5",
        displayName: "Claude Sonnet 5.5",
        ctx: 1_000_000,
        out: 128_000,
        price: [2, 10, 0.1],
        caps: CLAUDE_CAPS,
      },
      {
        modelId: "claude-haiku-5-5",
        displayName: "Claude Haiku 5.5",
        ctx: 1_000_000,
        out: 128_000,
        price: [0.1, 0.5, null],
        caps: [
          "tools",
          "vision",
          "thinking",
          "effort",
          "caching",
          "web_search",
        ],
      },
    ],
  },
  // Example entries — verify model ids and prices with the provider, then enable in the admin UI.
  {
    name: "OpenAI",
    kind: "OPENAI",
    apiKeyEnv: "OPENAI_API_KEY",
    active: false,
    models: [
      {
        modelId: "gpt-5",
        displayName: "GPT-5",
        caps: ["tools", "vision", "effort"],
        active: false,
      },
      {
        modelId: "gpt-5-mini",
        displayName: "GPT-5 mini",
        caps: ["tools", "effort"],
        active: false,
      },
    ],
  },
  {
    name: "Google Gemini",
    kind: "GEMINI",
    apiKeyEnv: "GEMINI_API_KEY",
    active: false,
    models: [
      {
        modelId: "gemini-2.5-pro",
        displayName: "Gemini Pro",
        caps: ["tools", "vision", "thinking"],
        active: false,
      },
      {
        modelId: "gemini-2.5-flash",
        displayName: "Gemini Flash",
        caps: ["tools", "vision"],
        active: false,
      },
    ],
  },
  {
    name: "Azure OpenAI",
    kind: "AZURE_OPENAI",
    apiKeyEnv: "AZURE_OPENAI_API_KEY",
    apiVersion: "2024-10-21",
    active: false,
    models: [],
  },
  {
    name: "xAI Grok",
    kind: "OPENAI_COMPATIBLE",
    apiKeyEnv: "XAI_API_KEY",
    baseUrl: "https://api.x.ai/v1",
    active: false,
    models: [],
  },
  {
    name: "Mistral",
    kind: "OPENAI_COMPATIBLE",
    apiKeyEnv: "MISTRAL_API_KEY",
    baseUrl: "https://api.mistral.ai/v1",
    active: false,
    models: [],
  },
  {
    name: "DeepSeek",
    kind: "OPENAI_COMPATIBLE",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    baseUrl: "https://api.deepseek.com/v1",
    active: false,
    models: [],
  },
  {
    name: "OpenRouter",
    kind: "OPENAI_COMPATIBLE",
    apiKeyEnv: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    active: false,
    models: [],
  },
  {
    // OpenClaw gateway (self-hosted, MIT): OpenAI-compatible endpoint on its own port. Off until you run a gateway
    // and set OPENCLAW_GATEWAY_TOKEN. Treated as NON-local for privacy: it only ever receives public data
    // (docs/openclaw-integration.md, ADR-006).
    name: "OpenClaw (self-hosted gateway)",
    kind: "OPENAI_COMPATIBLE",
    apiKeyEnv: "OPENCLAW_GATEWAY_TOKEN",
    baseUrl:
      process.env.OPENCLAW_BASE_URL ?? "http://host.docker.internal:18789/v1",
    active: false,
    models: [
      {
        modelId: "openclaw/default",
        displayName: "OpenClaw default agent",
        caps: [],
        active: false,
      },
    ],
  },
  {
    name: "Ollama (local)",
    kind: "OLLAMA",
    baseUrl:
      process.env.OLLAMA_BASE_URL ?? "http://host.docker.internal:11434/v1",
    active: false,
    models: [
      {
        modelId: "llama3.1",
        displayName: "Llama 3.1 (local)",
        caps: ["tools"],
        active: false,
      },
    ],
  },
  {
    name: "Pointwise demo (offline)",
    kind: "MOCK",
    active: true,
    models: [
      {
        modelId: "pointwise-demo",
        displayName: "Demo model (offline, no AI)",
        price: [0, 0, 0],
        caps: ["tools"],
      },
    ],
  },
];

export async function seedAi(prisma: PrismaClient) {
  const ids: Record<string, string> = {};
  let order = 0;
  for (const p of PROVIDERS) {
    const row = await prisma.aiProvider.upsert({
      where: { name: p.name },
      update: {},
      create: {
        name: p.name,
        kind: p.kind,
        apiKeyEnv: p.apiKeyEnv,
        baseUrl: p.baseUrl,
        apiVersion: p.apiVersion,
        status: p.active ? "ACTIVE" : "DISABLED",
      },
    });
    for (const m of p.models) {
      const model = await prisma.aiModel.upsert({
        where: {
          providerId_modelId: { providerId: row.id, modelId: m.modelId },
        },
        update: {},
        create: {
          providerId: row.id,
          modelId: m.modelId,
          displayName: m.displayName,
          contextWindow: m.ctx,
          maxOutputTokens: m.out,
          inputPrice: m.price?.[0],
          outputPrice: m.price?.[1],
          cacheReadPrice: m.price?.[2],
          capabilities: m.caps,
          status: m.active === false ? "DISABLED" : "ACTIVE",
          sortOrder: order++,
        },
      });
      ids[m.modelId] = model.id;
    }
  }
  const chain = [
    ids["claude-opus-5-5"],
    ids["claude-sonnet-5-5"],
    ids["pointwise-demo"],
  ].filter(Boolean);
  for (const [i, a] of AGENT_DEFAULTS.entries()) {
    const existing = await prisma.agentProfile.findUnique({
      where: { key: a.key },
      select: { tools: true },
    });
    const added = existing
      ? a.tools.filter((t) => !existing.tools.includes(t))
      : [];
    await prisma.agentProfile.upsert({
      where: { key: a.key },
      update: added.length ? { tools: [...existing!.tools, ...added] } : {},
      create: {
        key: a.key,
        name: a.name,
        description: a.description,
        systemPrompt: a.prompt,
        tools: a.tools,
        modelChain: chain,
        effort: a.effort,
        maxSteps: a.maxSteps,
        sortOrder: i,
      },
    });
  }
  console.log(
    `ai seeded: ${PROVIDERS.length} providers, ${Object.keys(ids).length} models, ${AGENT_DEFAULTS.length} agents`,
  );
}

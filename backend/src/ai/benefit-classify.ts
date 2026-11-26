import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaService } from "../common/prisma.service";
import { ALIAS_GROUPS } from "../domain/benefit-aliases";
import { MerchantClassifier, SpendService } from "../spend/spend.service";
import { ModelRouter } from "./router";

/**
 * AI tier of benefit detection. PRIVACY: the model receives ONE cleaned merchant string
 * ("uber eats") and the fixed list of generic benefit groups below. It never sees amounts, dates,
 * card digits, cardholder names, which cards the user owns, or any statement text.
 * Off unless the user turns on "classify merchants" (AiSettings.classifyMerchants).
 */
export const GROUP_HINTS: Record<string, string> = {
  uber: "Uber rides, Uber Eats, Uber One",
  "dining-gold": "restaurants and food delivery: Grubhub, Seamless, Shake Shack, Five Guys, Cheesecake Factory, Goldbelly, Wine.com",
  resy: "Resy restaurant reservations",
  "digital-entertainment": "streaming, news and audio subscriptions: Disney+, Hulu, ESPN+, Peacock, Audible, SiriusXM, New York Times",
  airline: "airline incidental fees: baggage, seat selection, lounge day passes",
  clear: "CLEAR / CLEAR Plus airport identity membership",
  walmart: "Walmart+ membership",
  hotel: "hotel bookings: Fine Hotels + Resorts, The Hotel Collection, Amex Travel",
  saks: "Saks Fifth Avenue",
  equinox: "Equinox gyms and SoulCycle",
  "global-entry": "Global Entry, TSA PreCheck, NEXUS application fees",
  lululemon: "lululemon retail",
};

export const SYSTEM_PROMPT = [
  "You classify one merchant name from a credit card statement into a benefit group, or none.",
  "Groups:",
  ...ALIAS_GROUPS.map((g) => `- ${g.key}: ${GROUP_HINTS[g.key] ?? g.aliases.join(", ")}`),
  'Reply with JSON only: {"group": "<group key or null>", "confidence": <0-100>, "reasoning": "<one short sentence>"}.',
  "Use null when the merchant does not clearly belong to a group. Do not guess.",
].join("\n");

export interface Classification {
  group: string;
  confidence: number;
  reasoning: string;
}

/** Reads the model's JSON reply; anything unexpected is "no classification". */
export function parseClassification(text: string): Classification | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  let o: unknown;
  try {
    o = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const r = o as Record<string, unknown>;
  const group = typeof r.group === "string" ? r.group : null;
  if (!group || !ALIAS_GROUPS.some((g) => g.key === group)) return null;
  const confidence = Number(r.confidence);
  if (!Number.isFinite(confidence)) return null;
  return {
    group,
    confidence: Math.max(0, Math.min(100, Math.round(confidence))),
    reasoning: typeof r.reasoning === "string" ? r.reasoning.slice(0, 500) : "",
  };
}

@Injectable()
export class BenefitClassifyService implements MerchantClassifier, OnModuleInit {
  private readonly logger = new Logger(BenefitClassifyService.name);
  /** merchant string → answer (also null answers) so a merchant is asked about once per process */
  private readonly cache = new Map<string, Classification | null>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly router: ModelRouter,
    private readonly spend: SpendService,
  ) {}

  onModuleInit() {
    this.spend.classifier = this;
  }

  async classify(userId: string, merchant: string): Promise<Classification | null> {
    const settings = await this.prisma.aiSettings.findUnique({ where: { userId } });
    if (!settings?.classifyMerchants) return null;
    const key = merchant.toLowerCase();
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const usable = await this.router.usableModels();
    const preferred = usable.find((m) => m.id === settings.preferredModelId);
    const chain = preferred ? [preferred, ...usable.filter((m) => m !== preferred)] : usable;
    if (!chain.length) return null;
    try {
      const { response } = await this.router.chat(
        chain,
        {
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", text: `Merchant: ${merchant}` }],
          tools: [],
          maxTokens: 200,
          effort: "low",
        },
        { userId, agentKey: "benefit-classify" },
      );
      const result = parseClassification(response.text);
      this.cache.set(key, result);
      return result;
    } catch (e) {
      this.logger.warn(`merchant classification skipped: ${(e as Error).message}`);
      return null;
    }
  }
}

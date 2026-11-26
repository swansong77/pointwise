import { readFileSync } from "fs";
import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import { htmlToText } from "../../../src/domain/card-extract";
import {
  canon,
  Candidate,
  currencyCode,
  findingsOf,
  isCashProgram,
  issuerMatches,
  matchCatalog,
  nameKey,
  normaliseCandidates,
  quoteOnPage,
  researchPrompt,
  researchToolSpec,
  sameUrl,
  slugify,
  verifyCandidate,
  DEFAULT_LEAD_DOMAINS,
  isLeadUrl,
  leadDomains,
} from "../../../src/domain/card-research";
import {
  validateSourceUrl,
  DEFAULT_ISSUER_DOMAINS,
} from "../../../src/catalog-refresh/fetcher";
import { AnthropicProvider } from "../../../src/ai/providers/anthropic";
import { MockProvider } from "../../../src/ai/providers/mock";
import { OpenAiProvider } from "../../../src/ai/providers/openai";
import { CATEGORIES } from "../../../src/seed/categories";
import {
  REAL_CARDS,
  REAL_CURRENCIES,
  REAL_ISSUERS,
  REAL_MERCHANTS,
  ISSUER_REGISTRY,
} from "../../../src/seed/real-catalog.data";

/** Card-research agent: payload normalisation, evidence checks, catalog matching, provider server tools, curated real-card data. */
const categories = CATEGORIES.map((c) => c[0]);
const page = htmlToText(
  readFileSync(
    join(__dirname, "../../fixtures/pages/research-card.html"),
    "utf8",
  ),
);
const opts = {
  categories,
  validateUrl: (u: string) =>
    void validateSourceUrl(u, {
      CARD_SOURCE_HTTP_HOSTS: "",
    } as NodeJS.ProcessEnv),
};

const raw = {
  cards: [
    {
      name: "Everyday Research Card®",
      issuer: "Chase",
      network: "VISA",
      type: "PERSONAL",
      productUrl: "https://www.chase.com/cards/research",
      rewardsProgram: "Chase Ultimate Rewards",
      facts: [
        { field: "annualFeeCents", value: 9500, evidence: "$95 annual fee" },
        {
          field: "bonusAmount",
          value: 60000,
          evidence: "Earn 60,000 bonus points",
        },
        {
          field: "bonusSpendCents",
          value: 400000,
          evidence: "after you spend $4,000 on purchases in the first 3 months",
        },
        {
          field: "foreignTxFee",
          value: false,
          evidence: "No foreign transaction fees",
        },
        {
          field: "authorizedUserFeeCents",
          value: 0,
          evidence: "not on the page at all",
        },
        { field: "madeUp", value: 1, evidence: "x" },
      ],
      rewards: [
        {
          category: "dining",
          rate: 3,
          description: "3X dining",
          evidence: "3X points on dining at restaurants",
        },
        {
          category: "groceries",
          rate: 5,
          description: "5X groceries",
          evidence: "2X points at grocery stores",
        }, // rate not in the quote
        {
          category: "everything-else",
          rate: 10,
          description: "10X",
          evidence: "10X points on everything everywhere",
        }, // not on the page
        {
          category: "not-a-category",
          rate: 2,
          description: "x",
          evidence: "x",
        },
        { category: "gas", rate: 99, description: "x", evidence: "x" },
      ],
      features: [
        { text: "No FTF", evidence: "No foreign transaction fees" },
        { text: "Lounge", evidence: "Complimentary lounge access" },
      ],
    },
    {
      name: "Everyday Research Card",
      issuer: "chase",
      productUrl: "https://www.chase.com/cards/research",
    }, // duplicate
    {
      name: "Copycat",
      issuer: "Chase",
      productUrl: "https://aggregator.example/copycat",
    },
    {
      name: "Plain http",
      issuer: "Chase",
      productUrl: "http://www.chase.com/x",
    },
    { issuer: "Chase", productUrl: "https://www.chase.com/x" },
    "garbage",
  ],
  notes: "Some pages did not load.",
};

describe("normaliseCandidates", () => {
  it("drops off-domain, non-https, nameless and duplicate cards and invalid facts/rates/categories", () => {
    const r = normaliseCandidates(raw, opts);
    expect(r.candidates).toHaveLength(1);
    expect(r.dropped.join("\n")).toMatch(
      /aggregator\.example is not an allow-listed issuer domain/,
    );
    expect(r.dropped.join("\n")).toMatch(/must use https/);
    expect(r.dropped.filter((d) => /without a name/.test(d))).toHaveLength(2);
    const c = r.candidates[0];
    expect(c.name).toBe("Everyday Research Card"); // ® removed
    expect(c.facts.map((f) => f.field)).toEqual([
      "annualFeeCents",
      "bonusAmount",
      "bonusSpendCents",
      "foreignTxFee",
      "authorizedUserFeeCents",
    ]);
    expect(c.rewards.map((x) => x.category)).toEqual([
      "dining",
      "groceries",
      "everything-else",
    ]);
    expect(r.notes).toBe("Some pages did not load.");
  });
  it("tolerates junk input", () => {
    expect(normaliseCandidates(null, opts).candidates).toEqual([]);
    expect(normaliseCandidates({ cards: "x" }, opts).candidates).toEqual([]);
  });
});

describe("verifyCandidate", () => {
  const [c] = normaliseCandidates(raw, opts).candidates;
  it("keeps only facts whose quote is on the page and states the value", () => {
    const { candidate, verification } = verifyCandidate(c, page);
    expect(candidate.facts.map((f) => f.field).sort()).toEqual([
      "annualFeeCents",
      "bonusAmount",
      "bonusSpendCents",
      "foreignTxFee",
    ]);
    expect(candidate.facts.every((f) => f.verified)).toBe(true);
    expect(candidate.rewards.map((r) => `${r.category}:${r.rate}`)).toEqual([
      "dining:3",
    ]);
    expect(candidate.features.map((f) => f.text)).toEqual(["No FTF"]);
    expect(verification).toEqual({ status: "PARTIAL", verified: 6, total: 10 });
    expect(findingsOf(candidate).map((f) => f.field)).toContain(
      "annualFeeCents",
    );
  });
  it("a quote from the page cannot verify a different value", () => {
    const bad = {
      ...c,
      facts: [
        {
          field: "annualFeeCents" as const,
          value: 0,
          evidence: "$95 annual fee",
          verified: false,
        },
      ],
    };
    expect(verifyCandidate(bad, page).candidate.facts).toEqual([]);
  });
  it("all facts on the page → VERIFIED; no page → UNVERIFIED with everything kept", () => {
    const good: Candidate = {
      ...c,
      facts: c.facts.slice(0, 2),
      rewards: c.rewards.slice(0, 1),
      features: c.features.slice(0, 1),
    };
    expect(verifyCandidate(good, page).verification.status).toBe("VERIFIED");
    const none = verifyCandidate(c, null);
    expect(none.verification).toEqual({
      status: "UNVERIFIED",
      verified: 0,
      total: 10,
    });
    expect(none.candidate.facts).toHaveLength(5);
    expect(
      verifyCandidate({ ...c, facts: [], rewards: [], features: [] }, page)
        .verification.status,
    ).toBe("UNVERIFIED");
  });
  it("quotes taken from instruction-like text planted on the page are not evidence", () => {
    expect(quoteOnPage(page, "10X points on everything")).toBe(false);
    expect(quoteOnPage(page, "$95 annual fee")).toBe(true);
    const planted = {
      ...c,
      rewards: [
        {
          category: "everything-else",
          rate: 10,
          description: "10X",
          evidence: "10X points on everything",
          verified: false,
        },
      ],
    };
    expect(verifyCandidate(planted, page).candidate.rewards).toEqual([]);
  });
  it("typography differences between the quote and the page still match", () => {
    expect(canon("Chase Sapphire Preferred® Card — 3x on dining ")).toBe(
      "Chase Sapphire Preferred Card - 3x on dining",
    );
    expect(
      quoteOnPage("Cardmember’s “benefits”", 'cardmember\'s "benefits"'),
    ).toBe(true);
    expect(quoteOnPage(null, "anything")).toBe(false);
    expect(quoteOnPage("abc", "ab")).toBe(false);
  });
});

describe("lead sites (card news / community)", () => {
  it("defaults to Doctor of Credit, The Points Guy and MileMoa; configurable; empty disables", () => {
    expect(leadDomains({} as NodeJS.ProcessEnv)).toEqual([
      "doctorofcredit.com",
      "thepointsguy.com",
      "milemoa.com",
    ]);
    expect(
      leadDomains({
        CARD_RESEARCH_LEAD_DOMAINS: " Example.com, ,b.org",
      } as NodeJS.ProcessEnv),
    ).toEqual(["example.com", "b.org"]);
    expect(
      leadDomains({ CARD_RESEARCH_LEAD_DOMAINS: "" } as NodeJS.ProcessEnv),
    ).toEqual([]);
    expect(
      isLeadUrl(
        "https://www.milemoa.com/bbs/board.php?bo_table=card",
        DEFAULT_LEAD_DOMAINS,
      ),
    ).toBe(true);
    expect(
      isLeadUrl("http://www.doctorofcredit.com/x", DEFAULT_LEAD_DOMAINS),
    ).toBe(false);
    expect(
      isLeadUrl("https://notdoctorofcredit.com/x", DEFAULT_LEAD_DOMAINS),
    ).toBe(false);
    expect(isLeadUrl("nope", DEFAULT_LEAD_DOMAINS)).toBe(false);
  });
  it("leads keep only links on lead sites; a lead site is never a product page", () => {
    const withLeads = {
      cards: [
        {
          ...(raw.cards[0] as object),
          leads: [
            { url: "https://www.thepointsguy.com/news/x/", title: "News" },
            { url: "https://aggregator.example/y", title: "Other" },
            { url: 5 },
          ],
        },
        {
          name: "Blog card",
          issuer: "Chase",
          productUrl: "https://www.doctorofcredit.com/best-cards/",
        },
      ],
    };
    const r = normaliseCandidates(withLeads, {
      ...opts,
      leadDomains: DEFAULT_LEAD_DOMAINS,
    });
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0].leads).toEqual([
      { url: "https://www.thepointsguy.com/news/x/", title: "News" },
    ]);
    expect(r.dropped.join(" ")).toMatch(
      /doctorofcredit\.com is not an allow-listed issuer domain/,
    );
    expect(normaliseCandidates(withLeads, opts).candidates[0].leads).toEqual(
      [],
    );
  });
  it("prompts name the lead sites (or forbid them) and the news task", () => {
    expect(
      researchPrompt("DISCOVER", {
        issuer: "Chase",
        limit: 5,
        leadDomains: ["doctorofcredit.com"],
      }),
    ).toMatch(
      /Lead sites you may read for discovery only: doctorofcredit\.com/,
    );
    expect(researchPrompt("DISCOVER", { issuer: "Chase", limit: 5 })).toMatch(
      /issuer website only/,
    );
    expect(
      researchPrompt("NEWS", {
        limit: 8,
        focus: "elevated offers",
        leadDomains: DEFAULT_LEAD_DOMAINS,
      }),
    ).toMatch(
      /^Task: scan card news[\s\S]*Focus: elevated offers[\s\S]*milemoa\.com[\s\S]*up to 8 cards/,
    );
  });
});

describe("matching and naming", () => {
  const chase = { name: "Chase", aliases: ["JPMorgan Chase"] };
  const amex = { name: "American Express", aliases: ["Amex"] };
  const catalog = [
    {
      id: "csp",
      name: "Chase Sapphire Preferred Card",
      issuer: chase,
      sourceUrls: [],
    },
    {
      id: "gold",
      name: "American Express Gold Card",
      issuer: amex,
      sourceUrls: [
        "https://www.americanexpress.com/us/credit-cards/card/gold-card/",
      ],
    },
  ];
  it("matches by product page or by issuer + name without marks, issuer words and filler", () => {
    expect(
      matchCatalog(
        {
          name: "Sapphire Preferred®",
          issuer: "JPMorgan Chase",
          productUrl: "https://creditcards.chase.com/x",
        },
        catalog,
      )?.id,
    ).toBe("csp");
    expect(
      matchCatalog(
        {
          name: "Something else",
          issuer: "Amex",
          productUrl:
            "https://americanexpress.com/us/credit-cards/card/gold-card",
        },
        catalog,
      )?.id,
    ).toBe("gold");
    expect(
      matchCatalog(
        {
          name: "Sapphire Reserve",
          issuer: "Chase",
          productUrl: "https://creditcards.chase.com/y",
        },
        catalog,
      ),
    ).toBeNull();
    expect(
      matchCatalog(
        {
          name: "Sapphire Preferred",
          issuer: "Citi",
          productUrl: "https://citi.com/y",
        },
        catalog,
      ),
    ).toBeNull();
  });
  it("helpers", () => {
    expect(
      nameKey("The Platinum Card® from American Express", [
        "American Express",
        "Amex",
      ]),
    ).toBe("platinum");
    expect(issuerMatches(amex, "AMEX")).toBe(true);
    expect(issuerMatches(amex, "Citi")).toBe(false);
    expect(sameUrl("https://www.chase.com/a/", "https://chase.com/a?x=1")).toBe(
      true,
    );
    expect(sameUrl("not a url", "NOT A URL")).toBe(true);
    expect(slugify("Chase", "Sapphire Preferred®")).toBe(
      "chase-sapphire-preferred",
    );
    expect(currencyCode("Membership Rewards® points")).toBe(
      "MEMBERSHIP_REWARDS_POINTS",
    );
    expect(isCashProgram("Cash back")).toBe(true);
    expect(isCashProgram(null)).toBe(true);
    expect(isCashProgram("Ultimate Rewards")).toBe(false);
  });
  it("prompts and tool schema", () => {
    expect(
      researchPrompt("DISCOVER", {
        issuer: "Chase",
        focus: "travel",
        limit: 5,
      }),
    ).toMatch(/Issuer: Chase\nFocus: travel\nReport up to 5 cards/);
    expect(
      researchPrompt("VERIFY", {
        card: {
          name: "Prime Visa",
          issuer: "Chase",
          url: "https://www.chase.com/p",
        },
        limit: 1,
      }),
    ).toMatch(/Card: Prime Visa\nIssuer: Chase\nKnown product page/);
    expect(JSON.stringify(researchToolSpec(["dining"]).inputSchema)).toContain(
      '"enum":["dining"]',
    );
  });
});

describe("server tools in providers", () => {
  const req = {
    model: "claude-sonnet-5-5",
    system: "s",
    messages: [{ role: "user" as const, text: "Issuer: Chase" }],
    tools: [researchToolSpec(categories)],
    maxTokens: 16000,
    serverTools: [
      {
        kind: "web_search" as const,
        allowedDomains: ["chase.com"],
        maxUses: 5,
      },
      { kind: "web_fetch" as const, allowedDomains: ["chase.com"], maxUses: 8 },
    ],
    timeoutMs: 600_000,
  };
  it("Claude: web search / fetch limited to the domains; pause_turn, pages and server usage are mapped", async () => {
    const create = jest.fn(async () => ({
      model: "claude-sonnet-5-5",
      stop_reason: "pause_turn",
      content: [
        {
          type: "server_tool_use",
          id: "s1",
          name: "web_search",
          input: { query: "chase cards" },
        },
        {
          type: "web_search_tool_result",
          tool_use_id: "s1",
          content: [
            {
              type: "web_search_result",
              url: "https://www.chase.com/a",
              title: "A",
              encrypted_content: "x",
              page_age: null,
            },
          ],
        },
        {
          type: "web_fetch_tool_result",
          tool_use_id: "s2",
          content: {
            type: "web_fetch_result",
            url: "https://www.chase.com/a",
            retrieved_at: null,
            content: {
              type: "document",
              title: "A",
              citations: null,
              source: {
                type: "text",
                media_type: "text/plain",
                data: "page text",
              },
            },
          },
        },
        {
          type: "web_fetch_tool_result",
          tool_use_id: "s3",
          content: {
            type: "web_fetch_tool_error",
            error_code: "url_not_accessible",
          },
        },
        {
          type: "web_search_tool_result",
          tool_use_id: "s4",
          content: {
            type: "web_search_tool_result_error",
            error_code: "max_uses_exceeded",
          },
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        server_tool_use: { web_search_requests: 1, web_fetch_requests: 2 },
      },
    }));
    const p = new AnthropicProvider({
      apiKey: "k",
      client: { beta: { messages: { create } } } as unknown as Anthropic,
    });
    const r = await p.chat(req);
    const [params, options] = create.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { timeout: number },
    ];
    const tools = params.tools as Array<Record<string, unknown>>;
    expect(tools[0].name).toBe("submit_card_research");
    expect(tools[1]).toEqual({
      type: "web_search_20260209",
      name: "web_search",
      allowed_domains: ["chase.com"],
      max_uses: 5,
    });
    expect(tools[2]).toMatchObject({
      type: "web_fetch_20260209",
      name: "web_fetch",
      allowed_domains: ["chase.com"],
      max_uses: 8,
      allowed_callers: ["direct"],
    });
    expect(options).toEqual({ timeout: 600_000 });
    expect(r.stopReason).toBe("pause");
    expect(r.webPages).toEqual([
      { url: "https://www.chase.com/a", title: "A", via: "search" },
      {
        url: "https://www.chase.com/a",
        title: "A",
        text: "page text",
        via: "fetch",
      },
    ]);
    expect(r.serverToolUse).toEqual({ webSearch: 1, webFetch: 2 });
  });
  it("OpenAI-compatible providers refuse server tools (not retryable)", async () => {
    const p = new OpenAiProvider("OPENAI", { client: {} as never });
    await expect(p.chat(req)).rejects.toMatchObject({
      code: "unsupported",
      retryable: false,
    });
  });
  it("the demo model answers research deterministically (with something for the checks to drop)", async () => {
    const r = await new MockProvider().chat({
      ...req,
      messages: [{ role: "user", text: "Task\nIssuer: Fixture Bank" }],
    });
    expect(r.toolCalls[0].name).toBe("submit_card_research");
    const cards = (
      r.toolCalls[0].input as {
        cards: Array<{ name: string; productUrl: string }>;
      }
    ).cards;
    expect(cards[0].name).toBe("Fixture Bank Everyday Research Card");
    expect(cards[1].productUrl).toMatch(/aggregator\.example/);
    expect(r.serverToolUse).toEqual({ webSearch: 1, webFetch: 1 });
  });
});

describe("curated real-card list", () => {
  const slugs = REAL_CARDS.map((c) => c.slug);
  it("references only known issuers, currencies, merchants and categories", () => {
    expect(new Set(slugs).size).toBe(slugs.length);
    const issuers = new Set(REAL_ISSUERS.map((i) => i.name));
    const currencies = new Set(["CASH", ...REAL_CURRENCIES.map((c) => c.code)]);
    const merchants = new Set(REAL_MERCHANTS.map((m) => m.slug));
    for (const c of REAL_CARDS) {
      expect(issuers.has(c.issuer)).toBe(true);
      expect(currencies.has(c.currency)).toBe(true);
      expect(c.rewards.length).toBeGreaterThan(0);
      for (const [cat, rate] of c.rewards) {
        expect(categories).toContain(cat);
        expect(rate).toBeGreaterThan(0);
        expect(rate).toBeLessThanOrEqual(12);
      }
      for (const [m] of c.merchantRewards ?? [])
        expect(merchants.has(m)).toBe(true);
      expect(c.feeDollars).toBeGreaterThanOrEqual(0);
      expect(c.feeDollars).toBeLessThan(1500);
      expect(c.name).not.toMatch(/[®™℠]/);
    }
    for (const m of REAL_MERCHANTS) expect(categories).toContain(m.category);
  });
  it("every issuer website (registry: banks and credit unions) is on the research / refresh allow-list", () => {
    for (const i of ISSUER_REGISTRY)
      expect(DEFAULT_ISSUER_DOMAINS).toContain(
        new URL(i.website).hostname.replace(/^www\./, ""),
      );
  });
  it("has broad coverage (all major issuers, personal and business)", () => {
    expect(REAL_CARDS.length).toBeGreaterThanOrEqual(110);
    for (const i of REAL_ISSUERS)
      expect(REAL_CARDS.some((c) => c.issuer === i.name)).toBe(true);
    expect(
      REAL_CARDS.filter((c) => c.type === "BUSINESS").length,
    ).toBeGreaterThanOrEqual(25);
    expect(
      REAL_ISSUERS.filter((i) => i.kind === "CREDIT_UNION").length,
    ).toBeGreaterThanOrEqual(3);
    // the registry names each institution once
    const names = ISSUER_REGISTRY.map((i) => i.name);
    expect(new Set(names).size).toBe(names.length);
    expect(
      ISSUER_REGISTRY.filter((i) => i.kind === "CREDIT_UNION").length,
    ).toBeGreaterThanOrEqual(14);
  });
});

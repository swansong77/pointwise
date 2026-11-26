import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { BonusType, Prisma } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { ModelRow, ModelRouter } from "../ai/router";
import { ChatMessage, ServerToolSpec, WebPage } from "../ai/types";
import { htmlToText } from "../domain/card-extract";
import {
  Candidate,
  CatalogEntry,
  RESEARCH_SYSTEM,
  RESEARCH_TOOL,
  currencyCode,
  factValue,
  findingsOf,
  isCashProgram,
  isLeadUrl,
  issuerMatches,
  leadDomains,
  matchCatalog,
  normaliseCandidates,
  researchPrompt,
  researchToolSpec,
  sameUrl,
  slugify,
  verifyCandidate,
} from "../domain/card-research";
import {
  allowedDomains,
  PageFetcher,
  validateSourceUrl,
} from "../catalog-refresh/fetcher";
import { CardRefreshService } from "../catalog-refresh/card-refresh.service";

const MAX_TURNS = 8;
const STALE_MS = 30 * 60_000;
const DEFAULT_LIMIT = 10;

export interface StartResearch {
  kind: "DISCOVER" | "VERIFY" | "NEWS";
  issuer?: string;
  /** let the agent read card news / community sites for leads (default true) */
  useLeads?: boolean;
  cardId?: string;
  focus?: string;
  limit?: number;
}

export interface ApproveOptions {
  /** approve a candidate whose page could not be checked (no verified facts) */
  acceptUnverified?: boolean;
  /** existing card: replace its earning rates with the candidate's verified rates */
  applyRewards?: boolean;
  /** new card with a new points currency: default value per point (¢) */
  centsPerPoint?: number;
  /** new card: use this existing currency code instead of matching by name */
  currencyCode?: string;
}

/**
 * Card-research agent: Claude with web search + web fetch restricted to issuer domains finds current
 * cards (DISCOVER) or re-checks one catalog card (VERIFY). Results become CardCandidate rows whose
 * facts were checked against the product page; an admin approves each before anything reaches the
 * catalog. Only public product information is sent to the model (no user data).
 */
@Injectable()
export class CardResearchService {
  private readonly logger = new Logger(CardResearchService.name);
  fetcher = new PageFetcher();

  constructor(
    private readonly prisma: PrismaService,
    private readonly refresh: CardRefreshService,
    @Optional() private readonly router?: ModelRouter,
  ) {}

  // ───────── models ─────────

  /** Models that can run research: Claude models (web search is a Claude server tool) or rows with the "web_search" capability. */
  async researchModels(): Promise<ModelRow[]> {
    if (!this.router) return [];
    const usable = (await this.router.usableModels()).filter(
      (m) =>
        m.provider.kind === "ANTHROPIC" ||
        m.capabilities.includes("web_search"),
    );
    const preferred = process.env.CARD_RESEARCH_MODEL;
    return preferred
      ? [
          ...usable.filter((m) => m.modelId === preferred),
          ...usable.filter((m) => m.modelId !== preferred),
        ]
      : usable;
  }

  async status() {
    const models = await this.researchModels();
    return {
      available: models.length > 0,
      models: models.map((m) => m.displayName),
      allowedDomains: allowedDomains(),
      leadDomains: leadDomains(),
      note: models.length
        ? null
        : "Card research needs a Claude model: set ANTHROPIC_API_KEY (or store a key in AI settings).",
    };
  }

  // ───────── runs ─────────

  async start(dto: StartResearch, adminId: string) {
    if (!(await this.researchModels()).length)
      throw new ServiceUnavailableException(
        "Card research needs a Claude model with web search. Configure an Anthropic key in AI settings.",
      );
    const limit = Math.min(Math.max(dto.limit ?? DEFAULT_LIMIT, 1), 25);
    let data: Prisma.CardResearchRunUncheckedCreateInput;
    if (dto.kind === "VERIFY") {
      if (!dto.cardId)
        throw new BadRequestException("cardId is required to verify a card");
      const card = await this.prisma.creditCard.findUnique({
        where: { id: dto.cardId },
        select: { id: true, ownerId: true },
      });
      if (!card || card.ownerId)
        throw new NotFoundException("Catalog card not found");
      data = {
        kind: "VERIFY",
        cardId: card.id,
        useLeads: dto.useLeads ?? true,
        requestedById: adminId,
      };
    } else if (dto.kind === "NEWS") {
      data = {
        kind: "NEWS",
        issuer: dto.issuer?.trim().slice(0, 80) || null,
        focus: dto.focus?.trim().slice(0, 200) || null,
        maxCards: limit,
        useLeads: true,
        requestedById: adminId,
      };
      if (!leadDomains().length)
        throw new BadRequestException(
          "No lead sites are configured (CARD_RESEARCH_LEAD_DOMAINS)",
        );
    } else {
      const issuer = dto.issuer?.trim();
      if (!issuer)
        throw new BadRequestException("issuer is required to discover cards");
      data = {
        kind: "DISCOVER",
        issuer: issuer.slice(0, 80),
        focus: dto.focus?.trim().slice(0, 200) || null,
        maxCards: limit,
        useLeads: dto.useLeads ?? true,
        requestedById: adminId,
      };
    }
    const run = await this.prisma.cardResearchRun.create({ data });
    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: "start",
        entity: "CardResearchRun",
        entityId: run.id,
        diff: {
          kind: dto.kind,
          issuer: dto.issuer ?? null,
          cardId: dto.cardId ?? null,
        },
      },
    });
    return run;
  }

  /** Queue a VERIFY run for every public card that no source has confirmed yet (bounded). */
  async verifyUnverified(adminId: string, max = 20) {
    if (!(await this.researchModels()).length)
      throw new ServiceUnavailableException(
        "Card research needs a Claude model with web search.",
      );
    const busy = await this.prisma.cardResearchRun.findMany({
      where: { status: { in: ["QUEUED", "RUNNING"] }, cardId: { not: null } },
      select: { cardId: true },
    });
    const cards = await this.prisma.creditCard.findMany({
      where: {
        ownerId: null,
        isActive: true,
        lastVerifiedAt: null,
        catalogSource: { not: "DEMO" },
        id: { notIn: busy.map((b) => b.cardId!) },
      },
      orderBy: [{ popularity: "desc" }, { name: "asc" }],
      take: Math.min(Math.max(max, 1), 50),
      select: { id: true },
    });
    for (const c of cards)
      await this.prisma.cardResearchRun.create({
        data: { kind: "VERIFY", cardId: c.id, requestedById: adminId },
      });
    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: "verify-unverified",
        entity: "CardResearchRun",
        entityId: "-",
        diff: { queued: cards.length },
      },
    });
    return { queued: cards.length };
  }

  /**
   * Queue a DISCOVER run for every issuer in the registry (banks, credit unions, card companies,
   * fintechs) not researched in the last `staleDays`, so new cards from all of them reach review.
   * Bounded per call; each run is billed (model tokens + web searches).
   */
  async discoverAll(
    adminId: string,
    opts: { kinds?: string[]; staleDays?: number; max?: number } = {},
    now = new Date(),
  ) {
    if (!(await this.researchModels()).length)
      throw new ServiceUnavailableException(
        "Card research needs a Claude model with web search.",
      );
    const staleBefore = new Date(
      now.getTime() - (opts.staleDays ?? 30) * 86_400_000,
    );
    const busy = await this.prisma.cardResearchRun.findMany({
      where: { status: { in: ["QUEUED", "RUNNING"] }, kind: "DISCOVER" },
      select: { issuer: true },
    });
    const issuers = await this.prisma.issuer.findMany({
      where: {
        website: { not: null },
        ...(opts.kinds?.length && { kind: { in: opts.kinds as never } }),
        OR: [
          { lastResearchedAt: null },
          { lastResearchedAt: { lt: staleBefore } },
        ],
      },
      orderBy: [
        { lastResearchedAt: { sort: "asc", nulls: "first" } },
        { name: "asc" },
      ],
      select: { name: true, website: true },
    });
    const allowed = allowedDomains();
    const todo = issuers
      .filter(
        (i) =>
          !busy.some(
            (b) => b.issuer && b.issuer.toLowerCase() === i.name.toLowerCase(),
          ),
      )
      .filter((i) => {
        try {
          const host = new URL(i.website!).hostname
            .replace(/^www\./, "")
            .toLowerCase();
          return allowed.some((d) => host === d || host.endsWith(`.${d}`));
        } catch {
          return false;
        }
      })
      .slice(0, Math.min(Math.max(opts.max ?? 60, 1), 100));
    for (const i of todo)
      await this.prisma.cardResearchRun.create({
        data: {
          kind: "DISCOVER",
          issuer: i.name,
          maxCards: 25,
          useLeads: true,
          requestedById: adminId,
        },
      });
    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: "discover-all",
        entity: "CardResearchRun",
        entityId: "-",
        diff: { queued: todo.length },
      },
    });
    return {
      queued: todo.length,
      issuers: todo.map((i) => i.name),
      skippedRecent: issuers.length - todo.length,
    };
  }

  /** Catalog coverage per issuer: personal / business cards, verified vs not, last research, pending review. */
  async coverage() {
    const [issuers, cards, pending, runs] = await Promise.all([
      this.prisma.issuer.findMany({
        select: {
          id: true,
          name: true,
          aliases: true,
          kind: true,
          website: true,
          lastResearchedAt: true,
        },
        orderBy: { name: "asc" },
      }),
      this.prisma.creditCard.groupBy({
        by: ["issuerId", "type"],
        where: {
          ownerId: null,
          isActive: true,
          catalogSource: { not: "DEMO" },
        },
        _count: true,
      }),
      this.prisma.cardCandidate.groupBy({
        by: ["issuerName"],
        where: { status: "PENDING" },
        _count: true,
      }),
      this.prisma.creditCard.groupBy({
        by: ["issuerId"],
        where: {
          ownerId: null,
          isActive: true,
          catalogSource: { not: "DEMO" },
          lastVerifiedAt: { not: null },
        },
        _count: true,
      }),
    ]);
    const rows = issuers
      .map((i) => {
        const of = (type: "PERSONAL" | "BUSINESS") =>
          cards.find((c) => c.issuerId === i.id && c.type === type)?._count ??
          0;
        const personal = of("PERSONAL");
        const business = of("BUSINESS");
        return {
          issuer: i.name,
          kind: i.kind,
          website: i.website,
          personal,
          business,
          verified: runs.find((r) => r.issuerId === i.id)?._count ?? 0,
          lastResearchedAt: i.lastResearchedAt,
          pendingReview: pending
            .filter((p) => issuerMatches(i, p.issuerName))
            .reduce((a, p) => a + p._count, 0),
        };
      })
      // issuers with no catalog cards and no website are user-created / demo rows
      .filter((r) => r.personal + r.business > 0 || r.website);
    return {
      totals: {
        issuers: rows.length,
        creditUnions: rows.filter((r) => r.kind === "CREDIT_UNION").length,
        cards: rows.reduce((a, r) => a + r.personal + r.business, 0),
        personal: rows.reduce((a, r) => a + r.personal, 0),
        business: rows.reduce((a, r) => a + r.business, 0),
        verified: rows.reduce((a, r) => a + r.verified, 0),
        neverResearched: rows.filter((r) => !r.lastResearchedAt).length,
        withoutCards: rows.filter((r) => r.personal + r.business === 0).length,
      },
      issuers: rows,
    };
  }

  runs(limit = 50) {
    return this.prisma.cardResearchRun.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 200),
      include: {
        card: { select: { name: true, slug: true } },
        _count: { select: { results: { where: { status: "PENDING" } } } },
      },
    });
  }

  async run(id: string) {
    const r = await this.prisma.cardResearchRun.findUnique({
      where: { id },
      include: {
        card: { select: { name: true, slug: true } },
        results: { orderBy: { createdAt: "asc" } },
      },
    });
    if (!r) throw new NotFoundException("Research run not found");
    return r;
  }

  candidates(status = "PENDING") {
    return this.prisma.cardCandidate.findMany({
      where: { status: status as never },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        run: {
          select: { kind: true, issuer: true, model: true, createdAt: true },
        },
      },
    });
  }

  /** Worker: fail stale runs, then execute queued runs one at a time. */
  async processQueued(max = 3): Promise<number> {
    await this.prisma.cardResearchRun.updateMany({
      where: {
        status: "RUNNING",
        startedAt: { lt: new Date(Date.now() - STALE_MS) },
      },
      data: {
        status: "FAILED",
        error: "timed out (worker stopped?)",
        finishedAt: new Date(),
      },
    });
    let done = 0;
    for (let i = 0; i < max; i++) {
      const next = await this.prisma.cardResearchRun.findFirst({
        where: { status: "QUEUED" },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (!next) break;
      const claimed = await this.prisma.cardResearchRun.updateMany({
        where: { id: next.id, status: "QUEUED" },
        data: { status: "RUNNING", startedAt: new Date() },
      });
      if (!claimed.count) continue;
      await this.execute(next.id);
      done++;
    }
    return done;
  }

  /** Runs the agent for one claimed run and stores its candidates. Never throws (the run records the error). */
  async execute(runId: string) {
    const run = await this.prisma.cardResearchRun.findUniqueOrThrow({
      where: { id: runId },
      include: {
        card: {
          select: {
            id: true,
            name: true,
            issuer: { select: { name: true, website: true } },
            dataSources: { select: { url: true }, take: 1 },
          },
        },
      },
    });
    const totals = { searches: 0, fetches: 0, inputTokens: 0, outputTokens: 0 };
    const pages: WebPage[] = [];
    let model: string | null = null;
    try {
      const chain = await this.researchModels();
      if (!chain.length || !this.router)
        throw new Error("No Claude model with web search is configured");
      const categories = (
        await this.prisma.category.findMany({
          select: { slug: true },
          orderBy: { sortOrder: "asc" },
        })
      ).map((c) => c.slug);
      const issuerName =
        run.kind === "VERIFY" ? run.card?.issuer.name : run.issuer;
      const leads = run.useLeads ? leadDomains() : [];
      // NEWS: any issuer site (cards from many issuers); otherwise the issuer's own domain. Lead sites are added for discovery.
      const issuerDomains =
        run.kind === "NEWS" && !issuerName
          ? allowedDomains()
          : await this.domainsFor(
              issuerName ?? "",
              run.card?.issuer.website ?? null,
            );
      const domains = [...new Set([...issuerDomains, ...leads])];
      const budget = { VERIFY: [4, 6], DISCOVER: [10, 20], NEWS: [12, 25] }[
        run.kind
      ];
      const serverTools: ServerToolSpec[] = [
        { kind: "web_search", allowedDomains: domains, maxUses: budget[0] },
        { kind: "web_fetch", allowedDomains: domains, maxUses: budget[1] },
      ];
      const messages: ChatMessage[] = [
        {
          role: "user",
          text: researchPrompt(run.kind, {
            issuer: run.issuer,
            card: run.card
              ? {
                  name: run.card.name,
                  issuer: run.card.issuer.name,
                  url: run.card.dataSources[0]?.url ?? null,
                }
              : null,
            focus: run.focus,
            limit: run.maxCards,
            leadDomains: leads,
          }),
        },
      ];
      const tool = researchToolSpec(categories);
      let payload: Record<string, unknown> | null = null;
      let nudged = false;
      for (let turn = 0; turn < MAX_TURNS && !payload; turn++) {
        const { response: r, model: m } = await this.router.chat(
          chain,
          {
            system: RESEARCH_SYSTEM,
            messages,
            tools: [tool],
            serverTools,
            maxTokens: 16_000,
            effort: "medium",
            timeoutMs: 600_000,
          },
          { userId: null, agentKey: "card-research" },
        );
        model = m.displayName;
        totals.inputTokens += r.usage.inputTokens;
        totals.outputTokens += r.usage.outputTokens;
        totals.searches += r.serverToolUse?.webSearch ?? 0;
        totals.fetches += r.serverToolUse?.webFetch ?? 0;
        pages.push(...(r.webPages ?? []));
        const call = r.toolCalls.find((c) => c.name === RESEARCH_TOOL);
        if (r.stopReason === "max_tokens")
          throw new Error(
            "The agent ran out of output tokens; try a narrower focus or a lower limit",
          );
        if (r.stopReason === "refusal")
          throw new Error("The model declined this research request");
        if (call) {
          payload = call.input;
          break;
        }
        messages.push({
          role: "assistant",
          text: r.text,
          toolCalls: [],
          native: r.native,
        });
        if (r.stopReason === "pause") continue;
        if (nudged)
          throw new Error("The agent finished without submitting results");
        messages.push({
          role: "user",
          text: `Call ${RESEARCH_TOOL} now with the cards you checked on their product pages (an empty list is fine).`,
        });
        nudged = true;
      }
      if (!payload)
        throw new Error("The agent did not finish within the turn limit");

      const { candidates, dropped, notes } = normaliseCandidates(payload, {
        categories,
        validateUrl: (u) => validateSourceUrl(u),
        leadDomains: leads,
      });
      const catalog = await this.catalogEntries();
      let stored = 0;
      for (const c of candidates) {
        const pageText = await this.pageText(c.productUrl, pages);
        const { candidate, verification } = verifyCandidate(c, pageText.text);
        let matched = matchCatalog(candidate, catalog);
        if (
          run.kind === "VERIFY" &&
          run.cardId &&
          (!matched || matched.id !== run.cardId) &&
          candidates.length === 1
        )
          matched = catalog.find((e) => e.id === run.cardId) ?? matched;
        await this.prisma.cardCandidate.create({
          data: {
            runId,
            issuerName: candidate.issuer,
            name: candidate.name,
            network: candidate.network,
            type: candidate.type,
            annualFeeCents: (factValue<number>(candidate, "annualFeeCents") ??
              null) as number | null,
            productUrl: candidate.productUrl,
            data: candidate as unknown as Prisma.InputJsonValue,
            verification: verification.status,
            evidenceFrom: pageText.from,
            verifiedFacts: verification.verified,
            totalFacts: verification.total,
            matchedCardId: matched?.id ?? null,
          },
        });
        stored++;
      }
      const uniquePages = dedupePages(pages);
      await this.prisma.cardResearchRun.update({
        where: { id: runId },
        data: {
          status: "DONE",
          model,
          ...totals,
          candidates: stored,
          sources: uniquePages.map((p) => ({
            url: p.url,
            title: p.title ?? null,
            via: p.via,
            lead: isLeadUrl(p.url, leads),
          })) as Prisma.InputJsonValue,
          notes:
            [notes, ...dropped.map((d) => `Dropped: ${d}`)]
              .filter(Boolean)
              .join("\n")
              .slice(0, 4000) || null,
          error: null,
          finishedAt: new Date(),
        },
      });
      // coverage: remember when this issuer's lineup was last checked
      if (run.kind === "DISCOVER" && run.issuer) {
        const issuers = await this.prisma.issuer.findMany({
          select: { id: true, name: true, aliases: true },
        });
        const hit = issuers.find((i) => issuerMatches(i, run.issuer!));
        if (hit)
          await this.prisma.issuer.update({
            where: { id: hit.id },
            data: { lastResearchedAt: new Date() },
          });
      }
    } catch (e) {
      const msg =
        (e as { response?: { message?: string } }).response?.message ??
        (e as Error).message;
      this.logger.warn(`research run ${runId} failed: ${msg}`);
      await this.prisma.cardResearchRun.update({
        where: { id: runId },
        data: {
          status: "FAILED",
          model,
          ...totals,
          error: String(msg).slice(0, 1000),
          finishedAt: new Date(),
        },
      });
    }
  }

  /** The issuer's own domain when known (narrowest allow-list), otherwise every allow-listed issuer domain. */
  private async domainsFor(
    issuerName: string,
    website: string | null,
  ): Promise<string[]> {
    const all = allowedDomains();
    let site = website;
    if (!site && issuerName) {
      const issuers = await this.prisma.issuer.findMany({
        select: { name: true, aliases: true, website: true },
      });
      site = issuers.find((i) => issuerMatches(i, issuerName))?.website ?? null;
    }
    if (site) {
      try {
        const host = new URL(site).hostname.replace(/^www\./, "").toLowerCase();
        const d = all.find((x) => host === x || host.endsWith(`.${x}`));
        if (d) return [d];
      } catch {
        /* fall through */
      }
    }
    return all;
  }

  /** Product page text: our own polite fetch first; the page the agent fetched when ours is blocked. */
  private async pageText(
    url: string,
    pages: WebPage[],
  ): Promise<{ text: string | null; from: "POINTWISE" | "AGENT" | "NONE" }> {
    try {
      const r = await this.fetcher.fetch(url, {});
      if (r.status === "OK" && r.body) {
        const text = htmlToText(r.body);
        if (text.length > 200) return { text, from: "POINTWISE" };
      }
    } catch {
      /* blocked, robots, network — try the agent's copy */
    }
    const agent = pages.find(
      (p) => p.via === "fetch" && p.text && sameUrl(p.url, url),
    );
    if (agent?.text)
      return {
        text: /<[a-z][\s\S]*>/i.test(agent.text)
          ? htmlToText(agent.text)
          : agent.text.slice(0, 120_000),
        from: "AGENT",
      };
    return { text: null, from: "NONE" };
  }

  private async catalogEntries(): Promise<CatalogEntry[]> {
    const cards = await this.prisma.creditCard.findMany({
      where: { ownerId: null },
      select: {
        id: true,
        name: true,
        issuer: { select: { name: true, aliases: true } },
        dataSources: { select: { url: true } },
      },
    });
    return cards.map((c) => ({
      id: c.id,
      name: c.name,
      issuer: c.issuer,
      sourceUrls: c.dataSources.map((d) => d.url),
    }));
  }

  // ───────── review ─────────

  async reject(id: string, adminId: string, note?: string) {
    const r = await this.prisma.cardCandidate.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "REJECTED",
        reviewerId: adminId,
        decidedAt: new Date(),
        note: note?.slice(0, 500) ?? null,
      },
    });
    if (!r.count) await this.pending(id); // 404 / 409
    await this.prisma.auditLog.create({
      data: {
        actorId: adminId,
        action: "reject",
        entity: "CardCandidate",
        entityId: id,
      },
    });
    return { status: "REJECTED" };
  }

  private async pending(id: string) {
    const c = await this.prisma.cardCandidate.findUnique({ where: { id } });
    if (!c) throw new NotFoundException("Candidate not found");
    if (c.status !== "PENDING")
      throw new ConflictException(
        `Candidate already ${c.status.toLowerCase()}`,
      );
    return c;
  }

  /**
   * Existing card → registers the product page as a source and turns verified facts into change
   * proposals (reviewed like any refresh); optionally replaces earning rates. New card → creates it
   * (issuer and currency matched or created), with its source and offer history.
   */
  async approve(id: string, adminId: string, opts: ApproveOptions = {}) {
    const row = await this.pending(id);
    const c = row.data as unknown as Candidate;
    const verified = row.verifiedFacts > 0;
    if (!verified && !opts.acceptUnverified)
      throw new BadRequestException(
        "No fact on this candidate could be checked against the product page. Approve with acceptUnverified to use it anyway.",
      );
    validateSourceUrl(row.productUrl);
    const claimed = await this.prisma.cardCandidate.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", reviewerId: adminId, decidedAt: new Date() },
    });
    if (!claimed.count)
      throw new ConflictException("Candidate already decided");
    const usable: Candidate = verified
      ? {
          ...c,
          facts: c.facts.filter((f) => f.verified),
          rewards: c.rewards.filter((r) => r.verified),
          features: c.features.filter((f) => f.verified),
        }
      : c;
    try {
      const result = row.matchedCardId
        ? await this.applyToExisting(
            row.matchedCardId,
            usable,
            row.productUrl,
            verified,
            opts,
          )
        : await this.createCard(usable, row.id, verified, opts);
      await this.prisma.cardCandidate.update({
        where: { id },
        data: { createdCardId: result.cardId },
      });
      await this.prisma.auditLog.create({
        data: {
          actorId: adminId,
          action: "approve",
          entity: "CardCandidate",
          entityId: id,
          diff: {
            cardId: result.cardId,
            created: result.created,
            proposals: result.proposals,
          },
        },
      });
      return { status: "APPROVED", ...result };
    } catch (e) {
      await this.prisma.cardCandidate.update({
        where: { id },
        data: { status: "PENDING", reviewerId: null, decidedAt: null },
      });
      throw e;
    }
  }

  private async ensureSource(cardId: string, url: string) {
    const existing = await this.prisma.cardDataSource.findMany({
      where: { cardId },
      select: { id: true, url: true },
    });
    const same = existing.find((s) => sameUrl(s.url, url));
    if (same) return same.id;
    return (await this.prisma.cardDataSource.create({ data: { cardId, url } }))
      .id;
  }

  private async categoryIds(): Promise<Record<string, string>> {
    return Object.fromEntries(
      (
        await this.prisma.category.findMany({
          select: { id: true, slug: true },
        })
      ).map((c) => [c.slug, c.id]),
    );
  }

  private rewardRows(
    cardId: string,
    c: Candidate,
    cats: Record<string, string>,
  ): Prisma.RewardCreateManyInput[] {
    return c.rewards
      .filter((r) => cats[r.category])
      .map((r) => ({
        cardId,
        categoryId: cats[r.category],
        multiplier: r.rate,
        description: r.description,
        capCents: r.capCents ?? null,
        capPeriod: r.capPeriod ?? null,
      }));
  }

  private async applyToExisting(
    cardId: string,
    c: Candidate,
    url: string,
    verified: boolean,
    opts: ApproveOptions,
  ) {
    const sourceId = await this.ensureSource(cardId, url);
    const findings = verified
      ? findingsOf(c)
      : c.facts.map((f) => ({
          field: f.field,
          value: f.value as never,
          evidence: f.evidence,
          confidence: 0.5,
        }));
    const proposals = await this.refresh.propose(
      cardId,
      findings,
      verified ? "RESEARCH" : "RESEARCH+UNVERIFIED",
      sourceId,
    );
    let rewards = 0;
    if (opts.applyRewards && c.rewards.length) {
      const cats = await this.categoryIds();
      const rows = this.rewardRows(cardId, c, cats);
      await this.prisma.$transaction([
        this.prisma.reward.deleteMany({ where: { cardId } }),
        this.prisma.reward.createMany({ data: rows }),
      ]);
      rewards = rows.length;
    }
    if (verified && !proposals.length)
      await this.prisma.creditCard.update({
        where: { id: cardId },
        data: { lastVerifiedAt: new Date() },
      });
    return {
      cardId,
      created: false,
      proposals: proposals.length,
      rewards,
      sourceId,
    };
  }

  private async createCard(
    c: Candidate,
    candidateId: string,
    verified: boolean,
    opts: ApproveOptions,
  ) {
    const cats = await this.categoryIds();
    return this.prisma.$transaction(async (tx) => {
      const issuers = await tx.issuer.findMany({
        select: { id: true, name: true, aliases: true },
      });
      let issuer = issuers.find((i) => issuerMatches(i, c.issuer));
      if (!issuer) {
        const host = new URL(c.productUrl).hostname.replace(/^www\./, "");
        issuer = await tx.issuer.create({
          data: { name: c.issuer, website: `https://www.${host}`, aliases: [] },
          select: { id: true, name: true, aliases: true },
        });
      }
      const currencyId = await this.currencyFor(tx, c, opts);
      let slug = slugify(c.name);
      for (
        let n = 2;
        await tx.creditCard.findUnique({
          where: { slug },
          select: { id: true },
        });
        n++
      )
        slug = `${slugify(c.name)}-${n}`;
      const bonusAmount = factValue<number>(c, "bonusAmount");
      const bonusSpend = factValue<number>(c, "bonusSpendCents");
      const bonusMonths = factValue<number>(c, "bonusMonths");
      const bonusType = factValue<BonusType>(c, "bonusType");
      const offerExpires = factValue<string>(c, "offerExpiresAt");
      const ftf = factValue<boolean>(c, "foreignTxFee");
      const card = await tx.creditCard.create({
        data: {
          slug,
          name: c.name,
          issuerId: issuer.id,
          network: c.network ?? "OTHER",
          type: c.type,
          annualFeeCents: factValue<number>(c, "annualFeeCents") ?? 0,
          foreignTxFee: ftf ?? true,
          currencyId,
          applyUrl: c.productUrl,
          bonusPoints: bonusAmount ?? null,
          bonusSpendCents: bonusSpend ?? null,
          bonusMonths: bonusMonths ?? null,
          bonusType: bonusType ?? null,
          authorizedUserFeeCents:
            factValue<number>(c, "authorizedUserFeeCents") ?? null,
          offerExpiresAt: offerExpires
            ? new Date(`${offerExpires}T00:00:00Z`)
            : null,
          bonusDescription:
            c.facts.find((f) => f.field === "bonusAmount")?.evidence ?? null,
          catalogSource: "RESEARCH",
          dataAsOf: new Date(),
          lastVerifiedAt: verified ? new Date() : null,
        },
      });
      const rows = this.rewardRows(card.id, c, cats);
      if (rows.length) await tx.reward.createMany({ data: rows });
      if (c.features.length)
        await tx.cardFeature.createMany({
          data: c.features.map((f, i) => ({
            cardId: card.id,
            text: f.text,
            sortOrder: i,
          })),
        });
      const src = await tx.cardDataSource.create({
        data: { cardId: card.id, url: c.productUrl },
      });
      if (bonusAmount != null)
        await this.refresh.recordOfferVersion(
          tx,
          card.id,
          `research:${candidateId}`,
          "created from card research",
        );
      return {
        cardId: card.id,
        slug,
        created: true,
        proposals: 0,
        rewards: rows.length,
        sourceId: src.id,
      };
    });
  }

  private async currencyFor(
    tx: Prisma.TransactionClient,
    c: Candidate,
    opts: ApproveOptions,
  ): Promise<string> {
    if (opts.currencyCode) {
      const cur = await tx.rewardCurrency.findUnique({
        where: { code: opts.currencyCode },
        select: { id: true },
      });
      if (!cur)
        throw new BadRequestException(`Unknown currency ${opts.currencyCode}`);
      return cur.id;
    }
    if (isCashProgram(c.rewardsProgram))
      return (
        await tx.rewardCurrency.findUniqueOrThrow({
          where: { code: "CASH" },
          select: { id: true },
        })
      ).id;
    const name = c.rewardsProgram!;
    const code = currencyCode(name);
    const existing = await tx.rewardCurrency.findFirst({
      where: {
        OR: [{ code }, { name: { equals: name, mode: "insensitive" } }],
      },
      select: { id: true },
    });
    if (existing) return existing.id;
    const cpp =
      opts.centsPerPoint && opts.centsPerPoint > 0 && opts.centsPerPoint <= 5
        ? opts.centsPerPoint
        : 1;
    return (
      await tx.rewardCurrency.create({
        data: { code, name, centsPerPoint: cpp },
      })
    ).id;
  }
}

function dedupePages(pages: WebPage[]): WebPage[] {
  const out: WebPage[] = [];
  for (const p of pages)
    if (!out.some((o) => sameUrl(o.url, p.url) && o.via === p.via)) out.push(p);
  return out.slice(0, 60);
}

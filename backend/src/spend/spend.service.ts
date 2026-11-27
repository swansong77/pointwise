import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TransactionKind, TransactionSource } from "@prisma/client";
import { PrismaService } from "../common/prisma.service";
import { addMonths } from "../domain/dates";
import { periodContaining } from "../domain/benefits";
import {
  BenefitRules,
  effectiveRules,
  mapBankCategory,
  matchMerchant,
  normalizeDescriptor,
  parseStatement,
  sanitizeRules,
  StatementError,
  StatementRow,
} from "../domain/spend";
import { looksLikeNotice, parseStatementPdf, printedTotals, scanStatementPdf, showsNoActivity } from "../domain/spend-pdf";
import { ALIAS_GROUPS } from "../domain/benefit-aliases";
import {
  aiDetection,
  Detection,
  detectBenefits,
  initialVerification,
  merchantForAi,
  pickDetection,
} from "../domain/benefit-detect";
import { validateStatement } from "../domain/statement-validate";
import { statementDigits } from "../domain/email-alerts";
import { createHash } from "crypto";
import { extractPdfLines } from "./pdf-extract";

const DAY = 86_400_000;
const CREDIT_LOOKBACK_DAYS = 60;
export const MAX_STATEMENT_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;
/** an alert and the posted transaction are the same purchase when the amount matches within this window */
const MATCH_WINDOW_MS = 4 * 86_400_000;
const isDebit = (k: TransactionKind) => k === "PURCHASE" || k === "FEE";
/** posted transactions (statement CSV / PDF, bank sync): the same purchase from two of them is one purchase */
const POSTED_SOURCES = new Set<TransactionSource>(["CSV", "PDF", "BANK"]);
export const MAX_BULK_FILES = 24;
const PARSE_OPTS = new Set(["positive", "negative"]);

/**
 * Optional AI tier of benefit detection (see ai/benefit-classify.ts). It only ever receives a cleaned
 * merchant string and answers with one of the generic benefit groups; never amounts, dates, digits or names.
 */
export interface MerchantClassifier {
  classify(
    userId: string,
    merchant: string,
  ): Promise<{ group: string; confidence: number; reasoning: string } | null>;
}

/** A transaction from any source, before it is stored. */
export interface IngestRow {
  occurredAt: Date;
  description: string;
  amountCents: number;
  kind: TransactionKind;
  externalId: string;
  bankCategory?: string | null;
  merchantName?: string | null;
}

/** One file of a bulk statement drop. */
export interface BulkFileResult {
  file: string;
  status: "IMPORTED" | "ALREADY_IMPORTED" | "NEEDS_CARD" | "ERROR";
  walletCardId?: string;
  card?: string | null;
  matchedBy?: "digits" | "choice";
  lastDigits?: string | null;
  period?: { start: Date | null; end: Date | null } | null;
  imported?: number;
  merged?: number;
  duplicates?: number;
  benefitUpdates?: number;
  /** completeness check of the file: PASS / WARNING / FAILED */
  validation?: Awaited<ReturnType<SpendService["savedValidation"]>>;
  note?: string;
}

export interface BenefitUpdate {
  benefitId: string;
  benefit: string;
  card: string;
  amountCents: number;
  status: "EXPECTED" | "CONFIRMED";
  transaction: string;
}

const benefitSelect = {
  id: true,
  name: true,
  howIssued: true,
  period: true,
  periodMonths: true,
  basis: true,
  amountPerPeriodCents: true,
  autoRules: true,
  category: { select: { slug: true } },
  usages: {
    select: {
      id: true,
      periodStart: true,
      amountCents: true,
      status: true,
      usedOn: true,
      creditTransactionId: true,
      transactionId: true,
    },
  },
} satisfies Prisma.UserBenefitSelect;
type TrackedBenefit = Prisma.UserBenefitGetPayload<{
  select: typeof benefitSelect;
}>;

/**
 * Spend tracking: stores transactions from statements, bank sync and manual entry, and keeps each
 * card's benefit tracker up to date from them (deterministic rules — no transaction data leaves
 * PointWise). See docs/spend-tracking.md.
 */
@Injectable()
export class SpendService {
  /** set by the AI module when merchant classification is available (off unless a user opts in) */
  classifier: MerchantClassifier | null = null;

  private readonly logger = new Logger(SpendService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async ownedCard(userId: string, walletCardId: string) {
    const wc = await this.prisma.walletCard.findFirst({
      where: { id: walletCardId, wallet: { userId } },
      select: {
        id: true,
        approvedAt: true,
        nickname: true,
        card: { select: { name: true, bonusMonths: true } },
      },
    });
    if (!wc) throw new NotFoundException("Wallet card not found");
    return wc;
  }

  // ───────── ingest ─────────

  /** Stores new transactions (duplicates by externalId are skipped), then updates the card's benefits. */
  async ingest(
    userId: string,
    walletCardId: string,
    rows: IngestRow[],
    source: TransactionSource,
  ) {
    const wc = await this.ownedCard(userId, walletCardId);
    const existing = new Set(
      (
        await this.prisma.transaction.findMany({
          where: {
            walletCardId,
            externalId: { in: rows.map((r) => r.externalId) },
          },
          select: { externalId: true },
        })
      ).map((t) => t.externalId),
    );
    const fresh = rows.filter((r) => !existing.has(r.externalId));
    const [merchants, categories] = await Promise.all([
      this.prisma.merchant.findMany({
        select: { id: true, name: true, hosts: true, aliases: true, categoryId: true },
      }),
      this.prisma.category.findMany({ select: { id: true, slug: true } }),
    ]);
    const catId = new Map(categories.map((c) => [c.slug, c.id]));
    const bonusEnd =
      wc.approvedAt && wc.card.bonusMonths
        ? addMonths(wc.approvedAt, wc.card.bonusMonths)
        : null;
    const ids: string[] = [];
    let bonusSpend = 0;
    let merged = 0;
    let sameAsPosted = 0;
    // the same purchase from another source: an alert email first, the posted statement / bank row later
    const near = fresh.length
      ? await this.prisma.transaction.findMany({
          where: {
            walletCardId,
            amountCents: { in: [...new Set(fresh.map((r) => r.amountCents))] },
            occurredAt: {
              gte: new Date(
                Math.min(...fresh.map((r) => r.occurredAt.getTime())) -
                  MATCH_WINDOW_MS,
              ),
              lte: new Date(
                Math.max(...fresh.map((r) => r.occurredAt.getTime())) +
                  MATCH_WINDOW_MS,
              ),
            },
          },
          select: {
            id: true,
            amountCents: true,
            kind: true,
            occurredAt: true,
            source: true,
          },
          orderBy: { occurredAt: "asc" },
        })
      : [];
    const consumed = new Set<string>();
    const counterpart = (r: IngestRow, wantEmail: boolean) =>
      near.find(
        (n) =>
          !consumed.has(n.id) &&
          (n.source === "EMAIL") === wantEmail &&
          n.amountCents === r.amountCents &&
          isDebit(n.kind) === isDebit(r.kind) &&
          Math.abs(n.occurredAt.getTime() - r.occurredAt.getTime()) <=
            MATCH_WINDOW_MS,
      );
    for (const r of fresh) {
      if (source === "EMAIL") {
        const posted = counterpart(r, false);
        if (posted) {
          consumed.add(posted.id);
          sameAsPosted++;
          continue;
        }
      } else {
        const alert = counterpart(r, true);
        if (alert) {
          consumed.add(alert.id);
          const m = matchMerchant(
            `${r.description} ${r.merchantName ?? ""}`,
            merchants,
          );
          await this.prisma.transaction.update({
            where: { id: alert.id },
            data: {
              description: r.description.slice(0, 200),
              occurredAt: r.occurredAt,
              kind: r.kind,
              source,
              externalId: r.externalId,
              bankCategory: r.bankCategory?.slice(0, 80) ?? null,
              ...(m && { merchantId: m.id, categoryId: m.categoryId }),
            },
          });
          ids.push(alert.id);
          merged++;
          continue;
        }
        // already recorded from another posted source (e.g. bank sync, then the statement PDF)
        const other = POSTED_SOURCES.has(source)
          ? near.find(
              (n) =>
                !consumed.has(n.id) &&
                POSTED_SOURCES.has(n.source) &&
                n.source !== source &&
                n.amountCents === r.amountCents &&
                isDebit(n.kind) === isDebit(r.kind) &&
                Math.abs(n.occurredAt.getTime() - r.occurredAt.getTime()) <=
                  MATCH_WINDOW_MS,
            )
          : undefined;
        if (other) {
          consumed.add(other.id);
          sameAsPosted++;
          continue;
        }
      }
      const merchant = matchMerchant(
        `${r.description} ${r.merchantName ?? ""}`,
        merchants,
      );
      const categoryId =
        merchant?.categoryId ??
        catId.get(mapBankCategory(r.bankCategory) ?? "") ??
        null;
      try {
        const tx = await this.prisma.transaction.create({
          data: {
            userId,
            walletCardId,
            amountCents: r.amountCents,
            description: r.description.slice(0, 200),
            occurredAt: r.occurredAt,
            kind: r.kind,
            source,
            externalId: r.externalId,
            bankCategory: r.bankCategory?.slice(0, 80) ?? null,
            merchantId: merchant?.id ?? null,
            categoryId,
          },
        });
        ids.push(tx.id);
        if (
          r.kind === "PURCHASE" &&
          wc.approvedAt &&
          bonusEnd &&
          r.occurredAt >= wc.approvedAt &&
          r.occurredAt < bonusEnd
        )
          bonusSpend += r.amountCents;
      } catch (e) {
        if ((e as { code?: string }).code !== "P2002") throw e; // a concurrent import stored it first
      }
    }
    if (bonusSpend)
      await this.prisma.walletCard.update({
        where: { id: walletCardId },
        data: { bonusSpendCents: { increment: bonusSpend } },
      });
    const updates = await this.autoTrack(userId, ids);
    return {
      imported: ids.length - merged,
      /** alert-email transactions replaced by their posted version (benefit matches kept) */
      merged,
      duplicates: rows.length - fresh.length + sameAsPosted,
      benefitUpdates: updates,
      transactionIds: ids,
    };
  }

  // ───────── automatic benefit tracking ─────────

  private rulesOf(b: TrackedBenefit): BenefitRules {
    return effectiveRules(b.autoRules, {
      name: b.name,
      howIssued: b.howIssued,
      categorySlug: b.category?.slug,
    });
  }

  private used(b: TrackedBenefit, periodStart: Date, exceptUsageId?: string) {
    return b.usages
      .filter(
        (u) =>
          u.status !== "DISMISSED" &&
          u.periodStart.getTime() === periodStart.getTime() &&
          u.id !== exceptUsageId,
      )
      .reduce((a, u) => a + u.amountCents, 0);
  }

  /**
   * Matches transactions to the tracked credit benefits of their own card. A purchase records
   * EXPECTED usage (capped at what is left in its period); the issuer's statement credit confirms
   * expected usage (or records confirmed usage directly). Idempotent: a transaction is used once per
   * benefit, and dismissed matches are never re-created.
   */
  async autoTrack(
    userId: string,
    transactionIds: string[],
  ): Promise<BenefitUpdate[]> {
    if (!transactionIds.length) return [];
    const txs = await this.prisma.transaction.findMany({
      where: {
        id: { in: transactionIds },
        userId,
        kind: { in: ["PURCHASE", "CREDIT"] },
      },
      orderBy: { occurredAt: "asc" },
      include: {
        category: { select: { slug: true } },
        merchant: { select: { name: true } },
      },
    });
    const byCard = new Map<string, typeof txs>();
    for (const t of txs)
      byCard.set(t.walletCardId, [...(byCard.get(t.walletCardId) ?? []), t]);
    const updates: BenefitUpdate[] = [];
    for (const [walletCardId, list] of byCard) {
      const wc = await this.prisma.walletCard.findUniqueOrThrow({
        where: { id: walletCardId },
        select: {
          approvedAt: true,
          nickname: true,
          card: { select: { name: true } },
        },
      });
      const benefits = await this.prisma.userBenefit.findMany({
        where: {
          walletCardId,
          enabled: true,
          autoTrack: true,
          kind: "CREDIT",
          amountPerPeriodCents: { gt: 0 },
        },
        select: benefitSelect,
        orderBy: { createdAt: "asc" },
      });
      if (!benefits.length) continue;
      for (const tx of list) {
        const cands = benefits.map((x) => ({
          id: x.id,
          name: x.name,
          rules: this.rulesOf(x),
        }));
        const dets = detectBenefits(
          {
            kind: tx.kind,
            description: tx.description,
            categorySlug: tx.category?.slug ?? null,
            merchantName: tx.merchant?.name,
          },
          cands,
        );
        let det: Detection | null = pickDetection(dets);
        let aiReasoning: string | null = null;
        if (!det && !dets.length && this.classifier) {
          const merchant = merchantForAi(tx.description ?? "");
          const r = merchant
            ? await this.classifier.classify(userId, merchant)
            : null;
          const g = r && ALIAS_GROUPS.find((a) => a.key === r.group);
          const hit = g && benefits.find((x) => g.benefit.test(x.name));
          if (r && hit) {
            det = aiDetection(hit.id, r.confidence, merchant);
            aiReasoning = r.reasoning.slice(0, 500);
          }
        }
        if (!det) continue;
        const b = benefits.find((x) => x.id === det!.benefitId)!;
        if (
          b.usages.some(
            (u) => u.transactionId === tx.id || u.creditTransactionId === tx.id,
          )
        )
          continue;
        const evidence = {
          merchant: det.merchant,
          rule: det.rule,
          line: (tx.description ?? "").slice(0, 120),
        };
        const detail = {
          detectionMethod: det.method,
          confidence: det.confidence,
          verification: initialVerification(det, tx.kind),
          evidence,
        };
        const risk = dets.length > 1;
        const label = {
          benefitId: b.id,
          benefit: b.name,
          card: wc.nickname || wc.card.name,
          transaction: tx.description ?? "",
        };
        const note = `Auto: ${(tx.description ?? "").slice(0, 80)}`;
        if (tx.kind === "PURCHASE") {
          const w = periodContaining(b, wc.approvedAt, tx.occurredAt);
          const amount = Math.min(
            tx.amountCents,
            b.amountPerPeriodCents - this.used(b, w.start),
          );
          if (amount <= 0) continue;
          const u = await this.prisma.benefitUsage.create({
            data: {
              userBenefitId: b.id,
              periodStart: w.start,
              amountCents: amount,
              usedOn: tx.occurredAt,
              note,
              source: "AUTO_PURCHASE",
              status: "EXPECTED",
              transactionId: tx.id,
              ...detail,
            },
          });
          await this.recordDetection(b.id, tx.id, u.id, det, risk, aiReasoning);
          b.usages.push({
            id: u.id,
            periodStart: w.start,
            amountCents: amount,
            status: "EXPECTED",
            usedOn: tx.occurredAt,
            creditTransactionId: null,
            transactionId: tx.id,
          });
          updates.push({ ...label, amountCents: amount, status: "EXPECTED" });
          continue;
        }
        // statement credit: confirm expected usage from recent matching purchases first
        let credit = tx.amountCents;
        const since = tx.occurredAt.getTime() - CREDIT_LOOKBACK_DAYS * DAY;
        const expected = b.usages
          .filter(
            (u) =>
              u.status === "EXPECTED" &&
              !u.creditTransactionId &&
              u.usedOn.getTime() <= tx.occurredAt.getTime() + DAY &&
              u.usedOn.getTime() >= since,
          )
          .sort((x, y) => x.usedOn.getTime() - y.usedOn.getTime());
        for (const u of expected) {
          if (credit <= 0) break;
          const amount = Math.min(u.amountCents, credit);
          await this.prisma.benefitUsage.update({
            where: { id: u.id },
            data: {
              status: "CONFIRMED",
              amountCents: amount,
              creditTransactionId: tx.id,
              verification: "VERIFIED",
            },
          });
          await this.recordDetection(b.id, tx.id, u.id, det, risk, aiReasoning);
          Object.assign(u, {
            status: "CONFIRMED",
            amountCents: amount,
            creditTransactionId: tx.id,
          });
          credit -= amount;
          updates.push({ ...label, amountCents: amount, status: "CONFIRMED" });
        }
        if (credit > 0) {
          const w = periodContaining(b, wc.approvedAt, tx.occurredAt);
          const amount = Math.min(
            credit,
            b.amountPerPeriodCents - this.used(b, w.start),
          );
          if (amount <= 0) continue;
          const u = await this.prisma.benefitUsage.create({
            data: {
              userBenefitId: b.id,
              periodStart: w.start,
              amountCents: amount,
              usedOn: tx.occurredAt,
              note,
              source: "AUTO_CREDIT",
              status: "CONFIRMED",
              transactionId: tx.id,
              creditTransactionId: tx.id,
              ...detail,
            },
          });
          await this.recordDetection(b.id, tx.id, u.id, det, risk, aiReasoning);
          b.usages.push({
            id: u.id,
            periodStart: w.start,
            amountCents: amount,
            status: "CONFIRMED",
            usedOn: tx.occurredAt,
            creditTransactionId: tx.id,
            transactionId: tx.id,
          });
          updates.push({ ...label, amountCents: amount, status: "CONFIRMED" });
        }
      }
    }
    return updates;
  }

  /** Audit row for one candidate match (reasoning, confidence, overrides). One per benefit and transaction. */
  private async recordDetection(
    userBenefitId: string,
    transactionId: string,
    usageId: string,
    det: Detection,
    duplicateRisk: boolean,
    aiReasoning: string | null,
  ) {
    await this.prisma.benefitDetection.upsert({
      where: { userBenefitId_transactionId: { userBenefitId, transactionId } },
      create: {
        userBenefitId,
        transactionId,
        usageId,
        method: det.method,
        confidence: det.confidence,
        rule: det.rule.slice(0, 120),
        merchant: det.merchant.slice(0, 120),
        tier: det.tier,
        aiReasoning,
        duplicateRisk,
      },
      update: {},
    });
  }

  /** Re-runs matching over recent transactions (after rules change, or on demand). */
  async rescan(
    userId: string,
    opts: { walletCardId?: string; days?: number } = {},
    now = new Date(),
  ) {
    if (opts.walletCardId) await this.ownedCard(userId, opts.walletCardId);
    const txs = await this.prisma.transaction.findMany({
      where: {
        userId,
        ...(opts.walletCardId && { walletCardId: opts.walletCardId }),
        occurredAt: { gte: new Date(now.getTime() - (opts.days ?? 180) * DAY) },
        kind: { in: ["PURCHASE", "CREDIT"] },
      },
      select: { id: true },
    });
    const updates = await this.autoTrack(
      userId,
      txs.map((t) => t.id),
    );
    return { scanned: txs.length, benefitUpdates: updates };
  }

  /** "Not this benefit": an automatic match is kept as DISMISSED (amount 0) so it is never re-created. */
  async dismiss(userId: string, usageId: string) {
    const u = await this.prisma.benefitUsage.findFirst({
      where: {
        id: usageId,
        userBenefit: { walletCard: { wallet: { userId } } },
      },
    });
    if (!u) throw new NotFoundException("Usage not found");
    if (u.source === "MANUAL")
      throw new BadRequestException(
        "Only automatic matches can be dismissed — delete a manual entry instead",
      );
    await this.prisma.benefitUsage.update({
      where: { id: usageId },
      data: { status: "DISMISSED", amountCents: 0 },
    });
    return { status: "DISMISSED" };
  }

  /** Turn auto-tracking on/off and set rules (null = go back to suggested rules); re-scans the card. */
  async setRules(
    userId: string,
    benefitId: string,
    dto: { autoTrack?: boolean; rules?: Partial<BenefitRules> | null },
  ) {
    const b = await this.prisma.userBenefit.findFirst({
      where: { id: benefitId, walletCard: { wallet: { userId } } },
      include: { category: { select: { slug: true } } },
    });
    if (!b) throw new NotFoundException("Benefit not found");
    let autoRules: Prisma.InputJsonValue | typeof Prisma.DbNull | undefined;
    if (dto.rules === null) autoRules = Prisma.DbNull;
    else if (dto.rules) {
      const clean = sanitizeRules(dto.rules);
      if (
        !clean ||
        (!clean.keywords.length &&
          !clean.categories.length &&
          !clean.creditKeywords.length)
      )
        throw new BadRequestException(
          "Give at least one keyword, category or credit keyword (or reset to the suggested rules)",
        );
      const known = new Set(
        (await this.prisma.category.findMany({ select: { slug: true } })).map(
          (c) => c.slug,
        ),
      );
      const unknown = clean.categories.filter((c) => !known.has(c));
      if (unknown.length)
        throw new BadRequestException(
          `Unknown categories: ${unknown.join(", ")}`,
        );
      autoRules = clean as unknown as Prisma.InputJsonValue;
    }
    const updated = await this.prisma.userBenefit.update({
      where: { id: benefitId },
      data: {
        ...(dto.autoTrack !== undefined && { autoTrack: dto.autoTrack }),
        ...(autoRules !== undefined && { autoRules }),
      },
    });
    const rescan = updated.autoTrack
      ? await this.rescan(userId, { walletCardId: b.walletCardId })
      : { scanned: 0, benefitUpdates: [] };
    return {
      autoTrack: updated.autoTrack,
      rules: effectiveRules(updated.autoRules, {
        name: b.name,
        howIssued: b.howIssued,
        categorySlug: b.category?.slug,
      }),
      rescan,
    };
  }

  // ───────── statements ─────────

  /** CSV or PDF statement → rows. PDFs are read by a sandboxed extractor (no AI — statements are card data). */
  private async parse(
    file: { buffer: Buffer; originalname: string; size: number } | undefined,
    walletCardId: string,
    purchasesAre?: "positive" | "negative",
  ) {
    if (!file)
      throw new BadRequestException("Attach a statement file (.pdf or .csv)");
    const isPdf =
      /\.pdf$/i.test(file.originalname) ||
      file.buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    try {
      if (isPdf) {
        if (file.size > MAX_PDF_BYTES)
          throw new BadRequestException("Statement PDF is larger than 10 MB");
        const pages = await extractPdfLines(file.buffer);
        const p = parseStatementPdf(pages, walletCardId);
        const quiet = !p.rows.length && showsNoActivity(pages);
        if (!p.rows.length && !quiet) {
          const text = pages.flat().join(" ").trim();
          if (looksLikeNotice(pages))
            throw new BadRequestException(
              "This PDF is an account notice from the card issuer, not a statement. There is nothing to import.",
            );
          throw new BadRequestException(
            text.length < 40
              ? "This PDF has no text layer (it looks like a scan or photo). Download the statement PDF from your card's website, or use CSV."
              : "No transactions were found in this PDF. If it is a statement from your card's website, try its CSV / activity download instead.",
          );
        }
        return {
          ...p,
          format: "pdf" as const,
          source: "PDF" as const,
          scan: scanStatementPdf(pages),
          noActivity: quiet,
          printed: printedTotals(pages),
        };
      }
      if (file.size > MAX_STATEMENT_BYTES)
        throw new BadRequestException("Statement file is larger than 2 MB");
      if (!/\.(csv|txt)$/i.test(file.originalname))
        throw new BadRequestException(
          "Upload the statement as a .pdf or .csv file",
        );
      const csv = parseStatement(file.buffer.toString("utf8"), walletCardId, {
        purchasesAre,
      });
      return {
        ...csv,
        period: null,
        format: "csv" as const,
        source: "CSV" as const,
        // every data row of the file: the ones read plus the ones that were not
        scan: {
          count: csv.rows.length + csv.errors.length,
          cents: csv.rows.reduce((n, r) => n + r.amountCents, 0),
        },
        noActivity: false,
        printed: null,
      };
    } catch (e) {
      if (e instanceof StatementError) throw new BadRequestException(e.message);
      throw e;
    }
  }

  private toIngest(rows: StatementRow[]): IngestRow[] {
    return rows.map((r) => ({
      occurredAt: r.occurredAt,
      description: r.description,
      amountCents: r.amountCents,
      kind: r.kind,
      externalId: r.externalId,
      bankCategory: r.bankCategory,
    }));
  }

  /** Parse + match without saving: what would be imported and which benefits it would update. */
  async previewStatement(
    userId: string,
    walletCardId: string,
    file: Parameters<SpendService["parse"]>[0],
    purchasesAre?: "positive" | "negative",
  ) {
    const wc = await this.ownedCard(userId, walletCardId);
    const p = await this.parse(file, walletCardId, purchasesAre);
    const [existing, merchants, benefits] = await Promise.all([
      this.prisma.transaction.findMany({
        where: {
          walletCardId,
          externalId: { in: p.rows.map((r) => r.externalId) },
        },
        select: { externalId: true },
      }),
      this.prisma.merchant.findMany({
        select: {
          name: true,
          hosts: true,
          aliases: true,
          category: { select: { slug: true } },
        },
      }),
      this.prisma.userBenefit.findMany({
        where: {
          walletCardId,
          enabled: true,
          autoTrack: true,
          kind: "CREDIT",
          amountPerPeriodCents: { gt: 0 },
        },
        select: benefitSelect,
      }),
    ]);
    const dup = new Set(existing.map((e) => e.externalId));
    const cands = benefits.map((b) => ({
      id: b.id,
      name: b.name,
      rules: this.rulesOf(b),
    }));
    return {
      card: wc.nickname || wc.card.name,
      validation: this.validation(p),
      format: p.format,
      period: p.period,
      columns: p.columns,
      purchasesAre: p.purchasesAre,
      errors: p.errors.slice(0, 50),
      totals: {
        rows: p.rows.length,
        new: p.rows.filter((r) => !dup.has(r.externalId)).length,
        duplicates: p.rows.filter((r) => dup.has(r.externalId)).length,
        purchasesCents: p.rows
          .filter((r) => r.kind === "PURCHASE")
          .reduce((a, r) => a + r.amountCents, 0),
      },
      rows: p.rows.slice(0, 500).map((r) => {
        const merchant = matchMerchant(r.description, merchants);
        const categorySlug =
          merchant?.category.slug ?? mapBankCategory(r.bankCategory);
        const m = pickDetection(
          detectBenefits(
            { kind: r.kind, description: r.description, categorySlug },
            cands,
          ),
        );
        return {
          occurredAt: r.occurredAt,
          description: r.description,
          amountCents: r.amountCents,
          kind: r.kind,
          category: categorySlug,
          merchant: merchant?.name ?? null,
          duplicate: dup.has(r.externalId),
          benefit: m
            ? {
                id: m.benefitId,
                name: benefits.find((b) => b.id === m.benefitId)!.name,
                by: m.method,
                term: m.rule,
                confidence: m.confidence,
              }
            : null,
        };
      }),
    };
  }

  async importStatement(
    userId: string,
    walletCardId: string,
    file: Parameters<SpendService["parse"]>[0],
    purchasesAre?: "positive" | "negative",
  ) {
    await this.ownedCard(userId, walletCardId);
    const p = await this.parse(file, walletCardId, purchasesAre);
    return this.store(userId, walletCardId, p, file!.buffer, "UPLOAD");
  }

  /**
   * Saves parsed statement rows and records the file (hash + period only). A file already imported
   * for the card is reported as such without touching anything.
   */
  private async store(
    userId: string,
    walletCardId: string,
    p: Awaited<ReturnType<SpendService["parse"]>>,
    buffer: Buffer,
    channel: "UPLOAD" | "BULK" | "EMAIL",
  ) {
    const fileSha256 = createHash("sha256").update(buffer).digest("hex");
    const seen = await this.prisma.statementImport.findUnique({
      where: { walletCardId_fileSha256: { walletCardId, fileSha256 } },
    });
    if (seen)
      return {
        imported: 0,
        merged: 0,
        duplicates: p.rows.length,
        benefitUpdates: [] as BenefitUpdate[],
        transactionIds: [] as string[],
        errors: p.errors.length,
        purchasesAre: p.purchasesAre,
        format: p.format,
        period: p.period,
        alreadyImported: seen.createdAt,
        validation: await this.savedValidation(seen.id),
      };
    const r = await this.ingest(
      userId,
      walletCardId,
      this.toIngest(p.rows),
      p.source,
    );
    const validation = this.validation(p);
    const record = await this.prisma.statementImport
      .create({
        data: {
          userId,
          walletCardId,
          fileSha256,
          format: p.format,
          channel,
          periodStart: p.period?.start ?? null,
          periodEnd: p.period?.end ?? this.lastDate(p.rows),
          rows: p.rows.length,
          imported: r.imported,
          duplicates: r.duplicates,
        },
      })
      .catch((e: { code?: string }) => {
        if (e.code !== "P2002") throw e; // the same file imported concurrently
        return null;
      });
    if (record) {
      await this.prisma.statementValidation.create({
        data: {
          statementImportId: record.id,
          statementCount: validation.statementCount,
          importedCount: validation.importedCount,
          differenceCount: validation.differenceCount,
          statementCents: validation.statementCents,
          importedCents: validation.importedCents,
          missingCents: validation.missingCents,
          confidence: validation.confidence,
          status: validation.status,
          details: { notes: validation.notes },
        },
      });
      // tie the benefit evidence found in this file to the import that supplied it
      if (r.transactionIds.length) {
        await this.prisma.benefitUsage.updateMany({
          where: {
            OR: [
              { transactionId: { in: r.transactionIds } },
              { creditTransactionId: { in: r.transactionIds } },
            ],
          },
          data: { statementImportId: record.id },
        });
        await this.prisma.benefitDetection.updateMany({
          where: { transactionId: { in: r.transactionIds } },
          data: { statementImportId: record.id },
        });
      }
    }
    return {
      ...r,
      errors: p.errors.length,
      purchasesAre: p.purchasesAre,
      format: p.format,
      period: p.period,
      alreadyImported: null as Date | null,
      validation,
    };
  }

  /** Completeness check of a parsed statement: what it prints vs what was read. */
  private validation(p: Awaited<ReturnType<SpendService["parse"]>>) {
    return validateStatement({
      statement: p.scan,
      imported: {
        count: p.rows.length,
        cents: p.rows.reduce((n, r) => n + r.amountCents, 0),
      },
      unreadLines: p.errors.length,
      noActivity: p.noActivity,
      printed: p.printed && {
        ...p.printed,
        rowCredits: Math.abs(p.rows.filter((r) => r.signedCents < 0).reduce((n, r) => n + r.signedCents, 0)),
        rowCharges: p.rows.filter((r) => r.signedCents > 0).reduce((n, r) => n + r.signedCents, 0),
      },
    });
  }

  /** The stored validation of an imported statement, in the same shape as a fresh one. */
  async savedValidation(statementImportId: string) {
    const v = await this.prisma.statementValidation.findUnique({
      where: { statementImportId },
    });
    if (!v) return null;
    return {
      statementCount: v.statementCount,
      importedCount: v.importedCount,
      differenceCount: v.differenceCount,
      statementCents: v.statementCents,
      importedCents: v.importedCents,
      missingCents: v.missingCents,
      confidence: v.confidence,
      status: v.status,
      notes: ((v.details as { notes?: string[] } | null)?.notes ?? []) as string[],
    };
  }

  private lastDate(rows: StatementRow[]): Date | null {
    return rows.reduce<Date | null>(
      (a, r) => (!a || r.occurredAt > a ? r.occurredAt : a),
      null,
    );
  }

  /**
   * The user's one open card matching the account digits a statement or alert shows
   * (Amex prints 5 digits, others 4). Null when no card or several cards match.
   */
  async cardForDigits(
    userId: string,
    digits: string | null,
    profileId: string | null = null,
  ): Promise<string | null> {
    if (!digits) return null;
    const cards = await this.prisma.walletCard.findMany({
      where: {
        wallet: { userId },
        ...(profileId && { profileId }),
        status: { not: "CLOSED" },
        lastFour: { not: null },
      },
      select: { id: true, lastFour: true },
    });
    const hits = cards.filter(
      (c) =>
        c.lastFour === digits ||
        c.lastFour!.endsWith(digits.slice(-4)) ||
        digits.endsWith(c.lastFour!),
    );
    return hits.length === 1 ? hits[0].id : null;
  }

  /** Account digits printed in a statement PDF, or in a CSV file name ("Chase1234_Activity.csv"). */
  private async detectDigits(file: {
    buffer: Buffer;
    originalname: string;
  }): Promise<string | null> {
    const isPdf = file.buffer.subarray(0, 5).toString("latin1") === "%PDF-";
    if (isPdf)
      return statementDigits((await extractPdfLines(file.buffer)).flat());
    const fromName = /(?:^|[^0-9])(\d{4,5})(?:[^0-9]|$)/.exec(
      file.originalname.replace(/(19|20)\d{6}/g, ""),
    );
    return fromName?.[1] ?? null;
  }

  /**
   * Bulk statement drop: every file is matched to its card by the account digits it shows (or the
   * card chosen for it in `assignments`), parsed and imported. Files that cannot be matched come
   * back as NEEDS_CARD so the user can pick the card and send just those again.
   */
  async importMany(
    userId: string,
    files: Array<{ buffer: Buffer; originalname: string; size: number }>,
    assignments: Record<string, string> = {},
    purchasesAre?: string,
  ) {
    if (!files?.length)
      throw new BadRequestException("Attach one or more statement files");
    if (files.length > MAX_BULK_FILES)
      throw new BadRequestException(
        `Up to ${MAX_BULK_FILES} statements at a time`,
      );
    const sign = PARSE_OPTS.has(purchasesAre ?? "")
      ? (purchasesAre as "positive" | "negative")
      : undefined;
    const cards = await this.prisma.walletCard.findMany({
      where: { wallet: { userId } },
      select: { id: true, nickname: true, card: { select: { name: true } } },
    });
    const name = new Map(cards.map((c) => [c.id, c.nickname || c.card.name]));
    const results: BulkFileResult[] = [];
    for (const f of files) {
      const file = f.originalname.slice(0, 120);
      try {
        const chosen = assignments[f.originalname];
        if (chosen && !name.has(chosen))
          throw new NotFoundException("Wallet card not found");
        const digits = chosen ? null : await this.detectDigits(f);
        const walletCardId =
          chosen ?? (await this.cardForDigits(userId, digits));
        if (!walletCardId) {
          results.push({
            file,
            status: "NEEDS_CARD" as const,
            lastDigits: digits,
            note: digits
              ? `No single card ending in ${digits} — choose the card`
              : "The statement does not show which card it is for — choose the card",
          });
          continue;
        }
        const p = await this.parse(f, walletCardId, sign);
        const r = await this.store(userId, walletCardId, p, f.buffer, "BULK");
        results.push({
          file,
          status: r.alreadyImported
            ? ("ALREADY_IMPORTED" as const)
            : ("IMPORTED" as const),
          walletCardId,
          card: name.get(walletCardId) ?? null,
          matchedBy: chosen ? "choice" : "digits",
          period: p.period,
          imported: r.imported,
          merged: r.merged,
          duplicates: r.duplicates,
          benefitUpdates: r.benefitUpdates.length,
          validation: r.validation,
        });
      } catch (e) {
        results.push({
          file,
          status: "ERROR" as const,
          note:
            e instanceof BadRequestException || e instanceof NotFoundException
              ? e.message
              : "The file could not be read",
        });
        if (!(
          e instanceof BadRequestException || e instanceof NotFoundException
        ))
          this.logger.warn(`bulk statement failed: ${(e as Error).message}`);
      }
    }
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return {
      files: results,
      totals: {
        imported: count("IMPORTED"),
        alreadyImported: count("ALREADY_IMPORTED"),
        needsCard: count("NEEDS_CARD"),
        errors: count("ERROR"),
        transactions: results.reduce((a, r) => a + (r.imported ?? 0), 0),
      },
    };
  }

  /** Emailed statement PDF (already parsed by the capture inbox). */
  async importEmailedStatement(
    userId: string,
    walletCardId: string,
    buffer: Buffer,
  ) {
    const p = await this.parse(
      { buffer, originalname: "statement.pdf", size: buffer.length },
      walletCardId,
    );
    return this.store(userId, walletCardId, p, buffer, "EMAIL");
  }

  /** Per card: the latest statement period imported and when. */
  async statementCoverage(userId: string) {
    const rows = await this.prisma.statementImport.groupBy({
      by: ["walletCardId"],
      where: { userId },
      _max: { periodEnd: true, createdAt: true },
      _count: true,
    });
    return new Map(
      rows.map((r) => [
        r.walletCardId,
        {
          statements: r._count,
          through: r._max.periodEnd,
          lastImportAt: r._max.createdAt,
        },
      ]),
    );
  }

  // ───────── listing ─────────

  async list(
    userId: string,
    q: {
      walletCardId?: string;
      kind?: TransactionKind;
      matched?: boolean;
      limit?: number;
    },
  ) {
    const rows = await this.prisma.transaction.findMany({
      where: {
        userId,
        ...(q.walletCardId && { walletCardId: q.walletCardId }),
        ...(q.kind && { kind: q.kind }),
        ...(q.matched !== undefined &&
          (q.matched
            ? {
                OR: [
                  { benefitUsages: { some: { status: { not: "DISMISSED" } } } },
                  { benefitCredits: { some: {} } },
                ],
              }
            : { benefitUsages: { none: {} }, benefitCredits: { none: {} } })),
      },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      take: Math.min(q.limit ?? 100, 500),
      include: {
        category: { select: { slug: true, name: true } },
        merchant: { select: { name: true } },
        walletCard: {
          select: {
            id: true,
            nickname: true,
            lastFour: true,
            card: { select: { name: true, color: true } },
          },
        },
        benefitUsages: {
          select: {
            id: true,
            amountCents: true,
            status: true,
            source: true,
            userBenefit: { select: { id: true, name: true } },
          },
        },
        benefitCredits: {
          select: {
            id: true,
            amountCents: true,
            status: true,
            source: true,
            userBenefit: { select: { id: true, name: true } },
          },
        },
      },
    });
    return rows.map((t) => {
      const usages = [
        ...t.benefitUsages,
        ...t.benefitCredits.filter(
          (c) => !t.benefitUsages.some((u) => u.id === c.id),
        ),
      ];
      return {
        id: t.id,
        occurredAt: t.occurredAt,
        description: t.description,
        descriptor: normalizeDescriptor(t.description),
        amountCents: t.amountCents,
        kind: t.kind,
        source: t.source,
        category: t.category,
        bankCategory: t.bankCategory,
        merchant: t.merchant?.name ?? null,
        walletCard: {
          id: t.walletCard.id,
          name: t.walletCard.nickname || t.walletCard.card.name,
          color: t.walletCard.card.color,
          lastFour: t.walletCard.lastFour,
        },
        benefits: usages.map((u) => ({
          usageId: u.id,
          benefitId: u.userBenefit.id,
          name: u.userBenefit.name,
          amountCents: u.amountCents,
          status: u.status,
          source: u.source,
        })),
      };
    });
  }

  /** Spend per category and per card for a period (purchases only). */
  async summary(
    userId: string,
    opts: { days?: number } = {},
    now = new Date(),
  ) {
    const since = new Date(now.getTime() - (opts.days ?? 30) * DAY);
    const [byCat, byCard, auto] = await Promise.all([
      this.prisma.transaction.groupBy({
        by: ["categoryId"],
        where: { userId, kind: "PURCHASE", occurredAt: { gte: since } },
        _sum: { amountCents: true },
        _count: true,
      }),
      this.prisma.transaction.groupBy({
        by: ["walletCardId"],
        where: { userId, kind: "PURCHASE", occurredAt: { gte: since } },
        _sum: { amountCents: true },
        _count: true,
      }),
      this.prisma.benefitUsage.groupBy({
        by: ["status"],
        where: {
          userBenefit: { walletCard: { wallet: { userId } } },
          source: { not: "MANUAL" },
          usedOn: { gte: since },
        },
        _sum: { amountCents: true },
        _count: true,
      }),
    ]);
    const cats = await this.prisma.category.findMany({
      where: {
        id: {
          in: byCat.map((c) => c.categoryId).filter((x): x is string => !!x),
        },
      },
      select: { id: true, name: true, slug: true },
    });
    const cards = await this.prisma.walletCard.findMany({
      where: { id: { in: byCard.map((c) => c.walletCardId) } },
      select: { id: true, nickname: true, card: { select: { name: true } } },
    });
    return {
      since,
      totalCents: byCard.reduce((a, c) => a + (c._sum.amountCents ?? 0), 0),
      byCategory: byCat
        .map((c) => ({
          category: cats.find((x) => x.id === c.categoryId) ?? null,
          amountCents: c._sum.amountCents ?? 0,
          count: c._count,
        }))
        .sort((a, b) => b.amountCents - a.amountCents),
      byCard: byCard
        .map((c) => {
          const w = cards.find((x) => x.id === c.walletCardId);
          return {
            walletCardId: c.walletCardId,
            name: w ? w.nickname || w.card.name : "?",
            amountCents: c._sum.amountCents ?? 0,
            count: c._count,
          };
        })
        .sort((a, b) => b.amountCents - a.amountCents),
      autoTracked: {
        expectedCents:
          auto.find((a) => a.status === "EXPECTED")?._sum.amountCents ?? 0,
        confirmedCents:
          auto.find((a) => a.status === "CONFIRMED")?._sum.amountCents ?? 0,
        matches: auto
          .filter((a) => a.status !== "DISMISSED")
          .reduce((s, a) => s + a._count, 0),
      },
    };
  }
}

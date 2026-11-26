import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from "@nestjs/common";
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { AuthUser, CurrentUser } from "../common/decorators";
import { PrismaService } from "../common/prisma.service";
import {
  benefitRecord,
  reconcileBenefit,
  RollBenefit,
  RollLevel,
  rollup,
} from "../domain/benefit-roll";

const LEVELS: RollLevel[] = ["product", "account", "cardholder", "household"];
const DAY = 86_400_000;

export class RollupQuery {
  @ApiPropertyOptional({ enum: LEVELS }) @IsOptional() @IsIn(LEVELS) level?: RollLevel;
}

export class DecisionDto {
  @ApiProperty({ enum: ["ACCEPT", "REJECT"] }) @IsIn(["ACCEPT", "REJECT"]) decision!: "ACCEPT" | "REJECT";
}

/**
 * Account-level benefit views: audit trail of detected credits, reconciliation and utilization at
 * four levels. Every row is one tracked benefit on one card account; nothing is merged by product.
 */
@Injectable()
export class BenefitAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every enabled tracked benefit of the user, one entry per card account. */
  async load(userId: string): Promise<RollBenefit[]> {
    const rows = await this.prisma.userBenefit.findMany({
      where: {
        enabled: true,
        walletCard: { wallet: { userId }, status: { not: "CLOSED" } },
      },
      include: {
        category: { select: { slug: true } },
        usages: true,
        walletCard: {
          select: {
            id: true,
            lastFour: true,
            approvedAt: true,
            nickname: true,
            card: { select: { id: true, name: true } },
            profile: { select: { id: true, nickname: true } },
          },
        },
      },
      orderBy: [{ createdAt: "asc" }],
    });
    return rows.map((b) => ({
      benefitId: b.id,
      walletCardId: b.walletCardId,
      productId: b.walletCard.card.id,
      productName: b.walletCard.card.name,
      lastFour: b.walletCard.lastFour,
      profileId: b.walletCard.profile?.id ?? null,
      profileName: b.walletCard.profile?.nickname ?? null,
      name: b.name,
      category: b.category?.slug ?? null,
      period: b.period,
      periodMonths: b.periodMonths,
      basis: b.basis,
      amountPerPeriodCents: b.amountPerPeriodCents,
      expiresOn: b.expiresOn,
      windowStart: b.windowStart,
      windowEnd: b.windowEnd,
      anchor: b.walletCard.approvedAt,
      enabled: b.enabled,
      usages: b.usages.map((u) => ({
        periodStart: u.periodStart,
        amountCents: u.amountCents,
        status: u.status,
        verification: u.verification,
        detectionMethod: u.detectionMethod ?? (u.source === "MANUAL" ? "MANUAL" : null),
        confidence: u.confidence,
        evidenceCount: u.statementImportId || u.creditTransactionId ? 1 : 0,
        updatedAt: u.createdAt,
      })),
    }));
  }

  async rollupView(userId: string, level: RollLevel, now = new Date()) {
    const records = (await this.load(userId)).map((b) => benefitRecord(b, now));
    return { level, groups: rollup(records, level), records };
  }

  async reconciliation(userId: string, now = new Date()) {
    const rows = (await this.load(userId)).map((b) => reconcileBenefit(b, now));
    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((n, r) => n + f(r), 0);
    return {
      totals: {
        expectedCents: sum((r) => r.expectedCents),
        detectedCents: sum((r) => r.detectedCents),
        pendingCents: sum((r) => r.pendingCents),
        missingCents: sum((r) => r.missingCents),
        expiredCents: sum((r) => r.expiredCents),
        unusedCents: sum((r) => r.unusedCents),
      },
      rows,
      unused: rows.filter((r) => r.detectedCents + r.pendingCents === 0 && r.unusedCents > 0),
      expired: rows.filter((r) => r.expiredCents > 0),
      potentialMissed: rows.filter((r) => r.potentialMissed),
      actions: rows
        .filter((r) => r.suggestion !== "On track.")
        .map((r) => ({
          benefitId: r.benefitId,
          card: r.card,
          lastFour: r.lastFour,
          cardholder: r.cardholder,
          benefit: r.benefitName,
          suggestion: r.suggestion,
        })),
    };
  }

  /** Per benefit: detected / matched / missed transactions, overrides, confidences, statement references. */
  async audit(userId: string, now = new Date()) {
    const roll = await this.load(userId);
    const records = roll.map((b) => benefitRecord(b, now));
    const since = new Date(now.getTime() - 365 * DAY);
    const detections = await this.prisma.benefitDetection.findMany({
      where: { userBenefit: { walletCard: { wallet: { userId } } }, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      take: 2000,
    });
    const txIds = [...new Set(detections.map((d) => d.transactionId))];
    const importIds = [...new Set(detections.map((d) => d.statementImportId).filter((x): x is string => !!x))];
    const [txs, imports] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { id: { in: txIds }, userId },
        select: { id: true, description: true, occurredAt: true, amountCents: true, kind: true },
      }),
      this.prisma.statementImport.findMany({
        where: { id: { in: importIds }, userId },
        select: { id: true, periodStart: true, periodEnd: true, channel: true, format: true, createdAt: true },
      }),
    ]);
    const txById = new Map(txs.map((t) => [t.id, t]));
    const impById = new Map(imports.map((i) => [i.id, i]));
    // credits that look like issuer credits but matched nothing on their card: missed transactions
    const unmatched = await this.prisma.transaction.findMany({
      where: {
        userId,
        kind: "CREDIT",
        occurredAt: { gte: since },
        walletCard: { status: { not: "CLOSED" } },
        id: { notIn: txIds.length ? txIds : ["-"] },
      },
      orderBy: { occurredAt: "desc" },
      take: 200,
      select: { id: true, walletCardId: true, description: true, occurredAt: true, amountCents: true },
    });
    const items = records.map((r) => {
      const mine = detections.filter((d) => d.userBenefitId === r.benefitId);
      return {
        ...r,
        detected: mine.length,
        matched: mine.filter((d) => d.status !== "REJECTED").length,
        manualOverrides: mine.filter((d) => d.status !== "DETECTED").length,
        missed: unmatched.filter((t) => t.walletCardId === r.cardAccountId).length,
        detections: mine.slice(0, 50).map((d) => ({
          id: d.id,
          method: d.method,
          confidence: d.confidence,
          tier: d.tier,
          rule: d.rule,
          status: d.status,
          duplicateRisk: d.duplicateRisk,
          aiReasoning: d.aiReasoning,
          decidedAt: d.decidedAt,
          transaction: txById.get(d.transactionId) ?? null,
          statement: d.statementImportId ? (impById.get(d.statementImportId) ?? null) : null,
        })),
      };
    });
    return {
      items,
      missedTransactions: unmatched,
      summary: {
        benefits: items.length,
        detected: items.reduce((n, i) => n + i.detected, 0),
        matched: items.reduce((n, i) => n + i.matched, 0),
        overrides: items.reduce((n, i) => n + i.manualOverrides, 0),
        needsReview: detections.filter((d) => d.status === "DETECTED" && d.tier === "REVIEW").length,
        missedTransactions: unmatched.length,
      },
    };
  }

  /** The user's accept / reject of a detected match. Rejecting keeps the usage out of every total and stops it being re-matched. */
  async decide(userId: string, id: string, decision: "ACCEPT" | "REJECT", now = new Date()) {
    const d = await this.prisma.benefitDetection.findFirst({
      where: { id, userBenefit: { walletCard: { wallet: { userId } } } },
    });
    if (!d) throw new NotFoundException("Detection not found");
    if (d.status !== "DETECTED") throw new BadRequestException("This detection was already decided");
    await this.prisma.$transaction(async (tx) => {
      await tx.benefitDetection.update({
        where: { id },
        data: { status: decision === "ACCEPT" ? "ACCEPTED" : "REJECTED", decidedAt: now },
      });
      if (d.usageId)
        await tx.benefitUsage.update({
          where: { id: d.usageId },
          data:
            decision === "ACCEPT"
              ? { verification: "VERIFIED" }
              : { verification: "REJECTED", status: "DISMISSED" },
        });
    });
    return { id, status: decision === "ACCEPT" ? "ACCEPTED" : "REJECTED" };
  }

  /** Statement imports with their validation reports (newest first). */
  async statements(userId: string) {
    const rows = await this.prisma.statementImport.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        validation: true,
        walletCard: { select: { lastFour: true, nickname: true, card: { select: { name: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      card: r.walletCard.nickname || r.walletCard.card.name,
      lastFour: r.walletCard.lastFour,
      format: r.format,
      channel: r.channel,
      periodStart: r.periodStart,
      periodEnd: r.periodEnd,
      importedAt: r.createdAt,
      rows: r.rows,
      imported: r.imported,
      duplicates: r.duplicates,
      validation: r.validation && {
        status: r.validation.status,
        confidence: r.validation.confidence,
        statementCount: r.validation.statementCount,
        importedCount: r.validation.importedCount,
        differenceCount: r.validation.differenceCount,
        statementCents: r.validation.statementCents,
        importedCents: r.validation.importedCents,
        missingCents: r.validation.missingCents,
        notes: ((r.validation.details as { notes?: string[] } | null)?.notes ?? []) as string[],
      },
    }));
  }
}

@ApiTags("benefit-audit")
@ApiBearerAuth()
@Controller("benefit-audit")
export class BenefitAuditController {
  constructor(private readonly svc: BenefitAuditService) {}

  @Get() audit(@CurrentUser() u: AuthUser) {
    return this.svc.audit(u.sub);
  }
  @Get("rollup") rollup(@CurrentUser() u: AuthUser, @Query() q: RollupQuery) {
    return this.svc.rollupView(u.sub, q.level ?? "account");
  }
  @Get("reconciliation") reconciliation(@CurrentUser() u: AuthUser) {
    return this.svc.reconciliation(u.sub);
  }
  @Get("statements") statements(@CurrentUser() u: AuthUser) {
    return this.svc.statements(u.sub);
  }
  @Patch("detections/:id") decide(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() dto: DecisionDto,
  ) {
    return this.svc.decide(u.sub, id, dto.decision);
  }
}

@Module({ providers: [BenefitAuditService], controllers: [BenefitAuditController], exports: [BenefitAuditService] })
export class BenefitAuditModule {}

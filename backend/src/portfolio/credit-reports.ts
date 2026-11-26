import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { AnyFilesInterceptor } from "@nestjs/platform-express";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, ValidateNested } from "class-validator";
import { randomUUID } from "crypto";
import {
  mergeReports,
  parseCreditReport,
  Tradeline,
} from "../domain/credit-report";
import { issuerMatches } from "../domain/card-research";
import { limitsFor } from "../domain/entitlements";
import { StatementError } from "../domain/spend";
import { extractPdfLines } from "../spend/pdf-extract";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProperty,
  ApiPropertyOptional,
  ApiTags,
} from "@nestjs/swagger";
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Bureau } from "@prisma/client";
import { AuthUser, CurrentUser } from "../common/decorators";
import { PrismaService } from "../common/prisma.service";
import { matchExisting } from "../domain/import";
import { HouseholdsModule, HouseholdsService } from "./households";

export class CreditReportAccountDto {
  @ApiPropertyOptional({ enum: Bureau })
  @IsOptional()
  @IsEnum(Bureau)
  bureau?: Bureau;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) creditorName: string;
  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^\d{4,5}$/)
  lastDigits?: string;
  @ApiProperty({
    description:
      "credit reports show month granularity; the 1st of the month is fine",
  })
  @IsDateString()
  openedOn: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isBusiness?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isAuthorizedUser?: boolean;
  @ApiPropertyOptional({ enum: ["OPEN", "CLOSED"] })
  @IsOptional()
  @IsIn(["OPEN", "CLOSED"])
  status?: "OPEN" | "CLOSED";
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000_00)
  creditLimitCents?: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({
    description: "link to a wallet card explicitly (otherwise auto-matched)",
  })
  @IsOptional()
  @IsUUID()
  walletCardId?: string;
}

/**
 * Bureau feasibility (see docs/bank-and-bureau-feasibility.md). Only manual / file-based entry is
 * implemented; direct bureau APIs need a commercial agreement and FCRA permissible purpose.
 */
export const BUREAU_PROVIDERS = [
  {
    id: "manual",
    name: "Manual entry from your credit report",
    status: "AVAILABLE",
    note: "Copy open dates from annualcreditreport.com (free weekly reports).",
  },
  {
    id: "bureau-reports",
    name: "Experian, Equifax and TransUnion reports",
    status: "FILE_IMPORT",
    note: "Download the reports (annualcreditreport.com — free weekly — or each bureau's site) as PDF and import up to three at once; accounts are merged across bureaus.",
  },
  {
    id: "experian",
    name: "Experian Connect / partner APIs",
    status: "REQUIRES_AGREEMENT",
    note: "Business contract, identity verification and FCRA compliance review required.",
  },
  {
    id: "credit-karma",
    name: "Credit Karma (TransUnion / Equifax)",
    status: "FILE_IMPORT",
    note: "No API and no automated access: print the credit report page to PDF (or copy its text) and import it here.",
  },
] as const;

export class ReportPreviewDto {
  @ApiPropertyOptional({
    description: "text copied from the credit report page (instead of a file)",
  })
  @IsOptional()
  @IsString()
  @MaxLength(500_000)
  text?: string;
  @ApiPropertyOptional({
    description: "household member the report belongs to (default: you)",
  })
  @IsOptional()
  @IsUUID()
  profileId?: string;
}

export class ReportImportRowDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) creditorName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) issuer?:
    string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) accountType?:
    string | null;
  @ApiProperty() @IsDateString() openedOn: string;
  @ApiProperty({ enum: ["DAY", "MONTH"] }) @IsIn(["DAY", "MONTH"]) precision:
    "DAY" | "MONTH";
  @ApiProperty({ enum: ["OPEN", "CLOSED"] }) @IsIn(["OPEN", "CLOSED"]) status:
    "OPEN" | "CLOSED";
  @ApiPropertyOptional() @IsOptional() @IsDateString() closedOn?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4,5}$/) lastDigits?:
    string | null;
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000_00)
  creditLimitCents?: number | null;
  @ApiProperty() @IsBoolean() isAuthorizedUser: boolean;
  @ApiProperty({ enum: ["LINK", "ADD", "SKIP"] })
  @IsIn(["LINK", "ADD", "SKIP"])
  action: "LINK" | "ADD" | "SKIP";
  @ApiPropertyOptional({ description: "LINK: the wallet card" })
  @IsOptional()
  @IsUUID()
  walletCardId?: string;
  @ApiPropertyOptional({
    description: "LINK: replace an open date already on the card",
  })
  @IsOptional()
  @IsBoolean()
  overwrite?: boolean;
  @ApiPropertyOptional({
    enum: Bureau,
    isArray: true,
    description: "bureaus whose reports listed the account",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsEnum(Bureau, { each: true })
  bureaus?: Bureau[];
}

type Upload = { buffer: Buffer; originalname: string; size: number };
const REPORT_SOURCES = [
  "CREDIT_KARMA_PDF",
  "CREDIT_KARMA_TEXT",
  "BUREAU_PDF",
  "BUREAU_TEXT",
  "MULTIPLE",
];

export class ReportImportDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() profileId?: string;
  @ApiPropertyOptional({ enum: Bureau })
  @IsOptional()
  @IsEnum(Bureau)
  bureau?: Bureau;
  @ApiPropertyOptional({ enum: REPORT_SOURCES })
  @IsOptional()
  @IsIn(REPORT_SOURCES)
  source?: string;
  @ApiProperty({ type: [ReportImportRowDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReportImportRowDto)
  accounts: ReportImportRowDto[];
}

const DAY = 86_400_000;
const sameMonth = (a: Date, b: Date) =>
  a.getUTCFullYear() === b.getUTCFullYear() &&
  a.getUTCMonth() === b.getUTCMonth();

@Injectable()
export class CreditReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
  ) {}

  list(userId: string) {
    return this.prisma.creditReportAccount.findMany({
      where: { userId },
      include: {
        walletCard: {
          select: {
            id: true,
            nickname: true,
            approvedAt: true,
            card: { select: { name: true } },
          },
        },
        profile: { select: { id: true, nickname: true } },
      },
      orderBy: { openedOn: "desc" },
    });
  }

  private async autoMatch(
    userId: string,
    dto: CreditReportAccountDto,
  ): Promise<string | null> {
    const rows = await this.prisma.walletCard.findMany({
      where: { wallet: { userId } },
      include: { card: { include: { issuer: true } }, profile: true },
    });
    const primary = await this.households.primary(userId);
    const owner = dto.profileId
      ? (rows.find((r) => r.profileId === dto.profileId)?.profile?.nickname ??
        primary.nickname)
      : primary.nickname;
    const hit = matchExisting(
      {
        cardName: dto.creditorName,
        issuer: dto.creditorName,
        lastDigits: dto.lastDigits ?? null,
        owner,
      },
      rows.map((r) => ({
        id: r.id,
        cardName: r.nickname || r.card.name,
        issuer: r.card.issuer.name,
        lastDigits: r.lastFour,
        owner: r.profile?.nickname ?? primary.nickname,
      })),
    );
    return hit?.id ?? null;
  }

  async create(userId: string, dto: CreditReportAccountDto) {
    if (dto.profileId) await this.households.owned(userId, dto.profileId);
    if (dto.walletCardId) {
      const wc = await this.prisma.walletCard.findUnique({
        where: { id: dto.walletCardId },
        include: { wallet: true },
      });
      if (!wc || wc.wallet.userId !== userId)
        throw new NotFoundException("Wallet card not found");
    }
    const openedOn = new Date(dto.openedOn);
    if (openedOn.getTime() > Date.now())
      throw new BadRequestException("openedOn cannot be in the future");
    return this.prisma.creditReportAccount.create({
      data: {
        userId,
        profileId: dto.profileId,
        bureau: dto.bureau ?? "OTHER",
        creditorName: dto.creditorName,
        lastDigits: dto.lastDigits,
        openedOn,
        isBusiness: dto.isBusiness ?? false,
        isAuthorizedUser: dto.isAuthorizedUser ?? false,
        status: dto.status ?? "OPEN",
        creditLimitCents: dto.creditLimitCents,
        walletCardId: dto.walletCardId ?? (await this.autoMatch(userId, dto)),
      },
    });
  }

  private async owned(userId: string, id: string) {
    const a = await this.prisma.creditReportAccount.findUnique({
      where: { id },
    });
    if (!a || a.userId !== userId)
      throw new NotFoundException("Credit report account not found");
    return a;
  }

  /** Copy the report's open date (month precision), AU flag and status onto the linked wallet card. */
  async apply(userId: string, id: string) {
    const a = await this.owned(userId, id);
    if (!a.walletCardId)
      throw new BadRequestException("Link this account to a wallet card first");
    return this.prisma.walletCard.update({
      where: { id: a.walletCardId },
      data: {
        approvedAt: new Date(
          Date.UTC(a.openedOn.getUTCFullYear(), a.openedOn.getUTCMonth(), 1),
        ),
        openDatePrecision: "MONTH",
        ...(a.isAuthorizedUser && { cardholder: "AUTHORIZED_USER" }),
        ...(a.status === "CLOSED" && { status: "CLOSED" }),
        ...(a.creditLimitCents != null && {
          creditLimitCents: a.creditLimitCents,
        }),
        ...(a.profileId && { profileId: a.profileId }),
      },
      select: {
        id: true,
        approvedAt: true,
        openDatePrecision: true,
        cardholder: true,
        status: true,
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.prisma.creditReportAccount.delete({ where: { id } });
  }

  // ───────── credit report import: Experian, Equifax, TransUnion, Credit Karma (PDF or copied text) ─────────

  /** Text lines of each uploaded report (PDFs via the sandboxed extractor) and of pasted text. */
  private async reportSources(
    files: Upload[],
    text: string | undefined,
  ): Promise<Array<{ name: string; kind: "PDF" | "TEXT"; lines: string[] }>> {
    const out: Array<{ name: string; kind: "PDF" | "TEXT"; lines: string[] }> =
      [];
    for (const file of files) {
      const isPdf =
        /\.pdf$/i.test(file.originalname) ||
        file.buffer.subarray(0, 5).toString("latin1") === "%PDF-";
      if (isPdf) {
        try {
          out.push({
            name: file.originalname,
            kind: "PDF",
            lines: (
              await extractPdfLines(file.buffer, { maxPages: 80 })
            ).flat(),
          });
        } catch (e) {
          if (e instanceof StatementError)
            throw new BadRequestException(
              `${file.originalname}: ${e.message.replace("a card statement", "a credit report")}`,
            );
          throw e;
        }
      } else if (/\.(txt|text)$/i.test(file.originalname))
        out.push({
          name: file.originalname,
          kind: "TEXT",
          lines: file.buffer.toString("utf8").split(/\r?\n/),
        });
      else
        throw new BadRequestException(
          `${file.originalname}: upload credit reports as PDF (download, or print the page and choose "Save as PDF"), or paste the text`,
        );
    }
    if (text && text.trim().length > 20)
      out.push({
        name: "pasted text",
        kind: "TEXT",
        lines: text.split(/\r?\n/),
      });
    if (!out.length)
      throw new BadRequestException(
        "Attach the credit report PDF(s) or paste the report text",
      );
    return out;
  }

  /**
   * Parses up to three reports (one per bureau, from the bureau / annualcreditreport.com or Credit
   * Karma) and merges them per account, then proposes for each card account: LINK to the matching
   * wallet card (open date onto the card), ADD as a card (so 5/24 counts it) or SKIP. Nothing is
   * saved; files and text are discarded after parsing.
   */
  async preview(
    userId: string,
    files: Upload[],
    dto: ReportPreviewDto,
    now = new Date(),
  ) {
    const profileId =
      dto.profileId ?? (await this.households.primary(userId)).id;
    await this.households.owned(userId, profileId);
    const sources = await this.reportSources(files, dto.text);
    const parsed = sources.map((s) => ({
      s,
      r: parseCreditReport(s.lines, now),
    }));
    const empty = parsed.filter(
      ({ r }) => !r.accounts.length && !r.skipped.length,
    );
    if (empty.length === parsed.length)
      throw new BadRequestException(
        sources.every((s) => s.lines.join(" ").trim().length < 40)
          ? "This PDF has no text layer (a scan or photo). Download the report as PDF from the bureau, print the page to PDF from the browser, or paste its text."
          : 'No accounts were found. Use the report section that lists your accounts with "Date opened" (download / print it, or copy its text).',
      );
    const usable = parsed.filter(
      ({ r }) => r.accounts.length || r.skipped.length,
    );
    const report = mergeReports(usable.map(({ r }) => r));
    const source =
      usable.length === 1
        ? `${usable[0].r.provider}_${usable[0].s.kind}`
        : "MULTIPLE";
    const primary = await this.households.primary(userId);
    const cards = await this.prisma.walletCard.findMany({
      where: { wallet: { userId } },
      include: { card: { include: { issuer: true } } },
    });
    const mine = cards.filter((c) => (c.profileId ?? primary.id) === profileId);
    const imported = await this.prisma.creditReportAccount.findMany({
      where: { userId },
      select: { creditorName: true, openedOn: true, lastDigits: true },
    });
    const used = new Set<string>();
    const pick = (t: Tradeline) => {
      const sameIssuer = mine.filter(
        (c) =>
          !used.has(c.id) &&
          issuerMatches(
            { name: c.card.issuer.name, aliases: c.card.issuer.aliases },
            t.issuer ?? t.creditorName,
          ),
      );
      const byDigits = t.lastDigits
        ? sameIssuer.find(
            (c) =>
              c.lastFour &&
              (c.lastFour === t.lastDigits ||
                c.lastFour.endsWith(t.lastDigits!.slice(-4))),
          )
        : undefined;
      if (byDigits) return { card: byDigits, by: "last digits" };
      const byMonth = sameIssuer.filter(
        (c) => c.approvedAt && sameMonth(c.approvedAt, t.openedOn),
      );
      if (byMonth.length === 1)
        return { card: byMonth[0], by: "issuer and open month" };
      const undated = sameIssuer.filter((c) => !c.approvedAt);
      if (undated.length === 1 && !t.lastDigits)
        return {
          card: undated[0],
          by: "only card from this issuer without an open date",
        };
      return null;
    };
    // strongest evidence first so a card is claimed by its best account
    const order = report.accounts
      .map((t, i) => ({ t, i }))
      .sort((a, b) => Number(!!b.t.lastDigits) - Number(!!a.t.lastDigits));
    const matches = new Map<number, ReturnType<typeof pick>>();
    for (const { t, i } of order) {
      const m = pick(t);
      if (m) used.add(m.card.id);
      matches.set(i, m);
    }
    return {
      bureau: report.bureaus.length === 1 ? report.bureaus[0] : "MULTIPLE",
      bureaus: report.bureaus,
      reports: parsed.map(({ s, r }) => ({
        name: s.name,
        bureau: r.bureau,
        provider: r.provider,
        accounts: r.accounts.length,
        skipped: r.skipped.length,
      })),
      source,
      profileId,
      accounts: report.accounts.map((t, i) => {
        const m = matches.get(i) ?? null;
        const recent = now.getTime() - t.openedOn.getTime() < 24 * 30.44 * DAY;
        const current = m?.card.approvedAt ?? null;
        return {
          ...t,
          openedOn: t.openedOn.toISOString().slice(0, 10),
          closedOn: t.closedOn?.toISOString().slice(0, 10) ?? null,
          alreadyImported: imported.some(
            (x) =>
              x.creditorName === t.creditorName &&
              x.openedOn.getTime() === t.openedOn.getTime() &&
              (x.lastDigits ?? null) === (t.lastDigits ?? null),
          ),
          match: m
            ? {
                walletCardId: m.card.id,
                name: m.card.nickname || m.card.card.name,
                by: m.by,
                currentOpenDate: current?.toISOString().slice(0, 10) ?? null,
                dateCheck: !current
                  ? "MISSING"
                  : sameMonth(current, t.openedOn) &&
                      (t.precision === "MONTH" ||
                        current.getTime() === t.openedOn.getTime())
                    ? "SAME"
                    : "DIFFERENT",
              }
            : null,
          suggested: m ? "LINK" : recent ? "ADD" : "SKIP",
          note: m
            ? null
            : recent
              ? "Opened in the last 24 months — add it so 5/24 counts it"
              : "Older than 24 months — not needed for 5/24",
        };
      }),
      skipped: report.skipped,
    };
  }

  /** Saves the confirmed rows: report accounts, open dates on linked cards, new private cards for ADD. */
  async importAccounts(userId: string, dto: ReportImportDto, now = new Date()) {
    const profileId =
      dto.profileId ?? (await this.households.primary(userId)).id;
    await this.households.owned(userId, profileId);
    const wallet = await this.prisma.wallet.upsert({
      where: { userId },
      update: {},
      create: { userId },
    });
    const sub = await this.prisma.subscription.findUnique({
      where: { userId },
    });
    const limits = limitsFor(sub, now);
    let cardCount = await this.prisma.walletCard.count({
      where: { walletId: wallet.id },
    });
    const out = {
      linked: 0,
      added: 0,
      skipped: 0,
      keptExistingDate: 0,
      limitReached: 0,
      accounts: 0,
    };
    for (const r of dto.accounts) {
      if (r.action === "SKIP") {
        out.skipped++;
        continue;
      }
      const openedOn = new Date(`${r.openedOn.slice(0, 10)}T00:00:00Z`);
      if (openedOn.getTime() > now.getTime())
        throw new BadRequestException(
          `${r.creditorName}: open date is in the future`,
        );
      const closedOn = r.closedOn
        ? new Date(`${r.closedOn.slice(0, 10)}T00:00:00Z`)
        : null;
      const approvedAt =
        r.precision === "MONTH"
          ? new Date(
              Date.UTC(openedOn.getUTCFullYear(), openedOn.getUTCMonth(), 1),
            )
          : openedOn;
      let walletCardId: string;
      if (r.action === "LINK") {
        if (!r.walletCardId)
          throw new BadRequestException(
            `${r.creditorName}: choose the wallet card to link`,
          );
        const wc = await this.prisma.walletCard.findFirst({
          where: { id: r.walletCardId, walletId: wallet.id },
        });
        if (!wc) throw new NotFoundException("Wallet card not found");
        // a report's month-level date never replaces a day-level date in the same month
        const keep =
          !!wc.approvedAt &&
          !r.overwrite &&
          (sameMonth(wc.approvedAt, approvedAt)
            ? wc.openDatePrecision === "DAY" && r.precision === "MONTH"
            : true);
        if (keep) out.keptExistingDate++;
        await this.prisma.walletCard.update({
          where: { id: wc.id },
          data: {
            ...(!keep && { approvedAt, openDatePrecision: r.precision }),
            ...(r.isAuthorizedUser && { cardholder: "AUTHORIZED_USER" }),
            ...(r.status === "CLOSED" && {
              status: "CLOSED",
              closedAt: closedOn ?? wc.closedAt ?? now,
            }),
            ...(r.creditLimitCents != null && {
              creditLimitCents: r.creditLimitCents,
            }),
            ...(!wc.lastFour && r.lastDigits && { lastFour: r.lastDigits }),
            profileId: wc.profileId ?? profileId,
          },
        });
        walletCardId = wc.id;
        out.linked++;
      } else {
        if (cardCount >= limits.maxCards) {
          out.limitReached++;
          continue;
        }
        const issuerName = (r.issuer || r.creditorName).slice(0, 80);
        const issuer =
          (await this.prisma.issuer.findFirst({
            where: {
              OR: [
                { name: { equals: issuerName, mode: "insensitive" } },
                { aliases: { has: issuerName } },
              ],
            },
          })) ??
          (await this.prisma.issuer.create({ data: { name: issuerName } }));
        const cash = await this.prisma.rewardCurrency.findFirst({
          where: { isCash: true },
        });
        if (!cash) throw new BadRequestException("Catalog is not seeded");
        const card = await this.prisma.creditCard.create({
          data: {
            slug: `u-${randomUUID()}`,
            name: `${r.issuer ?? r.creditorName} card${r.lastDigits ? ` ··${r.lastDigits}` : ""}`.slice(
              0,
              120,
            ),
            issuerId: issuer.id,
            network: "OTHER",
            currencyId: cash.id,
            isActive: false,
            ownerId: userId,
          },
        });
        const wc = await this.prisma.walletCard.create({
          data: {
            walletId: wallet.id,
            cardId: card.id,
            profileId,
            approvedAt,
            openDatePrecision: r.precision,
            lastFour: r.lastDigits ?? null,
            creditLimitCents: r.creditLimitCents ?? null,
            cardholder: r.isAuthorizedUser ? "AUTHORIZED_USER" : "PRIMARY",
            status: r.status === "CLOSED" ? "CLOSED" : "APPROVED",
            closedAt: r.status === "CLOSED" ? (closedOn ?? now) : null,
            source: "CREDIT_REPORT",
            sourceMeta: {
              creditor: r.creditorName,
              bureau: dto.bureau ?? "OTHER",
            },
            sortOrder: cardCount,
          },
        });
        cardCount++;
        walletCardId = wc.id;
        out.added++;
      }
      // the same account imported before (from any bureau): same card, or same creditor / date / digits
      const existing = await this.prisma.creditReportAccount.findFirst({
        where: {
          userId,
          OR: [
            { walletCardId },
            {
              creditorName: r.creditorName,
              openedOn,
              lastDigits: r.lastDigits ?? null,
            },
          ],
        },
      });
      const reportedBy = r.bureaus?.length
        ? r.bureaus
        : dto.bureau
          ? [dto.bureau]
          : [];
      const data = {
        profileId,
        bureau: reportedBy[0] ?? dto.bureau ?? "OTHER",
        reportedBy: [
          ...new Set([...(existing?.reportedBy ?? []), ...reportedBy]),
        ],
        creditorName: r.creditorName,
        lastDigits: r.lastDigits ?? null,
        openedOn,
        openedPrecision: r.precision,
        closedOn,
        accountType: r.accountType ?? null,
        isAuthorizedUser: r.isAuthorizedUser,
        status: r.status,
        creditLimitCents: r.creditLimitCents ?? null,
        source: dto.source ?? "CREDIT_KARMA_PDF",
        walletCardId,
      };
      if (existing)
        await this.prisma.creditReportAccount.update({
          where: { id: existing.id },
          data,
        });
      else
        await this.prisma.creditReportAccount.create({
          data: { userId, ...data },
        });
      out.accounts++;
    }
    return out;
  }
}

@ApiTags("credit-reports")
@ApiBearerAuth()
@Controller("credit-reports")
export class CreditReportsController {
  constructor(private readonly svc: CreditReportsService) {}

  @Get("providers") providers() {
    return BUREAU_PROVIDERS;
  }
  @Post("import/preview")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Parse a Credit Karma credit report (printed PDF or copied text) and propose links / new cards — nothing is saved",
  })
  @ApiConsumes("multipart/form-data", "application/json")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        files: {
          type: "array",
          items: { type: "string", format: "binary" },
          description: "up to 3 reports (one per bureau)",
        },
        text: { type: "string" },
        profileId: { type: "string", format: "uuid" },
      },
    },
  })
  @UseInterceptors(
    AnyFilesInterceptor({
      limits: {
        fileSize: 15 * 1024 * 1024,
        files: 3,
        fields: 5,
        fieldSize: 600_000,
      },
    }),
  )
  preview(
    @CurrentUser() u: AuthUser,
    @Body() dto: ReportPreviewDto,
    @UploadedFiles() files?: Upload[],
  ) {
    return this.svc.preview(u.sub, files ?? [], dto);
  }
  @Post("import")
  @HttpCode(200)
  @ApiOperation({
    summary:
      "Save the confirmed accounts: open dates onto wallet cards, new cards for 5/24",
  })
  importAccounts(@CurrentUser() u: AuthUser, @Body() dto: ReportImportDto) {
    return this.svc.importAccounts(u.sub, dto);
  }
  @Get("accounts") list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.sub);
  }
  @Post("accounts") create(
    @CurrentUser() u: AuthUser,
    @Body() dto: CreditReportAccountDto,
  ) {
    return this.svc.create(u.sub, dto);
  }
  @Post("accounts/:id/apply") apply(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.apply(u.sub, id);
  }
  @Delete("accounts/:id") @HttpCode(204) remove(
    @CurrentUser() u: AuthUser,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    return this.svc.remove(u.sub, id);
  }
}

@Module({
  imports: [HouseholdsModule],
  controllers: [CreditReportsController],
  providers: [CreditReportsService],
})
export class CreditReportsModule {}

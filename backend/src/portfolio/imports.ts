import {
  BadRequestException,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { CardNetwork, Prisma, Profile } from '@prisma/client';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { distributeUsage } from '../domain/benefits';
import { limitsFor } from '../domain/entitlements';
import {
  BUSINESS_REPORTS_TO_PERSONAL,
  canonicalIssuer,
  Cell,
  cardsForBenefit,
  CSV_TEMPLATE,
  ExistingCard,
  ImportIssue,
  matchCatalog,
  matchExisting,
  norm,
  ParsedBenefit,
  ParsedCard,
  parseCsv,
  parseWorkbook,
  Sheet,
} from '../domain/import';
import { HouseholdsModule, HouseholdsService } from './households';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_SHEETS = 20;
const MAX_ROWS = 5000;

/** exceljs cell value → plain cell (formula results, rich text, hyperlinks). */
export function plainCell(v: unknown): Cell {
  if (v == null) return null;
  if (v instanceof Date || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return plainCell(o.result);
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((t) => t.text).join('');
    if ('text' in o) return plainCell(o.text);
    if ('error' in o) return null;
  }
  return null;
}

/** .xlsx / .csv bytes → sheets. Formulas are never evaluated; cached results are read. */
export async function readUpload(buf: Buffer, fileName: string): Promise<Sheet[]> {
  const isZip = buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b;
  if (isZip) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExcelJS = require('exceljs') as typeof import('exceljs');
    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buf as never);
    } catch {
      throw new BadRequestException('Could not read the workbook (only .xlsx is supported)');
    }
    if (wb.worksheets.length > MAX_SHEETS) throw new BadRequestException(`Workbook has more than ${MAX_SHEETS} sheets`);
    return wb.worksheets.map((ws) => {
      if (ws.rowCount > MAX_ROWS) throw new BadRequestException(`Sheet "${ws.name}" has more than ${MAX_ROWS} rows`);
      const rows: Cell[][] = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        const values = (row.values as unknown[]).slice(1); // exceljs rows are 1-based
        rows[n - 1] = values.map(plainCell);
      });
      for (let i = 0; i < rows.length; i++) rows[i] ??= [];
      return { name: ws.name, rows };
    });
  }
  if (!/\.(csv|txt)$/i.test(fileName)) throw new BadRequestException('Upload an .xlsx workbook or a .csv file');
  const text = buf.toString('utf8');
  if (text.includes('\u0000')) throw new BadRequestException('File is not text');
  try {
    return [{ name: fileName.replace(/\.[^.]+$/, '') || 'csv', rows: parseCsv(text, MAX_ROWS) }];
  } catch (e) {
    throw new BadRequestException((e as Error).message);
  }
}

const networkFor = (issuer: string): CardNetwork => {
  const c = canonicalIssuer(issuer);
  if (c === 'american express') return 'AMEX';
  if (c === 'discover') return 'DISCOVER';
  return 'OTHER';
};

/** Whole words only: "Personal" contains "son" but is not a child. */
export const relationshipFor = (owner: string) =>
  /\b(spouse|wife|husband)\b/i.test(owner)
    ? 'SPOUSE'
    : /\bpartner\b/i.test(owner)
      ? 'PARTNER'
      : /\b(son|daughter|child|kid)s?\b/i.test(owner)
        ? 'CHILD'
        : 'OTHER';

interface CardRowData {
  card: ParsedCard;
  catalogCardId: string | null;
  catalogScore: number | null;
  existingWalletCardId: string | null;
}
interface BenefitRowData {
  benefit: ParsedBenefit;
  targetKeys: string[];
}

type WalletRow = Prisma.WalletCardGetPayload<{ include: { card: { include: { issuer: true } }; profile: true; benefits: { select: { name: true } } } }>;

@Injectable()
export class ImportsService {
  private readonly logger = new Logger(ImportsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly households: HouseholdsService,
  ) {}

  private async wallet(userId: string): Promise<WalletRow[]> {
    return this.prisma.walletCard.findMany({
      where: { wallet: { userId } },
      include: { card: { include: { issuer: true } }, profile: true, benefits: { select: { name: true } } },
    });
  }

  /** Parse an upload and store a PREVIEW job: nothing in the wallet changes until commit. */
  async preview(userId: string, file: { buffer: Buffer; originalname: string; size: number } | undefined) {
    if (!file) throw new BadRequestException('Attach a file in the "file" field');
    if (file.size > MAX_UPLOAD_BYTES) throw new BadRequestException('File is larger than 5 MB');
    const sheets = await readUpload(file.buffer, file.originalname);
    const parsed = parseWorkbook(sheets);
    const [existingRows, catalog, primary] = await Promise.all([
      this.wallet(userId),
      this.prisma.creditCard.findMany({ where: { isActive: true, ownerId: null }, select: { id: true, name: true, type: true, issuer: { select: { name: true } } } }),
      this.households.primary(userId),
    ]);
    const existing: ExistingCard[] = existingRows.map((w) => ({
      id: w.id,
      cardName: w.nickname || w.card.name,
      issuer: w.card.issuer.name,
      lastDigits: w.lastFour,
      owner: w.profile?.nickname ?? primary.nickname,
    }));
    const primaryAlias = (owner: string) => (parsed.owners[0] && norm(owner) === norm(parsed.owners[0]) ? primary.nickname : owner);
    const rowErrors = new Map<string, ImportIssue[]>();
    for (const i of parsed.issues) rowErrors.set(`${i.sheet}:${i.row}`, [...(rowErrors.get(`${i.sheet}:${i.row}`) ?? []), i]);

    const rows: Prisma.ImportRowCreateManyJobInput[] = [];
    for (const card of parsed.cards) {
      const errs = (rowErrors.get(`${card.sheet}:${card.rowNumber}`) ?? []).filter((e) => e.severity === 'ERROR');
      const match = matchExisting({ ...card, owner: primaryAlias(card.owner) }, existing);
      const cat = matchCatalog(card.cardName, card.issuer, catalog.map((c) => ({ id: c.id, name: c.name, issuerName: c.issuer.name, type: c.type })), 0.5, card.isBusiness);
      const data: CardRowData = { card, catalogCardId: cat?.id ?? null, catalogScore: cat?.score ?? null, existingWalletCardId: match?.id ?? null };
      const result = errs.length ? 'ERROR' : card.duplicateOfRow ? 'DUPLICATE' : match ? 'UPDATE' : 'NEW';
      const message = errs.length
        ? errs.map((e) => e.message).join('; ')
        : card.duplicateOfRow
          ? `duplicate of row ${card.duplicateOfRow}`
          : match
            ? `matches "${match.cardName}" already in your wallet — missing details will be filled in`
            : cat
              ? 'new card (matched to the catalog)'
              : 'new card (added as a custom card)';
      rows.push({ kind: 'CARD', rowNumber: card.rowNumber, data: data as unknown as Prisma.InputJsonValue, result, message, matchedId: match?.id ?? cat?.id ?? null });
    }
    for (const benefit of parsed.benefits) {
      const targets = cardsForBenefit(benefit, parsed.cards);
      const data: BenefitRowData = { benefit, targetKeys: targets.map((t) => t.key) };
      const already = targets.every((t) => {
        const match = matchExisting({ ...t, owner: primaryAlias(t.owner) }, existing);
        const w = match && existingRows.find((r) => r.id === match.id);
        return w && w.benefits.some((b) => norm(b.name) === norm(benefit.name));
      });
      const result = targets.length === 0 ? 'SKIPPED' : already ? 'DUPLICATE' : 'NEW';
      const message = targets.length === 0 ? 'no matching card for this benefit' : already ? 'already tracked' : `${targets.length} card(s)`;
      rows.push({ kind: 'BENEFIT', rowNumber: benefit.rowNumber, data: data as unknown as Prisma.InputJsonValue, result, message });
    }
    const count = (kind: string, result: string) => rows.filter((r) => r.kind === kind && r.result === result).length;
    const summary = {
      owners: parsed.owners,
      sheetsRead: parsed.sheetsRead,
      cards: { NEW: count('CARD', 'NEW'), UPDATE: count('CARD', 'UPDATE'), DUPLICATE: count('CARD', 'DUPLICATE'), ERROR: count('CARD', 'ERROR') },
      benefits: { NEW: count('BENEFIT', 'NEW'), DUPLICATE: count('BENEFIT', 'DUPLICATE'), SKIPPED: count('BENEFIT', 'SKIPPED') },
      closedCards: parsed.cards.filter((c) => c.closed).length,
      authorizedUserCards: parsed.cards.filter((c) => c.isAuthorizedUser).length,
    };
    const job = await this.prisma.cardImportJob.create({
      data: {
        userId,
        source: /\.csv$|\.txt$/i.test(file.originalname) ? 'CSV' : 'SPREADSHEET',
        fileName: file.originalname.slice(0, 200),
        summary,
        errors: parsed.issues as unknown as Prisma.InputJsonValue,
        status: parsed.sheetsRead.length ? 'PREVIEW' : 'FAILED',
        rows: { createMany: { data: rows } },
      },
    });
    return this.get(userId, job.id);
  }

  list(userId: string) {
    return this.prisma.cardImportJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { id: true, source: true, status: true, fileName: true, summary: true, createdAt: true, committedAt: true },
    });
  }

  async get(userId: string, id: string) {
    const job = await this.prisma.cardImportJob.findUnique({ where: { id }, include: { rows: { orderBy: [{ kind: 'desc' }, { rowNumber: 'asc' }] } } });
    if (!job || job.userId !== userId) throw new NotFoundException('Import not found');
    return job;
  }

  async discard(userId: string, id: string): Promise<void> {
    const job = await this.get(userId, id);
    if (job.status !== 'PREVIEW') throw new ConflictException(`Import is ${job.status.toLowerCase()}`);
    await this.prisma.cardImportJob.update({ where: { id }, data: { status: 'DISCARDED' } });
  }

  private async issuerId(db: Prisma.TransactionClient, name: string | null, cache: Map<string, string>): Promise<string> {
    const display = name?.trim() || 'Unknown issuer';
    const key = canonicalIssuer(display);
    if (cache.has(key)) return cache.get(key) as string;
    const all = await db.issuer.findMany({ select: { id: true, name: true, aliases: true } });
    const hit = all.find((i) => canonicalIssuer(i.name) === key || i.aliases.some((a) => canonicalIssuer(a) === key));
    const id =
      hit?.id ??
      (
        await db.issuer.upsert({
          where: { name: display },
          update: {},
          create: { name: display, businessReportsToPersonal: BUSINESS_REPORTS_TO_PERSONAL.has(key) },
        })
      ).id;
    cache.set(key, id);
    return id;
  }

  /** Apply a PREVIEW job: create members, cards, benefits and year-to-date usage. */
  async commit(userId: string, id: string, now = new Date()) {
    const job = await this.get(userId, id);
    if (job.status !== 'PREVIEW') throw new ConflictException(`Import is ${job.status.toLowerCase()}`);
    const cardRows = job.rows.filter((r) => r.kind === 'CARD' && (r.result === 'NEW' || r.result === 'UPDATE'));
    const benefitRows = job.rows.filter((r) => r.kind === 'BENEFIT' && r.result === 'NEW');
    const summary = job.summary as { owners?: string[] };
    const owners = summary.owners ?? [];

    // plan limits
    const [sub, walletCount, members] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { userId } }),
      this.prisma.walletCard.count({ where: { wallet: { userId } } }),
      this.households.members(userId),
    ]);
    const limits = limitsFor(sub, now);
    const newCount = cardRows.filter((r) => r.result === 'NEW').length;
    if (walletCount + newCount > limits.maxCards) {
      throw new ForbiddenException(`This import adds ${newCount} cards; the Free plan allows ${limits.maxCards}. Upgrade to Pro to import everything.`);
    }

    const result = await this.prisma.$transaction(
      async (db) => {
        // claim the job (row lock): a concurrent second commit sees status ≠ PREVIEW and fails
        const claimed = await db.cardImportJob.updateMany({ where: { id, status: 'PREVIEW' }, data: { status: 'COMMITTED', committedAt: now } });
        if (claimed.count === 0) throw new ConflictException('Import was already committed');
        // owners → household members (first owner in the file = the account owner)
        const primary = members.find((m) => m.isPrimary) as Profile;
        const memberFor = new Map<string, Profile>();
        const neededOwners = new Set(cardRows.map((r) => (r.data as unknown as CardRowData).card.owner));
        for (const owner of neededOwners) {
          const isPrimary = (owners[0] && norm(owner) === norm(owners[0])) || norm(owner) === norm(primary.nickname) || /^(me|myself|self|mine)$/i.test(owner);
          let m = isPrimary ? primary : members.find((x) => norm(x.nickname) === norm(owner));
          if (!m) {
            if (!limits.profiles) throw new ForbiddenException(`"${owner}" would become a household member, which requires Pro`);
            m = await db.profile.create({
              data: { userId, householdId: primary.householdId, nickname: owner.slice(0, 40), relationship: relationshipFor(owner), sortOrder: members.length + memberFor.size },
            });
          }
          memberFor.set(norm(owner), m);
        }

        const walletId = (await db.wallet.upsert({ where: { userId }, update: {}, create: { userId } })).id;
        const cash = await db.rewardCurrency.findFirst({ where: { isCash: true } });
        if (!cash) throw new BadRequestException('Catalog is not seeded (no cash currency)');
        const issuerCache = new Map<string, string>();
        const walletByKey = new Map<string, { id: string; approvedAt: Date | null }>();
        let created = 0;
        let updated = 0;

        for (const r of cardRows) {
          const { card, catalogCardId, existingWalletCardId } = r.data as unknown as CardRowData;
          const member = memberFor.get(norm(card.owner)) as Profile;
          const cardholder = card.isAuthorizedUser || member.relationship === 'CHILD' ? 'AUTHORIZED_USER' : 'PRIMARY';
          const openedAt = card.openedAt ? new Date(card.openedAt) : null;
          if (existingWalletCardId) {
            const cur = await db.walletCard.findUnique({ where: { id: existingWalletCardId } });
            if (cur) {
              const wc = await db.walletCard.update({
                where: { id: cur.id },
                data: {
                  approvedAt: cur.approvedAt ?? openedAt,
                  openDatePrecision: cur.approvedAt ? cur.openDatePrecision : card.openDatePrecision,
                  lastFour: cur.lastFour ?? card.lastDigits,
                  creditLimitCents: cur.creditLimitCents ?? card.creditLimitCents,
                  ...(card.closed && cur.status !== 'CLOSED' && { status: 'CLOSED' }),
                  sourceMeta: { importJobId: job.id, row: card.rowNumber, sheet: card.sheet },
                },
              });
              walletByKey.set(card.key, { id: wc.id, approvedAt: wc.approvedAt });
              updated++;
              continue;
            }
          }
          let cardId = catalogCardId;
          let feeOverride: number | null = null;
          if (cardId) {
            const cat = await db.creditCard.findUnique({ where: { id: cardId }, select: { annualFeeCents: true } });
            if (card.annualFeeCents != null && cat && cat.annualFeeCents !== card.annualFeeCents) feeOverride = card.annualFeeCents;
          } else {
            const issuerId = await this.issuerId(db, card.issuer, issuerCache);
            cardId = (
              await db.creditCard.create({
                data: {
                  slug: `u-${randomUUID()}`,
                  name: card.cardName.slice(0, 120),
                  issuerId,
                  network: networkFor(card.issuer ?? ''),
                  type: card.isBusiness ? 'BUSINESS' : 'PERSONAL',
                  annualFeeCents: card.annualFeeCents ?? 0,
                  currencyId: cash.id,
                  isActive: false,
                  ownerId: userId,
                },
              })
            ).id;
          }
          const wc = await db.walletCard.create({
            data: {
              walletId,
              cardId,
              profileId: member.id,
              cardholder,
              status: card.closed ? 'CLOSED' : 'APPROVED',
              approvedAt: openedAt,
              openDatePrecision: card.openDatePrecision,
              lastFour: card.lastDigits,
              creditLimitCents: card.creditLimitCents,
              annualFeeOverrideCents: feeOverride,
              notes: card.notes?.slice(0, 2000),
              source: 'SPREADSHEET',
              sourceRef: card.key.slice(0, 200),
              sourceMeta: { importJobId: job.id, row: card.rowNumber, sheet: card.sheet },
              sortOrder: walletCount + created,
            },
          });
          walletByKey.set(card.key, { id: wc.id, approvedAt: wc.approvedAt });
          created++;
        }

        let benefitsCreated = 0;
        let usageRows = 0;
        const categories = new Map((await db.benefitCategory.findMany()).map((c) => [c.slug, c.id]));
        for (const r of benefitRows) {
          const { benefit, targetKeys } = r.data as unknown as BenefitRowData;
          for (const key of targetKeys) {
            const wc = walletByKey.get(key);
            if (!wc) continue;
            const exists = await db.userBenefit.findUnique({ where: { walletCardId_name: { walletCardId: wc.id, name: benefit.name.slice(0, 120) } } });
            if (exists) continue;
            const ub = await db.userBenefit.create({
              data: {
                walletCardId: wc.id,
                name: benefit.name.slice(0, 120),
                kind: benefit.kind,
                period: benefit.period,
                periodMonths: benefit.periodMonths,
                basis: benefit.basis,
                amountPerPeriodCents: benefit.amountPerPeriodCents,
                categoryId: categories.get(benefit.categorySlug) ?? categories.get('other'),
                howIssued: benefit.howIssued?.slice(0, 200),
                actionNeeded: benefit.actionNeeded?.slice(0, 200),
                notes: benefit.notes?.slice(0, 1000),
              },
            });
            benefitsCreated++;
            const alloc = distributeUsage(benefit, wc.approvedAt, now, benefit.usedCents);
            if (alloc.length) {
              await db.benefitUsage.createMany({
                data: alloc.map((a) => ({ userBenefitId: ub.id, periodStart: a.periodStart, amountCents: a.amountCents, usedOn: now, note: 'Imported (year to date)' })),
              });
              usageRows += alloc.length;
            }
          }
        }

        const res = { cardsCreated: created, cardsUpdated: updated, benefitsCreated, usageRows, membersCreated: [...memberFor.values()].filter((m) => !members.some((x) => x.id === m.id)).length };
        await db.cardImportJob.update({
          where: { id },
          data: { summary: { ...(job.summary as object), result: res } },
        });
        return res;
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    this.logger.log(`import ${id} committed: ${JSON.stringify(result)}`);
    return result;
  }
}

@ApiTags('imports')
@ApiBearerAuth()
@Controller('imports')
export class ImportsController {
  constructor(private readonly svc: ImportsService) {}

  /** Public: a static example file with no user data. */
  @Public()
  @Get('template.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="pointwise-cards-template.csv"')
  template() {
    return CSV_TEMPLATE;
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 5 } }))
  upload(@CurrentUser() u: AuthUser, @UploadedFile() file?: { buffer: Buffer; originalname: string; size: number }) {
    return this.svc.preview(u.sub, file);
  }

  @Get() list(@CurrentUser() u: AuthUser) {
    return this.svc.list(u.sub);
  }
  @Get(':id') get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(u.sub, id);
  }
  @Post(':id/commit') commit(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.commit(u.sub, id);
  }
  @Delete(':id') @HttpCode(204) discard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.discard(u.sub, id);
  }
}

@Module({ imports: [HouseholdsModule], controllers: [ImportsController], providers: [ImportsService] })
export class ImportsModule {}

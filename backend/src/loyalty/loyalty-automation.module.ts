import { Body, Controller, Delete, Get, Headers, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ObservationOutcome } from '@prisma/client';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { TokensService } from '../ai/ai.controller';
import { BenefitAuditModule, BenefitAuditService } from '../benefit-audit/benefit-audit.module';
import { MailboxCoreModule } from '../mailbox/mailbox.module';
import { MailboxService } from '../mailbox/mailbox.service';
import { NotificationsModule, NotificationsService } from '../notifications/notifications.service';
import { parseLoyaltyEmail, parseLoyaltyText, programByCode, ParsedObservation } from '../domain/loyalty-email';
import { parseLoyaltyStatement } from '../domain/loyalty-statement';
import { extractPdfLines } from '../spend/pdf-extract';
import { MAX_PDF_BYTES } from '../spend/spend.service';
import { evidenceHashOf, LoyaltyIngestService } from './loyalty-ingest.service';
import { EXTENSION_SCOPE, LoyaltyAutomationService } from './loyalty-automation.service';
import { creditsFor, LoyaltyCoreModule } from './loyalty.module';

const day = (d: Date) => d.toISOString().slice(0, 10);
const week = (d: Date) => `${d.getUTCFullYear()}-W${String(Math.ceil(((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000 + 1) / 7)).padStart(2, '0')}`;

export class SnapshotDto {
  @ApiProperty({ description: 'registry program code, e.g. MAR_BONVOY' }) @IsString() @MinLength(2) @MaxLength(40) program: string;
  @ApiProperty({ description: 'the visible text of the page the member captured (never stored)' }) @IsString() @MinLength(10) @MaxLength(30_000) text: string;
  @ApiPropertyOptional({ description: 'hash of the page, to make repeated captures idempotent' }) @IsOptional() @IsString() @MaxLength(64) pageHash?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() capturedAt?: string;
  @ApiPropertyOptional({ description: 'last digits of the member number shown on the page' }) @IsOptional() @IsString() @MaxLength(8) memberDigits?: string;
}

export class EmailSampleDto {
  @ApiProperty({ description: 'sender domain, e.g. e.marriott.com' }) @IsString() @MaxLength(120) fromDomain: string;
  @ApiProperty() @IsString() @MaxLength(300) subject: string;
  @ApiProperty() @IsString() @MaxLength(30_000) text: string;
  @ApiPropertyOptional({ description: 'save the result as if the email had arrived' }) @IsOptional() @IsBoolean() apply?: boolean;
}

export class ResolveDto {
  @ApiProperty({ enum: ['ACCEPT', 'REJECT'] }) @IsIn(['ACCEPT', 'REJECT']) decision: 'ACCEPT' | 'REJECT';
}

export class TokenDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name: string;
  @ApiPropertyOptional({ default: 90 }) @IsOptional() @IsInt() @Min(1) @Max(365) expiresInDays?: number;
}

export class ObservationQuery {
  @ApiPropertyOptional({ enum: ['ACCEPTED', 'CONFIRMED', 'KEPT', 'CONFLICT', 'PENDING', 'REJECTED'] }) @IsOptional() @IsIn(['ACCEPTED', 'CONFIRMED', 'KEPT', 'CONFLICT', 'PENDING', 'REJECTED']) outcome?: ObservationOutcome;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accountId?: string;
}

interface Upload {
  buffer: Buffer;
  size: number;
  originalname: string;
}

const preview = (obs: ParsedObservation[]) => obs.map((o) => ({ entity: o.entity, field: o.field, value: o.value, rule: o.rule, ruleConfidence: o.ruleConfidence }));

@ApiTags('loyalty')
@Controller('loyalty')
export class LoyaltyIngestController {
  constructor(
    private readonly ingest: LoyaltyIngestService,
    private readonly auto: LoyaltyAutomationService,
    private readonly tokens: TokensService,
  ) {}

  /**
   * Called by the browser extension with a `loyalty:ingest` token. The page text is parsed with the same rules as
   * emails and then discarded; only a hash and the observations are kept (source EXTENSION).
   */
  @Public()
  @Post('ingest/snapshot')
  @HttpCode(200)
  async snapshot(@Headers('authorization') auth: string | undefined, @Body() dto: SnapshotDto) {
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const userId = await this.tokens.verify(token, EXTENSION_SCOPE);
    if (!userId) throw new UnauthorizedException('A valid PointWise extension token is required');
    const program = programByCode(dto.program.toUpperCase());
    if (!program) throw new BadRequestException(`Unknown program "${dto.program}"`);
    const when = dto.capturedAt ? new Date(dto.capturedAt) : new Date();
    const parsed = parseLoyaltyText(program, '', dto.text, when);
    if (!parsed.observations.length) return { accepted: false, reason: 'Nothing recognisable on this page. Open the page that shows your balance and status, then capture again.', rules: [] as string[] };
    const r = await this.ingest.apply({ userId, programCode: program.programCode, sourceType: 'EXTENSION', method: 'extension', evidenceHash: evidenceHashOf('ext', program.programCode, dto.pageHash ?? evidenceHashOf(dto.text)), memberDigits: dto.memberDigits ?? parsed.memberDigits, now: new Date() }, parsed.observations);
    return { accepted: true, ...r, programName: program.name, rules: parsed.rules, unverifiedParser: true };
  }

  @ApiBearerAuth()
  @Post('import/email-sample')
  @HttpCode(200)
  async emailSample(@CurrentUser() u: AuthUser, @Body() dto: EmailSampleDto) {
    const parsed = parseLoyaltyEmail(dto.fromDomain, dto.subject, dto.text, new Date());
    if (!parsed.program) return { program: null, kind: 'NONE', observations: [], note: 'This sender domain is not a known loyalty program.' };
    if (!dto.apply) return { program: parsed.program.name, kind: parsed.kind, rules: parsed.rules, memberDigits: parsed.memberDigits, observations: preview(parsed.observations), unverifiedParser: true };
    const r = await this.ingest.apply({ userId: u.sub, programCode: parsed.program.programCode, sourceType: 'EMAIL', method: 'email-sample', evidenceHash: evidenceHashOf('sample', u.sub, dto.fromDomain, dto.subject, dto.text), memberDigits: parsed.memberDigits, now: new Date() }, parsed.observations);
    return { program: parsed.program.name, kind: parsed.kind, rules: parsed.rules, observations: preview(parsed.observations), result: r };
  }

  /** Reads a loyalty program statement PDF. Nothing is stored unless `apply` is true; the file itself is never stored. */
  @ApiBearerAuth()
  @Post('import/statement')
  @HttpCode(200)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, apply: { type: 'string', enum: ['true', 'false'] } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PDF_BYTES, files: 1, fields: 3 } }))
  async statement(@CurrentUser() u: AuthUser, @UploadedFile() file?: Upload, @Body('apply') apply?: string) {
    if (!file?.buffer?.length) throw new BadRequestException('Attach a PDF statement');
    let lines: string[];
    try {
      lines = (await extractPdfLines(file.buffer)).flat();
    } catch {
      throw new BadRequestException('The PDF could not be read');
    }
    const when = new Date();
    const st = parseLoyaltyStatement(lines, when);
    const summary = { program: st.program?.name ?? null, period: st.periodStart && st.periodEnd ? `${day(st.periodStart)} to ${day(st.periodEnd)}` : null, opening: st.opening, closing: st.closing, totals: st.totals, activity: st.activity.length, validation: st.validation, extras: preview(st.extras) };
    if (apply !== 'true') return { applied: false, ...summary, lines: st.activity.map((a) => ({ date: day(a.occurredAt), description: a.description, kind: a.kind, points: a.points })) };
    if (!st.program || st.closing == null || st.validation.status === 'FAILED') throw new BadRequestException(st.validation.reasons[0] ?? 'This statement cannot be imported');
    const observations: ParsedObservation[] = [
      { entity: 'ACCOUNT', field: 'balance', value: st.closing, rule: 'statement.closing', ruleConfidence: st.validation.status === 'PASS' ? 95 : 70, observedAt: st.periodEnd ?? when },
      ...st.activity.map((x): ParsedObservation => ({ entity: 'ACCOUNT', field: 'activity', value: { kind: x.kind, points: x.points, occurredAt: x.occurredAt, balanceAfter: x.balanceAfter, note: x.description }, rule: 'statement.line', ruleConfidence: 90, observedAt: x.occurredAt })),
      ...st.extras,
    ];
    const r = await this.ingest.apply({ userId: u.sub, programCode: st.program.programCode, sourceType: 'STATEMENT', method: 'statement-pdf', evidenceHash: evidenceHashOf('pdf', evidenceHashOf(file.buffer.toString('base64').slice(0, 200_000))), now: when }, observations);
    return { applied: true, ...summary, result: r };
  }

  @ApiBearerAuth() @Get('observations') observations(@CurrentUser() u: AuthUser, @Query() q: ObservationQuery) {
    return this.ingest.observations(u.sub, q);
  }
  @ApiBearerAuth() @Post('observations/:id/resolve') @HttpCode(200) resolve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveDto) {
    return this.ingest.resolve(u.sub, id, dto.decision);
  }

  @ApiBearerAuth() @Get('tokens') listTokens(@CurrentUser() u: AuthUser) {
    return this.auto.listTokens(u.sub);
  }
  @ApiBearerAuth() @Post('tokens') createToken(@CurrentUser() u: AuthUser, @Body() dto: TokenDto) {
    return this.auto.createToken(u.sub, dto.name, dto.expiresInDays);
  }
  @ApiBearerAuth() @Delete('tokens/:id') @HttpCode(204) revokeToken(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.auto.revokeToken(u.sub, id);
  }
}

@ApiTags('loyalty')
@ApiBearerAuth()
@Controller('loyalty')
export class LoyaltyAutomationController {
  constructor(
    private readonly auto: LoyaltyAutomationService,
    private readonly benefits: BenefitAuditService,
    private readonly mailboxes: MailboxService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('refresh-status') status(@CurrentUser() u: AuthUser) {
    return this.auto.refreshStatus(u.sub);
  }

  /** Manual refresh: syncs the member's connected mailboxes now, then reports what is still stale and what to do. */
  @Post('refresh') @HttpCode(200) async refresh(@CurrentUser() u: AuthUser) {
    return this.syncAndReport(u.sub);
  }
  @Post('accounts/:id/refresh') @HttpCode(200) async refreshAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.syncAndReport(u.sub);
    return { ...r, account: r.status.accounts.find((a) => a.accountId === id) ?? null };
  }

  private async syncAndReport(userId: string) {
    const boxes = await this.prisma.mailbox.findMany({ where: { userId, active: true }, select: { id: true }, take: 3 });
    const synced: Array<{ processed: number; skipped: number; status: string }> = [];
    for (const b of boxes) {
      try {
        synced.push(await this.mailboxes.sync(b.id));
      } catch (e) {
        synced.push({ processed: 0, skipped: 0, status: (e as Error).message.slice(0, 120) });
      }
    }
    return { mailboxes: boxes.length, synced, status: await this.auto.refreshStatus(userId) };
  }

  @Get('health') async health(@CurrentUser() u: AuthUser) {
    return this.auto.health(u.sub, await creditsFor(this.benefits, u.sub));
  }
  @Get('audit') async audit(@CurrentUser() u: AuthUser) {
    return this.auto.audit(u.sub, await creditsFor(this.benefits, u.sub));
  }
  @Get('changes') changes(@CurrentUser() u: AuthUser, @Query('days') days?: string) {
    return this.auto.recentChanges(u.sub, Math.min(Math.max(Number(days) || 30, 1), 365));
  }
}

/** Scheduled refresh work. PointWise never logs in anywhere, so "refresh" syncs the member's mailbox and flags what stays stale. */
@Injectable()
export class LoyaltyRefreshJobs {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auto: LoyaltyAutomationService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Hourly: for members with urgent due accounts, sync their mailboxes, recompute schedules, and nudge about stale data. */
  async refreshDue(now: Date, syncMailbox: (mailboxId: string) => Promise<unknown>): Promise<number> {
    let n = 0;
    for (const userId of await this.auto.dueUsers(now)) {
      for (const b of await this.prisma.mailbox.findMany({ where: { userId, active: true }, select: { id: true }, take: 3 })) await syncMailbox(b.id).catch(() => undefined);
      const st = await this.auto.refreshStatus(userId, now);
      const prefs = await this.prisma.notificationPreference.findUnique({ where: { userId }, select: { loyaltyStale: true } });
      if (prefs?.loyaltyStale === false) continue;
      for (const a of st.accounts.filter((x) => (x.priority === 'CRITICAL' || x.priority === 'HIGH') && (x.freshness === 'STALE' || x.freshness === 'NEVER'))) {
        const todo = (a.plan as Array<{ text: string; automated: boolean }>).find((p) => !p.automated)?.text ?? 'Update the balance.';
        const key = `loy:stale:${a.accountId}:${week(now)}`;
        const before = await this.prisma.notification.count({ where: { userId, dedupeKey: key } });
        await this.notifications.notify(userId, 'LOYALTY_STALE', `${a.program} data needs a refresh`, `${a.program} (${a.member}) has not been updated recently: ${(a.reasons as string[]).join('; ')}. ${todo}`, '/loyalty', key, { profileId: (await this.prisma.loyaltyAccount.findUnique({ where: { id: a.accountId }, select: { profileId: true } }))?.profileId });
        if (!before) n++;
      }
    }
    return n;
  }
}

@Module({ imports: [LoyaltyCoreModule, NotificationsModule], providers: [LoyaltyAutomationService, LoyaltyRefreshJobs, TokensService], exports: [LoyaltyAutomationService, LoyaltyRefreshJobs] })
export class LoyaltyAutomationCoreModule {}

@Module({ imports: [LoyaltyCoreModule, LoyaltyAutomationCoreModule, BenefitAuditModule, MailboxCoreModule], controllers: [LoyaltyIngestController, LoyaltyAutomationController], providers: [TokensService] })
export class LoyaltyAutomationModule {}

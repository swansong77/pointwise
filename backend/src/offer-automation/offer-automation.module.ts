import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Post, Put, Query, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeController, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { TokensService } from '../ai/ai.controller';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { NotificationsModule } from '../notifications/notifications.service';
import { ConnectorRegistry } from './connector';
import { EnrollmentService } from './enrollment.service';
import { FlowConnector, ISSUER_FLOWS } from './issuer-flows';
import { MockConnector } from './mock-connector';
import { CreateOfferAccountDto, EnrollResultsDto, IngestSnapshotDto, InboxQuery, ItemIdsDto, MfaDto, PasteDto, PolicyDto, RuleDto, SyncDto, UpdateOfferAccountDto } from './offer-automation.dto';
import { EXTENSION_SCOPE, OfferAutomationService } from './offer-automation.service';
import { OfferAutomationJobs } from './offer-automation.jobs';
import { CONNECTORS, OfferSyncService } from './offer-sync.service';

/** The default connector set: the mock issuer, and the six issuer flows (which stay inert until the browser add-on is installed and the server switch is on). */
export function defaultRegistry(): ConnectorRegistry {
  const r = new ConnectorRegistry().register(new MockConnector());
  for (const f of ISSUER_FLOWS) r.register(new FlowConnector(f, null));
  return r;
}

@ApiTags('offer-automation')
@ApiBearerAuth()
@Controller('offer-automation')
export class OfferAutomationController {
  constructor(
    private readonly svc: OfferAutomationService,
    private readonly sync: OfferSyncService,
    private readonly enrollment: EnrollmentService,
  ) {}

  // accounts
  @Get('accounts') accounts(@CurrentUser() u: AuthUser) {
    return this.svc.accounts(u.sub);
  }
  @Post('accounts') createAccount(@CurrentUser() u: AuthUser, @Body() dto: CreateOfferAccountDto) {
    return this.svc.createAccount(u.sub, dto);
  }
  @Put('accounts/:id') updateAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfferAccountDto) {
    return this.svc.updateAccount(u.sub, id, dto);
  }
  @Post('accounts/:id/disconnect') disconnect(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.disconnect(u.sub, id);
  }
  @Delete('accounts/:id') @HttpCode(204) deleteAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteAccount(u.sub, id);
  }
  @Get('connectors') connectors() {
    return { switchOn: process.env.OFFER_CONNECTORS_ENABLED === 'true', flows: ISSUER_FLOWS.map((f) => ({ id: f.id, issuers: f.issuers, product: f.offersProduct, mfaMethods: f.mfaMethods, verified: false, termsNote: f.termsNote })) };
  }

  // sync
  @Post('sync') syncNow(@CurrentUser() u: AuthUser, @Body() dto: SyncDto) {
    return this.sync.start(u.sub, { accountId: dto.accountId, trigger: 'MANUAL', wait: dto.wait });
  }
  @Post('accounts/:id/mfa') mfa(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MfaDto) {
    return this.sync.submitMfa(u.sub, id, dto.code, false);
  }
  @Get('sync') dashboard(@CurrentUser() u: AuthUser, @Query('batchId') batchId?: string) {
    return this.svc.syncDashboard(u.sub, batchId);
  }

  // inbox and decisions
  @Get('inbox') inbox(@CurrentUser() u: AuthUser, @Query() q: InboxQuery) {
    return this.svc.inbox(u.sub, q);
  }
  @Get('counts') counts(@CurrentUser() u: AuthUser) {
    return this.svc.counts(u.sub);
  }
  @Post('approve') approve(@CurrentUser() u: AuthUser, @Body() dto: ItemIdsDto) {
    return this.enrollment.approve(u.sub, dto.itemIds);
  }
  @Post('ignore') ignore(@CurrentUser() u: AuthUser, @Body() dto: ItemIdsDto) {
    return this.enrollment.ignore(u.sub, dto.itemIds, dto.reason);
  }
  @Post('items/:id/mark-enrolled') markEnrolled(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.enrollment.markEnrolled(u.sub, id, 'MANUAL');
  }
  @Get('history') history(@CurrentUser() u: AuthUser, @Query('type') type?: string, @Query('limit') limit?: string) {
    return this.svc.history(u.sub, { type, limit: limit ? Number(limit) : undefined });
  }
  @Get('attempts') attempts(@CurrentUser() u: AuthUser, @Query('itemId') itemId?: string) {
    return this.svc.attempts(u.sub, itemId);
  }
  @Get('savings') savings(@CurrentUser() u: AuthUser) {
    return this.svc.savings(u.sub);
  }

  // rules and policy
  @Get('rules') rules(@CurrentUser() u: AuthUser) {
    return this.svc.rules(u.sub);
  }
  @Post('rules') createRule(@CurrentUser() u: AuthUser, @Body() dto: RuleDto) {
    return this.svc.createRule(u.sub, dto);
  }
  @Put('rules/:id') updateRule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RuleDto) {
    return this.svc.updateRule(u.sub, id, dto);
  }
  @Delete('rules/:id') @HttpCode(204) deleteRule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteRule(u.sub, id);
  }
  @Get('policy') policy(@CurrentUser() u: AuthUser) {
    return this.svc.policy(u.sub);
  }
  @Put('policy') setPolicy(@CurrentUser() u: AuthUser, @Body() dto: PolicyDto) {
    return this.svc.setPolicy(u.sub, dto);
  }

  // intake by the member
  @Post('accounts/:id/paste') paste(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PasteDto) {
    return this.svc.ingestSnapshot(u.sub, { accountId: id, text: dto.text, lastFour: dto.lastFour }, 'USER_ENTERED');
  }

  // extension tokens
  @Get('tokens') tokens(@CurrentUser() u: AuthUser) {
    return this.svc.extensionTokens(u.sub);
  }
  @Post('tokens') createToken(@CurrentUser() u: AuthUser) {
    return this.svc.createExtensionToken(u.sub);
  }
  @Delete('tokens/:id') @HttpCode(204) revokeToken(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeExtensionToken(u.sub, id);
  }
}

/** Public endpoints for the member's own browser extension. A bearer token with the offers:ingest scope is the only credential. */
@ApiExcludeController()
@Public()
@Controller('offer-automation/extension')
export class OfferExtensionController {
  constructor(
    private readonly svc: OfferAutomationService,
    private readonly tokens: TokensService,
  ) {}

  private async user(req: Request): Promise<string> {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : undefined;
    const id = await this.tokens.verify(token, EXTENSION_SCOPE);
    if (!id) throw new UnauthorizedException('A valid offers extension token is required');
    return id;
  }

  @Post('snapshot') async snapshot(@Req() req: Request, @Body() dto: IngestSnapshotDto) {
    return this.svc.ingestSnapshot(await this.user(req), dto, 'EXTENSION');
  }
  @Get('queue') async queue(@Req() req: Request, @Query('accountId', ParseUUIDPipe) accountId: string) {
    return { toAdd: await this.svc.queueFor(await this.user(req), accountId) };
  }
  @Post('enroll-results') async results(@Req() req: Request, @Body() dto: EnrollResultsDto) {
    return this.svc.enrollResults(await this.user(req), dto);
  }
}

@Module({
  imports: [NotificationsModule],
  providers: [OfferSyncService, EnrollmentService, OfferAutomationService, OfferAutomationJobs, TokensService, { provide: CONNECTORS, useFactory: defaultRegistry }],
  exports: [OfferSyncService, EnrollmentService, OfferAutomationService, OfferAutomationJobs],
})
export class OfferAutomationCoreModule {}

@Module({ imports: [OfferAutomationCoreModule], controllers: [OfferAutomationController, OfferExtensionController], providers: [TokensService] })
export class OfferAutomationModule {}

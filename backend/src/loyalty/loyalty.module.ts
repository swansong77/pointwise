import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { BenefitAuditModule, BenefitAuditService } from '../benefit-audit/benefit-audit.module';
import { AuthUser, CurrentUser, Roles } from '../common/decorators';
import { RolesGuard } from '../common/guards';
import { PrismaService } from '../common/prisma.service';
import { NotificationsModule, NotificationsService } from '../notifications/notifications.service';
import { alertText, alertThreshold } from '../domain/loyalty-expiration';
import { certState } from '../domain/loyalty-assets';
import { AccountEventDto, AwardTripDto, BonusRecordDto, CertificateDto, CertificateQuery, CreateAccountDto, MembershipDto, RedemptionCheckDto, StatusDto, UpdateAccountDto, UpdateCertificateDto, UpdateMembershipDto, UpdateStatusDto } from './loyalty.dto';
import { CreditInfo, LoyaltyService } from './loyalty.service';
import { LoyaltyIngestModule } from './loyalty-ingest.service';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Unused card credits from the benefit tracker, with their period end. */
export async function creditsFor(benefits: BenefitAuditService, userId: string, now = new Date()): Promise<CreditInfo[]> {
  const roll = await benefits.rollupView(userId, 'account', now).catch(() => null);
  return (roll?.records ?? []).filter((r) => r.remainingCents > 0).map((r) => ({ benefit: r.benefitName, card: r.card, member: r.cardholder, remainingCents: r.remainingCents, expiresAt: r.periodEnd }));
}

@ApiTags('loyalty')
@ApiBearerAuth()
@Controller('loyalty')
export class LoyaltyController {
  constructor(
    private readonly svc: LoyaltyService,
    private readonly benefits: BenefitAuditService,
  ) {}

  @Get('programs') programs() {
    return this.svc.registry();
  }

  // accounts
  @Get('accounts') accounts(@CurrentUser() u: AuthUser) {
    return this.svc.accounts(u.sub);
  }
  @Post('accounts') createAccount(@CurrentUser() u: AuthUser, @Body() dto: CreateAccountDto) {
    return this.svc.createAccount(u.sub, dto);
  }
  @Patch('accounts/:id') updateAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.svc.updateAccount(u.sub, id, dto);
  }
  @Delete('accounts/:id') @HttpCode(204) deleteAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteAccount(u.sub, id);
  }
  @Post('accounts/:id/events') addEvent(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AccountEventDto) {
    return this.svc.addEvent(u.sub, id, dto);
  }
  @Get('accounts/:id/history') history(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query('months') months?: string) {
    return this.svc.history(u.sub, id, months ? Number(months) || 12 : 12);
  }
  @Get('expirations') expirations(@CurrentUser() u: AuthUser) {
    return this.svc.expirations(u.sub);
  }

  // certificates
  @Get('certificates') certificates(@CurrentUser() u: AuthUser, @Query() q: CertificateQuery) {
    return this.svc.certificates(u.sub, q.category);
  }
  @Post('certificates') createCert(@CurrentUser() u: AuthUser, @Body() dto: CertificateDto) {
    return this.svc.createCertificate(u.sub, dto);
  }
  @Get('certificates/opportunities') certOps(@CurrentUser() u: AuthUser) {
    return this.svc.certificateIntelligence(u.sub);
  }
  @Patch('certificates/:id') updateCert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCertificateDto) {
    return this.svc.updateCertificate(u.sub, id, dto);
  }
  @Delete('certificates/:id') @HttpCode(204) deleteCert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteCertificate(u.sub, id);
  }
  @Post('certificates/:id/check') @HttpCode(200) check(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RedemptionCheckDto) {
    return this.svc.checkRedemption(u.sub, id, dto.stays.map((s) => ({ ...s, checkIn: new Date(s.checkIn) })));
  }
  /** Same hotels as the opportunities list, so "what could I redeem where" can be asked of any list of stays. */
  @Post('certificates/opportunities') @HttpCode(200) certOpsFor(@CurrentUser() u: AuthUser, @Body() dto: RedemptionCheckDto) {
    return this.svc.certificateIntelligence(u.sub, dto.stays.map((s) => ({ ...s, checkIn: new Date(s.checkIn) })));
  }

  // elite status
  @Get('status') statuses(@CurrentUser() u: AuthUser) {
    return this.svc.statuses(u.sub);
  }
  @Post('status') createStatus(@CurrentUser() u: AuthUser, @Body() dto: StatusDto) {
    return this.svc.createStatus(u.sub, dto);
  }
  @Patch('status/:id') updateStatus(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateStatusDto) {
    return this.svc.updateStatus(u.sub, id, dto);
  }
  @Delete('status/:id') @HttpCode(204) deleteStatus(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteStatus(u.sub, id);
  }

  // memberships
  @Get('memberships') async memberships(@CurrentUser() u: AuthUser) {
    return this.svc.memberships(u.sub, await creditsFor(this.benefits, u.sub));
  }
  @Post('memberships') createMembership(@CurrentUser() u: AuthUser, @Body() dto: MembershipDto) {
    return this.svc.createMembership(u.sub, dto);
  }
  @Patch('memberships/:id') updateMembership(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMembershipDto) {
    return this.svc.updateMembership(u.sub, id, dto);
  }
  @Delete('memberships/:id') @HttpCode(204) deleteMembership(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteMembership(u.sub, id);
  }
  @Get('memberships/:id/number') reveal(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revealMemberNumber(u.sub, id);
  }

  // valuation, forecast, household, dashboard
  @Get('valuation') async valuation(@CurrentUser() u: AuthUser) {
    return this.svc.valuation(u.sub, await creditsFor(this.benefits, u.sub));
  }
  @Get('forecast') async forecast(@CurrentUser() u: AuthUser) {
    return this.svc.forecast(u.sub, await creditsFor(this.benefits, u.sub));
  }
  @Get('household') async household(@CurrentUser() u: AuthUser) {
    return this.svc.household(u.sub, await creditsFor(this.benefits, u.sub));
  }
  @Get('dashboard') async dashboard(@CurrentUser() u: AuthUser) {
    return this.svc.dashboard(u.sub, await creditsFor(this.benefits, u.sub));
  }

  // transfers
  @Get('transfers') transfers() {
    return this.svc.transferRoutes();
  }

  // award trips
  @Post('award-trips') @HttpCode(200) evaluate(@CurrentUser() u: AuthUser, @Body() dto: AwardTripDto) {
    return this.svc.evaluateTrip(u.sub, dto);
  }
  @Get('award-trips') trips(@CurrentUser() u: AuthUser) {
    return this.svc.trips(u.sub);
  }
  @Delete('award-trips/:id') @HttpCode(204) deleteTrip(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteTrip(u.sub, id);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@UseGuards(RolesGuard)
@Controller('admin/loyalty')
export class LoyaltyAdminController {
  constructor(private readonly svc: LoyaltyService) {}

  /** Record a transfer bonus seen in the wild, so history and averages improve. */
  @Put('bonus-records') record(@Body() dto: BonusRecordDto) {
    return this.svc.addBonusRecord(dto);
  }
}

/** Scheduled loyalty work. Idempotent: notifications are keyed by asset, expiry date and threshold. */
@Injectable()
export class LoyaltyJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly svc: LoyaltyService,
  ) {}

  /** Alerts at 365 / 180 / 90 / 60 / 30 / 14 / 7 / 1 days for points, certificates, memberships and status. Returns alerts created. */
  async scanExpirations(now: Date): Promise<number> {
    await this.svc.recordActiveBonuses(now);
    await this.prisma.loyaltyCertificate.updateMany({ where: { status: 'AVAILABLE', expiresAt: { lt: now } }, data: { status: 'EXPIRED' } });
    const users = await this.prisma.user.findMany({
      where: { OR: [{ loyaltyAccounts: { some: {} } }, { loyaltyCertificates: { some: {} } }, { memberships: { some: {} } }, { eliteStatuses: { some: {} } }] },
      select: { id: true, notificationPrefs: { select: { loyaltyExpiring: true } } },
      take: 2000,
    });
    let n = 0;
    for (const u of users) {
      if (u.notificationPrefs?.loyaltyExpiring === false) continue;
      const send = async (key: string, title: string, body: string) => {
        const before = await this.prisma.notification.count({ where: { userId: u.id, dedupeKey: key } });
        await this.notifications.notify(u.id, 'LOYALTY_EXPIRING', title, body, '/loyalty', key);
        if (!before) n++;
      };
      for (const a of await this.svc.accounts(u.id, now)) {
        const p = a.prediction;
        const t = alertThreshold(p.daysLeft);
        if (!t || !p.expiresAt || p.atRiskPoints <= 0) continue;
        await send(`loy:acct:${a.id}:${day(p.expiresAt)}:${t}`, `${a.programName}: ${a.unit} at risk`, `${alertText(a.programName, a.unit, p)} Confidence ${p.confidence}% (${p.source}).`);
      }
      for (const c of await this.svc.certificates(u.id, undefined, now)) {
        const v = c.view;
        const t = alertThreshold(v.daysLeft);
        if (v.effectiveStatus !== 'AVAILABLE' || !t || !c.expiresAt) continue;
        await send(`loy:cert:${c.id}:${t}`, `${c.name} expires in ${v.daysLeft} day(s)`, `${c.name} (${c.member}) expires ${day(c.expiresAt)}.${c.potentialValueCents ? ` Potential value $${Math.round((c.potentialValueCents * c.quantity) / 100)}.` : ''}`);
      }
      for (const m of await this.svc.memberships(u.id, [], now)) {
        const when = m.expiresAt ?? m.renewalAt;
        const t = alertThreshold(m.view.daysLeft);
        if (!when || !t) continue;
        await send(`loy:mem:${m.id}:${day(when)}:${t}`, `${m.name} expires in ${m.view.daysLeft} day(s)`, m.view.headline);
      }
      for (const s of await this.svc.statuses(u.id, now)) {
        const t = alertThreshold(s.view.daysLeft);
        if (!s.current || s.maintained || !t || !s.expiresAt || s.view.risk === 'LOW' || s.view.risk === 'NONE') continue;
        await send(`loy:status:${s.id}:${t}`, `${s.program} ${s.level} status at risk`, `${s.view.headline}. ${s.view.actions[0] ?? ''}`.trim());
      }
    }
    return n;
  }

  /** Once a month, write a snapshot of every balance so history charts have a point even in quiet months. */
  async snapshotBalances(now: Date): Promise<number> {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const rows = await this.prisma.loyaltyAccount.findMany({ where: { balance: { gt: 0 }, events: { none: { kind: 'SNAPSHOT', occurredAt: { gte: monthStart } } } }, select: { id: true, userId: true, balance: true }, take: 10_000 });
    if (!rows.length) return 0;
    await this.prisma.loyaltyEvent.createMany({ data: rows.map((r) => ({ userId: r.userId, accountId: r.id, kind: 'SNAPSHOT' as const, points: 0, balanceAfter: r.balance, occurredAt: now, note: 'Monthly snapshot' })) });
    return rows.length;
  }
}

export { certState };

/** Providers only (no controllers): shared by the API, the worker and the AI tools. */
@Module({ imports: [NotificationsModule, LoyaltyIngestModule], providers: [LoyaltyService, LoyaltyJobsService], exports: [LoyaltyService, LoyaltyJobsService, LoyaltyIngestModule] })
export class LoyaltyCoreModule {}

@Module({ imports: [LoyaltyCoreModule, BenefitAuditModule], controllers: [LoyaltyController, LoyaltyAdminController] })
export class LoyaltyModule {}

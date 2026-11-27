import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, OmitType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { AuthUser, CurrentUser, MemberSafe } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { MemberContext } from '../domain/member-access';
import { MEMBER_BRIEF_KINDS, MemberBriefKind } from '../domain/member-brief';
import { NotificationsModule } from '../notifications/notifications.service';
import { MemberBriefingService } from './member-briefing.service';
import { MemberEditService } from './member-edit.service';
import { CreateAccountDto, UpdateAccountDto } from '../loyalty/loyalty.dto';
import { LoyaltyCoreModule } from '../loyalty/loyalty.module';
import { UsageDto } from '../portfolio/benefits';
import { AddWalletCardDto, UpdateWalletCardDto } from '../wallet/wallet.dto';
import { WalletModule } from '../wallet/wallet.module';
import { benefitView, BenefitsModule, BenefitsService } from '../portfolio/benefits';
import { PortfolioModule, PortfolioService } from '../portfolio/portfolio';

/**
 * What a household member sees with their own sign-in ("My view"). Every query is pinned to the member's own profile inside the
 * owner's account (ctx.ownerId + ctx.profileId, resolved by the guard from the database). Read only. A member never reaches the
 * general routes: the guard denies everything not marked @MemberSafe.
 */
@Injectable()
export class MemberViewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly portfolio: PortfolioService,
    private readonly benefits: BenefitsService,
  ) {}

  async me(ctx: MemberContext, email: string) {
    const [p, hh] = await Promise.all([
      this.prisma.profile.findUniqueOrThrow({ where: { id: ctx.profileId }, select: { nickname: true, relationship: true, loginSince: true } }),
      this.prisma.household.findUnique({ where: { ownerId: ctx.ownerId }, select: { name: true } }),
    ]);
    return { email, nickname: p.nickname, relationship: p.relationship, since: p.loginSince, household: hh?.name ?? 'Household', visibility: ctx.visibility, canEdit: ctx.canEdit };
  }

  async overview(ctx: MemberContext, now = new Date()) {
    const { ownerId, profileId } = ctx;
    const [portfolio, benefitRows, loyalty, transactions] = await Promise.all([
      this.portfolio.portfolio(ownerId, { profileId }, now),
      this.benefits.rows(ownerId, { walletCard: { profileId } as never }),
      this.prisma.loyaltyAccount.findMany({
        where: { userId: ownerId, profileId },
        select: {
          id: true, nickname: true, customName: true, accountLast4: true, balance: true, pendingBalance: true, statusLevel: true,
          statusDeadline: true, expiresAt: true, lastActivityAt: true, program: { select: { code: true, name: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.transaction.findMany({
        where: { userId: ownerId, walletCard: { profileId } },
        orderBy: { occurredAt: 'desc' },
        take: 25,
        select: { id: true, amountCents: true, description: true, occurredAt: true, kind: true, walletCard: { select: { nickname: true, lastFour: true, card: { select: { name: true } } } } },
      }),
    ]);
    const benefits = benefitRows
      .filter((b) => b.enabled)
      .map((b) => benefitView(b, now))
      .map(({ usages: _u, autoRules: _a, notes: _n, howIssued: _h, ...v }) => v)
      .sort((a, b) => a.currentPeriod.end.getTime() - b.currentPeriod.end.getTime());
    return {
      asOf: now,
      cards: { groups: portfolio.groups, totals: portfolio.totals, counts: portfolio.counts },
      benefits,
      loyalty: loyalty.map((l) => ({ ...l, name: l.customName ?? l.program?.name ?? 'Loyalty account' })),
      transactions: transactions.map((t) => ({ id: t.id, amountCents: t.amountCents, description: t.description, occurredAt: t.occurredAt, kind: t.kind, card: t.walletCard.nickname || t.walletCard.card.name, lastFour: t.walletCard.lastFour })),
    };
  }

  /** Only for a member the owner made HOUSEHOLD-visible. Other members' sign-in details are never part of it. */
  async household(ctx: MemberContext, now = new Date()) {
    if (ctx.visibility !== 'HOUSEHOLD') throw new ForbiddenException('The household overview is not shared with this sign-in');
    const d = await this.portfolio.householdDashboard(ctx.ownerId, now);
    return {
      ...d,
      members: d.members.map((m) => ({ ...m, profile: { id: m.profile.id, nickname: m.profile.nickname, relationship: m.profile.relationship, cardCount: m.profile.cardCount } })),
    };
  }
}

/** Writing needs the owner's permission, switched on per member in Household. */
const needEditor = (u: AuthUser): MemberContext => {
  const m = needMember(u);
  if (!m.canEdit) throw new ForbiddenException('The household owner has not allowed you to change your own cards and points');
  return m;
};

const needMember = (u: AuthUser): MemberContext => {
  if (!u.member) throw new ForbiddenException('This is for household members who have their own sign-in');
  return u.member;
};

export class BriefingQuery {
  @ApiPropertyOptional({ enum: MEMBER_BRIEF_KINDS }) @IsOptional() @IsIn(MEMBER_BRIEF_KINDS as unknown as string[]) kind?: MemberBriefKind;
}
export class MakeBriefingDto {
  @ApiProperty({ enum: MEMBER_BRIEF_KINDS }) @IsIn(MEMBER_BRIEF_KINDS as unknown as string[]) kind: MemberBriefKind;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() force?: boolean;
}

/** What a member may send: the profile is never theirs to choose, so the field does not exist here (an extra field is refused). */
export class MemberAddCardDto extends OmitType(AddWalletCardDto, ['profileId'] as const) {}
export class MemberUpdateCardDto extends OmitType(UpdateWalletCardDto, ['profileId'] as const) {}
export class MemberAddAccountDto extends OmitType(CreateAccountDto, ['profileId'] as const) {}

@ApiTags('member')
@ApiBearerAuth()
@MemberSafe()
@Controller('member')
export class MemberController {
  constructor(
    private readonly view: MemberViewService,
    private readonly briefings: MemberBriefingService,
    private readonly edit: MemberEditService,
  ) {}

  @Get('me') me(@CurrentUser() u: AuthUser) {
    return this.view.me(needMember(u), u.email);
  }
  @Get('overview') overview(@CurrentUser() u: AuthUser) {
    return this.view.overview(needMember(u));
  }
  @Get('household') household(@CurrentUser() u: AuthUser) {
    return this.view.household(needMember(u));
  }
  // ───────── editing their own data (the owner must have allowed it) ─────────
  @Get('loyalty/programs') programs(@CurrentUser() u: AuthUser) {
    needMember(u);
    return this.edit.programs();
  }
  @Post('cards') addCard(@CurrentUser() u: AuthUser, @Body() dto: MemberAddCardDto) {
    return this.edit.addCard(needEditor(u), u.sub, dto);
  }
  @Patch('cards/:id') updateCard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MemberUpdateCardDto) {
    return this.edit.updateCard(needEditor(u), u.sub, id, dto);
  }
  @Delete('cards/:id') @HttpCode(204) removeCard(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.edit.removeCard(needEditor(u), u.sub, id);
  }
  @Post('loyalty/accounts') addAccount(@CurrentUser() u: AuthUser, @Body() dto: MemberAddAccountDto) {
    return this.edit.addAccount(needEditor(u), u.sub, dto);
  }
  @Patch('loyalty/accounts/:id') updateAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAccountDto) {
    return this.edit.updateAccount(needEditor(u), u.sub, id, dto);
  }
  @Delete('loyalty/accounts/:id') @HttpCode(204) removeAccount(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.edit.removeAccount(needEditor(u), u.sub, id);
  }
  @Post('benefits/:id/usage') logUsage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UsageDto) {
    return this.edit.logUsage(needEditor(u), u.sub, id, dto);
  }
  @Delete('benefits/:id/usage/:usageId') @HttpCode(204) removeUsage(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('usageId', ParseUUIDPipe) usageId: string) {
    return this.edit.removeUsage(needEditor(u), u.sub, id, usageId);
  }

  /** The member's own saved briefings, newest first. */
  @Get('briefings') briefingList(@CurrentUser() u: AuthUser, @Query() q: BriefingQuery) {
    needMember(u);
    return this.briefings.list(u.sub, q.kind);
  }
  /** Make this period's briefing now. A daily one is only made when something is due, so the answer can be empty. */
  @Post('briefings') @HttpCode(200) async briefingNow(@CurrentUser() u: AuthUser, @Body() dto: MakeBriefingDto) {
    needMember(u);
    const r = await this.briefings.generate(u.sub, dto.kind, new Date(), { force: !!dto.force });
    return { briefing: r.briefing, message: r.briefing ? null : dto.kind === 'DAILY' ? 'Nothing is due today, so there is no briefing.' : 'There is nothing to report this week.' };
  }
}

@Module({
  imports: [PortfolioModule, BenefitsModule, NotificationsModule, WalletModule, LoyaltyCoreModule],
  controllers: [MemberController],
  providers: [MemberViewService, MemberBriefingService, MemberEditService],
  exports: [MemberBriefingService],
})
export class MemberModule {}

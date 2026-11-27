import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ConflictException,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CardholderRelationship, Profile, CreditBand, MemberVisibility } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { limitsFor } from '../domain/entitlements';
import { canHaveLogin, inviteExpiry, loginStatus, newInviteToken, VISIBILITIES } from '../domain/member-access';
import { MailService } from '../jobs/mail.service';

export const MAX_MEMBERS = 10;

export class MemberDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(40) nickname: string;
  @ApiPropertyOptional({ enum: CardholderRelationship, default: 'OTHER' }) @IsOptional() @IsEnum(CardholderRelationship)
  relationship?: CardholderRelationship;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1900) @Max(2100) birthYear?: number;
  @ApiPropertyOptional({ enum: CreditBand, nullable: true, description: 'Self-reported credit score band (optional; used only by the next-card scorer, never sent to an AI provider)' })
  @IsOptional() @IsEnum(CreditBand) creditBand?: CreditBand | null;
  @ApiPropertyOptional({ type: [String], enum: ['TRAVEL', 'CASHBACK', 'HOTEL', 'AIRLINE', 'LOW_FEE'], description: 'Reward goals used by the recommendation engine (never sent to an AI provider)' })
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(['TRAVEL', 'CASHBACK', 'HOTEL', 'AIRLINE', 'LOW_FEE'], { each: true }) goals?: string[];
  @ApiPropertyOptional({ description: 'Can apply for business cards' }) @IsOptional() @IsBoolean() hasBusiness?: boolean;
  @ApiPropertyOptional({ enum: VISIBILITIES, description: "What this member's own sign-in may see: OWN (their own cards, benefits, loyalty, spending) or HOUSEHOLD (also the household overview, read only)" })
  @IsOptional() @IsIn(VISIBILITIES) visibility?: MemberVisibility;
  @ApiPropertyOptional({ description: 'Let this member add and edit their own cards, points and benefit usage (they need their own sign-in)' })
  @IsOptional() @IsBoolean() canEdit?: boolean;
  @ApiPropertyOptional({ description: 'false = stop sending the owner notifications about this member (they get them instead; needs their own sign-in)' })
  @IsOptional() @IsBoolean() notifyOwner?: boolean;
}
export class UpdateMemberDto extends PartialType(MemberDto) {}

export class HouseholdDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name: string;
}

/**
 * Household = the account owner's group of cardholders. Members are Profile rows; the owner's own
 * member (relationship SELF, isPrimary) is created on first use. Wallet cards without a profile
 * belong to the SELF member. See docs/household-management.md.
 */
@Injectable()
export class HouseholdsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  /** A member row as the owner sees it: the sign-in is described, never exposed (no user id, no hash). */
  shapeMembers<T extends Profile>(rows: T[]) {
    return this.shape(rows);
  }

  private async shape<T extends Profile>(rows: T[]) {
    const now = new Date();
    const loginIds = rows.map((r) => r.loginUserId).filter((x): x is string => !!x);
    const [users, invites, boxes, inboxes] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.loginUserId).filter((x): x is string => !!x) } }, select: { id: true, email: true } }),
      this.prisma.memberInvite.findMany({ where: { profileId: { in: rows.map((r) => r.id) }, usedAt: null, revokedAt: null, expiresAt: { gt: now } } }),
      // a member's mailboxes (their own, or ones the owner assigned to them): counts and health only, never the addresses
      this.prisma.mailbox.findMany({ where: { OR: [{ profileId: { in: rows.map((r) => r.id) } }, { userId: { in: loginIds } }] }, select: { userId: true, profileId: true, lastSyncAt: true, lastStatus: true } }),
      this.prisma.emailInbox.findMany({ where: { userId: { in: loginIds } }, select: { userId: true, enabled: true } }),
    ]);
    return rows.map((r) => {
      const { loginUserId, loginSince, ...rest } = r;
      const open = invites.filter((i) => i.profileId === r.id);
      const mine = boxes.filter((b) => b.profileId === r.id || (loginUserId !== null && b.userId === loginUserId));
      const lastSync = mine.map((b) => b.lastSyncAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      return {
        ...rest,
        channels: {
          mailboxes: mine.length,
          needsAttention: mine.filter((b) => b.lastStatus === 'ERROR' || b.lastStatus === 'RECONNECT').length,
          lastSyncAt: lastSync,
          alertAddress: loginUserId ? (inboxes.find((i) => i.userId === loginUserId)?.enabled ?? false) : null,
        },
        login: {
          status: loginStatus({ loginUserId }, open, now),
          canHaveLogin: canHaveLogin(r),
          email: users.find((u) => u.id === loginUserId)?.email ?? null,
          since: loginSince,
          inviteExpiresAt: open.map((i) => i.expiresAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
        },
      };
    });
  }

  async ensure(userId: string) {
    const [existing, primary] = await Promise.all([
      this.prisma.household.findUnique({ where: { ownerId: userId } }),
      this.prisma.profile.findFirst({ where: { userId, isPrimary: true }, select: { householdId: true, relationship: true } }),
    ]);
    if (existing && primary?.householdId === existing.id && primary.relationship === 'SELF') return existing;
    // First use: serialise per user (pages fire several queries at once) so only one SELF member is created.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${userId}))`;
      const hh = await tx.household.upsert({ where: { ownerId: userId }, update: {}, create: { ownerId: userId } });
      await tx.profile.updateMany({ where: { userId, householdId: null }, data: { householdId: hh.id } });
      const self = await tx.profile.findFirst({ where: { userId, isPrimary: true } });
      if (self && self.relationship !== 'SELF') await tx.profile.update({ where: { id: self.id }, data: { relationship: 'SELF' } });
      if (!self) {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
        await tx.profile.create({
          data: { userId, householdId: hh.id, nickname: user?.name?.split(' ')[0] || 'Me', relationship: 'SELF', isPrimary: true, sortOrder: -1 },
        });
      }
      return hh;
    });
  }

  async members(userId: string): Promise<Profile[]> {
    await this.ensure(userId);
    return this.prisma.profile.findMany({ where: { userId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
  }

  async primary(userId: string): Promise<Profile> {
    const ms = await this.members(userId);
    return ms.find((m) => m.isPrimary) as Profile;
  }

  async get(userId: string) {
    const hh = await this.ensure(userId);
    const members = await this.prisma.profile.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: { _count: { select: { cards: true } } },
    });
    const unassigned = await this.prisma.walletCard.count({ where: { wallet: { userId }, profileId: null } });
    const shaped = await this.shape(members);
    return {
      ...hh,
      members: shaped.map((m) => {
        const { _count } = members.find((x) => x.id === m.id)!;
        return { ...m, cardCount: _count.cards + (m.isPrimary ? unassigned : 0) };
      }),
    };
  }

  async rename(userId: string, dto: HouseholdDto) {
    await this.ensure(userId);
    return this.prisma.household.update({ where: { ownerId: userId }, data: { name: dto.name } });
  }

  async addMember(userId: string, dto: MemberDto) {
    const hh = await this.ensure(userId);
    if (dto.relationship === 'SELF') throw new BadRequestException('There is already a SELF member');
    const [count, sub] = await Promise.all([
      this.prisma.profile.count({ where: { userId } }),
      this.prisma.subscription.findUnique({ where: { userId } }),
    ]);
    if (!limitsFor(sub).profiles) throw new ForbiddenException('Household members require Pro');
    if (count >= MAX_MEMBERS) throw new ForbiddenException(`Maximum of ${MAX_MEMBERS} household members`);
    return this.prisma.profile.create({
      data: {
        userId,
        householdId: hh.id,
        nickname: dto.nickname,
        relationship: dto.relationship ?? 'OTHER',
        email: dto.email,
        birthYear: dto.birthYear,
        creditBand: dto.creditBand ?? null,
        goals: [...new Set(dto.goals ?? [])],
        hasBusiness: dto.hasBusiness ?? false,
        sortOrder: count,
      },
    });
  }

  async owned(userId: string, id: string): Promise<Profile> {
    const p = await this.prisma.profile.findUnique({ where: { id } });
    if (!p || p.userId !== userId) throw new NotFoundException('Household member not found');
    return p;
  }

  async updateMember(userId: string, id: string, dto: UpdateMemberDto) {
    const p = await this.owned(userId, id);
    // both only make sense once the member has their own sign-in: someone has to receive what the owner stops receiving
    if ((dto.canEdit === true || dto.notifyOwner === false) && !p.loginUserId) throw new BadRequestException('Give them their own sign-in first');
    if (dto.relationship && (dto.relationship === 'SELF') !== p.isPrimary) {
      throw new BadRequestException('Only the primary member can be SELF');
    }
    if (dto.relationship === 'CHILD') {
      const primaryCards = await this.prisma.walletCard.count({ where: { profileId: id, cardholder: 'PRIMARY' } });
      if (primaryCards > 0) throw new BadRequestException('A child can only hold authorized-user cards; change those cards first');
    }
    return this.prisma.profile.update({
      where: { id },
      data: { nickname: dto.nickname, relationship: dto.relationship, email: dto.email, birthYear: dto.birthYear, visibility: dto.visibility, canEdit: dto.canEdit, notifyOwner: dto.notifyOwner, ...(dto.creditBand !== undefined && { creditBand: dto.creditBand }), ...(dto.goals !== undefined && { goals: [...new Set(dto.goals)] }), ...(dto.hasBusiness !== undefined && { hasBusiness: dto.hasBusiness }) },
    });
  }

  async removeMember(userId: string, id: string): Promise<void> {
    const p = await this.owned(userId, id);
    if (p.isPrimary) throw new ForbiddenException('Cannot delete the primary member');
    // cards fall back to the primary member (profileId → null); the member's own sign-in goes with them
    await this.prisma.$transaction([
      ...(p.loginUserId ? [this.prisma.user.delete({ where: { id: p.loginUserId } })] : []),
      this.prisma.profile.delete({ where: { id } }),
    ]);
  }

  /**
   * A one-time link the owner shares (and, when the member has an address on file and mail is configured, e-mails).
   * The token is returned once; only its hash is stored. A new invite replaces any open one.
   */
  async invite(userId: string, id: string) {
    const p = await this.owned(userId, id);
    if (!canHaveLogin(p)) throw new BadRequestException('The account owner already has a sign-in');
    if (p.loginUserId) throw new ConflictException('This member already has a sign-in. Remove it first to invite again.');
    const { token, hash } = newInviteToken();
    const now = new Date();
    const expiresAt = inviteExpiry(now);
    await this.prisma.$transaction([
      this.prisma.memberInvite.updateMany({ where: { profileId: id, usedAt: null, revokedAt: null }, data: { revokedAt: now } }),
      this.prisma.memberInvite.create({ data: { profileId: id, tokenHash: hash, expiresAt } }),
      this.prisma.auditLog.create({ data: { actorId: userId, action: 'member.invite.created', entity: 'Profile', entityId: id } }),
    ]);
    const base = String(this.config.get('APP_URL') ?? 'http://localhost:3000').replace(/\/+$/, '');
    const url = `${base}/join/${token}`;
    let emailed = false;
    if (p.email) {
      const owner = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      emailed = await this.mail.send(
        p.email,
        'You are invited to PointWise',
        `${owner?.name ?? 'Someone'} invited you to your household's PointWise.\n\nChoose your own sign-in here (valid for 7 days, works once):\n${url}\n`,
      );
    }
    return { url, expiresAt, emailed };
  }

  async revokeInvite(userId: string, id: string): Promise<void> {
    await this.owned(userId, id);
    await this.prisma.memberInvite.updateMany({ where: { profileId: id, usedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  /** Removes the member's own sign-in (and with it their mailboxes, alert address and notifications). Their cards and data stay. */
  async removeLogin(userId: string, id: string): Promise<void> {
    const p = await this.owned(userId, id);
    if (!p.loginUserId) throw new NotFoundException('This member has no sign-in');
    await this.prisma.$transaction([
      this.prisma.user.delete({ where: { id: p.loginUserId } }),
      // nobody receives or edits as the member any more: the owner hears about their items again and the rights go
      this.prisma.profile.update({ where: { id }, data: { canEdit: false, notifyOwner: true } }),
      this.prisma.auditLog.create({ data: { actorId: userId, action: 'member.login.removed', entity: 'Profile', entityId: id } }),
    ]);
  }

  /** Enforced by the wallet: minors can only be authorized users. */
  static assertCardholderAllowed(member: Pick<Profile, 'relationship'> | null, cardholder: 'PRIMARY' | 'AUTHORIZED_USER') {
    if (member?.relationship === 'CHILD' && cardholder !== 'AUTHORIZED_USER') {
      throw new BadRequestException('Cards held by a child must be authorized-user cards');
    }
  }
}

@ApiTags('household')
@ApiBearerAuth()
@Controller('household')
export class HouseholdsController {
  constructor(private readonly hh: HouseholdsService) {}

  @Get() get(@CurrentUser() u: AuthUser) {
    return this.hh.get(u.sub);
  }
  @Patch() rename(@CurrentUser() u: AuthUser, @Body() dto: HouseholdDto) {
    return this.hh.rename(u.sub, dto);
  }
  @Get('members') async members(@CurrentUser() u: AuthUser) {
    return this.hh.shapeMembers(await this.hh.members(u.sub));
  }
  @Post('members') async add(@CurrentUser() u: AuthUser, @Body() dto: MemberDto) {
    return (await this.hh.shapeMembers([await this.hh.addMember(u.sub, dto)]))[0];
  }
  @Patch('members/:id') async update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return (await this.hh.shapeMembers([await this.hh.updateMember(u.sub, id, dto)]))[0];
  }
  @Post('members/:id/invite') @HttpCode(200) invite(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.hh.invite(u.sub, id);
  }
  @Delete('members/:id/invite') @HttpCode(204) revokeInvite(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.hh.revokeInvite(u.sub, id);
  }
  @Delete('members/:id/login') @HttpCode(204) removeLogin(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.hh.removeLogin(u.sub, id);
  }
  @Delete('members/:id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.hh.removeMember(u.sub, id);
  }
}

@Module({ controllers: [HouseholdsController], providers: [HouseholdsService], exports: [HouseholdsService] })
export class HouseholdsModule {}

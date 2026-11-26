import {
  BadRequestException,
  Body,
  Controller,
  Delete,
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
import { CardholderRelationship, Profile, CreditBand } from '@prisma/client';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { limitsFor } from '../domain/entitlements';

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
  constructor(private readonly prisma: PrismaService) {}

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
    return {
      ...hh,
      members: members.map(({ _count, ...m }) => ({ ...m, cardCount: _count.cards + (m.isPrimary ? unassigned : 0) })),
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
    if (dto.relationship && (dto.relationship === 'SELF') !== p.isPrimary) {
      throw new BadRequestException('Only the primary member can be SELF');
    }
    if (dto.relationship === 'CHILD') {
      const primaryCards = await this.prisma.walletCard.count({ where: { profileId: id, cardholder: 'PRIMARY' } });
      if (primaryCards > 0) throw new BadRequestException('A child can only hold authorized-user cards; change those cards first');
    }
    return this.prisma.profile.update({
      where: { id },
      data: { nickname: dto.nickname, relationship: dto.relationship, email: dto.email, birthYear: dto.birthYear, ...(dto.creditBand !== undefined && { creditBand: dto.creditBand }), ...(dto.goals !== undefined && { goals: [...new Set(dto.goals)] }), ...(dto.hasBusiness !== undefined && { hasBusiness: dto.hasBusiness }) },
    });
  }

  async removeMember(userId: string, id: string): Promise<void> {
    const p = await this.owned(userId, id);
    if (p.isPrimary) throw new ForbiddenException('Cannot delete the primary member');
    // cards fall back to the primary member (profileId → null)
    await this.prisma.profile.delete({ where: { id } });
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
  @Get('members') members(@CurrentUser() u: AuthUser) {
    return this.hh.members(u.sub);
  }
  @Post('members') add(@CurrentUser() u: AuthUser, @Body() dto: MemberDto) {
    return this.hh.addMember(u.sub, dto);
  }
  @Patch('members/:id') update(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.hh.updateMember(u.sub, id, dto);
  }
  @Delete('members/:id') @HttpCode(204) remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.hh.removeMember(u.sub, id);
  }
}

@Module({ controllers: [HouseholdsController], providers: [HouseholdsService], exports: [HouseholdsService] })
export class HouseholdsModule {}

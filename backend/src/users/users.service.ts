import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, IsUUID, Length, MaxLength, Min, MinLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { limitsFor } from '../domain/entitlements';

export class UpdateMeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 2) countryCode?: string;
}

export class ProfileDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(40) nickname: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
}

export class OfferAlertDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) keywords: string[];
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) minValueCents?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsUUID('all', { each: true }) issuerIds?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateOfferAlertDto extends PartialType(OfferAlertDto) {}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async me(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, countryCode: true, createdAt: true, emailVerified: true, passwordHash: true, accounts: { select: { provider: true } } },
    });
    if (!u) throw new NotFoundException('User not found');
    const { passwordHash, ...rest } = u;
    return { ...rest, hasPassword: !!passwordHash };
  }

  update(userId: string, dto: UpdateMeDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name, countryCode: dto.countryCode?.toUpperCase() },
      select: { id: true, email: true, name: true, role: true, countryCode: true },
    });
  }

  /** GDPR export: everything we hold about the user. */
  async export(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        profiles: true,
        wallet: {
          include: {
            cards: {
              include: {
                userOffers: { include: { offer: true } },
                card: { select: { name: true } },
                benefits: { include: { usages: true, notifications: true } },
              },
            },
          },
        },
        household: true,
        creditReportAccounts: true,
        importJobs: { include: { rows: true } },
        // connection metadata only — the (encrypted) access token is never exported
        bankConnections: { select: { id: true, provider: true, institutionName: true, lastSyncedAt: true, createdAt: true } },
        pushSubscriptions: { select: { id: true, endpoint: true, createdAt: true } },
        subscription: true,
        notifications: true,
        notificationPrefs: true,
        transactions: true,
        valuations: true,
        categoryPins: true,
        offerAlerts: true,
        accounts: { select: { provider: true } },
      },
    });
    if (!user) throw new NotFoundException();
    const { passwordHash: _p, ...safe } = user;
    return { exportedAt: new Date().toISOString(), user: safe };
  }

  /** Hard delete; cascades remove all user-owned rows. */
  async delete(userId: string) {
    await this.prisma.user.delete({ where: { id: userId } });
  }

  profiles(userId: string) {
    return this.prisma.profile.findMany({ where: { userId }, orderBy: { sortOrder: 'asc' } });
  }

  async addProfile(userId: string, dto: ProfileDto) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    const count = await this.prisma.profile.count({ where: { userId } });
    if (count >= 1 && !limitsFor(sub).profiles) throw new ForbiddenException('Household profiles require Pro');
    if (count >= 10) throw new ForbiddenException('Maximum of 10 profiles');
    return this.prisma.profile.create({ data: { userId, nickname: dto.nickname, email: dto.email, sortOrder: count } });
  }

  async removeProfile(userId: string, id: string) {
    const p = await this.prisma.profile.findUnique({ where: { id } });
    if (!p || p.userId !== userId) throw new NotFoundException('Profile not found');
    if (p.isPrimary) throw new ForbiddenException('Cannot delete the primary profile');
    await this.prisma.profile.delete({ where: { id } });
  }

  alerts(userId: string) {
    return this.prisma.offerAlert.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async addAlert(userId: string, dto: OfferAlertDto) {
    const sub = await this.prisma.subscription.findUnique({ where: { userId } });
    if (!limitsFor(sub).offerAlerts) throw new ForbiddenException('Offer alerts require Pro');
    return this.prisma.offerAlert.create({
      data: { userId, keywords: dto.keywords.map((k) => k.trim()).filter(Boolean), minValueCents: dto.minValueCents, issuerIds: dto.issuerIds ?? [], isActive: dto.isActive ?? true },
    });
  }

  async updateAlert(userId: string, id: string, dto: Partial<OfferAlertDto>) {
    const a = await this.prisma.offerAlert.findUnique({ where: { id } });
    if (!a || a.userId !== userId) throw new NotFoundException('Alert not found');
    return this.prisma.offerAlert.update({ where: { id }, data: dto });
  }

  async removeAlert(userId: string, id: string) {
    const res = await this.prisma.offerAlert.deleteMany({ where: { id, userId } });
    if (!res.count) throw new NotFoundException('Alert not found');
  }
}

@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() me(@CurrentUser() u: AuthUser) { return this.users.me(u.sub); }
  @Patch() update(@CurrentUser() u: AuthUser, @Body() dto: UpdateMeDto) { return this.users.update(u.sub, dto); }
  @Get('export') export(@CurrentUser() u: AuthUser) { return this.users.export(u.sub); }
  @Delete() @HttpCode(204) remove(@CurrentUser() u: AuthUser) { return this.users.delete(u.sub); }

  @Get('profiles') profiles(@CurrentUser() u: AuthUser) { return this.users.profiles(u.sub); }
  @Post('profiles') addProfile(@CurrentUser() u: AuthUser, @Body() dto: ProfileDto) { return this.users.addProfile(u.sub, dto); }
  @Delete('profiles/:id') @HttpCode(204) removeProfile(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.users.removeProfile(u.sub, id); }

  @Get('alerts') alerts(@CurrentUser() u: AuthUser) { return this.users.alerts(u.sub); }
  @Post('alerts') addAlert(@CurrentUser() u: AuthUser, @Body() dto: OfferAlertDto) { return this.users.addAlert(u.sub, dto); }
  @Patch('alerts/:id') updateAlert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfferAlertDto) { return this.users.updateAlert(u.sub, id, dto); }
  @Delete('alerts/:id') @HttpCode(204) removeAlert(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.users.removeAlert(u.sub, id); }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}

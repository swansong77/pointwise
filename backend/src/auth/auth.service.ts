import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { User } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { MailService } from '../jobs/mail.service';
import { isTrustedInternal } from '../common/throttler.guard';
import { hashInviteToken, inviteState } from '../domain/member-access';
import { AcceptInviteDto, OAuthExchangeDto, RegisterDto } from './dto/auth.dto';

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: {
    id: string;
    email: string;
    name: string | null;
    role: string;
    /** Present for a household member's own sign-in */
    member?: { profileId: string; nickname: string; visibility: string; household: string };
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  private get accessTtl(): number {
    return Number(this.config.get('JWT_ACCESS_TTL') ?? 900);
  }
  private get refreshTtlDays(): number {
    return Number(this.config.get('JWT_REFRESH_TTL_DAYS') ?? 30);
  }

  /** Create user + wallet + free subscription + notification prefs atomically. */
  private async createUser(data: { email: string; name?: string | null; passwordHash?: string | null }): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        name: data.name ?? null,
        passwordHash: data.passwordHash ?? null,
        wallet: { create: {} },
        subscription: { create: { plan: 'FREE', status: 'ACTIVE' } },
        notificationPrefs: { create: {} },
        profiles: { create: { nickname: data.name || 'Me', isPrimary: true, relationship: 'SELF' } },
      },
    });
  }

  async register(dto: RegisterDto): Promise<TokenPair> {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('An account with this email already exists');
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.createUser({ email: dto.email, name: dto.name, passwordHash });
    await this.track(user.id, 'user_registered', { method: 'password' });
    return this.issueTokens(user);
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Constant-ish work even when the user doesn't exist, to reduce user enumeration via timing.
    const hash = user?.passwordHash ?? '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$0000000000000000000000000000000000000000000';
    const ok = await argon2.verify(hash, password).catch(() => false);
    if (!user || !user.passwordHash || !ok || user.deletedAt) {
      throw new UnauthorizedException('Invalid email or password');
    }
    await this.track(user.id, 'user_logged_in', { method: 'password' });
    return this.issueTokens(user);
  }

  /** Called server-to-server by NextAuth after a successful Google/Apple sign-in. */
  async oauthExchange(dto: OAuthExchangeDto, internalSecret: string | undefined): Promise<TokenPair> {
    const expected = this.config.getOrThrow<string>('INTERNAL_API_SECRET');
    if (!isTrustedInternal(internalSecret, expected)) {
      throw new ForbiddenException('Invalid internal secret');
    }
    const account = await this.prisma.oAuthAccount.findUnique({
      where: { provider_providerAccountId: { provider: dto.provider, providerAccountId: dto.providerAccountId } },
      include: { user: true },
    });
    let user = account?.user;
    if (!user) {
      user = (await this.prisma.user.findUnique({ where: { email: dto.email } })) ?? undefined;
      if (!user) user = await this.createUser({ email: dto.email, name: dto.name });
      await this.prisma.oAuthAccount.create({
        data: { userId: user.id, provider: dto.provider, providerAccountId: dto.providerAccountId },
      });
      if (!user.emailVerified) {
        user = await this.prisma.user.update({ where: { id: user.id }, data: { emailVerified: new Date() } });
      }
    }
    if (user.deletedAt) throw new UnauthorizedException('Account deleted');
    await this.track(user.id, 'user_logged_in', { method: dto.provider });
    return this.issueTokens(user);
  }

  /** Rotating refresh tokens with reuse detection: reusing a rotated token revokes the whole family. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    const tokenHash = sha256(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });
    if (!stored) throw new UnauthorizedException('Invalid refresh token');
    if (stored.revokedAt) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      this.logger.warn(`Refresh token reuse detected for user ${stored.userId}; family revoked`);
      throw new UnauthorizedException('Refresh token reuse detected');
    }
    if (stored.expiresAt.getTime() < Date.now() || stored.user.deletedAt) {
      throw new UnauthorizedException('Refresh token expired');
    }
    const pair = await this.issueTokens(stored.user, stored.familyId);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedBy: sha256(pair.refreshToken) },
    });
    return pair;
  }

  async logout(refreshToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (stored) {
      await this.prisma.refreshToken.updateMany({
        where: { familyId: stored.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  /** Always responds the same way to avoid account enumeration. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt) return;
    const token = randomBytes(32).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
    });
    const url = `${this.config.get('APP_URL') ?? 'http://localhost:3000'}/reset-password?token=${token}`;
    await this.mail.send(user.email, 'Reset your PointWise password', `Reset your password: ${url}\nThis link expires in 1 hour.`);
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const rec = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!rec || rec.usedAt || rec.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: rec.userId }, data: { passwordHash } }),
      this.prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } }),
      // Invalidate all sessions after a password change.
      this.prisma.refreshToken.updateMany({ where: { userId: rec.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
  }

  async issueTokens(user: Pick<User, 'id' | 'email' | 'role' | 'name'>, familyId: string = randomUUID()): Promise<TokenPair> {
    // a household member's own sign-in carries a marker; the guard then resolves the live link on every request
    const link = await this.prisma.profile.findUnique({
      where: { loginUserId: user.id },
      select: { id: true, nickname: true, visibility: true, household: { select: { name: true } } },
    });
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role, typ: 'access', ...(link && { mem: true }) },
      { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'), expiresIn: this.accessTtl },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + this.refreshTtlDays * 86_400_000),
      },
    });
    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTtl,
      user: {
        id: user.id,
        email: user.email,
        name: user.name ?? null,
        role: user.role,
        ...(link && { member: { profileId: link.id, nickname: link.nickname, visibility: link.visibility, household: link.household?.name ?? 'Household' } }),
      },
    };
  }

  /** What the invitation page shows before the person chooses a password. Reveals nothing about the owner's account. */
  async inviteInfo(token: string): Promise<{ nickname: string; household: string; expiresAt: Date }> {
    const invite = await this.prisma.memberInvite.findUnique({
      where: { tokenHash: hashInviteToken(token) },
      include: { profile: { include: { household: true } } },
    });
    if (!invite || inviteState(invite) !== 'ACTIVE' || invite.profile.loginUserId) throw new NotFoundException('This invitation is not valid. Ask for a new one.');
    return { nickname: invite.profile.nickname, household: invite.profile.household?.name ?? 'Household', expiresAt: invite.expiresAt };
  }

  /** Turns an invitation into the member's own sign-in. The token is single-use; two people racing for it cannot both win. */
  async acceptInvite(dto: AcceptInviteDto): Promise<TokenPair> {
    const hash = hashInviteToken(dto.token);
    const now = new Date();
    const passwordHash = await argon2.hash(dto.password, { type: argon2.argon2id });
    const user = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.memberInvite.updateMany({
        where: { tokenHash: hash, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) throw new NotFoundException('This invitation is not valid. Ask for a new one.');
      const invite = await tx.memberInvite.findUniqueOrThrow({ where: { tokenHash: hash }, include: { profile: true } });
      if (invite.profile.loginUserId || invite.profile.isPrimary) throw new NotFoundException('This invitation is not valid. Ask for a new one.');
      if (await tx.user.findUnique({ where: { email: dto.email } })) throw new ConflictException('An account with this email already exists');
      // only the member's own channels are created here: no wallet, plan or household (their data lives with the owner)
      const created = await tx.user.create({
        data: { email: dto.email, name: dto.name?.trim() || invite.profile.nickname, passwordHash, notificationPrefs: { create: {} } },
      });
      await tx.profile.update({ where: { id: invite.profileId }, data: { loginUserId: created.id, loginSince: now } });
      await tx.memberInvite.updateMany({ where: { profileId: invite.profileId, usedAt: null, revokedAt: null }, data: { revokedAt: now } });
      await tx.auditLog.create({ data: { actorId: created.id, action: 'member.login.created', entity: 'Profile', entityId: invite.profileId } });
      return created;
    });
    await this.track(user.id, 'member_login_created', {});
    return this.issueTokens(user);
  }

  private async track(userId: string, name: string, properties: Record<string, unknown>): Promise<void> {
    await this.prisma.analyticsEvent.create({ data: { userId, name, properties: properties as object } }).catch(() => undefined);
  }
}

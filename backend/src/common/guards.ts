import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthUser, IS_PUBLIC, MEMBER_SAFE, ROLES } from './decorators';
import { PrismaService } from './prisma.service';

/** Global guard: verifies the Bearer access token unless the route is @Public(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()]);
    if (isPublic) return true;
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    try {
      const payload = await this.jwt.verifyAsync<AuthUser & { typ?: string; mem?: boolean }>(header.slice(7), {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      if (payload.typ !== 'access') throw new Error('wrong token type');
      req.user = { sub: payload.sub, email: payload.email, role: payload.role } satisfies AuthUser;
      if (payload.mem) {
        // A household member's sign-in. Resolved from the database on every request, so removing the login or changing what
        // it may see takes effect at once, not when the access token expires.
        const p = await this.prisma.profile.findUnique({
          where: { loginUserId: payload.sub },
          select: { id: true, userId: true, visibility: true, nickname: true, canEdit: true },
        });
        if (!p) throw new Error('member login removed');
        req.user.member = { ownerId: p.userId, profileId: p.id, visibility: p.visibility, nickname: p.nickname, canEdit: p.canEdit };
        req.user.role = 'USER';
      }
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
    // Deny by default: a member sign-in reaches only routes that were made member-safe
    if (req.user.member && !this.reflector.getAllAndOverride<boolean>(MEMBER_SAFE, [ctx.getHandler(), ctx.getClass()])) {
      throw new ForbiddenException('This area is not available to a member sign-in');
    }
    return true;
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user || !roles.includes(user.role)) throw new ForbiddenException('Insufficient role');
    return true;
  }
}

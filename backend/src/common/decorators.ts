import { MemberContext } from '../domain/member-access';
import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export interface AuthUser {
  /** The signed-in person's own user id. For a household member this is the member's own login, never the owner's. */
  sub: string;
  email: string;
  role: 'USER' | 'ADMIN';
  /** Set when this sign-in belongs to a household member: whose data it may reach, and how much. Resolved live by the guard. */
  member?: MemberContext;
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Member sign-ins are denied everywhere except routes marked with this. A route marked MemberSafe must use user.member
 * (never user.sub) to reach household data, and must respect member.visibility.
 */
export const MEMBER_SAFE = 'memberSafe';
export const MemberSafe = () => SetMetadata(MEMBER_SAFE, true);

export const ROLES = 'roles';
export const Roles = (...roles: Array<'USER' | 'ADMIN'>) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

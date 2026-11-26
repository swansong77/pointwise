import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export interface AuthUser {
  sub: string;
  email: string;
  role: 'USER' | 'ADMIN';
}

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const ROLES = 'roles';
export const Roles = (...roles: Array<'USER' | 'ADMIN'>) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../common/prisma.service';

export interface MaintenanceState {
  on: boolean;
  reason: string | null;
  since: string | null;
  by: string | null;
}

const KEY = 'maintenance';
const OFF: MaintenanceState = { on: false, reason: null, since: null, by: null };
const CACHE_MS = 5_000;

/** Paths that stay reachable while maintenance mode is on: health checks and signing in (so an administrator can get in). */
export const MAINTENANCE_OPEN = [/^\/health(\/|$)/, /^\/api\/v1\/health(\/|$)/, /^\/api\/v1\/auth\/(login|refresh)$/];

/** Maintenance mode: while it is on, only administrators can use the system. Used around a final export, a restore and a cutover. */
@Injectable()
export class MaintenanceService {
  private cached: { at: number; state: MaintenanceState } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async get(now = Date.now()): Promise<MaintenanceState> {
    if (this.cached && now - this.cached.at < CACHE_MS) return this.cached.state;
    let state = OFF;
    try {
      const row = await this.prisma.systemSetting.findUnique({ where: { key: KEY } });
      if (row?.value && typeof row.value === 'object') state = { ...OFF, ...(row.value as unknown as MaintenanceState) };
    } catch {
      state = OFF; // before the table exists (a restore of a fresh database) the system is simply open
    }
    this.cached = { at: now, state };
    return state;
  }

  async set(on: boolean, by: string | null, reason?: string): Promise<MaintenanceState> {
    const state: MaintenanceState = on ? { on: true, reason: reason?.slice(0, 200) ?? null, since: new Date().toISOString(), by } : OFF;
    await this.prisma.systemSetting.upsert({ where: { key: KEY }, update: { value: state as unknown as Prisma.InputJsonValue }, create: { key: KEY, value: state as unknown as Prisma.InputJsonValue } });
    this.cached = null;
    return state;
  }

  /** Drops the cached value (after a restore replaced the table). */
  forget(): void {
    this.cached = null;
  }
}

/** Answers 503 to everyone but administrators while maintenance mode is on. Runs after authentication. */
@Injectable()
export class MaintenanceGuard implements CanActivate {
  constructor(private readonly maintenance: MaintenanceService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const state = await this.maintenance.get();
    if (!state.on) return true;
    const req = ctx.switchToHttp().getRequest<Request & { user?: { role?: string } }>();
    if (req.user?.role === 'ADMIN') return true;
    const path = req.path ?? req.url ?? '';
    if (MAINTENANCE_OPEN.some((re) => re.test(path))) return true;
    throw new HttpException({ statusCode: 503, error: 'MAINTENANCE', message: state.reason ? `PointWise is in maintenance: ${state.reason}` : 'PointWise is in maintenance. Please try again shortly.' }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}

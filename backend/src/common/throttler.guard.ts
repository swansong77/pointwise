import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash, timingSafeEqual } from 'crypto';

const sha = (s: string) => createHash('sha256').update(s).digest();

/** True when the request carries the shared secret used by the NextAuth server (constant-time compare). */
export function isTrustedInternal(secretHeader: unknown, expected = process.env.INTERNAL_API_SECRET): boolean {
  if (typeof secretHeader !== 'string' || !expected) return false;
  return timingSafeEqual(sha(secretHeader), sha(expected));
}

/** Basic sanity check for a forwarded client IP (IPv4/IPv6 characters only, bounded length). */
export function sanitizeIp(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const ip = v.split(',')[0].trim();
  return /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

/**
 * Rate-limit by the real end-user IP.
 *
 * Browser traffic arrives through the Next.js proxy with X-Forwarded-For (resolved by Express
 * `trust proxy`). Server-to-server calls from the NextAuth server (login, refresh, logout) all come
 * from the frontend container's IP, which would otherwise put every user in one shared bucket. Those
 * calls authenticate with `x-internal-secret` and forward the user's IP in `x-client-ip`:
 *  - with a valid client IP → tracked per end-user IP (brute-force protection preserved);
 *  - without one, only /auth/refresh and /auth/logout skip throttling (refresh is protected by
 *    rotation + reuse detection); login falls back to the request IP bucket.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    if (isTrustedInternal(req.headers?.['x-internal-secret'])) {
      const ip = sanitizeIp(req.headers?.['x-client-ip']);
      if (ip) return `client:${ip}`;
    }
    return req.ip ?? req.socket?.remoteAddress ?? 'unknown';
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const path: string = req.path ?? req.url ?? '';
    // Only token refresh/logout may skip; login without a client IP keeps the (shared) IP bucket.
    return (
      /\/auth\/(refresh|logout)$/.test(path) &&
      isTrustedInternal(req.headers?.['x-internal-secret']) &&
      !sanitizeIp(req.headers?.['x-client-ip'])
    );
  }
}

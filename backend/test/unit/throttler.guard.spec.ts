import { ExecutionContext } from '@nestjs/common';
import { ClientIpThrottlerGuard, isTrustedInternal, sanitizeIp } from '../../src/common/throttler.guard';

const SECRET = 'unit-internal-secret';

describe('ClientIpThrottlerGuard', () => {
  const guard = Object.create(ClientIpThrottlerGuard.prototype) as ClientIpThrottlerGuard & {
    getTracker(req: Record<string, unknown>): Promise<string>;
    shouldSkip(ctx: ExecutionContext): Promise<boolean>;
  };
  const ctx = (req: Record<string, unknown>) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as unknown as ExecutionContext;

  beforeAll(() => {
    process.env.INTERNAL_API_SECRET = SECRET;
  });

  it('isTrustedInternal: constant-time match only for the exact secret', () => {
    expect(isTrustedInternal(SECRET)).toBe(true);
    expect(isTrustedInternal('wrong')).toBe(false);
    expect(isTrustedInternal(undefined)).toBe(false);
    expect(isTrustedInternal(['array'])).toBe(false);
    expect(isTrustedInternal(SECRET, '')).toBe(false);
  });

  it('sanitizeIp: first entry, IP characters only', () => {
    expect(sanitizeIp('203.0.113.7, 10.0.0.1')).toBe('203.0.113.7');
    expect(sanitizeIp('2001:db8::1')).toBe('2001:db8::1');
    expect(sanitizeIp('evil<script>')).toBeNull();
    expect(sanitizeIp('')).toBeNull();
    expect(sanitizeIp(42)).toBeNull();
  });

  it('tracks trusted server calls by the forwarded end-user IP', async () => {
    await expect(guard.getTracker({ headers: { 'x-internal-secret': SECRET, 'x-client-ip': '203.0.113.7' }, ip: '172.18.0.5' })).resolves.toBe('client:203.0.113.7');
  });

  it('ignores x-client-ip from untrusted callers (no spoofing)', async () => {
    await expect(guard.getTracker({ headers: { 'x-client-ip': '1.2.3.4' }, ip: '198.51.100.9' })).resolves.toBe('198.51.100.9');
    await expect(guard.getTracker({ headers: { 'x-internal-secret': 'bad', 'x-client-ip': '1.2.3.4' }, ip: '198.51.100.9' })).resolves.toBe('198.51.100.9');
  });

  it('falls back to socket address / unknown', async () => {
    await expect(guard.getTracker({ headers: {}, socket: { remoteAddress: '::1' } })).resolves.toBe('::1');
    await expect(guard.getTracker({})).resolves.toBe('unknown');
  });

  it('skips only trusted refresh/logout without a client IP — never login', async () => {
    const trusted = { 'x-internal-secret': SECRET };
    await expect(guard.shouldSkip(ctx({ path: '/api/v1/auth/refresh', headers: trusted }))).resolves.toBe(true);
    await expect(guard.shouldSkip(ctx({ path: '/api/v1/auth/logout', headers: trusted }))).resolves.toBe(true);
    await expect(guard.shouldSkip(ctx({ path: '/api/v1/auth/login', headers: trusted }))).resolves.toBe(false);
    await expect(guard.shouldSkip(ctx({ path: '/api/v1/auth/refresh', headers: {} }))).resolves.toBe(false);
    await expect(guard.shouldSkip(ctx({ path: '/api/v1/auth/refresh', headers: { ...trusted, 'x-client-ip': '203.0.113.7' } }))).resolves.toBe(false);
    await expect(guard.shouldSkip(ctx({ url: '/api/v1/wallet/cards', headers: trusted }))).resolves.toBe(false);
  });
});

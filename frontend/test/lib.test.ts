import { centsPerDollar, daysLeftLabel, distance, dollarsToCents, initials, money, multiplier, pct, shortDate } from '@/lib/format';
import { validateEmail, validateLastFour, validatePassword } from '@/lib/validation';
import { safeCallback } from '@/app/login/login-form';
import { ApiError, apiFetch } from '@/lib/api';

describe('format', () => {
  it('money', () => {
    expect(money(123456)).toBe('$1,234.56');
    expect(money(5000)).toBe('$50');
    expect(money(null)).toBe('$0');
    expect(money(-250)).toBe('-$2.50');
  });
  it('centsPerDollar / multiplier', () => {
    expect(centsPerDollar(5)).toBe('5¢/$');
    expect(centsPerDollar(4.5)).toBe('4.5¢/$');
    expect(centsPerDollar(6.6000001)).toBe('6.6¢/$');
    expect(multiplier('4.00')).toBe('4x');
    expect(multiplier(1.5)).toBe('1.5x');
  });
  it('shortDate', () => {
    expect(shortDate('2026-03-05T00:00:00Z')).toBe('Mar 5, 2026');
    expect(shortDate(null)).toBe('—');
    expect(shortDate(new Date('2026-12-31T00:00:00Z'))).toBe('Dec 31, 2026');
  });
  it('daysLeftLabel', () => {
    expect(daysLeftLabel(null)).toBe('No expiry');
    expect(daysLeftLabel(-1)).toBe('Expired');
    expect(daysLeftLabel(0)).toBe('Ends today');
    expect(daysLeftLabel(1)).toBe('1 day left');
    expect(daysLeftLabel(9)).toBe('9 days left');
  });
  it('distance', () => {
    expect(distance(420.4)).toBe('420 m');
    expect(distance(1530)).toBe('1.5 km');
  });
  it('dollarsToCents', () => {
    expect(dollarsToCents('12')).toBe(1200);
    expect(dollarsToCents('$1,234.5')).toBe(123450);
    expect(dollarsToCents(' 0.07 ')).toBe(7);
    expect(dollarsToCents('1.234')).toBeNull();
    expect(dollarsToCents('-5')).toBeNull();
    expect(dollarsToCents('abc')).toBeNull();
    expect(dollarsToCents('')).toBeNull();
  });
  it('pct / initials', () => {
    expect(pct(150)).toBe('100%');
    expect(pct(-2)).toBe('0%');
    expect(initials('Omar Optimizer')).toBe('OO');
    expect(initials(null, 'nora@example.com')).toBe('NE');
    expect(initials('', '')).toBe('?');
  });
});

describe('validation', () => {
  it('password', () => {
    expect(validatePassword('short1')).toMatch(/10/);
    expect(validatePassword('onlyletterslong')).toMatch(/letter/);
    expect(validatePassword('1234567890')).toMatch(/letter/);
    expect(validatePassword('a'.repeat(129) + '1')).toMatch(/128/);
    expect(validatePassword('correct-horse-1')).toBeNull();
  });
  it('email', () => {
    expect(validateEmail('a@b.co')).toBeNull();
    expect(validateEmail('nope')).not.toBeNull();
  });
  it('last four', () => {
    expect(validateLastFour('')).toBeNull();
    expect(validateLastFour('1234')).toBeNull();
    expect(validateLastFour('4111111111111111')).toMatch(/last 4/);
    expect(validateLastFour('12a4')).not.toBeNull();
  });
});

describe('safeCallback (open-redirect protection)', () => {
  it('allows relative paths', () => {
    expect(safeCallback('/offers?status=ACTIVE')).toBe('/offers?status=ACTIVE');
    expect(safeCallback(null)).toBe('/dashboard');
  });
  it('blocks external and protocol-relative URLs', () => {
    expect(safeCallback('https://evil.example/phish')).toBe('/dashboard');
    expect(safeCallback('//evil.example')).toBe('/dashboard');
    expect(safeCallback('/login')).toBe('/dashboard');
  });
  it('allows same-origin absolute URLs', () => {
    expect(safeCallback(`${window.location.origin}/wallet`)).toBe('/wallet');
  });
});

describe('apiFetch', () => {
  afterEach(() => vi.restoreAllMocks());
  it('sends bearer + JSON and parses response', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    await expect(apiFetch('/x', { method: 'POST', body: '{}', token: 't' })).resolves.toEqual({ ok: 1 });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe('/api/v1/x');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer t', 'Content-Type': 'application/json' });
  });
  it('returns undefined on 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    await expect(apiFetch('/x')).resolves.toBeUndefined();
  });
  it('throws ApiError with joined validation messages', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ message: ['a is bad', 'b is bad'] }), { status: 400 }));
    await expect(apiFetch('/x')).rejects.toMatchObject({ status: 400, message: 'a is bad, b is bad' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 500, statusText: 'Server Error' }));
    const err = (await apiFetch('/x').catch((e: unknown) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.message).toBe('Server Error');
  });
});

describe('clientIpFrom (NextAuth → API client IP forwarding)', async () => {
  const { clientIpFrom } = await import('@/lib/auth');
  it('takes the first forwarded IP and validates it', () => {
    expect(clientIpFrom({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2' })).toBe('203.0.113.7');
    expect(clientIpFrom({ 'x-real-ip': '2001:db8::1' })).toBe('2001:db8::1');
    expect(clientIpFrom({ 'x-forwarded-for': 'not an ip' })).toBeUndefined();
    expect(clientIpFrom(undefined)).toBeUndefined();
  });
});

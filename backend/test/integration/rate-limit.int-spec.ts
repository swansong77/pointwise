import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Runs with a deliberately tight auth limit. The env must be set before the app modules load
 * (the @Throttle decorator reads it at import), so modules are required lazily.
 */
const V = '/api/v1';
const SECRET = process.env.INTERNAL_API_SECRET as string;
let app: INestApplication;

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT_PER_MIN = '3';
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createApp } = require('./helpers') as typeof import('./helpers');
  app = await createApp();
});
afterAll(async () => {
  await app.close();
});

const login = (headers: Record<string, string> = {}) =>
  request(app.getHttpServer()).post(`${V}/auth/login`).set(headers).send({ email: 'demo@pointwise.local', password: 'Demo12345!' });

describe('rate limiting by real client IP', () => {
  it('untrusted callers share their own IP bucket and get 429 after the limit', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await login({ 'x-client-ip': '9.9.9.9' })).status); // spoofed header ignored
    expect(codes.slice(0, 3)).toEqual([200, 200, 200]);
    expect(codes.slice(3)).toEqual([429, 429]);
  });

  it('trusted NextAuth calls are limited per end-user IP, so users do not share a bucket', async () => {
    const a = { 'x-internal-secret': SECRET, 'x-client-ip': '203.0.113.10' };
    const b = { 'x-internal-secret': SECRET, 'x-client-ip': '203.0.113.11' };
    for (let i = 0; i < 3; i++) expect((await login(a)).status).toBe(200);
    expect((await login(a)).status).toBe(429); // user A exhausted…
    expect((await login(b)).status).toBe(200); // …user B unaffected
  });

  it('trusted background token refresh is never throttled (protected by rotation instead)', async () => {
    let refreshToken = (await login({ 'x-internal-secret': SECRET, 'x-client-ip': '203.0.113.20' })).body.refreshToken as string;
    for (let i = 0; i < 6; i++) {
      const res = await request(app.getHttpServer()).post(`${V}/auth/refresh`).set({ 'x-internal-secret': SECRET }).send({ refreshToken });
      expect(res.status).toBe(200);
      refreshToken = res.body.refreshToken;
    }
  });
});

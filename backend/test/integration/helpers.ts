import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap';

export async function createApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ logger: ['error'], forceCloseConnections: true });
  configureApp(app);
  await app.init();
  return app;
}

export const api = (app: INestApplication) => request(app.getHttpServer());
export const uniqueEmail = (prefix = 'user') => `${prefix}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@test.local`;

export async function register(app: INestApplication, email = uniqueEmail()) {
  const res = await api(app).post('/api/v1/auth/register').send({ email, password: 'integration-pass-1', name: 'Test' }).expect(201);
  return { email, token: res.body.accessToken as string, refresh: res.body.refreshToken as string, userId: res.body.user.id as string };
}

export async function login(app: INestApplication, email: string, password: string) {
  const res = await api(app).post('/api/v1/auth/login').send({ email, password }).expect(200);
  return res.body.accessToken as string;
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

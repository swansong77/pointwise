import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';
import { AiService } from '../../src/ai/ai.service';
import { EvalCase, gradeRun, summarize, toMarkdown } from '../../src/ai/evals';
import { createApp } from './helpers';

/** The grounding eval set on the offline demo model must pass 100 % (regression gate for prompts, tools and routing). */
let app: INestApplication;
const prisma = new PrismaClient();

beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

it('grounding eval set: every case passes on the demo model', async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: 'family@pointwise.local' } });
  await prisma.aiSettings.upsert({ where: { userId: user.id }, update: { consentedAt: new Date() }, create: { userId: user.id, consentedAt: new Date() } });
  const ai = app.get(AiService);
  const cases = JSON.parse(readFileSync(join(__dirname, '../evals/grounding.json'), 'utf8')) as EvalCase[];
  expect(cases.length).toBeGreaterThanOrEqual(15);
  const results = [];
  for (const c of cases) results.push(gradeRun(c, await ai.run(user.id, { message: c.question, agentKey: c.agent })));
  const s = summarize(results);
  if (s.failures.length) console.log(toMarkdown('demo', results));
  expect(s.failures).toEqual([]);
  expect(s.passRate).toBe(1);
});

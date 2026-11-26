/*
 * Runs the grounding eval set (test/evals/grounding.json) against the demo family account.
 *
 *   npm run eval                          # offline demo model (free, deterministic)
 *   EVAL_MODEL_ID=<AiModel.id> EVAL_LIVE=1 npm run eval   # a real model — costs money, opt-in only
 *
 * Needs DATABASE_URL (seeded) and REDIS_URL. Writes eval-report.md / eval-report.json to the cwd.
 * Whatever the model, user card data is never sent to it (privacy boundary) — live runs measure
 * tool selection and catalog answers.
 */
import { NestFactory } from '@nestjs/core';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { AiService } from '../src/ai/ai.service';
import { EvalCase, gradeRun, summarize, toMarkdown } from '../src/ai/evals';
import { PrismaService } from '../src/common/prisma.service';

async function main() {
  const modelId = process.env.EVAL_MODEL_ID ?? null;
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = app.get(PrismaService);
  const ai = app.get(AiService);
  if (modelId) {
    const m = await prisma.aiModel.findUnique({ where: { id: modelId }, include: { provider: true } });
    if (!m) throw new Error(`Unknown model ${modelId}`);
    if (m.provider.kind !== 'MOCK' && process.env.EVAL_LIVE !== '1') throw new Error('Refusing to call a paid model: set EVAL_LIVE=1 to confirm.');
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { email: process.env.EVAL_USER ?? 'family@pointwise.local' } });
  await prisma.aiSettings.upsert({ where: { userId: user.id }, update: { consentedAt: new Date() }, create: { userId: user.id, consentedAt: new Date() } });
  const cases = JSON.parse(readFileSync(join(__dirname, '../test/evals/grounding.json'), 'utf8')) as EvalCase[];
  const results = [];
  for (const c of cases) {
    const started = Date.now();
    try {
      const r = await ai.run(user.id, { message: c.question, agentKey: c.agent, modelId: modelId ?? undefined });
      results.push(gradeRun(c, r, Date.now() - started));
    } catch (e) {
      results.push(gradeRun(c, { answer: '', trace: [], refused: true }, Date.now() - started));
      console.error(`${c.id}: ${(e as Error).message}`);
    }
  }
  const label = modelId ?? 'default chain';
  writeFileSync('eval-report.md', toMarkdown(label, results));
  writeFileSync('eval-report.json', JSON.stringify({ model: label, summary: summarize(results), results }, null, 2));
  const s = summarize(results);
  console.log(`eval ${label}: ${s.passed}/${s.cases} passed (${Math.round(s.passRate * 100)} %)`);
  await app.close();
  process.exit(s.passRate === 1 ? 0 : 1);
}
void main();

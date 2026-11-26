import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from './common/prisma.service';
import { MailModule } from './jobs/mail.service';
import { JobsWorkerModule } from './jobs/jobs.module';

/** worker: executes scheduled / enqueued jobs (the schedule itself is registered by scheduler.ts). */
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, MailModule, JobsWorkerModule] })
class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('Worker started', 'Worker');
}
void bootstrap();

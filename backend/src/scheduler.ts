import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { JobsSchedulerModule } from './jobs/jobs.module';

/** scheduler: registers the cron schedule in Redis (BullMQ job schedulers) and keeps it current. */
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), JobsSchedulerModule] })
class SchedulerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SchedulerModule);
  app.enableShutdownHooks();
  Logger.log('Scheduler started', 'Scheduler');
}
void bootstrap();

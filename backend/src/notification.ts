import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from './common/prisma.service';
import { MailModule } from './jobs/mail.service';
import { queueRoot } from './jobs/jobs.module';
import { DeliveryWorkerModule } from './notifications/delivery';

/** notification-service: delivers email and web-push notifications from the notifications queue. */
@Module({ imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, MailModule, queueRoot(), DeliveryWorkerModule] })
class NotificationServiceModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(NotificationServiceModule);
  app.enableShutdownHooks();
  Logger.log('Notification service started', 'Notifications');
}
void bootstrap();

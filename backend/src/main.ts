import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app, { swagger: process.env.SWAGGER_ENABLED !== 'false' });
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');
  Logger.log(`API listening on :${port} (docs at /api/docs)`, 'Bootstrap');
}
void bootstrap();

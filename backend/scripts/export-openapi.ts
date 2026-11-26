/* Exports the Swagger/OpenAPI document without a database: PrismaService is stubbed. */
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'fs';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma.service';

async function main() {
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ $connect: async () => undefined, $disconnect: async () => undefined })
    .compile();
  const app = mod.createNestApplication({ logger: false });
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  const config = new DocumentBuilder()
    .setTitle('Pointwise API')
    .setDescription('Credit-card rewards optimization API. All money values are integer cents.')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, config);
  writeFileSync(process.argv[2], JSON.stringify(doc, null, 2));
  console.log(`wrote ${Object.keys(doc.paths).length} paths, ${Object.keys(doc.components?.schemas ?? {}).length} schemas`);
  process.exit(0);
}
void main();

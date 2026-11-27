import 'reflect-metadata';
import { stacklens } from '@stacklens/node-tracer';
import * as typeorm from 'typeorm';

stacklens.init({ application: 'billing-api', project: 'payments' });
stacklens.instrumentTypeORM(typeorm); // Repository / EntityManager / raw SQL spans

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  stacklens.instrumentNest(app); // ← the only line needed in a Nest app
  await app.listen(process.env.PORT ?? 3002);
  console.log(`nest example on http://localhost:${process.env.PORT ?? 3002}`);
}
bootstrap();

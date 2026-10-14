import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ENV } from './config/config.module.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { bufferLogs: true },
  );
  const logger = app.get(Logger);
  app.useLogger(logger);

  const env = app.get<Env>(ENV);
  app.enableCors({ origin: env.CORS_ORIGIN.split(','), credentials: true });

  // On SIGTERM (deploys, Ctrl+C) Nest runs onApplicationShutdown hooks, so
  // DB and Redis connections close cleanly instead of being cut.
  app.enableShutdownHooks();

  await app.listen(env.PORT, '0.0.0.0');
  logger.log(`ready on http://localhost:${env.PORT}`, 'Bootstrap');
}
await bootstrap();

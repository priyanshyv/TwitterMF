import fastifyCookie from '@fastify/cookie';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Env } from './config/env.js';

// Everything main.ts and the e2e tests must configure identically.
export async function configureApp(app: NestFastifyApplication, env: Env) {
  await app.register(fastifyCookie);
  // Browsers only send cookies cross-origin when the server names the exact
  // origin and allows credentials.
  app.enableCors({ origin: env.CORS_ORIGIN.split(','), credentials: true });
}

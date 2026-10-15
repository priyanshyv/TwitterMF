import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ENV } from '../src/config/config.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { REDIS } from '../src/redis/redis.module.js';

export async function createTestApp(
  override?: (builder: TestingModuleBuilder) => void,
) {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  override?.(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await configureApp(app, app.get(ENV));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

// Empties every table and the test Redis database, so each test starts clean.
export async function resetData(app: NestFastifyApplication) {
  await app
    .get<Database>(DB)
    .execute(
      sql`truncate users, tweets, follows, likes, refresh_tokens cascade`,
    );
  await app.get<Redis>(REDIS).flushdb();
}

type InjectResponse = Awaited<ReturnType<NestFastifyApplication['inject']>>;

// Turns a response's Set-Cookie headers into a Cookie header for the next
// request, like a browser would.
export function cookiesFrom(res: InjectResponse): string {
  return res.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
}

export function cookieValue(res: InjectResponse, name: string) {
  return res.cookies.find((c) => c.name === name)?.value;
}

export async function signup(
  app: NestFastifyApplication,
  username = 'alice',
  password = 'correct horse battery',
) {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/signup',
    payload: { username, displayName: username.toUpperCase(), password },
  });
  if (res.statusCode !== 201)
    throw new Error(`signup failed: ${res.statusCode} ${res.body}`);
  return {
    res,
    cookie: cookiesFrom(res),
    user: res.json<{ user: { id: string; username: string } }>().user,
  };
}

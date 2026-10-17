import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AppModule } from '../src/app.module.js';
import { QUEUES, type Queues } from '../src/jobs/jobs.module.js';
import { OutboxRelay } from '../src/jobs/outbox.relay.js';
import { WorkerModule } from '../src/worker/worker.module.js';
import { configureApp } from '../src/app.setup.js';
import { ENV } from '../src/config/config.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { REDIS } from '../src/redis/redis.module.js';

// By default the app also runs the queue workers in-process, like a worker
// process would, so tests exercise the real background path; call settle()
// to wait for queued jobs.
export async function createTestApp(
  override?: (builder: TestingModuleBuilder) => void,
  { workers = true }: { workers?: boolean } = {},
) {
  const builder = Test.createTestingModule({
    imports: [workers ? WorkerModule : AppModule],
  });
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
      sql`truncate users, tweets, follows, likes, refresh_tokens, notifications, outbox cascade`,
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

// Waits until the outbox is empty and every queue has nothing waiting,
// running or scheduled.
export async function settle(app: NestFastifyApplication, timeoutMs = 10_000) {
  const queues = app.get<Queues>(QUEUES);
  const relay = app.get(OutboxRelay);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await relay.drain();
    const outboxed = await relay.pending();
    const counts = await Promise.all(
      [queues.fanout, queues.notifications, queues.search, queues.media].map(
        (q) =>
          q.getJobCounts(
            'waiting',
            'active',
            'delayed',
            'prioritized',
            'waiting-children',
          ),
      ),
    );
    if (
      outboxed === 0 &&
      counts.every((c) => Object.values(c).every((n) => n === 0))
    )
      return;
    if (Date.now() > deadline)
      throw new Error(
        `jobs still pending after ${timeoutMs} ms: ${JSON.stringify(counts)}`,
      );
    await new Promise((r) => setTimeout(r, 20));
  }
}

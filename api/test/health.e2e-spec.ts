import {
  FastifyAdapter,
  type NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { REDIS } from '../src/redis/redis.module.js';

// Needs Postgres and Redis running: `npm run infra:up` from the repo root.
async function createApp(
  override?: (b: ReturnType<typeof Test.createTestingModule>) => void,
) {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  override?.(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
    { logger: false },
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('GET /health', () => {
  let app: NestFastifyApplication;

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 when Postgres and Redis are reachable', async () => {
    app = await createApp();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'up', redis: 'up' });
  });

  it('returns 503 and names the dependency that is down', async () => {
    const brokenRedis = {
      ping: () => Promise.reject(new Error('connection refused')),
      quit: () => Promise.resolve('OK'),
    };
    app = await createApp((b) =>
      b.overrideProvider(REDIS).useValue(brokenRedis),
    );

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'degraded',
      db: 'up',
      redis: 'down',
    });
  });
});

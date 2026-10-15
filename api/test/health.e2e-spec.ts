import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { REDIS } from '../src/redis/redis.module.js';
import { createTestApp } from './helpers.js';

// Needs Postgres and Redis running: `npm run infra:up` from the repo root.
describe('GET /health', () => {
  let app: NestFastifyApplication;

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 when Postgres and Redis are reachable', async () => {
    app = await createTestApp();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', db: 'up', redis: 'up' });
  });

  it('returns 503 and names the dependency that is down', async () => {
    const brokenRedis = {
      ping: () => Promise.reject(new Error('connection refused')),
      quit: () => Promise.resolve('OK'),
      on: () => brokenRedis,
    };
    app = await createTestApp((b) =>
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

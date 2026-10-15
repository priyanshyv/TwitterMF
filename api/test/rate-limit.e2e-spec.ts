import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { ENV } from '../src/config/config.module.js';
import { loadEnv } from '../src/config/env.js';
import { RATE_LIMITER } from '../src/rate-limit/rate-limit.module.js';
import { REDIS } from '../src/redis/redis.module.js';
import { createTestApp, resetData, signup } from './helpers.js';

const withLimits = () =>
  createTestApp((b) =>
    b
      .overrideProvider(ENV)
      .useValue({ ...loadEnv(), RATE_LIMIT_ENABLED: true }),
  );

describe('rate limiting', () => {
  let app: NestFastifyApplication;
  let redis: Redis;

  beforeAll(async () => {
    app = await withLimits();
    redis = app.get(REDIS);
  });
  beforeEach(async () => {
    await resetData(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const login = (username: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { username, password: 'wrong-password' },
    });

  describe('login (sliding-window log)', () => {
    it('allows 10 attempts per account in 15 minutes, then 429s', async () => {
      await signup(app, 'alice');
      for (let i = 0; i < 10; i++)
        expect((await login('alice')).statusCode).toBe(401);

      const blocked = await login('alice');
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().message).toMatch(/Try again in \d+ minutes?/);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(800);

      // Another account from the same address is unaffected.
      expect((await login('bob')).statusCode).toBe(401);
    });

    it('lets attempts through again once old ones leave the window', async () => {
      for (let i = 0; i < 10; i++) await login('alice');
      expect((await login('alice')).statusCode).toBe(429);

      // Pretend the 10 attempts happened 16 minutes ago.
      const [key] = await redis.keys('rl:login:*');
      await redis.eval(
        `local e = redis.call('ZRANGE', KEYS[1], 0, -1, 'WITHSCORES')
         for i = 1, #e, 2 do
           redis.call('ZADD', KEYS[1], tonumber(e[i + 1]) - tonumber(ARGV[1]), e[i])
         end`,
        1,
        key,
        16 * 60_000,
      );

      expect((await login('alice')).statusCode).toBe(401);
    });
  });

  describe('posting (token bucket)', () => {
    it('allows a burst of 10 tweets, then 429s until tokens refill', async () => {
      const alice = await signup(app, 'alice');
      const tweet = () =>
        app.inject({
          method: 'POST',
          url: '/tweets',
          payload: { text: 'spam?' },
          headers: { cookie: alice.cookie },
        });

      const remaining: number[] = [];
      for (let i = 0; i < 10; i++) {
        const res = await tweet();
        expect(res.statusCode).toBe(201);
        remaining.push(Number(res.headers['ratelimit-remaining']));
      }
      expect(remaining).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);

      const blocked = await tweet();
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json().retryAfterSeconds).toBeLessThanOrEqual(6);

      // Wind the bucket's clock back a minute: 10 tokens drip back in.
      const key = `rl:post:user:${alice.user.id}`;
      const ts = Number(await redis.hget(key, 'ts'));
      await redis.hset(key, 'ts', ts - 60_000);
      expect((await tweet()).statusCode).toBe(201);
    });

    it('gives each account its own bucket', async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      const post = (cookie: string) =>
        app.inject({
          method: 'POST',
          url: '/tweets',
          payload: { text: 'hi' },
          headers: { cookie },
        });
      for (let i = 0; i < 10; i++) await post(alice.cookie);
      expect((await post(alice.cookie)).statusCode).toBe(429);
      expect((await post(bob.cookie)).statusCode).toBe(201);
    });
  });
});

describe('rate limiting when Redis is down', () => {
  it('fails open: requests go through', async () => {
    const app = await createTestApp((b) =>
      b
        .overrideProvider(ENV)
        .useValue({ ...loadEnv(), RATE_LIMIT_ENABLED: true })
        .overrideProvider(RATE_LIMITER)
        .useValue({
          tokenBucket: () => Promise.reject(new Error('connection refused')),
          slidingWindow: () => Promise.reject(new Error('connection refused')),
        }),
    );
    await resetData(app);
    for (let i = 0; i < 15; i++) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'alice', password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(401);
    }
    await app.close();
  });
});

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { REDIS } from '../src/redis/redis.module.js';
import { UsernamesService } from '../src/usernames/usernames.service.js';
import { createTestApp, resetData, signup } from './helpers.js';

describe('username availability (bloom filter)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetData(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const check = async (username: string) => {
    const res = await app.inject({
      method: 'GET',
      url: `/usernames/${username}`,
    });
    return { status: res.statusCode, body: res.json() };
  };

  it('answers "available" for a fresh name without asking Postgres', async () => {
    expect((await check('brand_new')).body).toEqual({
      username: 'brand_new',
      available: true,
      checkedBy: 'bloom',
    });
  });

  it('confirms a taken name in Postgres, ignoring case', async () => {
    await signup(app, 'alice');
    expect((await check('ALICE')).body).toEqual({
      username: 'ALICE',
      available: false,
      checkedBy: 'database',
    });
  });

  it('rejects names that could never be valid', async () => {
    expect((await check('no spaces!')).status).toBe(400);
    expect((await check('waytoolongusername')).status).toBe(400);
  });

  it('rebuilds the filter from Postgres after Redis loses it', async () => {
    await signup(app, 'alice');
    await app.get<Redis>(REDIS).flushdb();

    // With the filter gone, it wrongly says the name is free...
    expect((await check('alice')).body.checkedBy).toBe('bloom');

    // ...until it's rebuilt from the source of truth.
    await app.get(UsernamesService).rebuild();
    expect((await check('alice')).body).toMatchObject({
      available: false,
      checkedBy: 'database',
    });
  });

  it('still blocks a duplicate sign-up when the filter is out of date', async () => {
    await signup(app, 'alice');
    await app.get<Redis>(REDIS).flushdb();

    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        username: 'alice',
        displayName: 'Copycat',
        password: 'password123',
      },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('username availability when Redis is down', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const down = () => Promise.reject(new Error('connection refused'));
    const deadRedis = {
      pipeline: () => ({ getbit() {}, setbit() {}, exec: down }),
      exists: down,
      ping: down,
      flushdb: () => Promise.resolve('OK'),
      quit: () => Promise.resolve('OK'),
      on: () => deadRedis,
      duplicate: () => deadRedis, // the WebSocket gateway's subscriber
    };
    app = await createTestApp((b) =>
      b.overrideProvider(REDIS).useValue(deadRedis),
    );
    await resetData(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('falls back to Postgres instead of failing', async () => {
    await signup(app, 'alice');
    const free = await app.inject({
      method: 'GET',
      url: '/usernames/someone_new',
    });
    const taken = await app.inject({ method: 'GET', url: '/usernames/alice' });

    expect(free.json()).toMatchObject({
      available: true,
      checkedBy: 'database',
    });
    expect(taken.json()).toMatchObject({
      available: false,
      checkedBy: 'database',
    });
  });
});

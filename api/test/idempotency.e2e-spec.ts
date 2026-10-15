import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DB, type Database } from '../src/db/db.module.js';
import { REDIS } from '../src/redis/redis.module.js';
import { createTestApp, resetData, signup } from './helpers.js';

describe('idempotency keys on POST /tweets', () => {
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

  const post = (cookie: string, key: string | undefined, payload: object) =>
    app.inject({
      method: 'POST',
      url: '/tweets',
      payload,
      headers: { cookie, ...(key ? { 'idempotency-key': key } : {}) },
    });
  const tweetCount = async () => {
    const { rows } = await app
      .get<Database>(DB)
      .execute<{ n: number }>(sql`select count(*)::int as n from tweets`);
    return rows[0].n;
  };

  it('posts once and replays the same response for a retry', async () => {
    const alice = await signup(app, 'alice');
    const first = await post(alice.cookie, 'key-1', { text: 'only once' });
    const retry = await post(alice.cookie, 'key-1', { text: 'only once' });

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json().id).toBe(first.json().id);
    expect(await tweetCount()).toBe(1);
  });

  it('handles a double-submit racing the first request', async () => {
    const alice = await signup(app, 'alice');
    const results = await Promise.all([
      post(alice.cookie, 'key-2', { text: 'double click' }),
      post(alice.cookie, 'key-2', { text: 'double click' }),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    // One posts; the other either sees "in progress" or the replay.
    expect(codes).toContain(201);
    expect(codes.every((c) => c === 201 || c === 409)).toBe(true);
    expect(await tweetCount()).toBe(1);
  });

  it('rejects reusing a key for a different tweet', async () => {
    const alice = await signup(app, 'alice');
    await post(alice.cookie, 'key-3', { text: 'first' });
    const res = await post(alice.cookie, 'key-3', { text: 'something else' });
    expect(res.statusCode).toBe(422);
    expect(await tweetCount()).toBe(1);
  });

  it('releases the key when the request fails, so a retry can work', async () => {
    const alice = await signup(app, 'alice');
    const failed = await post(alice.cookie, 'key-4', { text: '' });
    expect(failed.statusCode).toBe(400);
    expect(
      await app.get<Redis>(REDIS).exists(`idem:${alice.user.id}:key-4`),
    ).toBe(0);
  });

  it('scopes keys per user', async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    await post(alice.cookie, 'same-key', { text: 'alice' });
    const res = await post(bob.cookie, 'same-key', { text: 'bob' });
    expect(res.statusCode).toBe(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await tweetCount()).toBe(2);
  });

  it('works without a key, and rejects malformed keys', async () => {
    const alice = await signup(app, 'alice');
    expect(
      (await post(alice.cookie, undefined, { text: 'no key' })).statusCode,
    ).toBe(201);
    expect(
      (await post(alice.cookie, 'bad key!', { text: 'x' })).statusCode,
    ).toBe(400);
  });
});

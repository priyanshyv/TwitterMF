import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { CountersService } from '../src/counters/counters.service.js';
import { DB, type Database } from '../src/db/db.module.js';
import { REDIS } from '../src/redis/redis.module.js';
import { createTestApp, resetData, signup } from './helpers.js';

describe('likes, replies, retweets and counters', () => {
  let app: NestFastifyApplication;
  let db: Database;
  let redis: Redis;

  beforeAll(async () => {
    app = await createTestApp();
    db = app.get(DB);
    redis = app.get(REDIS);
  });
  beforeEach(async () => {
    await resetData(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const as = (cookie: string) => ({
    get: (url: string) =>
      app.inject({ method: 'GET', url, headers: { cookie } }),
    post: (url: string, payload?: object) =>
      app.inject({ method: 'POST', url, payload, headers: { cookie } }),
    del: (url: string) =>
      app.inject({ method: 'DELETE', url, headers: { cookie } }),
  });
  const post = async (cookie: string, text: string, replyToId?: string) => {
    const res = await as(cookie).post('/tweets', { text, replyToId });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>();
  };
  const storedCounts = async (tweetId: string) => {
    const { rows } = await db.execute<{
      like_count: number;
      reply_count: number;
      retweet_count: number;
    }>(
      sql`select like_count, reply_count, retweet_count from tweets where id = ${BigInt(tweetId)}`,
    );
    return rows[0];
  };
  const flush = () => app.get(CountersService).flush();

  describe('likes', () => {
    it('likes once, however many times you click, and unlikes', async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      const t = await post(alice.cookie, 'like me');

      const first = (await as(bob.cookie).post(`/tweets/${t.id}/like`)).json();
      const again = (await as(bob.cookie).post(`/tweets/${t.id}/like`)).json();
      expect(first.counts.likes).toBe(1);
      expect(again.counts.likes).toBe(1);
      expect(again.viewer).toEqual({ liked: true, retweeted: false });

      const undone = (await as(bob.cookie).del(`/tweets/${t.id}/like`)).json();
      expect(undone.counts.likes).toBe(0);
      expect(undone.viewer.liked).toBe(false);
    });

    it('404s for a tweet that does not exist', async () => {
      const bob = await signup(app, 'bob');
      expect(
        (await as(bob.cookie).post('/tweets/123456/like')).statusCode,
      ).toBe(404);
    });
  });

  describe('write-behind counters', () => {
    it('keeps counts in Redis until a flush moves them to Postgres', async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      const carol = await signup(app, 'carol');
      const t = await post(alice.cookie, 'popular');
      await as(bob.cookie).post(`/tweets/${t.id}/like`);
      await as(carol.cookie).post(`/tweets/${t.id}/like`);

      // Before the flush: Postgres still says 0, the API already says 2.
      expect((await storedCounts(t.id)).like_count).toBe(0);
      expect(await redis.hget(`counter:tweet:${t.id}`, 'likes')).toBe('2');
      const before = (await as(alice.cookie).get(`/tweets/${t.id}`)).json();
      expect(before.tweet.counts.likes).toBe(2);

      await flush();

      // After: Postgres has it, Redis has nothing pending, the API agrees.
      expect((await storedCounts(t.id)).like_count).toBe(2);
      expect(await redis.exists(`counter:tweet:${t.id}`)).toBe(0);
      const after = (await as(alice.cookie).get(`/tweets/${t.id}`)).json();
      expect(after.tweet.counts.likes).toBe(2);
    });

    it('counts follows and tweets on profiles the same way', async () => {
      const alice = await signup(app, 'alice');
      await signup(app, 'bob');
      await as(alice.cookie).post('/users/bob/follow');
      await post(alice.cookie, 'one');
      await post(alice.cookie, 'two');

      const check = async () => {
        expect(
          (await as(alice.cookie).get('/users/bob')).json().stats.followers,
        ).toBe(1);
        expect(
          (await as(alice.cookie).get('/users/alice')).json().stats,
        ).toEqual({
          followers: 0,
          following: 1,
          tweets: 2,
        });
      };
      await check();
      await flush();
      await check();
    });

    it('writes straight to Postgres when Redis is unavailable', async () => {
      const alice = await signup(app, 'alice');
      const t = await post(alice.cookie, 'resilient');

      const counters = app.get(CountersService);
      const realMulti = redis.multi.bind(redis);
      redis.multi = (() => ({
        hincrby() {},
        sadd() {},
        exec: () => Promise.reject(new Error('connection refused')),
      })) as never;
      try {
        await counters.change([
          { entity: 'tweet', id: BigInt(t.id), field: 'likes', by: 1 },
        ]);
      } finally {
        redis.multi = realMulti;
      }
      expect((await storedCounts(t.id)).like_count).toBe(1);
    });

    it('reconcile recomputes every count from the source rows', async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      const t = await post(alice.cookie, 'drifted');
      await as(bob.cookie).post(`/tweets/${t.id}/like`);
      await flush();
      // Simulate drift (say, Redis lost a batch of changes).
      await db.execute(
        sql`update tweets set like_count = 99 where id = ${BigInt(t.id)}`,
      );

      await app.get(CountersService).reconcile();

      expect((await storedCounts(t.id)).like_count).toBe(1);
    });
  });

  describe('replies and threads', () => {
    it('replies, counts the reply, and shows the thread', async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      const root = await post(alice.cookie, 'root');
      const reply = await post(bob.cookie, 'reply to root', root.id);
      const nested = await post(alice.cookie, 'reply to reply', reply.id);

      const thread = (
        await app.inject({ method: 'GET', url: `/tweets/${nested.id}` })
      ).json();
      expect(thread.ancestors.map((t: { text: string }) => t.text)).toEqual([
        'root',
        'reply to root',
      ]);
      expect(thread.tweet.replyTo).toMatchObject({
        id: reply.id,
        author: { username: 'bob' },
      });

      const replies = (
        await app.inject({ method: 'GET', url: `/tweets/${root.id}/replies` })
      ).json();
      expect(
        replies.items.map((i: { tweet: { text: string } }) => i.tweet.text),
      ).toEqual(['reply to root']);
      expect(thread.ancestors[0].counts.replies).toBe(1);
    });

    it('rejects a reply to a tweet that does not exist', async () => {
      const alice = await signup(app, 'alice');
      const res = await as(alice.cookie).post('/tweets', {
        text: 'hi',
        replyToId: '42',
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('retweets', () => {
    it("puts the original in followers' timelines, credited to the retweeter", async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      const carol = await signup(app, 'carol');
      await as(carol.cookie).post('/users/bob/follow');
      const t = await post(alice.cookie, 'worth sharing');

      const view = (
        await as(bob.cookie).post(`/tweets/${t.id}/retweet`)
      ).json();
      expect(view.counts.retweets).toBe(1);
      expect(view.viewer.retweeted).toBe(true);

      const [item] = (await as(carol.cookie).get('/timeline')).json().items;
      expect(item.retweetedBy).toMatchObject({ username: 'bob' });
      expect(item.tweet).toMatchObject({
        id: t.id,
        text: 'worth sharing',
        author: { username: 'alice' },
      });
      expect(item.id).not.toBe(t.id); // the cursor is the retweet's own ID
    });

    it('retweets once, retweeting a retweet targets the original, and undoes', async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      const carol = await signup(app, 'carol');
      const t = await post(alice.cookie, 'original');

      await as(bob.cookie).post(`/tweets/${t.id}/retweet`);
      await as(bob.cookie).post(`/tweets/${t.id}/retweet`);
      const bobsRetweet = (await as(bob.cookie).get('/users/bob/tweets')).json()
        .items[0];
      const viaRetweet = (
        await as(carol.cookie).post(`/tweets/${bobsRetweet.id}/retweet`)
      ).json();
      expect(viaRetweet).toMatchObject({ id: t.id, counts: { retweets: 2 } });

      const undone = (
        await as(bob.cookie).del(`/tweets/${t.id}/retweet`)
      ).json();
      expect(undone.counts.retweets).toBe(1);
      expect(
        (await as(bob.cookie).get('/users/bob/tweets')).json().items,
      ).toEqual([]);
    });
  });

  describe('cache', () => {
    it('serves tweet and user bodies from Redis after the first read', async () => {
      const alice = await signup(app, 'alice');
      const t = await post(alice.cookie, 'cache me');
      await as(alice.cookie).get('/timeline');

      const cached = JSON.parse((await redis.get(`cache:tweet:${t.id}`))!);
      expect(cached).toMatchObject({ id: t.id, text: 'cache me' });
      expect(await redis.exists(`cache:user:${alice.user.id}`)).toBe(1);
      const ttl = await redis.ttl(`cache:tweet:${t.id}`);
      expect(ttl).toBeGreaterThan(500); // 600s ± 10% jitter
      expect(ttl).toBeLessThanOrEqual(660);
    });

    it('drops cached copies when a flush changes their counts', async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      const t = await post(alice.cookie, 'counted');
      await as(bob.cookie).post(`/tweets/${t.id}/like`);
      expect(await redis.exists(`cache:tweet:${t.id}`)).toBe(1);

      await flush();

      expect(await redis.exists(`cache:tweet:${t.id}`)).toBe(0);
    });

    it('remembers missing users briefly, and forgets once they sign up', async () => {
      expect(
        (await app.inject({ method: 'GET', url: '/users/dave' })).statusCode,
      ).toBe(404);
      expect(await redis.get('cache:uname:dave')).toBe('null');

      await signup(app, 'dave');

      expect(
        (await app.inject({ method: 'GET', url: '/users/dave' })).statusCode,
      ).toBe(200);
    });
  });
});

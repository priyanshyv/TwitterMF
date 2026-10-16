import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { ENV } from '../src/config/config.module.js';
import { loadEnv } from '../src/config/env.js';
import { CountersService } from '../src/counters/counters.service.js';
import { REDIS } from '../src/redis/redis.module.js';
import { createTestApp, resetData, settle, signup } from './helpers.js';

// FANOUT_MAX_FOLLOWERS = 2 here, so an account with 2 followers already
// counts as a "celebrity" and the hybrid path can be tested cheaply.
describe('home timeline: fan-out on write + hybrid', () => {
  let app: NestFastifyApplication;
  let redis: Redis;

  beforeAll(async () => {
    app = await createTestApp((b) =>
      b
        .overrideProvider(ENV)
        .useValue({ ...loadEnv(), FANOUT_MAX_FOLLOWERS: 2 }),
    );
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
  const tweet = async (cookie: string, text: string) =>
    (await as(cookie).post('/tweets', { text })).json<{ id: string }>();
  const texts = async (cookie: string) =>
    (await as(cookie).get('/timeline'))
      .json()
      .items.map((i: { tweet: { text: string } }) => i.tweet.text);
  const list = (userId: string) => redis.lrange(`timeline:${userId}`, 0, -1);

  it('builds a cold timeline from Postgres once, then keeps it in Redis', async () => {
    const alice = await signup(app, 'alice');
    await tweet(alice.cookie, 'first');
    expect(await redis.exists(`timeline:${alice.user.id}`)).toBe(0);

    expect(await texts(alice.cookie)).toEqual(['first']);

    // The list now exists, ending with the "built" marker, and expires
    // after a week of not being read.
    expect((await list(alice.user.id)).at(-1)).toBe('0');
    expect(await redis.ttl(`timeline:${alice.user.id}`)).toBeGreaterThan(
      6 * 24 * 3600,
    );
  });

  it("pushes a new tweet into followers' timelines in the worker", async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    await as(bob.cookie).post('/users/alice/follow');
    await texts(bob.cookie); // warm bob's timeline

    const t = await tweet(alice.cookie, 'hello followers');
    await settle(app);

    expect(await list(bob.user.id)).toContain(t.id);
    expect(await texts(bob.cookie)).toEqual(['hello followers']);
  });

  it('shows your own tweet at once, before the worker runs', async () => {
    const alice = await signup(app, 'alice');
    await texts(alice.cookie); // warm
    await tweet(alice.cookie, 'mine');
    // no settle(): read-your-writes comes from the synchronous push
    expect(await texts(alice.cookie)).toEqual(['mine']);
  });

  it('skips fan-out for big accounts and merges their tweets at read time', async () => {
    const celeb = await signup(app, 'celeb');
    const bob = await signup(app, 'bob');
    const carol = await signup(app, 'carol');
    await as(bob.cookie).post('/users/celeb/follow');
    await as(carol.cookie).post('/users/celeb/follow');
    await app.get(CountersService).flush(); // follower_count = 2: a celebrity now
    await texts(bob.cookie); // warm

    const t = await tweet(celeb.cookie, 'to millions');
    await settle(app);

    expect(await list(bob.user.id)).not.toContain(t.id); // not pushed…
    expect(await texts(bob.cookie)).toEqual(['to millions']); // …but still shown
  });

  it('rebuilds the timeline after a follow or unfollow', async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    await tweet(alice.cookie, 'old alice tweet');
    await texts(bob.cookie); // warm, without alice

    await as(bob.cookie).post('/users/alice/follow');
    expect(await texts(bob.cookie)).toEqual(['old alice tweet']);

    await as(bob.cookie).del('/users/alice/follow');
    expect(await texts(bob.cookie)).toEqual([]);
  });

  it('fans out retweets, credited to the retweeter', async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    const carol = await signup(app, 'carol');
    await as(carol.cookie).post('/users/bob/follow');
    const t = await tweet(alice.cookie, 'retweet me');
    await texts(carol.cookie); // warm

    await as(bob.cookie).post(`/tweets/${t.id}/retweet`);
    await settle(app);

    const [item] = (await as(carol.cookie).get('/timeline')).json().items;
    expect(item).toMatchObject({
      retweetedBy: { username: 'bob' },
      tweet: { id: t.id, text: 'retweet me' },
    });
  });

  it('shows a duplicated ID only once (jobs can run twice)', async () => {
    const alice = await signup(app, 'alice');
    const t = await tweet(alice.cookie, 'once');
    await texts(alice.cookie);
    await redis.lpush(`timeline:${alice.user.id}`, t.id, t.id);
    expect(await texts(alice.cookie)).toEqual(['once']);
  });
});

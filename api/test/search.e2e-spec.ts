import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { SearchProcessor } from '../src/search/search.processor.js';
import { SearchService } from '../src/search/search.service.js';
import { TrendsService } from '../src/search/trends.service.js';
import { createTestApp, resetData, settle, signup } from './helpers.js';

// Real Meilisearch (indexes prefixed test_). Breaker resets after 300 ms here.
describe('search', () => {
  let app: NestFastifyApplication;
  let alice: Awaited<ReturnType<typeof signup>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetData(app);
    alice = await signup(app, 'alice');
  });
  afterAll(async () => {
    await app.close();
  });

  const post = (text: string, cookie = alice.cookie) =>
    app.inject({
      method: 'POST',
      url: '/tweets',
      payload: { text },
      headers: { cookie },
    });
  const search = async (q: string, type = 'tweets') =>
    (
      await app.inject({
        method: 'GET',
        url: `/search?q=${encodeURIComponent(q)}&type=${type}`,
      })
    ).json();
  const texts = (res: { tweets: { tweet: { text: string } }[] }) =>
    res.tweets.map((i) => i.tweet.text);

  it('finds a new tweet once the worker has indexed it, typos included', async () => {
    await post('Learning about circuit breakers today');
    await post('Something unrelated');
    await settle(app); // outbox -> queue -> worker -> Meilisearch

    const res = await search('circut breakr'); // two typos
    expect(res.source).toBe('meilisearch');
    expect(texts(res)).toEqual(['Learning about circuit breakers today']);
  });

  it('searches hashtags exactly, newest first', async () => {
    await post('first #Postgres post');
    await post('a #postgresql post');
    await post('second #postgres post');
    await settle(app);
    expect(texts(await search('#postgres'))).toEqual([
      'second #postgres post',
      'first #Postgres post',
    ]);
  });

  it("doesn't index retweets as separate results", async () => {
    const bob = await signup(app, 'bob');
    const t = (await post('worth retweeting')).json();
    await app.inject({
      method: 'POST',
      url: `/tweets/${t.id}/retweet`,
      headers: { cookie: bob.cookie },
    });
    await settle(app);
    expect(texts(await search('retweeting'))).toEqual(['worth retweeting']);
  });

  it('finds people by partial name and says who you follow', async () => {
    await signup(app, 'carol_codes');
    await app.inject({
      method: 'POST',
      url: '/users/carol_codes/follow',
      headers: { cookie: alice.cookie },
    });
    await settle(app);
    const res = (
      await app.inject({
        method: 'GET',
        url: '/search?q=carol&type=users',
        headers: { cookie: alice.cookie },
      })
    ).json();
    expect(res.users).toMatchObject([
      { username: 'carol_codes', viewer: { follows: true } },
    ]);
  });

  describe('circuit breaker', () => {
    // Make Meilisearch "go down" without stopping the container: every call
    // through its client fails while `down` is true.
    let down = false;
    beforeEach(() => {
      const client = (
        app.get(SearchService) as unknown as {
          client: { index: (uid: string) => unknown };
        }
      ).client;
      const realIndex = client.index.bind(client);
      client.index = (uid: string) => {
        const index = realIndex(uid) as {
          search: (...a: unknown[]) => Promise<unknown>;
        };
        const realSearch = index.search.bind(index);
        index.search = (...args: unknown[]) =>
          down
            ? Promise.reject(new Error('connect ECONNREFUSED'))
            : realSearch(...args);
        return index;
      };
    });
    afterEach(() => {
      down = false;
    });
    const breaker = async () =>
      (await app.inject({ method: 'GET', url: '/health' })).json().breakers
        .search;

    it('falls back to Postgres, opens, fails fast, then recovers', async () => {
      await post('resilient search');
      await settle(app);
      down = true;

      // Failing calls still get answers, from Postgres.
      for (let i = 0; i < 5; i++) {
        const res = await search('resilient');
        expect(res.source).toBe('postgres');
        expect(texts(res)).toEqual(['resilient search']);
      }
      // 5 of 5 failed: the breaker is open, and calls skip Meilisearch entirely.
      expect(await breaker()).toBe('open');
      const t = performance.now();
      expect((await search('resilient')).source).toBe('postgres');
      expect(performance.now() - t).toBeLessThan(200);

      // Meilisearch is back. After the reset timeout one trial call goes
      // through (half-open); it succeeds, so the breaker closes.
      down = false;
      await new Promise((r) => setTimeout(r, 400));
      expect(await breaker()).toBe('half-open');
      expect((await search('resilient')).source).toBe('meilisearch');
      expect(await breaker()).toBe('closed');
    });

    it('stays open if the trial call fails', async () => {
      down = true;
      for (let i = 0; i < 5; i++) await search('anything');
      expect(await breaker()).toBe('open');
      await new Promise((r) => setTimeout(r, 400));
      await search('anything'); // trial call, still down
      expect(await breaker()).toBe('open');
      down = false;
      await new Promise((r) => setTimeout(r, 400));
      await search('anything');
      expect(await breaker()).toBe('closed');
    });
  });

  describe('trending', () => {
    it('ranks hashtags by recent use', async () => {
      await post('#coffee first');
      await post('#coffee again');
      await post('#tea once');
      await settle(app);
      const { trends } = (
        await app.inject({ method: 'GET', url: '/trends' })
      ).json();
      expect(trends.slice(0, 2)).toMatchObject([
        { tag: 'coffee', posts: 2 },
        { tag: 'tea', posts: 1 },
      ]);
    });

    it('lets recent uses outweigh older ones (time decay)', async () => {
      const trends = app.get(TrendsService);
      const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
      // 3 uses 18 h ago (weight 0.125 each) vs 1 use now (weight 1).
      await trends.record('1', '#yesterday', hoursAgo(18));
      await trends.record('2', '#yesterday', hoursAgo(18));
      await trends.record('3', '#yesterday', hoursAgo(18));
      await trends.record('4', '#now', hoursAgo(0));
      const top = await trends.top();
      expect(top.map((t) => t.tag)).toEqual(['now', 'yesterday']);
      expect(top[1]).toMatchObject({ posts: 3, score: 0.38 });
    });

    it('counts a tweet once even if its job runs twice', async () => {
      const t = (await post('#once')).json();
      await settle(app);
      await app.get(SearchProcessor).process({ kind: 'trend', tweetId: t.id }); // a repeat
      const { trends } = (
        await app.inject({ method: 'GET', url: '/trends' })
      ).json();
      expect(trends.find((x: { tag: string }) => x.tag === 'once').posts).toBe(
        1,
      );
    });
  });
});

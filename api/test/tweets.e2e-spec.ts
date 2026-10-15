import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, resetData, signup } from './helpers.js';

describe('tweets, follows and the home timeline', () => {
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

  const as = (cookie: string) => ({
    get: (url: string) =>
      app.inject({ method: 'GET', url, headers: { cookie } }),
    post: (url: string, payload?: object) =>
      app.inject({ method: 'POST', url, payload, headers: { cookie } }),
    del: (url: string) =>
      app.inject({ method: 'DELETE', url, headers: { cookie } }),
  });

  const tweet = async (cookie: string, text: string) => {
    const res = await as(cookie).post('/tweets', { text });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string; text: string }>();
  };

  describe('posting', () => {
    it('creates a tweet with its author and a string ID', async () => {
      const alice = await signup(app, 'alice');
      const t = await tweet(alice.cookie, '  hello world  ');
      expect(t).toMatchObject({
        id: expect.stringMatching(/^\d+$/),
        text: 'hello world',
        author: { username: 'alice', displayName: 'ALICE' },
      });
    });

    it('counts emoji as one character each', async () => {
      const alice = await signup(app, 'alice');
      const ok = await as(alice.cookie).post('/tweets', {
        text: '🐦'.repeat(280),
      });
      const tooLong = await as(alice.cookie).post('/tweets', {
        text: '🐦'.repeat(281),
      });
      expect(ok.statusCode).toBe(201);
      expect(tooLong.statusCode).toBe(400);
    });

    it('rejects empty tweets and anonymous posting', async () => {
      const alice = await signup(app, 'alice');
      expect(
        (await as(alice.cookie).post('/tweets', { text: '   ' })).statusCode,
      ).toBe(400);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/tweets',
            payload: { text: 'hi' },
          })
        ).statusCode,
      ).toBe(401);
    });
  });

  describe('following', () => {
    it('follows and unfollows, and shows it on the profile', async () => {
      const alice = await signup(app, 'alice');
      await signup(app, 'bob');

      expect(
        (await as(alice.cookie).post('/users/bob/follow')).statusCode,
      ).toBe(204);
      // Following twice is harmless.
      expect(
        (await as(alice.cookie).post('/users/bob/follow')).statusCode,
      ).toBe(204);

      const profile = (await as(alice.cookie).get('/users/bob')).json();
      expect(profile.stats).toEqual({ followers: 1, following: 0, tweets: 0 });
      expect(profile.viewer).toEqual({ isMe: false, follows: true });

      await as(alice.cookie).del('/users/bob/follow');
      const after = (await as(alice.cookie).get('/users/bob')).json();
      expect(after.stats.followers).toBe(0);
      expect(after.viewer.follows).toBe(false);
    });

    it("doesn't allow following yourself or unknown users", async () => {
      const alice = await signup(app, 'alice');
      expect(
        (await as(alice.cookie).post('/users/alice/follow')).statusCode,
      ).toBe(400);
      expect(
        (await as(alice.cookie).post('/users/nobody/follow')).statusCode,
      ).toBe(404);
    });

    it('shows profiles to logged-out visitors, without viewer info', async () => {
      await signup(app, 'bob');
      const res = await app.inject({ method: 'GET', url: '/users/BOB' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        user: { username: 'bob' },
        viewer: null,
      });
    });

    it('suggests accounts you do not follow yet', async () => {
      const alice = await signup(app, 'alice');
      await signup(app, 'bob');
      await signup(app, 'carol');
      await as(alice.cookie).post('/users/bob/follow');

      const names = (await as(alice.cookie).get('/users/suggestions'))
        .json()
        .map((u: { username: string }) => u.username);
      expect(names).toEqual(['carol']);
    });
  });

  describe('home timeline', () => {
    it('shows my tweets and those of people I follow, newest first', async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      const carol = await signup(app, 'carol');
      await as(alice.cookie).post('/users/bob/follow');

      await tweet(bob.cookie, 'bob 1');
      await tweet(carol.cookie, 'carol (not followed)');
      await tweet(alice.cookie, 'alice 1');
      await tweet(bob.cookie, 'bob 2');

      const page = (await as(alice.cookie).get('/timeline')).json();
      expect(
        page.items.map((t: { tweet: { text: string } }) => t.tweet.text),
      ).toEqual(['bob 2', 'alice 1', 'bob 1']);
      expect(page.nextCursor).toBeNull();
    });

    it('pages through with a cursor, with no gaps or repeats', async () => {
      const alice = await signup(app, 'alice');
      const bob = await signup(app, 'bob');
      await as(alice.cookie).post('/users/bob/follow');
      for (let i = 1; i <= 7; i++)
        await tweet(i % 2 ? bob.cookie : alice.cookie, `t${i}`);

      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const url: string = `/timeline?limit=3${cursor ? `&before=${cursor}` : ''}`;
        const page = (await as(alice.cookie).get(url)).json();
        seen.push(
          ...page.items.map((t: { tweet: { text: string } }) => t.tweet.text),
        );
        cursor = page.nextCursor;
        pages++;
      } while (cursor);

      expect(seen).toEqual(['t7', 't6', 't5', 't4', 't3', 't2', 't1']);
      expect(pages).toBe(3);
    });

    it('is only for logged-in users', async () => {
      expect(
        (await app.inject({ method: 'GET', url: '/timeline' })).statusCode,
      ).toBe(401);
    });
  });

  describe('profile tweets', () => {
    it("lists one user's tweets with the same cursor paging", async () => {
      const bob = await signup(app, 'bob');
      for (let i = 1; i <= 3; i++) await tweet(bob.cookie, `b${i}`);

      const first = (
        await app.inject({ method: 'GET', url: '/users/bob/tweets?limit=2' })
      ).json();
      expect(
        first.items.map((t: { tweet: { text: string } }) => t.tweet.text),
      ).toEqual(['b3', 'b2']);
      const second = (
        await app.inject({
          method: 'GET',
          url: `/users/bob/tweets?limit=2&before=${first.nextCursor}`,
        })
      ).json();
      expect(
        second.items.map((t: { tweet: { text: string } }) => t.tweet.text),
      ).toEqual(['b1']);
      expect(second.nextCursor).toBeNull();
    });

    it('rejects a malformed cursor', async () => {
      await signup(app, 'bob');
      const res = await app.inject({
        method: 'GET',
        url: '/users/bob/tweets?before=abc',
      });
      expect(res.statusCode).toBe(400);
    });
  });

  it('blocks reserved usernames at sign-up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/signup',
      payload: {
        username: 'Suggestions',
        displayName: 'x',
        password: 'password123',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, resetData, settle, signup } from './helpers.js';

describe('notifications', () => {
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
  const tweet = async (cookie: string, text: string, replyToId?: string) =>
    (await as(cookie).post('/tweets', { text, replyToId })).json<{
      id: string;
    }>();
  const inbox = async (cookie: string) => {
    await settle(app);
    return (await as(cookie).get('/notifications')).json().items as {
      type: string;
      read: boolean;
      actor: { username: string };
      tweet: { id: string; text: string } | null;
    }[];
  };
  const unread = async (cookie: string) =>
    (await as(cookie).get('/notifications/unread-count')).json().unread;

  it('notifies about likes, once, and never about your own', async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    const t = await tweet(alice.cookie, 'like this');

    await as(bob.cookie).post(`/tweets/${t.id}/like`);
    await settle(app);
    await as(bob.cookie).del(`/tweets/${t.id}/like`);
    await as(bob.cookie).post(`/tweets/${t.id}/like`); // like again: no repeat
    await as(alice.cookie).post(`/tweets/${t.id}/like`); // own like: none

    const items = await inbox(alice.cookie);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'like',
      read: false,
      actor: { username: 'bob' },
      tweet: { id: t.id, text: 'like this' },
    });
    expect(await unread(alice.cookie)).toBe(1);
  });

  it('notifies about follows, retweets and replies', async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    const t = await tweet(alice.cookie, 'original');

    await as(bob.cookie).post('/users/alice/follow');
    await as(bob.cookie).post(`/tweets/${t.id}/retweet`);
    const reply = await tweet(bob.cookie, 'nice one', t.id);

    const items = await inbox(alice.cookie);
    // The worker runs several jobs at once, so they may finish (and get
    // their time-sorted IDs) in any order: concurrent consumers don't keep
    // the order events happened in. Compare as a set.
    expect(items.map((n) => n.type).sort()).toEqual([
      'follow',
      'reply',
      'retweet',
    ]);
    expect(items.find((n) => n.type === 'reply')?.tweet).toMatchObject({
      id: reply.id,
      text: 'nice one',
    });
  });

  it('notifies everyone @mentioned, but not twice and not yourself', async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    const carol = await signup(app, 'carol');
    const t = await tweet(alice.cookie, 'hi');

    // Replying to alice AND mentioning her: one notification, a reply.
    await tweet(bob.cookie, '@alice @Carol @bob @nobody look', t.id);

    expect((await inbox(alice.cookie)).map((n) => n.type)).toEqual(['reply']);
    expect((await inbox(carol.cookie)).map((n) => n.type)).toEqual(['mention']);
    expect(await inbox(bob.cookie)).toEqual([]);
  });

  it('marks everything read', async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    await as(bob.cookie).post('/users/alice/follow');
    await settle(app);
    expect(await unread(alice.cookie)).toBe(1);

    expect(
      (await as(alice.cookie).post('/notifications/read')).statusCode,
    ).toBe(204);
    expect(await unread(alice.cookie)).toBe(0);
    expect((await inbox(alice.cookie))[0].read).toBe(true);
  });
});

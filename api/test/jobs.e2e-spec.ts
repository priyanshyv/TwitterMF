import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import { listDeadLetters, replayDeadLetters } from '../src/jobs/dead-letter.js';
import { QUEUES, type Queues } from '../src/jobs/jobs.module.js';
import { REDIS } from '../src/redis/redis.module.js';
import { TimelineService } from '../src/timeline/timeline.service.js';
import { createTestApp, resetData, settle, signup } from './helpers.js';

describe('background jobs: retries and the dead-letter queue', () => {
  let app: NestFastifyApplication;
  let timeline: TimelineService;
  let realPush: TimelineService['push'];

  beforeAll(async () => {
    app = await createTestApp();
    timeline = app.get(TimelineService);
    realPush = timeline.push.bind(timeline);
  });
  beforeEach(async () => {
    await resetData(app);
    await app.get<Queues>(QUEUES).deadLetter.obliterate({ force: true });
  });
  afterEach(() => {
    timeline.push = realPush;
  });
  afterAll(async () => {
    await app.close();
  });

  // Alice follows bob with a warm timeline; returns a function that makes
  // bob post, so the fan-out job targets alice.
  async function setup() {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    await app.inject({
      method: 'POST',
      url: '/users/bob/follow',
      headers: { cookie: alice.cookie },
    });
    await app.inject({
      method: 'GET',
      url: '/timeline',
      headers: { cookie: alice.cookie },
    });
    const post = async () =>
      (
        await app.inject({
          method: 'POST',
          url: '/tweets',
          payload: { text: 'hi' },
          headers: { cookie: bob.cookie },
        })
      ).json<{ id: string }>();
    return { alice, post };
  }
  const inTimeline = async (userId: string, tweetId: string) =>
    (await app.get<Redis>(REDIS).lrange(`timeline:${userId}`, 0, -1)).includes(
      tweetId,
    );

  it('retries a failing job with backoff until it succeeds', async () => {
    const { alice, post } = await setup();
    let calls = 0;
    // Fail the fan-out twice (not the author's own synchronous push).
    timeline.push = async (ids, id) => {
      if (ids.length > 1 || ids[0] === alice.user.id) {
        calls++;
        if (calls <= 2) throw new Error('Redis blip');
      }
      return realPush(ids, id);
    };

    const t = await post();
    await settle(app);

    expect(calls).toBe(3); // 2 failures + 1 success
    expect(await inTimeline(alice.user.id, t.id)).toBe(true);
    expect(await listDeadLetters(app.get(QUEUES))).toEqual([]);
  });

  it('dead-letters a job after 5 failed attempts, and replays it', async () => {
    const { alice, post } = await setup();
    timeline.push = async (ids, id) => {
      if (ids.includes(alice.user.id))
        throw new Error('timeline store is down');
      return realPush(ids, id);
    };

    const t = await post();
    await settle(app);
    const queues = app.get<Queues>(QUEUES);
    let dead = await listDeadLetters(queues);
    for (let i = 0; i < 50 && dead.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      dead = await listDeadLetters(queues);
    }

    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({
      queue: 'fanout',
      name: 'tweet',
      attemptsMade: 5,
      failedReason: 'timeline store is down',
      data: { tweetId: t.id },
    });
    expect(await inTimeline(alice.user.id, t.id)).toBe(false);

    // The cause is fixed: replay.
    timeline.push = realPush;
    expect(await replayDeadLetters(queues)).toBe(1);
    await settle(app);
    expect(await inTimeline(alice.user.id, t.id)).toBe(true);
    expect(await listDeadLetters(queues)).toEqual([]);
  });
});

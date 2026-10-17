import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Redis } from 'ioredis';
import type { Pool } from 'pg';
import { DB, PG_POOL, type Database } from '../src/db/db.module.js';
import { OutboxService, QUEUES, type Queues } from '../src/jobs/jobs.module.js';
import { OutboxRelay } from '../src/jobs/outbox.relay.js';
import { message } from '../src/jobs/queues.js';
import { REDIS } from '../src/redis/redis.module.js';
import { createTestApp, resetData, settle, signup } from './helpers.js';

describe('transactional outbox', () => {
  let app: NestFastifyApplication;
  let relay: OutboxRelay;

  beforeAll(async () => {
    app = await createTestApp();
    relay = app.get(OutboxRelay);
  });
  beforeEach(async () => {
    await resetData(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('writes no job when the transaction rolls back', async () => {
    const db = app.get<Database>(DB);
    await expect(
      db.transaction(async (tx) => {
        await app.get(OutboxService).add(tx, [message.fanout(1n, 1n)]);
        throw new Error('the tweet insert failed');
      }),
    ).rejects.toThrow('the tweet insert failed');
    expect(await relay.pending()).toBe(0);
  });

  it('keeps jobs while Redis is unreachable, and delivers them after', async () => {
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
    await settle(app);

    const fanout = app.get<Queues>(QUEUES).fanout;
    const realAddBulk = fanout.addBulk.bind(fanout);
    fanout.addBulk = () => Promise.reject(new Error('ECONNREFUSED')) as never;
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/tweets',
        payload: { text: 'posted during an outage' },
        headers: { cookie: bob.cookie },
      });
      expect(res.statusCode).toBe(201); // posting still works
      await relay.drain();
      expect(await relay.pending()).toBeGreaterThan(0); // waiting safely in Postgres
    } finally {
      fanout.addBulk = realAddBulk;
    }

    await settle(app); // Redis is "back": the relay delivers
    const list = await app
      .get<Redis>(REDIS)
      .lrange(`timeline:${alice.user.id}`, 0, -1);
    const [item] = (
      await app.inject({
        method: 'GET',
        url: '/timeline',
        headers: { cookie: alice.cookie },
      })
    ).json().items;
    expect(item.tweet.text).toBe('posted during an outage');
    expect(list).toContain(item.id);
  });

  it('wakes the relay with LISTEN/NOTIFY, not just the 1 s poll', async () => {
    const alice = await signup(app, 'alice');
    await settle(app);
    const started = Date.now();
    await app.inject({
      method: 'POST',
      url: '/tweets',
      payload: { text: 'how fast?' },
      headers: { cookie: alice.cookie },
    });
    while ((await relay.pending()) > 0 && Date.now() - started < 3_000)
      await new Promise((r) => setTimeout(r, 5));
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe('outbox relays running side by side', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // No workers here: only the two relays below touch the outbox.
    app = await createTestApp(undefined, { workers: false });
  });
  afterAll(async () => {
    await app.close();
  });

  it('relays every row exactly once (FOR UPDATE SKIP LOCKED)', async () => {
    await resetData(app);
    const db = app.get<Database>(DB);
    await app.get(OutboxService).add(
      db,
      Array.from({ length: 250 }, (_, i) => message.fanout(BigInt(i + 1), 1n)),
    );

    // Two independent relays, each recording what it would enqueue.
    const seen: string[][] = [[], []];
    const relays = seen.map((record) => {
      const queues = {
        fanout: {
          addBulk: async (jobs: { opts: { jobId: string } }[]) => {
            await new Promise((r) => setTimeout(r, 5)); // overlap the transactions
            record.push(...jobs.map((j) => j.opts.jobId));
          },
        },
      } as unknown as Queues;
      return new OutboxRelay(app.get<Pool>(PG_POOL), db, queues);
    });
    await Promise.all(relays.map((r) => r.drain()));

    const all = [...seen[0], ...seen[1]];
    expect(all).toHaveLength(250);
    expect(new Set(all).size).toBe(250); // nothing relayed twice
    expect(seen[0].length).toBeGreaterThan(0); // and both did real work
    expect(seen[1].length).toBeGreaterThan(0);
    expect(await relays[0].pending()).toBe(0);
  });
});

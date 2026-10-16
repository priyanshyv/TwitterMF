// Fan-out lab: reading a precomputed timeline vs building it per request.
// Run from the repo root:  npm run lab:fanout   (needs seeded data: npm run db:seed)
// Read-only: it times the two paths for the user who follows the most people.
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { sql } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Database } from '../src/db/db.module.js';
import { REDIS } from '../src/redis/redis.module.js';
import { TimelineService } from '../src/timeline/timeline.service.js';

const READS = 300;
const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error'],
});
const db = app.get<Database>(DB);
const timeline = app.get(TimelineService);

const { rows } = await db.execute<{
  id: string;
  username: string;
  following: number;
}>(sql`
  select u.id, u.username, count(*)::int as following
  from follows f join users u on u.id = f.follower_id
  group by u.id order by following desc limit 1`);
if (!rows.length) {
  console.log('No follows found. Run npm run db:seed first.');
  process.exit(1);
}
const user = rows[0];
const userId = BigInt(user.id);

// The Phase 2 query, built per request (what every page load used to do).
const onRead = () =>
  db.execute(sql`
    with sources as (
      select followee_id as author_id from follows where follower_id = ${userId}
      union all select ${userId}::bigint
    )
    select t.id from sources s
    cross join lateral (
      select id from tweets where author_id = s.author_id order by id desc limit 21
    ) t order by t.id desc limit 21`);
const onWrite = () => timeline.page(userId, undefined, 20);
// The list alone, for comparison: what a read costs when you follow no
// celebrities (the celebrity set is emptied for this row).
const redis = app.get(REDIS);
const listOnly = () => redis.lrange(`timeline:${userId}`, 0, 30);

// Many readers at once: the SQL path queues for one of the 10 pooled
// Postgres connections; the list read doesn't touch Postgres at all.
async function throughput(
  fn: () => Promise<unknown>,
  concurrency = 100,
  rounds = 10,
) {
  const t = performance.now();
  for (let r = 0; r < rounds; r++)
    await Promise.all(Array.from({ length: concurrency }, fn));
  const seconds = (performance.now() - t) / 1000;
  return {
    'reads/s at 100 concurrent': Math.round(
      (concurrency * rounds) / seconds,
    ).toLocaleString('en'),
  };
}

async function time(fn: () => Promise<unknown>) {
  await fn(); // warm up (and build the Redis list on first use)
  const samples: number[] = [];
  for (let i = 0; i < READS; i++) {
    const t = performance.now();
    await fn();
    samples.push(performance.now() - t);
  }
  samples.sort((a, b) => a - b);
  const p = (q: number) =>
    samples[Math.floor(q * (samples.length - 1))].toFixed(2);
  return { 'p50 (ms)': p(0.5), 'p95 (ms)': p(0.95), 'p99 (ms)': p(0.99) };
}

console.log(
  `@${user.username} follows ${user.following} accounts. ${READS} reads of the first page each:\n`,
);
console.table([
  {
    path: 'fan-out on read (SQL per request)',
    ...(await time(onRead)),
    ...(await throughput(onRead)),
  },
  {
    path: 'fan-out on write (list + celebrity merge)',
    ...(await time(onWrite)),
    ...(await throughput(onWrite)),
  },
  {
    path: 'fan-out on write (list only, no celebrities)',
    ...(await time(listOnly)),
    ...(await throughput(listOnly)),
  },
]);
console.log(
  '\nOne request at a time, all three are well under a millisecond on this small' +
    '\ndataset. The difference is where the work lands: the SQL path puts every read' +
    '\non Postgres (10 pooled connections, hard to scale) and grows with how many' +
    '\naccounts you follow; the list read costs the same for 30 or 3,000 follows and' +
    '\nnever touches Postgres. The celebrity merge is the price of the hybrid.',
);
await app.close();

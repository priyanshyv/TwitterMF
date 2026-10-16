import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB, type Database } from '../db/db.module.js';
import { REDIS } from '../redis/redis.module.js';

// Home timelines, "fan-out on write" with a hybrid for big accounts.
//
// Phase 2 built each timeline when it was read (fan-out on read): cheap to
// post, but every page load merges the tweets of everyone you follow.
// Timelines are read far more often than tweets are written, so now each
// active user has a precomputed list of tweet IDs in Redis:
//
//   timeline:<userId>   newest first, at most 800 IDs, expires after 7 idle days
//
// Posting pushes the new ID into every follower's list (in the worker). A
// read is then one LRANGE. But an account with 5 million followers would
// mean 5 million pushes per tweet, so authors above FANOUT_MAX_FOLLOWERS
// are skipped and merged in at read time instead: the hybrid.

const MAX_ENTRIES = 800;
const IDLE_TTL_SECONDS = 7 * 24 * 60 * 60;
// Which big accounts you follow is stored next to the list, so reads don't
// rediscover it with a join every time. Refreshed hourly, so an account
// that crosses the threshold is picked up without waiting a week.
const CELEBS_TTL_SECONDS = 60 * 60;
// Redis can't store an empty list or set (it deletes the key), so built
// ones always contain this marker. "0" is never a real ID.
const SENTINEL = '0';

export const timelineKey = (userId: string) => `timeline:${userId}`;
const celebsKey = (userId: string) => `timeline:${userId}:celebs`;

@Injectable()
export class TimelineService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // IDs for one page of the home timeline, newest first, plus one extra to
  // signal that there is a next page.
  async page(userId: bigint, before: bigint | undefined, limit: number) {
    const need = limit + 1;
    let window = await this.window(userId, before, need);
    if (window.cold) {
      await this.build(userId);
      window = await this.window(userId, before, need);
    }
    const celebs = window.celebs ?? (await this.storeCelebrities(userId));

    // Past the end of a full list: older tweets aren't precomputed, so fall
    // back to the fan-out-on-read query. Twitter keeps ~800 per user too.
    if (
      window.exhausted &&
      window.listLength >= MAX_ENTRIES &&
      window.ids.length < need
    )
      return this.fromDatabase(userId, before, need, 'all');

    // Nobody big followed: the page is just the list, no Postgres at all.
    const celebrityTweets = celebs.length
      ? await this.byAuthors(celebs, before, need)
      : [];
    // A job can run twice (queues deliver at least once), so the same ID
    // may be in the list twice: a Set merges duplicates away.
    const merged = new Set([...window.ids, ...celebrityTweets]);
    return [...merged]
      .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
      .slice(0, need);
  }

  // Called by the fan-out worker: add a tweet to these users' timelines.
  // LPUSHX only touches lists that exist: a cold (expired or never built)
  // timeline is rebuilt from Postgres on its next read, tweet included.
  async push(userIds: string[], tweetId: string): Promise<void> {
    for (let i = 0; i < userIds.length; i += 1_000) {
      const pipeline = this.redis.pipeline();
      for (const id of userIds.slice(i, i + 1_000)) {
        pipeline.lpushx(timelineKey(id), tweetId);
        pipeline.ltrim(timelineKey(id), 0, MAX_ENTRIES - 1);
      }
      const results = (await pipeline.exec()) ?? [];
      const failed = results.find(([err]) => err);
      if (failed) throw failed[0]; // let the queue retry the job
    }
  }

  // Following or unfollowing someone changes which tweets belong in your
  // timeline. Instead of picking their tweets out of the list one by one,
  // drop it; the next read rebuilds it. Simple and correct, at the cost of
  // one rebuild query. (At Twitter's scale they filter at read time instead.)
  async invalidate(userId: bigint): Promise<void> {
    await this.redis.del(timelineKey(`${userId}`), celebsKey(`${userId}`));
  }

  isCelebrity(followerCount: number) {
    return followerCount >= this.env.FANOUT_MAX_FOLLOWERS;
  }

  // Rebuilds a timeline from Postgres (the Phase 2 query), without
  // celebrities, whose tweets are merged at read time anyway.
  private async build(userId: bigint): Promise<void> {
    const ids = await this.fromDatabase(
      userId,
      undefined,
      MAX_ENTRIES,
      'regular',
    );
    const key = timelineKey(userId.toString());
    await this.redis
      .multi()
      .del(key)
      .rpush(key, ...ids.map(String), SENTINEL)
      .expire(key, IDLE_TTL_SECONDS)
      .exec();
    await this.storeCelebrities(userId);
  }

  private async storeCelebrities(userId: bigint): Promise<bigint[]> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select f.followee_id as id
      from follows f join users u on u.id = f.followee_id
      where f.follower_id = ${userId}
        and u.follower_count >= ${this.env.FANOUT_MAX_FOLLOWERS}`);
    const key = celebsKey(userId.toString());
    await this.redis
      .multi()
      .del(key)
      .sadd(key, ...rows.map((r) => r.id), SENTINEL)
      .expire(key, CELEBS_TTL_SECONDS)
      .exec();
    return rows.map((r) => BigInt(r.id));
  }

  // Reads only as much of the list as the page needs. The list is newest
  // first, so page one is the first ~30 entries, not all 800 (parsing and
  // sorting 800 IDs per request is what limits throughput). Later pages scan
  // forward in chunks until they pass the cursor.
  private async window(
    userId: bigint,
    before: bigint | undefined,
    need: number,
  ) {
    const list = timelineKey(userId.toString());
    const celebs = celebsKey(userId.toString());
    // First chunk in one round trip with the celebrity set and a TTL refresh
    // (still in use: keep it another week).
    let size = need + 10; // a little slack for duplicates
    const first = await this.redis
      .multi()
      .lrange(list, 0, size - 1)
      .smembers(celebs)
      .expire(list, IDLE_TTL_SECONDS)
      .exec();
    let chunk = (first?.[0]?.[1] ?? []) as string[];
    const stars = (first?.[1]?.[1] ?? []) as string[];
    const real = (xs: string[]) => xs.filter((x) => x !== SENTINEL).map(BigInt);

    const ids: bigint[] = [];
    let start = 0;
    let exhausted = false;
    for (;;) {
      for (const id of real(chunk))
        if (before === undefined || id < before) ids.push(id);
      if (chunk.length < size) {
        exhausted = true;
        break;
      }
      if (ids.length >= need) break;
      start += size;
      size = 200;
      chunk = await this.redis.lrange(list, start, start + size - 1);
    }
    return {
      cold: start === 0 && chunk.length === 0, // no list at all: build it
      ids,
      exhausted,
      listLength: start + chunk.length,
      celebs: stars.length ? real(stars) : null, // null: expired, recompute
    };
  }

  // Newest tweets by a known set of authors: one index lookup per author.
  private async byAuthors(
    authorIds: bigint[],
    before: bigint | undefined,
    limit: number,
  ) {
    const authors = sql.join(
      authorIds.map((id) => sql`(${id}::bigint)`),
      sql`, `,
    );
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select t.id
      from (values ${authors}) as a(author_id)
      cross join lateral (
        select id from tweets
        where author_id = a.author_id
          ${before === undefined ? sql`` : sql`and id < ${before}`}
        order by id desc
        limit ${limit}
      ) t
      order by t.id desc
      limit ${limit}`);
    return rows.map((r) => BigInt(r.id));
  }

  // Tweet IDs from the people `userId` follows (and their own), newest first.
  //   all       everyone: the plain fan-out-on-read timeline
  //   regular   only authors below the celebrity threshold (+ yourself)
  private async fromDatabase(
    userId: bigint,
    before: bigint | undefined,
    limit: number,
    who: 'all' | 'regular',
  ): Promise<bigint[]> {
    const tier =
      who === 'all'
        ? sql`true`
        : sql`u.follower_count < ${this.env.FANOUT_MAX_FOLLOWERS}`;
    const { rows } = await this.db.execute<{ id: string }>(sql`
      with sources as (
        select f.followee_id as author_id
        from follows f join users u on u.id = f.followee_id
        where f.follower_id = ${userId} and ${tier}
        union select ${userId}::bigint
      )
      select t.id
      from sources s
      cross join lateral (
        select id from tweets
        where author_id = s.author_id
          ${before === undefined ? sql`` : sql`and id < ${before}`}
        order by id desc
        limit ${limit}
      ) t
      order by t.id desc
      limit ${limit}`);
    return rows.map((r) => BigInt(r.id));
  }
}

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
// Redis can't store an empty list (it deletes the key), so a built
// timeline always ends with this marker. "0" is never a real tweet ID.
const SENTINEL = '0';

export const timelineKey = (userId: string) => `timeline:${userId}`;

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
    const key = timelineKey(userId.toString());
    let cached = await this.read(key);
    if (cached === null) {
      await this.build(userId);
      cached = (await this.read(key)) ?? [];
    }

    // Past the end of a full list: older tweets aren't precomputed, so fall
    // back to the fan-out-on-read query. Twitter keeps ~800 per user too.
    const full = cached.length >= MAX_ENTRIES;
    const oldest = cached.at(-1);
    if (
      full &&
      oldest !== undefined &&
      before !== undefined &&
      before <= oldest
    )
      return this.fromDatabase(userId, before, limit + 1, 'all');

    const celebrities = await this.fromDatabase(
      userId,
      before,
      limit + 1,
      'celebrities',
    );
    // A job can run twice (queues deliver at least once), so the same ID
    // may be in the list twice: a Set merges duplicates away.
    const merged = new Set([
      ...cached.filter((id) => before === undefined || id < before),
      ...celebrities,
    ]);
    return [...merged]
      .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))
      .slice(0, limit + 1);
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
    await this.redis.del(timelineKey(userId.toString()));
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
  }

  private async read(key: string): Promise<bigint[] | null> {
    const results = await this.redis
      .multi()
      .lrange(key, 0, MAX_ENTRIES)
      .expire(key, IDLE_TTL_SECONDS) // still in use: keep it another week
      .exec();
    const ids = (results?.[0]?.[1] ?? []) as string[];
    if (ids.length === 0) return null; // no list: cold
    return ids.filter((id) => id !== SENTINEL).map(BigInt);
  }

  // Tweet IDs from the people `userId` follows (and their own), newest first.
  //   all          everyone: the plain fan-out-on-read timeline
  //   regular      only authors below the celebrity threshold (+ yourself)
  //   celebrities  only authors at or above it
  private async fromDatabase(
    userId: bigint,
    before: bigint | undefined,
    limit: number,
    who: 'all' | 'regular' | 'celebrities',
  ): Promise<bigint[]> {
    const threshold = this.env.FANOUT_MAX_FOLLOWERS;
    const tier =
      who === 'all'
        ? sql`true`
        : who === 'regular'
          ? sql`u.follower_count < ${threshold}`
          : sql`u.follower_count >= ${threshold}`;
    const self =
      who === 'celebrities' ? sql`` : sql`union select ${userId}::bigint`;
    const { rows } = await this.db.execute<{ id: string }>(sql`
      with sources as (
        select f.followee_id as author_id
        from follows f join users u on u.id = f.followee_id
        where f.follower_id = ${userId} and ${tier}
        ${self}
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

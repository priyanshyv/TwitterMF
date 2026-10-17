import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { extractHashtags } from '../common/hashtags.js';
import { DB, type Database } from '../db/db.module.js';
import { REDIS } from '../redis/redis.module.js';

// Trending hashtags with time decay.
//
// Counting "all-time uses" would keep #coffee on top forever; trending means
// "a lot, recently". Each hour gets its own sorted set (tag -> uses):
//
//   trends:h:<hour>   ZINCRBY'd once per tweet per tag, expires after 48 h
//
// To rank, the last 24 hours are added up with weights that halve every
// 6 hours (exponential decay): a use 6 h ago counts 0.5, 12 h ago 0.25.
// Redis does the weighted sum itself (ZUNIONSTORE … WEIGHTS), and the top
// 10 are cached for a minute, since everyone sees the same list.

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 24;
const HALF_LIFE_HOURS = 6;
const BUCKET_TTL_SECONDS = 48 * 60 * 60;
const CACHE_KEY = 'trends:top';
const CACHE_SECONDS = 60;

const bucketKey = (hour: number) => `trends:h:${hour}`;

// Weighted union for the score, plain union for the post count, top N.
// In Lua so it's one atomic round trip, and replies come back flat.
const TOP = `
local n = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
-- unpack() only spreads all values when it's the LAST argument of a call,
-- so build each command's arguments as a table first.
local weighted = {'ZUNIONSTORE', KEYS[n + 1], n}
local plain = {'ZUNIONSTORE', KEYS[n + 2], n}
for i = 1, n do
  table.insert(weighted, KEYS[i])
  table.insert(plain, KEYS[i])
end
table.insert(weighted, 'WEIGHTS')
for i = 1, n do table.insert(weighted, ARGV[2 + i]) end
redis.call(unpack(weighted))
redis.call(unpack(plain))
local top = redis.call('ZREVRANGE', KEYS[n + 1], 0, limit - 1, 'WITHSCORES')
local out = {}
for i = 1, #top, 2 do
  table.insert(out, top[i])
  table.insert(out, top[i + 1])
  table.insert(out, redis.call('ZSCORE', KEYS[n + 2], top[i]))
end
redis.call('DEL', KEYS[n + 1], KEYS[n + 2])
return out`;

export interface Trend {
  tag: string;
  posts: number; // uses in the last 24 h
  score: number; // decayed: recent uses count more
}

@Injectable()
export class TrendsService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(DB) private readonly db: Database,
  ) {}

  // Counts a tweet's hashtags toward trending. Jobs can run twice, so each
  // tweet is counted once only (the SET NX marker), or a retried job would
  // inflate its tags.
  async record(tweetId: string, text: string, at: Date): Promise<void> {
    const tags = extractHashtags(text);
    if (tags.length === 0) return;
    const first = await this.redis.set(
      `trends:seen:${tweetId}`,
      '1',
      'EX',
      BUCKET_TTL_SECONDS,
      'NX',
    );
    if (first !== 'OK') return;
    const key = bucketKey(Math.floor(at.getTime() / HOUR_MS));
    const pipeline = this.redis.pipeline();
    for (const tag of tags) pipeline.zincrby(key, 1, tag);
    pipeline.expire(key, BUCKET_TTL_SECONDS);
    await pipeline.exec();
  }

  async top(limit = 10): Promise<Trend[]> {
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) return (JSON.parse(cached) as Trend[]).slice(0, limit);

    const now = Math.floor(Date.now() / HOUR_MS);
    const hours = Array.from({ length: WINDOW_HOURS }, (_, age) => now - age);
    const weights = hours.map((_, age) => 0.5 ** (age / HALF_LIFE_HOURS));
    const tmp = `trends:tmp:${process.pid}:${Math.random().toString(36).slice(2)}`;
    const flat = (await this.redis.eval(
      TOP,
      hours.length + 2,
      ...hours.map(bucketKey),
      `${tmp}:w`,
      `${tmp}:n`,
      hours.length,
      20,
      ...weights,
    )) as string[];

    const trends: Trend[] = [];
    for (let i = 0; i < flat.length; i += 3)
      trends.push({
        tag: flat[i],
        score: Math.round(Number(flat[i + 1]) * 100) / 100,
        posts: Number(flat[i + 2]),
      });
    await this.redis.set(
      CACHE_KEY,
      JSON.stringify(trends),
      'EX',
      CACHE_SECONDS,
    );
    return trends.slice(0, limit);
  }

  // Rebuilds the last 48 h of buckets from Postgres: after seeding, or if
  // Redis lost them. (Redis only holds derived data; Postgres has the rest.)
  async rebuild(): Promise<number> {
    const { rows } = await this.db.execute<{
      id: string;
      text: string;
      at: string;
    }>(sql`
      select id, text, extract(epoch from created_at) * 1000 as at from tweets
      where retweet_of_id is null and created_at > now() - interval '48 hours'
        and text like '%#%'`);
    const buckets = new Map<number, Map<string, number>>();
    for (const row of rows) {
      const hour = Math.floor(Number(row.at) / HOUR_MS);
      const counts = buckets.get(hour) ?? new Map<string, number>();
      for (const tag of extractHashtags(row.text))
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      buckets.set(hour, counts);
    }
    const pipeline = this.redis.pipeline();
    for (const [hour, counts] of buckets) {
      const key = bucketKey(hour);
      pipeline.del(key);
      for (const [tag, n] of counts) pipeline.zadd(key, n, tag);
      pipeline.expire(key, BUCKET_TTL_SECONDS);
    }
    for (const row of rows)
      pipeline.set(`trends:seen:${row.id}`, '1', 'EX', BUCKET_TTL_SECONDS);
    pipeline.del(CACHE_KEY);
    await pipeline.exec();
    return rows.length;
  }
}

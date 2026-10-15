import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { CACHE } from '../cache/cache.module.js';
import type { RedisCache } from '../cache/redis-cache.js';
import { withTimeout } from '../common/with-timeout.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB, type Database } from '../db/db.module.js';
import { REDIS } from '../redis/redis.module.js';

// Write-behind counters.
//
// A like inserts one row into `likes` right away (that's the truth), but
// bumping tweets.like_count on every like means every like on a viral tweet
// fights over the same database row. Instead, the change goes into Redis:
//
//   counter:tweet:<id>  (hash)  likes -> +3, replies -> +1   pending changes
//   counter:dirty       (set)   "tweet:<id>", "user:<id>"    what needs flushing
//
// Every COUNTER_FLUSH_INTERVAL_MS, flush() moves all pending changes into
// Postgres in one transaction. The count shown to users is
// "stored count + pending change", so it is always current.
//
// The trade-off: if Redis dies between flushes, up to one interval of count
// changes is lost (the likes themselves are safe in Postgres).
// `npm run counters:reconcile` recomputes every count from the source rows.

export const COUNTER_COLUMNS = {
  tweet: {
    likes: 'like_count',
    replies: 'reply_count',
    retweets: 'retweet_count',
  },
  user: {
    followers: 'follower_count',
    following: 'following_count',
    tweets: 'tweet_count',
  },
} as const;

type Entity = keyof typeof COUNTER_COLUMNS;
export type CounterChange =
  | {
      entity: 'tweet';
      id: bigint;
      field: keyof typeof COUNTER_COLUMNS.tweet;
      by: number;
    }
  | {
      entity: 'user';
      id: bigint;
      field: keyof typeof COUNTER_COLUMNS.user;
      by: number;
    };

const DIRTY = 'counter:dirty';
const BATCH = 500;
const REDIS_TIMEOUT_MS = 200;

// Read the pending changes and delete them in one atomic step, so an
// increment can never land between "read" and "delete" and be lost.
const TAKE_PENDING = `
local out = {}
for i, key in ipairs(KEYS) do
  out[i] = redis.call('HGETALL', key)
  redis.call('DEL', key)
end
return out`;

@Injectable()
export class CountersService
  implements OnModuleInit, BeforeApplicationShutdown
{
  private readonly logger = new Logger('Counters');
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CACHE) private readonly cache: RedisCache,
  ) {}

  onModuleInit() {
    const ms = this.env.COUNTER_FLUSH_INTERVAL_MS;
    if (ms > 0) {
      this.timer = setInterval(() => {
        this.flush().catch((err) =>
          this.logger.error(`flush failed: ${String(err)}`),
        );
      }, ms);
      this.timer.unref();
    }
  }

  // Graceful shutdown: write pending counts before Redis and Postgres close.
  async beforeApplicationShutdown() {
    clearInterval(this.timer);
    await this.flush().catch((err) =>
      this.logger.error(`final flush failed: ${String(err)}`),
    );
  }

  async change(changes: CounterChange[]): Promise<void> {
    if (changes.length === 0) return;
    const multi = this.redis.multi(); // all-or-nothing, like a transaction
    for (const c of changes) {
      multi.hincrby(`counter:${c.entity}:${c.id}`, c.field, c.by);
      multi.sadd(DIRTY, `${c.entity}:${c.id}`);
    }
    try {
      await withTimeout(multi.exec(), REDIS_TIMEOUT_MS, 'counter change');
    } catch (err) {
      // Redis is down: write straight to Postgres. Slower and contended,
      // but the count stays right.
      this.logger.warn(
        `Redis unavailable, writing counts to Postgres: ${String(err)}`,
      );
      await this.applyToDb(changes);
    }
  }

  // Pending (not yet flushed) changes for some IDs, to add to stored counts.
  async pending(
    entity: Entity,
    ids: string[],
  ): Promise<Map<string, Record<string, number>>> {
    const out = new Map<string, Record<string, number>>();
    if (ids.length === 0) return out;
    const pipeline = this.redis.pipeline();
    for (const id of ids) pipeline.hgetall(`counter:${entity}:${id}`);
    try {
      const replies =
        (await withTimeout(
          pipeline.exec(),
          REDIS_TIMEOUT_MS,
          'pending counts',
        )) ?? [];
      replies.forEach(([err, hash], i) => {
        if (err || !hash) return;
        const parsed = Object.fromEntries(
          Object.entries(hash as Record<string, string>).map(([k, v]) => [
            k,
            Number(v),
          ]),
        );
        if (Object.keys(parsed).length) out.set(ids[i], parsed);
      });
    } catch {
      // Redis down: show stored counts (a little stale) rather than fail.
    }
    return out;
  }

  // Moves every pending change into Postgres. Safe to run on several API
  // instances at once: SPOP hands each dirty entry to exactly one of them,
  // and TAKE_PENDING is atomic.
  async flush(): Promise<number> {
    let flushed = 0;
    for (;;) {
      const members = (await this.redis.spop(DIRTY, BATCH)) as string[];
      if (!members?.length) break;

      const keys = members.map((m) => `counter:${m}`);
      const hashes = (await this.redis.eval(
        TAKE_PENDING,
        keys.length,
        ...keys,
      )) as string[][];
      const changes = members.flatMap((member, i) =>
        toChanges(member, hashes[i]),
      );

      try {
        await this.applyToDb(changes);
      } catch (err) {
        // Put the changes back so the next flush retries them.
        await this.change(changes);
        throw err;
      }

      // The cached copies hold the old stored counts; drop them. Then once
      // more a moment later, in case a reader cached a pre-flush row in
      // between ("delayed double delete").
      const cacheKeys = members.map((m) => `cache:${m}`);
      await this.cache.invalidate(cacheKeys);
      setTimeout(() => void this.cache.invalidate(cacheKeys), 2_000).unref();
      flushed += members.length;
    }
    if (flushed) this.logger.debug(`flushed ${flushed} counters`);
    return flushed;
  }

  // Recomputes every stored count from the rows it summarizes. For repairs
  // after data loss, and after seeding. Run it when traffic is quiet: a like
  // that lands mid-run can end up counted twice until the next reconcile.
  async reconcile(): Promise<void> {
    await this.flush();
    await this.db.execute(sql`
      update users u set
        follower_count  = (select count(*) from follows f where f.followee_id = u.id),
        following_count = (select count(*) from follows f where f.follower_id = u.id),
        tweet_count     = (select count(*) from tweets t where t.author_id = u.id)`);
    await this.db.execute(sql`
      update tweets t set
        like_count    = (select count(*) from likes l where l.tweet_id = t.id),
        reply_count   = (select count(*) from tweets r where r.reply_to_id = t.id),
        retweet_count = (select count(*) from tweets r where r.retweet_of_id = t.id)`);
  }

  private async applyToDb(changes: CounterChange[]) {
    const byEntity = {
      tweet: new Map<bigint, Record<string, number>>(),
      user: new Map(),
    };
    for (const c of changes) {
      const row = byEntity[c.entity].get(c.id) ?? {};
      row[c.field] = (row[c.field] ?? 0) + c.by;
      byEntity[c.entity].set(c.id, row);
    }
    await this.db.transaction(async (tx) => {
      for (const entity of ['tweet', 'user'] as const) {
        const rows = byEntity[entity];
        if (rows.size === 0) continue;
        const fields = Object.keys(COUNTER_COLUMNS[entity]) as string[];
        const columns = COUNTER_COLUMNS[entity] as Record<string, string>;
        const values = sql.join(
          [...rows].map(
            ([id, d]) =>
              sql`(${id}::bigint, ${sql.join(
                fields.map((f) => sql`${d[f] ?? 0}::int`),
                sql`, `,
              )})`,
          ),
          sql`, `,
        );
        const sets = sql.join(
          fields.map(
            (f) =>
              sql`${sql.identifier(columns[f])} = greatest(0, t.${sql.identifier(columns[f])} + v.${sql.identifier(f)})`,
          ),
          sql`, `,
        );
        const table = sql.identifier(entity === 'tweet' ? 'tweets' : 'users');
        // One UPDATE for the whole batch, joined against a VALUES list.
        await tx.execute(sql`
          update ${table} t set ${sets}
          from (values ${values}) as v(id, ${sql.join(
            fields.map((f) => sql.identifier(f)),
            sql`, `,
          )})
          where t.id = v.id`);
      }
    });
  }
}

function toChanges(
  member: string,
  flat: string[] | undefined,
): CounterChange[] {
  const [entity, rawId] = member.split(':') as [Entity, string];
  const out: CounterChange[] = [];
  for (let i = 0; flat && i < flat.length; i += 2) {
    const by = Number(flat[i + 1]);
    if (by)
      out.push({
        entity,
        id: BigInt(rawId),
        field: flat[i],
        by,
      } as CounterChange);
  }
  return out;
}

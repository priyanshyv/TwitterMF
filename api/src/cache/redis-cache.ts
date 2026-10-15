import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';

// Cache-aside ("lazy loading"): look in Redis first; on a miss, load from the
// database and store the result for next time. Postgres stays the source of
// truth; Redis only ever holds copies, so losing it costs speed, not data.
//
// The hard part is the stampede: a popular key expires and 1,000 requests
// miss at the same moment, so 1,000 identical queries hit Postgres at once.
// Two layers stop that:
//   1. In-process single-flight: concurrent misses for one key inside this
//      API instance share one load (a Map of in-flight promises).
//   2. A Redis lock across instances: only the instance that wins
//      `SET lock:<key> NX` loads; the others wait briefly for its result.
// `npm run lab:stampede` measures each layer.

export interface CacheOptions {
  singleFlight: boolean;
  lock: boolean;
}

const MISSING = 'null'; // stored for "doesn't exist" (negative caching)
const NEGATIVE_TTL_SECONDS = 30;
const LOCK_TTL_MS = 3_000; // a crashed lock holder can't block a key forever
const LOCK_WAIT_MS = 1_000; // how long others wait before loading themselves
const POLL_MS = 25;
const REDIS_TIMEOUT_MS = 150;

// Only delete the lock if it is still ours: if our load outlived the lock,
// someone else may hold it now.
const RELEASE_LOCK = `
if redis.call('get', KEYS[1]) == ARGV[1] then
  return redis.call('del', KEYS[1])
end
return 0`;

type Loader<T> = (missingKeys: string[]) => Promise<Map<string, T>>;

export class RedisCache {
  private readonly inflight = new Map<string, Promise<Map<string, unknown>>>();

  constructor(
    private readonly redis: Redis,
    private readonly options: CacheOptions = { singleFlight: true, lock: true },
  ) {}

  // Returns the found values by key. Keys the loader didn't return don't
  // exist, and are left out of the result.
  async getMany<T>(
    keys: string[],
    ttlSeconds: number,
    load: Loader<T>,
  ): Promise<Map<string, T>> {
    const result = new Map<string, T>();
    const unique = [...new Set(keys)];
    if (unique.length === 0) return result;

    // If Redis is down or slow, act as if everything missed: slower, but
    // the page still loads (graceful degradation).
    const cached = await this.safe(() => this.redis.mget(...unique));
    const missing: string[] = [];
    unique.forEach((key, i) => {
      const raw = cached?.[i];
      if (raw == null) missing.push(key);
      else if (raw !== MISSING) result.set(key, JSON.parse(raw) as T);
    });
    if (missing.length === 0) return result;

    const toLoad: string[] = [];
    const joined: Promise<void>[] = [];
    for (const key of missing) {
      const pending = this.options.singleFlight
        ? this.inflight.get(key)
        : undefined;
      if (pending) {
        joined.push(
          pending.then((m) => {
            if (m.has(key)) result.set(key, m.get(key) as T);
          }),
        );
      } else {
        toLoad.push(key);
      }
    }

    if (toLoad.length > 0) {
      const loading = this.loadWithLock(toLoad, ttlSeconds, load, !!cached);
      if (this.options.singleFlight) {
        for (const key of toLoad) this.inflight.set(key, loading);
        const done = () => {
          for (const key of toLoad)
            if (this.inflight.get(key) === loading) this.inflight.delete(key);
        };
        loading.then(done, done);
      }
      for (const [key, value] of await loading) result.set(key, value);
    }
    await Promise.all(joined);
    return result;
  }

  async get<T>(key: string, ttlSeconds: number, load: () => Promise<T | null>) {
    const found = await this.getMany<T>([key], ttlSeconds, async () => {
      const value = await load();
      return new Map(value === null ? [] : [[key, value]]);
    });
    return found.get(key) ?? null;
  }

  // Called when the source data changed, so the next read reloads it.
  async invalidate(keys: string[]): Promise<void> {
    if (keys.length) await this.safe(() => this.redis.del(...keys));
  }

  private async loadWithLock<T>(
    keys: string[],
    ttlSeconds: number,
    load: Loader<T>,
    redisUp: boolean,
  ): Promise<Map<string, T>> {
    if (!this.options.lock || !redisUp)
      return this.loadAndStore(keys, ttlSeconds, load);

    const token = randomUUID();
    const pipeline = this.redis.pipeline();
    for (const key of keys)
      pipeline.set(`lock:${key}`, token, 'PX', LOCK_TTL_MS, 'NX');
    const replies = await this.safe(() => pipeline.exec());
    if (!replies) return this.loadAndStore(keys, ttlSeconds, load);

    const mine = keys.filter((_, i) => replies[i]?.[1] === 'OK');
    const theirs = keys.filter((_, i) => replies[i]?.[1] !== 'OK');

    const [loaded, waited] = await Promise.all([
      mine.length
        ? this.loadAndStore(mine, ttlSeconds, load).finally(() =>
            this.releaseLocks(mine, token),
          )
        : new Map<string, T>(),
      theirs.length
        ? this.waitForOthers(theirs, ttlSeconds, load)
        : new Map<string, T>(),
    ]);
    return new Map([...loaded, ...waited]);
  }

  // Another instance is loading these keys. Poll for its result; if it
  // takes too long (crashed, or very slow), load them ourselves.
  private async waitForOthers<T>(
    keys: string[],
    ttlSeconds: number,
    load: Loader<T>,
  ): Promise<Map<string, T>> {
    const found = new Map<string, T>();
    let pending = keys;
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (pending.length && Date.now() < deadline) {
      await sleep(POLL_MS);
      const values = await this.safe(() => this.redis.mget(...pending));
      if (!values) break;
      pending = pending.filter((key, i) => {
        const raw = values[i];
        if (raw == null) return true;
        if (raw !== MISSING) found.set(key, JSON.parse(raw) as T);
        return false;
      });
    }
    if (pending.length)
      for (const [k, v] of await this.loadAndStore(pending, ttlSeconds, load))
        found.set(k, v);
    return found;
  }

  private async loadAndStore<T>(
    keys: string[],
    ttlSeconds: number,
    load: Loader<T>,
  ): Promise<Map<string, T>> {
    const loaded = await load(keys);
    const pipeline = this.redis.pipeline();
    for (const key of keys) {
      if (loaded.has(key)) {
        pipeline.set(
          key,
          JSON.stringify(loaded.get(key)),
          'EX',
          jitter(ttlSeconds),
        );
      } else {
        // Remember "doesn't exist" briefly, so lookups for missing things
        // (typos, deleted tweets, bots probing IDs) don't all reach Postgres.
        pipeline.set(key, MISSING, 'EX', NEGATIVE_TTL_SECONDS);
      }
    }
    await this.safe(() => pipeline.exec());
    return loaded;
  }

  private async releaseLocks(keys: string[], token: string) {
    const pipeline = this.redis.pipeline();
    for (const key of keys)
      pipeline.eval(RELEASE_LOCK, 1, `lock:${key}`, token);
    await this.safe(() => pipeline.exec());
  }

  private async safe<R>(fn: () => Promise<R>): Promise<R | null> {
    try {
      return await withTimeout(fn(), REDIS_TIMEOUT_MS, 'redis cache');
    } catch {
      return null;
    }
  }
}

// Keys cached at the same moment (say, after a deploy) would otherwise all
// expire at the same moment too and stampede together. ±10% spreads them out.
export function jitter(ttlSeconds: number) {
  return Math.max(1, Math.round(ttlSeconds * (0.9 + Math.random() * 0.2)));
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

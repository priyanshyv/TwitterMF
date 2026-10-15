// Cache stampede lab: what happens when a hot key expires?
// Run from the repo root:  npm run lab:stampede
// Uses Redis DB 2 (your app data in DB 0 is untouched) and cleans up after.
import { Redis } from 'ioredis';
import { RedisCache, type CacheOptions } from '../src/cache/redis-cache.js';

const REQUESTS = 1_000;
const INSTANCES = 4;
const DB_QUERY_MS = 50; // a realistic query on a busy database

const redis = new Redis('redis://localhost:6379/2');

async function scenario(
  name: string,
  options: CacheOptions,
  instances: number,
) {
  await redis.flushdb();
  let queries = 0;
  const loadFromDb = async (keys: string[]) => {
    queries++;
    await new Promise((r) => setTimeout(r, DB_QUERY_MS));
    return new Map(keys.map((k) => [k, { id: k, name: 'Celebrity' }]));
  };

  // Each instance is a separate cache object, like separate API servers.
  // Requests are spread across them, all arriving at once on a cold key.
  const caches = Array.from(
    { length: instances },
    () => new RedisCache(redis, options),
  );
  const started = performance.now();
  await Promise.all(
    Array.from({ length: REQUESTS }, (_, i) =>
      caches[i % instances].getMany(['cache:user:celebrity'], 600, loadFromDb),
    ),
  );
  return {
    scenario: name,
    'API instances': instances,
    'DB queries': queries,
    'total time (ms)': Math.round(performance.now() - started),
  };
}

const rows = [
  await scenario(
    'no protection',
    { singleFlight: false, lock: false },
    INSTANCES,
  ),
  await scenario(
    'single-flight only',
    { singleFlight: true, lock: false },
    INSTANCES,
  ),
  await scenario(
    'single-flight + Redis lock',
    { singleFlight: true, lock: true },
    INSTANCES,
  ),
];
console.log(
  `${REQUESTS} requests hit the same expired key at the same moment.\n`,
);
console.table(rows);
console.log(
  '\nWithout protection every request queries the database. Single-flight collapses' +
    '\nthe requests inside each instance into one query; the lock collapses the' +
    '\ninstances into one.',
);
await redis.flushdb();
await redis.quit();

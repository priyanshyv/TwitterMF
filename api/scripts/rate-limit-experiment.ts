// Rate limiter lab: why the check-and-update must be atomic.
// Run from the repo root:  npm run lab:ratelimit
// Uses Redis DB 2 (your app data in DB 0 is untouched) and cleans up after.
import { Redis } from 'ioredis';
import { RedisRateLimiter } from '../src/rate-limit/redis-rate-limiter.js';

const redis = new Redis('redis://localhost:6379/2');
const LIMIT = 10;
const REQUESTS = 200; // all at the same moment, like a bot or a retry storm

// The obvious version: read the count, compare, write it back. Three
// separate commands, so concurrent requests interleave between them.
async function naive(key: string) {
  const used = Number((await redis.get(key)) ?? 0);
  if (used >= LIMIT) return false;
  await redis.set(key, used + 1);
  return true;
}

await redis.flushdb();
const limiter = new RedisRateLimiter(redis);
const count = (results: boolean[]) => results.filter(Boolean).length;

const naiveAllowed = count(
  await Promise.all(Array.from({ length: REQUESTS }, () => naive('naive'))),
);
const bucketAllowed = count(
  await Promise.all(
    Array.from({ length: REQUESTS }, () =>
      limiter.tokenBucket('bucket', LIMIT, 1).then((r) => r.allowed),
    ),
  ),
);
const windowAllowed = count(
  await Promise.all(
    Array.from({ length: REQUESTS }, () =>
      limiter.slidingWindow('window', LIMIT, 60_000).then((r) => r.allowed),
    ),
  ),
);

console.log(`${REQUESTS} requests at once against a limit of ${LIMIT}:\n`);
console.table([
  {
    limiter: 'naive GET + SET',
    allowed: naiveAllowed,
    'over the limit': naiveAllowed - LIMIT,
  },
  {
    limiter: 'token bucket (Lua)',
    allowed: bucketAllowed,
    'over the limit': bucketAllowed - LIMIT,
  },
  {
    limiter: 'sliding window (Lua)',
    allowed: windowAllowed,
    'over the limit': windowAllowed - LIMIT,
  },
]);

// Token bucket vs sliding window over time: one request every 250 ms for
// 8 seconds, against "5 per 4 seconds" in both styles.
await redis.flushdb();
console.log(
  '\nOne request every 250 ms, limit "5 per 4 seconds" (# = allowed, . = blocked):\n',
);
let bucketLine = '';
let windowLine = '';
for (let i = 0; i < 32; i++) {
  const [b, w] = await Promise.all([
    limiter.tokenBucket('bucket2', 5, 75), // 5 tokens, refills 75/min = 5 per 4 s
    limiter.slidingWindow('window2', 5, 4_000),
  ]);
  bucketLine += b.allowed ? '#' : '.';
  windowLine += w.allowed ? '#' : '.';
  await new Promise((r) => setTimeout(r, 250));
}
console.log(`  token bucket    ${bucketLine}`);
console.log(`  sliding window  ${windowLine}`);
console.log(
  '\nBoth allow the first burst of 5. Then the bucket lets one through each time a' +
    '\ntoken drips back (steady trickle); the window waits until old requests age out' +
    '\n(bursts, then pauses).',
);
await redis.flushdb();
await redis.quit();

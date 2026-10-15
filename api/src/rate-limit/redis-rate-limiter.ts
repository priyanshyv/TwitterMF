import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  // How long until the next request would be allowed (0 when allowed).
  retryAfterMs: number;
}

// Why Lua: a limiter must read the current state, decide, and write it back.
// Done as separate commands, two requests arriving together both read
// "1 left", both pass, and the limit leaks (`npm run lab:ratelimit` shows
// how badly). Redis runs a Lua script start to finish with nothing in
// between, so the check-and-update is atomic across every API instance.
//
// Both scripts take the time from Redis itself (TIME), not from the API
// server, so instances with slightly different clocks still agree.

// Token bucket: the bucket holds up to `capacity` tokens and refills at a
// steady rate; each request takes one. Allows short bursts (a full bucket),
// then settles to the refill rate. Stores just two numbers per key.
const TOKEN_BUCKET = `
local capacity = tonumber(ARGV[1])
local per_ms = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

local state = redis.call('HMGET', KEYS[1], 'tokens', 'ts')
local tokens = tonumber(state[1]) or capacity
local last = tonumber(state[2]) or now
tokens = math.min(capacity, tokens + (now - last) * per_ms)

local allowed, retry = 0, 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
else
  retry = math.ceil((1 - tokens) / per_ms)
end
redis.call('HSET', KEYS[1], 'tokens', tokens, 'ts', now)
-- After this long the bucket would be full again, so the key can go.
redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / per_ms))
return {allowed, math.floor(tokens), retry}`;

// Sliding-window log: remember the time of every allowed request in the
// window (a sorted set scored by time); allow a new one only if fewer than
// `limit` are left after dropping the expired ones. Exact, unlike a fixed
// per-minute counter that allows 2x the limit across a minute boundary, but
// it stores one entry per request, so it suits small limits (logins).
const SLIDING_WINDOW = `
local limit = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)

redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count < limit then
  redis.call('ZADD', KEYS[1], now, now .. ':' .. ARGV[3])
  redis.call('PEXPIRE', KEYS[1], window)
  return {1, limit - count - 1, 0}
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
return {0, 0, tonumber(oldest[2]) + window - now}`;

export class RedisRateLimiter {
  constructor(private readonly redis: Redis) {}

  async tokenBucket(
    key: string,
    capacity: number,
    refillPerMinute: number,
  ): Promise<RateLimitResult> {
    const perMs = refillPerMinute / 60_000;
    const reply = (await this.redis.eval(
      TOKEN_BUCKET,
      1,
      key,
      capacity,
      perMs,
    )) as number[];
    return toResult(reply);
  }

  async slidingWindow(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    const reply = (await this.redis.eval(
      SLIDING_WINDOW,
      1,
      key,
      limit,
      windowMs,
      randomUUID(), // two requests in the same millisecond still count twice
    )) as number[];
    return toResult(reply);
  }
}

function toResult([
  allowed,
  remaining,
  retryAfterMs,
]: number[]): RateLimitResult {
  return { allowed: allowed === 1, remaining, retryAfterMs };
}

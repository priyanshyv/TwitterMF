# Concepts log

One entry per concept, added when the code that uses it lands. Each says what it is, why this app needs it, and where to look.

## Phase 1: Set up the workshop

### Environment-based config, validated at boot (12-factor)

**What:** All settings (DB URL, Redis URL, port) come from environment variables, never from code. They are validated with a zod schema when the process starts.
**Why:** The same build runs locally, in CI and in production with different env vars. A typo in `DATABASE_URL` crashes the process at startup with a clear message, instead of failing on the first request an hour later.
**Where:** `api/src/config/env.ts`

### Health checks (readiness)

**What:** `GET /health` actually queries Postgres (`select 1`) and Redis (`PING`). It returns 200 if both answer and 503 if either doesn't.
**Why:** Once there are several API instances behind a load balancer (Phase 6), the balancer polls this endpoint and stops sending traffic to an instance whose dependencies are down.
**Where:** `api/src/health/health.controller.ts`
**Try it:** `docker stop twittermf-redis-1`, then `curl localhost:4000/health`. You get a 503 naming Redis. Start it again and the endpoint recovers.

### Timeouts on every external call

**What:** Every call to another system gets a deadline (`withTimeout`). The pg pool has a 2s connect timeout, and ioredis gives up after one retry instead of queueing commands forever.
**Why:** A slow dependency is worse than a dead one. Without deadlines, requests pile up waiting until the whole API stops responding. This is the building block for the circuit breaker in Phase 5.
**Where:** `api/src/common/with-timeout.ts`, `api/src/db/db.module.ts`, `api/src/redis/redis.module.ts`

### Connection pooling

**What:** The API keeps a pool of at most 10 open Postgres connections and reuses them, instead of opening one per request.
**Why:** Opening a Postgres connection costs a few milliseconds and some server memory, and Postgres allows only ~100 connections in total. So 10 API instances × 10 connections already reaches the limit. Phase 6 adds PgBouncer to get past it.
**Where:** `api/src/db/db.module.ts`

### Graceful shutdown

**What:** On SIGTERM (a deploy, or Ctrl+C) Nest runs `onApplicationShutdown`, which closes the pg pool and the Redis connection cleanly.
**Why:** Rolling deploys kill old instances all the time. Clean shutdown means in-flight work finishes and no connections are left dangling on the database.
**Where:** `app.enableShutdownHooks()` in `api/src/main.ts`, plus the shutdown hooks in the db and redis modules

### Docker Compose healthchecks

**What:** Each container declares a command that proves it is ready (`pg_isready`, `redis-cli ping`), and `docker compose up --wait` blocks until all of them pass.
**Why:** "Container started" is not the same as "database accepting connections". Without this, the API races Postgres on boot and crashes.
**Where:** `infra/docker-compose.yml`

## Phase 2: Core monolith

### Schema migrations

**What:** Every schema change is a numbered SQL file in `api/drizzle/` (`0000_init.sql`, `0001_refresh_token_rotated_at.sql`), generated from the Drizzle schema and applied in order. Postgres records which ones ran.
**Why:** Your laptop, CI and production must end up with the same tables. Editing tables by hand drifts; migrations replay the same steps everywhere. Never edit a migration that already ran; add a new one, like `0001` did.
**Where:** `api/src/db/schema/index.ts`, `api/drizzle/`. `npm run dev` applies pending migrations; the e2e setup does the same for the test database.
**Try it:** add a column to the schema, run `npm run db:generate`, and read the SQL it wrote.

### B-tree indexes, EXPLAIN, and query shape

**What:** An index is a sorted copy of some columns pointing back to the rows. `tweets(author_id, id desc)` keeps each author's tweets together, newest first. `EXPLAIN ANALYZE` shows the plan Postgres picked and how much work it did.
**Why:** Measured on 1M tweets (`npm run lab:explain`):

| Query                      | Without index        | With index            | With index + LATERAL rewrite |
| -------------------------- | -------------------- | --------------------- | ---------------------------- |
| Profile: user's latest 20  | 17.7 ms, 7,319 pages | **0.04 ms, 26 pages** | n/a                          |
| Home timeline (20 follows) | 18.6 ms              | 14.4 ms               | **0.45 ms**                  |

The surprise is the second row: the index barely helped the timeline, because `author_id IN (...) ORDER BY id` walks every recent tweet on the site and throws away 276k of them. Rewriting it as "for each followee, take their newest 20 from the index, then merge" (`CROSS JOIN LATERAL`) uses the index 20 times and reads 400 rows. **An index only helps if the query is shaped so the planner can use it.**
**Where:** `api/src/db/schema/index.ts` (indexes), `api/src/tweets/tweets.service.ts` (`timeline`), `api/scripts/explain-timeline.sql`.

### Snowflake IDs

**What:** 64-bit IDs built from 41 bits of milliseconds, 10 bits of worker ID and a 12-bit per-millisecond sequence. Twitter published this scheme in 2010.
**Why:** Auto-increment IDs need one database to hand them out, which becomes a bottleneck and breaks once you shard. Snowflakes are generated in-process with no coordination, are unique across up to 1,024 API instances, and sort by time, so `ORDER BY id` means "newest first" and an ID doubles as a pagination cursor. They exceed JavaScript's safe integers (2^53), so the API sends them as strings (Twitter's API has `id_str` for the same reason).
**Where:** `api/src/common/snowflake.ts` (+ tests for bursts of 4,096/ms and a backwards clock), `WORKER_ID` in `.env`.

### Password hashing (argon2id) and timing-safe login

**What:** Passwords are stored as argon2id hashes: deliberately slow (~50 ms) and memory-hard (64 MB each).
**Why:** If the database leaks, every guess costs the attacker real hardware. Login for an unknown username still runs one hash against a dummy, so "no such user" and "wrong password" take the same time and give the same message; otherwise response timing would reveal which usernames exist.
**Where:** `api/src/auth/passwords.ts`, `login()` in `api/src/auth/auth.controller.ts`.

### Access tokens + rotating refresh tokens

**What:** Login sets two httpOnly cookies. The **access token** is a 15-minute signed JWT the API checks without touching the database. The **refresh token** is random, lives 30 days, is stored only as a SHA-256 hash, and works **once**: each refresh swaps it for a new one in the same "family".
**Why:** Short access tokens limit the damage of a leak; refresh tokens keep you logged in. Single use enables **theft detection**: if an already-used refresh token shows up again, two parties hold a copy, so the whole family is revoked and both must log in again. A 10-second grace window keeps legitimate parallel refreshes (two tabs, Next.js prefetching) from tripping it. httpOnly means page JavaScript can't read the tokens (XSS can't steal them); SameSite=Lax stops other sites from riding on them (CSRF).
**Where:** `api/src/auth/tokens.service.ts` (`rotate`), `auth.cookies.ts`, `auth.guard.ts`. On the web side, `web/src/proxy.ts` refreshes before a page renders and `web/src/lib/api/client.ts` refreshes once on a 401 (one refresh shared by all waiting requests).
**Try it:** the e2e test "detects reuse of an old token" in `api/test/auth.e2e-spec.ts` walks through a theft.

### Bloom filter

**What:** A bit array plus k hash functions. Adding a value sets k bits; checking reads them. Any 0 means **definitely not added**; all 1s means **probably added**. No false negatives, a tunable rate of false positives, no deletes.
**Why:** The sign-up form checks "is this username taken?" on every pause in typing. Most names typed are free, and the filter answers those from Redis with no Postgres query. Only "maybe" goes to Postgres. Measured (`npm run lab:bloom`, 100k names):

| Filter                       | Size   | Expected FP | Measured FP |
| ---------------------------- | ------ | ----------- | ----------- |
| 10% target                   | 59 KB  | 10.07%      | 10.12%      |
| 1% target                    | 117 KB | 1.00%       | 0.95%       |
| 0.1% target                  | 176 KB | 0.10%       | 0.11%       |
| 1% target, **3× overfilled** | 117 KB | 43.6%       | 43.7%       |
| Redis 8 `BF.*` (built in)    | 135 KB | 1.00%       | 0.48%       |

The same 100k names as a Redis SET take 4.9 MB, 42× more. Overfilling ruins a filter, so size it for growth. Redis's built-in version is ~18× faster to fill because it runs on the server in one command.
**Where:** `api/src/usernames/` (`bloom.ts` math, `redis-bloom-filter.ts`, `usernames.service.ts`), `api/scripts/bloom-experiment.ts`.
**Try it:** type a name on `/signup` and read the line under it. Names of deleted accounts stay in the filter, which makes them nice examples of false positives.

### Graceful degradation (first taste)

**What:** When an optional dependency fails, fall back to something slower but correct instead of failing the request.
**Why:** The bloom filter is an optimization, not the source of truth. If Redis is slow (200 ms deadline) or down, the username check asks Postgres directly. If Redis lost the filter, the API rebuilds it from Postgres on boot. And whatever the filter says, the unique index in Postgres blocks duplicate usernames. Phase 5's circuit breaker formalizes this.
**Where:** `check()`, `add()` and `onApplicationBootstrap()` in `api/src/usernames/usernames.service.ts`.

### Validation at the edge, constraints at the core

**What:** Every request body, query and route parameter is parsed with a zod schema before reaching a service (400 with one message per field). The database also enforces the rules that matter: username format, case-insensitive uniqueness, tweet length 1–280, no self-follows.
**Why:** The API check gives friendly errors; the database check holds even if a bug, a script or a race slips past the API. Two simultaneous sign-ups for one name can both pass the API check; only one insert survives the unique index (→ 409).
**Where:** `api/src/common/zod.pipe.ts`, `*.schemas.ts`, check constraints in the schema.

### Fan-out on read (home timeline v1)

**What:** The home timeline is assembled when you ask for it: take the accounts you follow, fetch each one's newest tweets, merge.
**Why:** It's the simplest correct design: posting is one insert, and nothing is precomputed. The cost lands on reads and grows with how many accounts you follow, and timelines are read far more often than tweets are written. Phase 4 adds fan-out on write (precomputed timelines in Redis) and a hybrid for celebrity accounts.
**Where:** `timeline()` in `api/src/tweets/tweets.service.ts`.

### Cursor (keyset) pagination

**What:** "Next page" means "20 tweets with an ID below the last one you saw" (`?before=<id>`), not "skip 40, take 20".
**Why:** `OFFSET 10000` makes Postgres read and discard 10,000 rows, so deep pages get slower. A cursor jumps straight there through the index, so every page costs the same. New tweets arriving while you scroll can't shift pages and cause duplicates or gaps. Queries fetch one extra row (limit + 1) to learn whether another page exists without a second query.
**Where:** `api/src/common/pagination.ts`, `web/src/components/tweet-list.tsx` (Load more).

## Phase 3: Caching and engagement

### Cache-aside (lazy loading)

**What:** To read a tweet or user, look in Redis first; on a miss, load it from Postgres and store a copy with an expiry (TTL). Writes go to Postgres only; when stored data changes, the cached copy is deleted so the next read reloads it.
**Why:** A popular tweet appears in thousands of timelines. Without a cache, every one of those page loads reads the same row from Postgres. With one, Postgres is read once per TTL. Redis only ever holds copies, so if it's flushed the app just gets slower for a moment, never wrong.
**Where:** `api/src/cache/redis-cache.ts`. Used for tweet bodies (`cache:tweet:<id>`, 10 min), users (`cache:user:<id>`, 5 min) and username → ID (`cache:uname:<name>`, 1 h) in `tweets.service.ts` and `user-records.service.ts`.
**Try it:** open the timeline, then look at the `cache:*` keys in Redis Insight. Run `FLUSHDB` and reload: the page still works and the keys come back.

### Separating "which items" from "what's in them" (hydration)

**What:** Feed queries now return only IDs, straight from an index. A second step, hydration, fetches the bodies (from the cache), adds counts, and adds the viewer's own state ("did I like this?").
**Why:** The ID query is cheap and always fresh. The bodies are the expensive, repeated part, and they're the same for everyone, so they're cacheable. Per-viewer data (your likes) is not, so it's looked up separately with two indexed queries. Twitter's real timeline service works the same way.
**Where:** `hydrate()` in `api/src/tweets/tweets.service.ts`.

### TTL jitter and negative caching

**What:** Every TTL gets ±10% randomness (600 s becomes anything from 540 to 660 s). Lookups that find nothing are cached too, as `null`, for 30 seconds.
**Why:** Keys cached together (after a deploy, or after a flush) would otherwise all expire together and hit Postgres all at once. Negative caching stops repeated lookups of things that don't exist (typos, bots probing IDs) from reaching Postgres every time. The catch: when the thing starts existing, the `null` must be deleted. Sign-up does that for usernames.
**Where:** `jitter()` and the `MISSING` marker in `redis-cache.ts`; `UsersService.create()` clears `cache:uname:<name>`.

### Cache stampede protection (single-flight + lock)

**What:** When a hot key expires and many requests miss it at the same moment, only **one** of them loads it from Postgres; the others wait for that result. There are two layers. **Single-flight** shares one in-flight load among requests inside one API instance (a map of promises). A **Redis lock** (`SET lock:<key> NX PX 3000`) does the same across instances; the losers poll the cache briefly, and load it themselves if the winner takes too long.
**Why:** Measured with `npm run lab:stampede` (1,000 simultaneous requests for one expired key, 4 instances):

| Protection           | Postgres queries     |
| -------------------- | -------------------- |
| None                 | 1,000                |
| Single-flight        | 4 (one per instance) |
| Single-flight + lock | **1**                |

The lock is released with a small Lua script that deletes it **only if it still holds our random token**. If our load outlived the lock's 3 s expiry, someone else may own it by now, and a plain `DEL` would delete their lock.
**Where:** `getMany()`, `loadWithLock()`, `RELEASE_LOCK` in `api/src/cache/redis-cache.ts`; `api/scripts/stampede-experiment.ts`.

### Write-behind counters

**What:** A like writes its `likes` row to Postgres immediately; that row is the truth. The **count** goes to Redis as a pending change (`HINCRBY counter:tweet:<id> likes 1`, plus the ID in a "dirty" set). Every 60 seconds, a flush moves all pending changes into Postgres in one `UPDATE … FROM (VALUES …)` per table. Counts shown to users are "stored count + pending change", so they're always current.
**Why:** Updating `tweets.like_count` on every like makes every like on a viral tweet wait for the same row lock. Batching turns 10,000 row updates into one. The details that keep it correct:

- **Atomic hand-off.** Pending changes are read and deleted in one Lua script, so an increment can't slip in between and vanish.
- **Several flushers are safe.** `SPOP` hands each dirty entry to exactly one API instance, so several can flush at once.
- **Failures don't lose counts.** A failed flush puts the changes back; shutdown does a final flush; if Redis is down, changes go straight to Postgres.
- **Stale cached copies are dropped.** After a flush, the cached copies (which hold the old stored count) are deleted twice: once right away, and again 2 s later, in case a reader cached a pre-flush row in between ("delayed double delete").

**The trade-off:** if Redis is lost between flushes, up to a minute of count changes is lost. The likes themselves are safe, so `npm run counters:reconcile` can recompute every count from the source rows.
**Where:** `api/src/counters/counters.service.ts`; `COUNTER_FLUSH_INTERVAL_MS` in `.env`.
**Try it:** like a tweet, then in DBeaver see `like_count` unchanged while Redis Insight shows `counter:tweet:<id>`. Within a minute, the Postgres column catches up and the Redis key disappears.

### Rate limiting: token bucket and sliding-window log

**What:** Two algorithms, each one Lua script running inside Redis.

|                | Token bucket                                                | Sliding-window log                                                      |
| -------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| Idea           | Up to N tokens, refilling steadily; each request spends one | Remember the time of every request in the window; allow if fewer than N |
| Behavior       | Short bursts OK, then a steady trickle                      | Exact count over the whole window                                       |
| Memory per key | 2 numbers                                                   | 1 entry per request                                                     |
| Used for       | posting, likes, retweets, follows, username checks          | login (10 per 15 min), sign-up (10/hour)                                |

**Why Lua:** a limiter reads, decides and writes. As separate commands, simultaneous requests all read "1 left" and all pass. `npm run lab:ratelimit` sends 200 requests at once against a limit of 10: the naive GET + SET version allowed **all 200**; the Lua versions allowed exactly 10. Both scripts use Redis's clock (`TIME`), so API servers with slightly different clocks still agree.
**Design choices:**

- **Login key.** Login is limited per _address + account_: it slows guessing one account's password without letting a stranger lock you out from everywhere.
- **Headers.** Responses carry `RateLimit-Limit` / `RateLimit-Remaining`; a 429 adds `Retry-After` and a readable message.
- **Fail open.** If Redis is down, requests are allowed, because availability matters more here than strictness. A bank might fail closed.

**Where:** `api/src/rate-limit/` (`redis-rate-limiter.ts`, `policies.ts`, `rate-limit.guard.ts`), `@RateLimit('<policy>')` on routes; `api/scripts/rate-limit-experiment.ts`.
**Try it:** post 11 tweets quickly: the 11th gets "Too many requests. Try again in 6 seconds."

### Idempotency keys

**What:** The compose box sends a random `Idempotency-Key` header with each new tweet, and reuses the same key if the user retries that draft. The API claims the key (`SET NX`), posts the tweet, and stores the response for 24 hours. The same key again replays the stored response (`Idempotent-Replayed: true`) instead of posting twice.
**Why:** Networks fail _after_ the server did the work: the request landed, the answer got lost, the client retries, and you get a duplicate tweet. The edge cases each have an answer:

- **Still running:** a second request while the first is in progress gets 409, so a fast double-click can't race it.
- **Different body:** reusing a key for a different request gets 422.
- **Failure:** a failed request releases the key, so a retry really retries.
- **Scope:** keys are per user.

Payment APIs (Stripe) work exactly like this.
**Where:** `api/src/idempotency/idempotency.interceptor.ts`, `@Idempotent()` on `POST /tweets`; `web/src/components/compose-box.tsx`.

### Idempotent toggles and "act on the original"

**What:** Like, retweet and follow are safe to repeat: inserts use `ON CONFLICT DO NOTHING` (backed by primary keys and a partial unique index on `(author_id, retweet_of_id)`), and counts change only when a row was really inserted or deleted (`RETURNING` tells us). Liking, retweeting or replying to a retweet targets the original tweet.
**Why:** Clients retry and users double-click; repeating "like" must not count twice. Pointing every action at the original keeps one set of counts per tweet.
**Where:** `like()`, `retweet()`, `contentId()` in `tweets.service.ts`; the partial indexes in `schema/index.ts`.

### Recursive queries (threads)

**What:** A thread page walks up the reply chain with a recursive CTE (`WITH RECURSIVE`): start at the tweet, join to its `reply_to_id`, repeat, capped at 25 hops.
**Why:** It's one round trip instead of one query per ancestor. Replies are listed through a partial index on `(reply_to_id, id desc) WHERE reply_to_id IS NOT NULL`, which only contains replies and is therefore small.
**Where:** `thread()` and `replies()` in `tweets.service.ts`.

### CORS preflight (a bug worth remembering)

**What:** Before a cross-origin `DELETE`, or a request with a custom header like `Idempotency-Key`, the browser first asks the server (an `OPTIONS` "preflight") whether it's allowed. If the answer doesn't list the method, the real request never leaves the browser.
**Why it matters here:** NestJS on Fastify allows only GET, HEAD and POST by default. Every `DELETE` from the website (unfollow since Phase 2, unlike, undo retweet) was silently blocked. The API tests didn't notice, because they don't go through a browser. The browser test caught it once it waited for the server's real answer instead of trusting the optimistic UI.
**Where:** `api/src/app.setup.ts`; regression test `api/test/cors.e2e-spec.ts`.

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

## Phase 4: Async work and real-time

### Message queues: producer and consumer

**What:** The API (the **producer**) no longer does slow follow-up work inside the request. It writes a small **job** to a queue in Redis ("tweet 9004 was posted by 42") and answers immediately. A separate **worker process** (the **consumer**) pulls jobs off the queue and does the work: copying the tweet into 5,000 timelines, creating notifications.
**Why:** Posting stays fast no matter how many followers you have. If the worker is slow or down, jobs wait in the queue instead of making requests slow or failing; start more workers and they share the load (BullMQ gives each job to exactly one). The API and worker are separate programs (`npm run dev` shows them as `api` and `job`), so a stuck job can never freeze the website.
**Where:** `api/src/jobs/queues.ts` (queue and job definitions), `jobs.module.ts` (`JobsService.fanout()` / `.notify()`, the producer), `api/src/worker/worker.service.ts` (the consumers), `api/src/worker.ts` (the process).
**Try it:** stop the worker (Ctrl+C everything, then run only `npm run dev -w api` and `-w web`), like a tweet, and run `npm run jobs`: the job sits in `waiting`. Start `npm run dev` again and watch it drain.

### Retries, exponential backoff with jitter, and a dead-letter queue

**What:** A failed job is retried up to 5 times, waiting 1 s, 2 s, 4 s, 8 s between attempts (**exponential backoff**), each wait randomly shortened by up to half (**jitter**). After the 5th failure it moves to a **dead-letter queue** with its data and the error, where nothing processes it until a human looks.
**Why:**

- **Most failures are temporary** (a Redis blip, a deploy), so retrying fixes them.
- **Backoff gives a struggling dependency room to recover** instead of hammering it.
- **Jitter stops a retry storm.** 1,000 jobs that failed together don't all retry at the same instant.
- **The dead-letter queue keeps nothing silently lost.** `npm run jobs` lists the jobs and the reason they failed; once the cause is fixed, `npm run jobs -- --replay` re-runs them.

**Where:** `jobOptions()` in `api/src/jobs/queues.ts`; the `failed` handler in `worker.service.ts`; `api/src/jobs/dead-letter.ts`; `api/scripts/jobs.ts`. Tests: `api/test/jobs.e2e-spec.ts` (fail twice then succeed; fail 5 times → dead-letter → replay).

### At-least-once delivery and idempotent consumers

**What:** A queue can deliver the same job **twice**: a worker might crash after doing the work but before reporting success, and the job is then retried. So every consumer must be safe to run twice.
**Why it's handled:**

- **Notifications:** a unique index on (recipient, type, actor, tweet) plus `ON CONFLICT DO NOTHING`.
- **Fan-out:** a repeated tweet ID in a timeline list is merged away at read time.
- **Enqueueing:** uses a fixed job ID (`fanout-<tweetId>`), so a retried request doesn't queue it twice.

This is the same idea as Phase 3's idempotency keys, applied to the consumer side.
**Where:** `notifications_dedupe_idx` in `schema/index.ts`; the `Set` in `TimelineService.page()`; `JobsService.fanout()`.

### Concurrent consumers don't preserve order

**What:** The notifications worker runs 10 jobs at once, so jobs can finish in a different order than they were queued.
**Why it matters:** A notification's time-sorted ID reflects when its job _ran_. For notifications, a few milliseconds of reordering is fine. When order matters (say, "edited" must apply after "created"), you need one consumer per key (a partition), which is what Kafka partitions give you in Phase 7. A test caught this: it expected an exact order and failed about one run in four.
**Where:** `concurrency` in `worker.service.ts`; the comment in `test/notifications.e2e-spec.ts`.

### Fan-out on write (precomputed timelines)

**What:** Each active user has a Redis list `timeline:<userId>` with the IDs of the newest ~800 posts for their home feed. Posting pushes the new ID into every follower's list (in the worker). Reading the first page is now a short `LRANGE` instead of a SQL query across everyone you follow.
**Details that make it work:**

- **Cold lists:** a missing list (new or inactive user) is built once from the Phase 2 query. Idle lists expire after 7 days, so memory goes to active users only.
- **The pusher never creates lists:** it uses `LPUSHX`, which only touches lists that already exist; a cold one is rebuilt later anyway.
- **Read-your-writes:** your own tweet is pushed into _your_ list synchronously, so you see it before the worker runs.
- **Empty timelines still count as built:** a marker entry `0` keeps the key alive, because Redis can't store an empty list.
- **Old pages come from Postgres:** past the 800th entry, reads fall back to the query.
- **Follow and unfollow drop your list,** and the next read rebuilds it. That's simpler than removing one account's tweets by hand. Your earlier question about unfollow cost is answered here: the work happens lazily, once, on your next read.

**Measured** (`npm run lab:fanout`, seeded data, 100 concurrent readers):

| Path                                     | p50         | p99         | Reads/s    |
| ---------------------------------------- | ----------- | ----------- | ---------- |
| Fan-out on read (SQL per request)        | 0.33 ms     | 0.96 ms     | 13,825     |
| Fan-out on write, list + celebrity merge | 0.35 ms     | **0.52 ms** | 12,583     |
| Fan-out on write, list only              | **0.11 ms** | **0.16 ms** | **92,618** |

At this tiny scale (31 follows, 1,500 tweets) Postgres is barely working either way. The point is **where the work lands**:

- **The SQL path** puts every read on Postgres, which has 10 pooled connections and is the hardest part to scale, and its cost grows with how many accounts you follow.
- **The list read** costs the same for 30 or 3,000 follows and never touches Postgres.

**A lesson from measuring:** the first version of the hybrid path did only **4,851 reads/s**, _slower_ than not precomputing at all. It rediscovered your celebrity follows with a join on every read, and it parsed and sorted all 800 list entries to return 20. Storing the celebrity set next to the list and reading only a window of it gave 2.6× more. **Measure before believing the design works.**
**Where:** `api/src/timeline/timeline.service.ts`, `fanout.processor.ts`, `api/scripts/fanout-experiment.ts`.

### Hybrid fan-out (celebrities)

**What:** Accounts with at least `FANOUT_MAX_FOLLOWERS` followers are **not** fanned out. Their tweets are merged into each reader's page at read time, from a stored set of "celebrities you follow" (`timeline:<id>:celebs`, refreshed hourly).
**Why:** Fanning out one tweet from an account with 50 million followers means 50 million list writes, minutes of work, for every tweet. Merging at read time costs each reader one small indexed query per page. Twitter does exactly this. The threshold is 10,000 by default; `api/.env` sets 40 so the seed's three celebrities (about 55 followers each) use the hybrid path locally.
**Trade-offs:**

- **No live banner for celebrities:** their tweets don't trigger the "new posts" banner (nothing is pushed per follower).
- **Crossing the threshold:** an account that drops back below it has its older tweets missing from lists until they're rebuilt.

**Where:** `isCelebrity()`, `storeCelebrities()`, `byAuthors()` in `timeline.service.ts`; test "skips fan-out for big accounts…" in `api/test/timeline.e2e-spec.ts`.

### WebSockets and pub/sub across instances

**What:** The browser keeps one **WebSocket** open to `/ws`; the server pushes small events down it (`{type: 'notification', unread: 3}`, `{type: 'timeline', …}`) instead of the page polling every few seconds. Behind a load balancer, a user's socket lives on one API instance, but events come from anywhere (usually the worker). So events travel through **Redis pub/sub**: the worker `PUBLISH`es to `rt:user:<id>`, and each API instance `SUBSCRIBE`s to the channels of the users connected to _it_.
**Details:**

- **Authentication:** the session cookie (or a Bearer token) is checked during the handshake.
- **Origin check:** browsers attach cookies to WebSocket handshakes from _any_ site, and CORS doesn't apply to WebSockets. Without the check, a malicious page could open a socket as you (cross-site WebSocket hijacking).
- **Heartbeat:** a ping every 30 s detects dead connections, such as a closed laptop lid.
- **Reconnecting:** the browser reconnects with exponential backoff and jitter, so after a deploy thousands of tabs don't reconnect in the same second. It refreshes the session and re-syncs the unread count before reconnecting.

**Measured:** a like reached the other user's notification bell **59 ms** later, through API → queue → worker process → Redis pub/sub → API → WebSocket → browser.
**Where:** `api/src/realtime/realtime.gateway.ts`, `realtime.publisher.ts`; `web/src/components/realtime-provider.tsx`; tests in `api/test/realtime.e2e-spec.ts`.

### The dual-write gap (preview of Phase 5)

**What:** Posting writes the tweet to Postgres, _then_ adds a job to Redis. If the process crashes between the two, or Redis is down at that moment, the tweet exists but its fan-out and notifications never happen.
**Today:** enqueueing failures are logged, and the tweet still appears (cold timelines rebuild from Postgres; your own list gets a direct push).
**Phase 5:** the **transactional outbox** fixes this properly: the job is written to a Postgres table _in the same transaction as the tweet_, and a relay moves it to the queue.
**Where:** `JobsService.add()` in `api/src/jobs/jobs.module.ts`.

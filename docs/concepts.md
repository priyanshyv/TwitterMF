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

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

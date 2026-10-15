# TwitterMF: context for Claude

## What this project is

A Twitter clone built to be very scalable on **free resources only**, and deployed later. The owner is building it **to learn system design hands-on**. Each phase introduces a real distributed-systems concept (bloom filter, rate limiter, circuit breaker, queues, Kafka, consistent hashing…) at the point where the app actually needs it. Learning and portfolio quality matter as much as shipping features.

- Full plan with concept tags: [docs/ROADMAP.md](docs/ROADMAP.md). It is the source of truth; keep it updated.
- Concepts log: [docs/concepts.md](docs/concepts.md). Add an entry (What / Why / Where / Try it) whenever a concept's code lands.
- Status: **Phases 1 and 2 done** (2026-10-15). **Next: Phase 3 (caching and engagement), starting with likes and replies.**

## How to work with the owner

- Explain the concept behind each piece of code: what it is, why this app needs it now, and what breaks without it. Prefer letting them see it working, e.g. stop a container and watch the behavior.
- Build the simple version first, measure, then add the scalable version. Don't add infrastructure before the roadmap calls for it.
- **Kafka (via Redpanda) only in Phase 7**, after load tests show BullMQ is the limit. The owner chose this explicitly.
- Free tools only. Nothing that needs a credit card except optional free tiers.

## Stack and decisions

| Area         | Choice                                               | Notes                                                                        |
| ------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Monorepo     | npm workspaces (`api`, `web`)                        | pnpm/corepack failed: no write access to `/usr/local/bin` on the owner's Mac |
| API          | NestJS 12 on Fastify, ESM                            | Imports need `.js` extensions (`nodenext`). Port **4000**                    |
| Web          | Next.js 16 (App Router, `cacheComponents: true`)     | Port **3001**; port 3000 is used by another of the owner's apps              |
| UI           | shadcn/ui (Radix, "nova" preset) + Tailwind v4       | Neutral, minimal, X-like look; dark mode via next-themes (`.dark` class)     |
| DB           | Postgres 16 + Drizzle ORM (`drizzle-kit`)            | Chosen so the SQL stays visible and tunable                                  |
| Cache/queues | Redis 8 (ioredis 6); BullMQ from Phase 4             | Redis 8 has bloom filters (`BF.*`) built in                                  |
| Auth         | argon2id + jose (HS256 JWT) + @fastify/cookie        | httpOnly cookies `tmf_at` (15 min) / `tmf_rt` (30 days, rotating)            |
| Config       | zod-validated env in `api/src/config/env.ts`         | App crashes at boot on bad env                                               |
| Logs         | nestjs-pino (pretty in dev, JSON otherwise)          | `/health` excluded from request logs                                         |
| Tests        | Vitest 4: `*.spec.ts` unit, `test/*.e2e-spec.ts` e2e | e2e hits real Postgres + Redis                                               |
| Lint         | oxlint (api), eslint (web), prettier at root         |                                                                              |
| CI           | `.github/workflows/ci.yml`                           | lint, typecheck, build, test, test:e2e with service containers               |

## Commands (repo root)

```bash
npm run setup        # install + create api/.env and web/.env.local from examples
npm run dev          # scripts/dev.mjs: checks Docker, starts infra, then api + web with short prefixed logs
npm run infra:up | infra:down | infra:reset   # reset deletes local data
npm run lint && npm run typecheck && npm run build && npm test && npm run test:e2e
npm run db:generate | db:migrate | db:studio
npm run lab:explain  # EXPLAIN ANALYZE lab on 1M tweets (indexes, LATERAL)
npm run lab:bloom    # bloom filter false-positive experiment
```

Run the full check line above before every commit; CI runs the same steps.

## Code map and conventions

- `api/src/config/`: `ENV` injection token (a symbol), `loadEnv()`. Inject with `@Inject(ENV) env: Env`.
- `api/src/db/`: global `DbModule` provides `PG_POOL` (pg Pool, max 10, 2s connect timeout) and `DB` (Drizzle `Database`). Tables go in `src/db/schema/index.ts`.
- `api/src/redis/`: global `RedisModule` provides `REDIS` (ioredis, `maxRetriesPerRequest: 1`).
- `api/src/common/with-timeout.ts`: wrap every external call in a deadline.
- `api/src/health/`: `GET /health` returns 200 or 503 with per-dependency status.
- `api/src/common/`: `snowflake.ts` + `IdModule` (`SNOWFLAKE` token) for all IDs; `zod.pipe.ts` (`new ZodPipe(schema)` on `@Body`/`@Query`/`@Param`); `pagination.ts` (`PageQuerySchema`, `toPage` with the limit+1 trick); `pg-errors.ts`.
- `api/src/auth/`: `AuthGuard` (cookie or Bearer) is global; protect routes with `@UseGuards(AuthGuard)`, allow anonymous with `@OptionalAuth()`, read the user with `@CurrentUser()`. `TokensService.rotate()` holds the refresh/reuse logic.
- `api/src/users/` (profiles, follows, suggestions), `api/src/tweets/` (create, by author, timeline), `api/src/usernames/` (bloom filter).
- IDs: `bigint` in the DB and in TypeScript (`mode: 'bigint'`), **strings** in every API response (DTO mappers `toPublicUser`, `toTweetView`). Never send a BigInt to JSON.
- Raw SQL via `db.execute(sql...)` returns bigint as string and timestamps as Postgres text, so select timestamps with `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`(see`TWEET_COLUMNS`).
- Web: server components fetch through `web/src/lib/api/server.ts` (forwards cookies); client components use `api()` from `web/src/lib/api/client.ts` (refresh once on 401, then retry). `web/src/proxy.ts` refreshes expiring access tokens before pages render. After a mutation, call `router.refresh()`.
- Every module that holds connections implements `onApplicationShutdown`; `main.ts` calls `enableShutdownHooks()`.
- Use explicit `@Inject(TOKEN)` everywhere: Vitest doesn't emit decorator metadata, so class-type injection breaks in tests.
- e2e tests use `app.inject()` (Fastify), not supertest, and override providers to simulate failures. Use `createTestApp`, `resetData` and `signup` from `test/helpers.ts`. They run against a separate `twitter_test` database and Redis DB 1 (set in `vitest.config.e2e.ts`), one file at a time.
- Web UI: add components with `npx shadcn@latest add <name>` from `web/`, then run prettier. They land in `web/src/components/ui/` and are ours to edit. Use theme tokens (`bg-background`, `text-muted-foreground`, …), never raw colors, so dark mode keeps working. Keep the look minimal and neutral.
- Comments explain _why_ (the concept), briefly. Match the existing style.

## Gotchas found so far

- Next 16 differs from older versions: read `web/node_modules/next/dist/docs/` (or root `node_modules/next/dist/docs/`) before writing web code. Request-time data goes in `<Suspense>`, with `await connection()` from `next/server`.
- `web` typecheck must run `next typegen` first (already in the script) for the global `LayoutProps` types.
- `web/.gitignore` ignores `.env*`, with an exception for `.env.example`.
- shadcn's `cn` helper comes from the `cn` npm package (by shadcn, replaces clsx + tailwind-merge); it is legitimate.
- Headless Chrome screenshots: windows can't go below ~500px wide, so a narrower "phone" screenshot looks cropped. Use 500px.
- pino-http's `autoLogging.ignore` doesn't work under Nest; use nestjs-pino's `exclude` instead.
- Docker Desktop must be running before `npm run dev` (the dev script checks and says so).
- Dev log output is kept minimal on purpose: `scripts/dev.mjs` filters known banner noise (`NOISE` list), and `api/src/config/logger.ts` hides Nest's boot chatter in dev only. Production logs stay full JSON.
- pino crashes on `hooks: undefined`; add optional pino options with a conditional spread. Vitest runs with `NODE_ENV=test`, which catches this.
- The ioredis client needs an `error` listener, or every reconnect attempt prints an unhandled error (see `redis.module.ts`).
- Schema changes: edit `schema/index.ts`, then `npm run db:generate -- --name <what_changed>`; never edit a migration that has run.
- Vitest's `globalSetup` runs before `test.env` applies; read config from the `TestProject` argument (see `test/global-setup.ts`).
- React lint (`react-hooks/set-state-in-effect`) rejects `setState` called directly in an effect: derive state during render instead (see `signup-form.tsx`).
- Next.js streams `<Suspense>` content after load; in browser tests, wait for elements (`waitFor`) instead of checking `isVisible()` right after `goto`.
- Bloom filters can't delete: names of deleted accounts stay "maybe taken" and fall through to Postgres (correct, just slower).

## Next steps (Phase 3: Caching and engagement)

1. Likes (table exists) and replies (`reply_to_id` + thread view), then retweets.
2. Cache hot objects in Redis: cache-aside with TTL jitter and a single-flight lock against stampedes.
3. Move like/reply/follower counts to Redis counters, flushed to Postgres every minute (write-behind). Replace the `COUNT(*)` in `FollowsService.stats`.
4. Rate limiting two ways (token bucket and sliding-window log), each as a Redis Lua script; start with login and posting.
5. Idempotency keys on `POST /tweets`.

When a task is done, tick it in `docs/ROADMAP.md` and add its concept to `docs/concepts.md`.

# TwitterMF: context for Claude

## What this project is

A Twitter clone built to be very scalable on **free resources only**, and deployed later. The owner is building it **to learn system design hands-on**. Each phase introduces a real distributed-systems concept (bloom filter, rate limiter, circuit breaker, queues, Kafka, consistent hashing…) at the point where the app actually needs it. Learning and portfolio quality matter as much as shipping features.

- Full plan with concept tags: [docs/ROADMAP.md](docs/ROADMAP.md). It is the source of truth; keep it updated.
- Concepts log: [docs/concepts.md](docs/concepts.md). Add an entry (What / Why / Where / Try it) whenever a concept's code lands.
- Status: **Phases 1–5 done** (2026-10-18). **Next: Phase 6 (prove it scales), starting with a bigger seed and Prometheus + Grafana.**

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
| Cache/queues | Redis 8 (ioredis 6); BullMQ 6                        | Redis 8 has bloom filters (`BF.*`) built in                                  |
| Storage      | RustFS 1.0.3 (S3 API) via @aws-sdk/client-s3         | MinIO stopped publishing free images; same code works on R2                  |
| Search       | Meilisearch v1.55 (`meilisearch` client 0.62)        | Fed by outbox jobs; Postgres ILIKE + pg_trgm fallback behind a breaker       |
| Images       | sharp                                                | WebP 1600/600, EXIF stripped, in the worker                                  |
| Real-time    | `ws` WebSocket server on the API at `/ws`            | Redis pub/sub `rt:user:<id>` between worker and API instances                |
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
npm run dev:stop     # stops a running npm run dev from this repo, from any terminal (graceful SIGINT)
npm run infra:up | infra:down | infra:reset   # reset deletes local data
npm run lint && npm run typecheck && npm run build && npm test && npm run test:e2e
npm run db:generate | db:migrate | db:studio
npm run lab:explain  # EXPLAIN ANALYZE lab on 1M tweets (indexes, LATERAL)
npm run lab:bloom    # bloom filter false-positive experiment
npm run lab:stampede # cache stampede: 1,000 misses -> 1,000 / 4 / 1 DB queries
npm run lab:ratelimit # naive vs Lua limiter under concurrency; bucket vs window
npm run db:seed      # ~60 fake people + tweets/likes/follows (-- --reset wipes all); login demo / password123
npm run counters:reconcile  # recompute stored counts from source rows
npm run jobs         # queue sizes + dead-letter queue; -- --replay re-runs dead jobs
npm run lab:fanout   # fan-out on read vs write, latency + throughput
npm run lab:breaker  # a dead dependency with and without a circuit breaker
npm run search:reindex  # rebuild Meilisearch indexes + trending from Postgres
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
- `api/src/users/` (profiles, follows, suggestions; `UserRecordsService` = cached users + live counts, in its own `UserRecordsModule` to avoid a users<->tweets cycle), `api/src/tweets/` (create/reply, like, retweet, timeline, thread, replies), `api/src/usernames/` (bloom filter).
- `api/src/cache/`: `RedisCache` (`CACHE` token): `getMany(keys, ttl, loader)` / `get` / `invalidate`. Cache-aside with TTL jitter, negative caching (`'null'` for 30 s), single-flight + Redis lock. Keys: `cache:tweet:<id>`, `cache:user:<id>`, `cache:uname:<lower>`.
- `api/src/counters/`: `CountersService.change([...])` for every count change (never `UPDATE ... count + 1` directly); `pending()` to overlay; `flush()` every `COUNTER_FLUSH_INTERVAL_MS`; `reconcile()`. Redis keys `counter:<entity>:<id>` + set `counter:dirty`.
- `api/src/rate-limit/`: policies in `policies.ts`; put `@RateLimit('<policy>')` under the route decorator (after `@UseGuards(AuthGuard)` for per-user). Keys `rl:<policy>:<subject>`.
- `api/src/idempotency/`: `@Idempotent()` on create endpoints; keys `idem:<userId>:<key>`.
- Feeds: queries return IDs only, then `hydrate()` builds `FeedItem { id (row/cursor), retweetedBy, tweet: TweetView }`. Retweets are tweet rows with `retweet_of_id` and empty text; actions on a retweet target the original (`contentId()`).
- IDs: `bigint` in the DB and in TypeScript (`mode: 'bigint'`), **strings** in every API response (DTO mappers `toPublicUser`, `toTweetView`). Never send a BigInt to JSON.
- Raw SQL via `db.execute(sql...)` returns bigint as string and timestamps as Postgres text, so select timestamps with `to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`(see`TWEET_COLUMNS`).
- Web layout: `web/src/components/shell/`: `SideNav` (desktop sticky left nav: Home, Notifications with live `UnreadBadge`, Profile, Post, account chip) and `MobileNav` (top bar + bottom tab bar), both in the root layout. Pages wrap content in `<Columns>` (600px bordered column + sticky right rail with Who to follow; `aside={false}` to drop it) and start with `<PageHeader title subtitle? back?>` (sticky, blurred).
- Avatars: always pass `seed={username}` to `UserAvatar` (stable per-person color); initials inherit the avatar's font size. Profile banners: `bannerStyle(username)`.
- Web: tweet UI is `FeedItemCard` / `TweetCard` (`large` for the focused tweet) + client `TweetActions` (optimistic like/retweet, tinted hover circles, `animate-pop` on the user's own toggle); thread page `/[username]/status/[id]`; links via `tweetHref()`. Server components fetch through `web/src/lib/api/server.ts` (forwards cookies); client components use `api()` from `web/src/lib/api/client.ts` (refresh once on 401, then retry). `web/src/proxy.ts` refreshes expiring access tokens before pages render. After a mutation, call `router.refresh()`.
- Every module that holds connections implements `onApplicationShutdown`; `main.ts` calls `enableShutdownHooks()`.
- Use explicit `@Inject(TOKEN)` everywhere: Vitest doesn't emit decorator metadata, so class-type injection breaks in tests.
- Test isolation for Phase 5: bucket `twittermf-test`, Meilisearch indexes prefixed `test_`, `BREAKER_RESET_MS=300` (all in `vitest.config.e2e.ts`); `resetData` clears test indexes. Fake Meilisearch outages by wrapping the client's `index()` (see `search.e2e-spec.ts`); fake Redis outages by stubbing a queue's `addBulk`.
- e2e tests use `app.inject()` (Fastify), not supertest, and override providers to simulate failures. Use `createTestApp` (runs the workers in-process by default), `settle(app)` (wait for queues to drain), `resetData` and `signup` from `test/helpers.ts`. Fake Redis stubs need `duplicate()` (the gateway's subscriber). WebSocket tests: `app.listen(0)` + the `ws` client. They run against a separate `twitter_test` database and Redis DB 1 (set in `vitest.config.e2e.ts`), one file at a time, with `RATE_LIMIT_ENABLED=false` and `COUNTER_FLUSH_INTERVAL_MS=0` (call `CountersService.flush()` by hand). To test limits, override `ENV` (see `rate-limit.e2e-spec.ts`).
- Redis DBs: 0 = dev app, 1 = tests, 2 = lab scripts. Everything in Redis is derived and can be flushed, except queued jobs (flushing drops pending fan-out/notifications).
- Processes: `api` (`src/main.ts`, HTTP + WebSockets), `job` (`src/worker.ts`, BullMQ consumers; boots `WorkerModule` = AppModule + workers via `createApplicationContext`), `web`. `npm run dev` starts all three, the worker after the API is healthy.
- `api/src/jobs/`: queue names, job payloads and retry options in `queues.ts`. **Produce jobs only via the outbox**: `outbox.add(tx, [message.fanout(...), message.notify(...), message.search(...), message.media(...)])` inside the same `db.transaction` as the change. `OutboxRelay` (worker only) moves rows to BullMQ (LISTEN/NOTIFY + 1 s poll, `FOR UPDATE SKIP LOCKED`, job ID `outbox-<id>`). Job IDs can't contain `:`. Dead letters: `dead-letter.ts`. New job type = payload in `queues.ts` + `message.*` helper + relay `QUEUE_KEY` + a consumer in `worker.service.ts` + `settle()` queue list in `test/helpers.ts`.
- `api/src/storage/`: `StorageService` (bucket setup on boot, `presignUpload`, `head` behind the storage breaker, `get/put/delete`, `publicUrl`). Keys: `uploads/<id>` private, `media/<id>/{large,small}.webp` public.
- `api/src/media/`: `MediaService` (createUpload / complete / attach in the tweet tx / forTweets), `MediaProcessor` (worker; `UnrecoverableError` for bad files). Tweet records carry `media` in the cache; the processor invalidates `cache:tweet:<id>` (twice).
- `api/src/search/`: `SearchService` (Meilisearch through `breakers.run('search', ...)`, Postgres fallback returns `source: 'postgres'`; `indexTweet/indexUser` idempotent from current DB state; `reindexAll`), `TrendsService` (hour buckets `trends:h:<hour>`, Lua weighted union, 60 s cache `trends:top`), `SearchProcessor`. Hashtags: `common/hashtags.ts` (`HASHTAG_CHARS` includes `\p{M}`).
- `api/src/breakers/`: `BreakersService.run(name, task)`; add a name to `BreakerName` + `SETTINGS` for a new dependency. `/health` shows states; optional deps never fail readiness.
- `api/src/timeline/`: `TimelineService.page()` (window read of `timeline:<id>` + merge of `timeline:<id>:celebs` authors), `push()` (LPUSHX, worker), `invalidate()` on follow/unfollow. `FanoutProcessor` runs in the worker. Lists end with sentinel `0`.
- `api/src/notifications/`: `NotificationsService.handle(job)` (worker side; dedupe via unique index) and `list/unreadCount/markAllRead` (API side).
- `api/src/realtime/`: `RealtimePublisher.publish(userIds, event)` from anywhere; `RealtimeGateway` only activates when an HTTP server exists. Events: `notification {unread}`, `timeline {tweetId, authorId}`; add new ones to both `realtime.publisher.ts` and `web/src/lib/api/types.ts`.
- Web realtime: `RealtimeProvider` in the root layout; use `useRealtime(listener)` in client components (the socket opens only while something listens). Bell = `notification-bell.tsx`, banner = `new-posts-banner.tsx`, page `/notifications`.
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
- `npm run dev` refuses to start if ports 4000/3001 are taken and names the culprit; usually an old `npm run dev` in another terminal tab (`npm run dev:stop`). It starts the API first and the web app only once `/health` answers, so open tabs don't hit a half-started API.
- The header (`UserNav`) lives in the root layout, which `app/error.tsx` can't catch; it must never throw. Page-level fetch failures surface as "API unreachable at ..." and render `app/error.tsx` (Next 16 passes `retry`, not `reset`). In dev, Next's overlay sits on top of it.
- Dev log output is kept minimal on purpose: `scripts/dev.mjs` filters known banner noise (`NOISE` list), and `api/src/config/logger.ts` hides Nest's boot chatter in dev only. Production logs stay full JSON.
- pino crashes on `hooks: undefined`; add optional pino options with a conditional spread. Vitest runs with `NODE_ENV=test`, which catches this.
- The ioredis client needs an `error` listener, or every reconnect attempt prints an unhandled error (see `redis.module.ts`).
- Schema changes: edit `schema/index.ts`, then `npm run db:generate -- --name <what_changed>`; never edit a migration that has run.
- Vitest's `globalSetup` runs before `test.env` applies; read config from the `TestProject` argument (see `test/global-setup.ts`).
- React lint (`react-hooks/set-state-in-effect`) rejects `setState` called directly in an effect: derive state during render instead (see `signup-form.tsx`).
- Next.js streams `<Suspense>` content after load; in browser tests, wait for elements (`waitFor`) instead of checking `isVisible()` right after `goto`.
- Bloom filters can't delete: names of deleted accounts stay "maybe taken" and fall through to Postgres (correct, just slower).
- CORS on Fastify defaults to GET/HEAD/POST only; methods and exposed headers are listed in `app.setup.ts`. Any new custom request header works (headers are reflected), but new response headers browsers must read go in `exposedHeaders`.
- ioredis 6 speaks RESP3: `ZRANGE ... WITHSCORES` and similar return nested pairs, not flat arrays. Inside Lua scripts replies are flat; prefer Lua for multi-step logic anyway.
- Drizzle `sql` templates: pass arrays via query builder `inArray()`, not `${array}` inside raw SQL.
- Browser tests of optimistic UI must wait for the server response (`page.waitForResponse`), or they pass even when the request fails.
- `db:seed` boots the app via `NestFactory.createApplicationContext`; reuse this pattern for one-off scripts instead of duplicating service logic.
- Browser automation: log in once and reuse `storageState`; ~10 logins in 15 min trips the login rate limit (clear `rl:login:*` in Redis DB 0 if needed). Playwright screenshots before hydration add `caret-color` to inputs, which shows up as a hydration-mismatch "issue" in Next's dev overlay; not an app bug.
- Seed assigns Snowflake IDs in time order with worker 1023 (reserved for scripts); `created_at` must match the ID's timestamp or feeds sort wrongly.
- BullMQ 6 needs its own ioredis connection with `maxRetriesPerRequest: null`; `QUEUE_CONNECTION` is shared by queues and workers and closed by `JobsModule`. Close workers in `beforeApplicationShutdown` (before the connection goes).
- Array pipelines: `.filter().filter().map()` runs each step over the whole array, so "seen so far" sets filled in a later step are empty in an earlier one; use a loop (bug found in notification dedupe).
- Concurrent workers finish jobs out of order; never assert exact order of worker-produced rows in tests.
- WebSockets aren't covered by CORS; the gateway checks `Origin` itself. Cookies reach the API's `/ws` because localhost:3001 and :4000 are the same site.
- Measure: `lab:fanout` showed the first hybrid read slower than fan-out on read until the celebrity set was stored and the list read in windows. Re-run it after timeline changes.
- `FANOUT_MAX_FOLLOWERS=40` in dev `.env` (seed celebrities have ~55 followers); default 10000.
- Hashtag/word regexes must include `\p{M}` (combining marks) or Indic scripts break (`#भारत` -> `#भ`).
- Lua: `unpack(t)` only expands fully as the LAST argument; build an args table and `redis.call(unpack(args))`.
- When a worker updates a row other requests may have changed meanwhile, read the fields it needs from `UPDATE ... RETURNING`, not an earlier SELECT (media/tweet cache race).
- Trends are cached 60 s, so a new hashtag appears within a minute. Seeded tweets are older than 24 h, so dev trends start empty.
- Next's `@next/next/no-img-element` warns on `<img>`; we use plain img for already-resized storage URLs with an eslint-disable comment.
- Docker images: MinIO's free images are gone (pull fails); SeaweedFS failed presigned PUT and public-read in our probe; RustFS passed all checks.

## Next steps (Phase 6: Prove it scales)

1. Bigger seed: ~1M users / 20M tweets with a few celebrity accounts (COPY or batched inserts; keep `npm run db:seed` small, add a separate `db:seed:big`).
2. Monitoring: Prometheus + Grafana in docker-compose; expose metrics (request p95/p99 by route, DB pool usage, Redis memory, queue depth, outbox lag, breaker state).
3. k6 load tests: timeline reads, posting, following; record requests/s per endpoint.
4. Fix the top 3 bottlenecks the data shows (EXPLAIN ANALYZE + dashboards only).
5. PgBouncer; a Postgres read replica + 2 API instances behind Nginx (read-your-writes from the primary).
6. Consistent hashing for the timeline cache across 2-3 Redis nodes; bulkheads (separate pools/limits so slow search can't starve timelines).

When a task is done, tick it in `docs/ROADMAP.md` and add its concept to `docs/concepts.md`.

# TwitterMF: context for Claude

## What this project is

A Twitter clone built to be very scalable on **free resources only**, and deployed later. The owner is building it **to learn system design hands-on**. Each phase introduces a real distributed-systems concept (bloom filter, rate limiter, circuit breaker, queues, Kafka, consistent hashing…) at the point where the app actually needs it. Learning and portfolio quality matter as much as shipping features.

- Full plan with concept tags: [docs/ROADMAP.md](docs/ROADMAP.md). It is the source of truth; keep it updated.
- Concepts log: [docs/concepts.md](docs/concepts.md). Add an entry (What / Why / Where / Try it) whenever a concept's code lands.
- Status: **Phase 1 done** (2026-10-14). **Next: Phase 2, starting with the schema design.**

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
| Cache/queues | Redis 7 (ioredis 6); BullMQ from Phase 4             |                                                                              |
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
```

Run the full check line above before every commit; CI runs the same steps.

## Code map and conventions

- `api/src/config/`: `ENV` injection token (a symbol), `loadEnv()`. Inject with `@Inject(ENV) env: Env`.
- `api/src/db/`: global `DbModule` provides `PG_POOL` (pg Pool, max 10, 2s connect timeout) and `DB` (Drizzle `Database`). Tables go in `src/db/schema/index.ts`.
- `api/src/redis/`: global `RedisModule` provides `REDIS` (ioredis, `maxRetriesPerRequest: 1`).
- `api/src/common/with-timeout.ts`: wrap every external call in a deadline.
- `api/src/health/`: `GET /health` returns 200 or 503 with per-dependency status.
- Every module that holds connections implements `onApplicationShutdown`; `main.ts` calls `enableShutdownHooks()`.
- Use explicit `@Inject(TOKEN)` everywhere: Vitest doesn't emit decorator metadata, so class-type injection breaks in tests.
- e2e tests use `app.inject()` (Fastify), not supertest, and override providers to simulate failures (see `test/health.e2e-spec.ts`).
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

## Next steps (Phase 2: Core monolith)

1. Schema: users, tweets, follows, likes. Indexes `tweets(author_id, id desc)`, `follows(follower_id)`, `follows(followee_id)`. Show `EXPLAIN` before and after.
2. Drizzle migrations.
3. Snowflake ID generator (timestamp + worker id + sequence), with unit tests.
4. Auth: argon2, short-lived JWT access token, rotating refresh tokens with reuse detection.
5. Bloom filter for "username taken?", hand-built on Redis `SETBIT`/`GETBIT` with k hashes. Measure the false-positive rate, then compare with RedisBloom.
6. Then tweets, follow/unfollow, profile, timeline v1 (fan-out on read), cursor pagination, and the frontend screens.

When a task is done, tick it in `docs/ROADMAP.md` and add its concept to `docs/concepts.md`.

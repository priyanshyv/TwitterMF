# TwitterMF

A Twitter clone built to scale on free tools, and built to teach. Every phase introduces a real distributed-systems concept (caching, rate limiting, bloom filters, queues, circuit breakers, Kafka…) at the point where the app actually needs it.

Roadmap: [docs/ROADMAP.md](docs/ROADMAP.md) (interactive checklist: https://claude.ai/artifact/FMhF5s4nSK617FuuXADcKC)
Concepts learned so far: [docs/concepts.md](docs/concepts.md)

## Stack

| Layer          | Tool                          | Why                                                                                                 |
| -------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| API            | NestJS 12 on Fastify          | Modules + DI make it easy to plug in caches, queues and breakers; Fastify is ~2x Express throughput |
| Web            | Next.js 16 (App Router)       | Server components; streaming                                                                        |
| Database       | PostgreSQL 16 + Drizzle ORM   | SQL you can see and tune; Aurora-compatible later                                                   |
| Cache / queues | Redis 7 (BullMQ from Phase 4) | One tool for cache, counters, rate limits, bloom filter, job queue                                  |
| Logs           | pino (JSON)                   | Structured logs, ready for Grafana/Loki                                                             |
| Tests          | Vitest                        | Fast; e2e tests hit real Postgres and Redis                                                         |

## Quick start

Needs Node 24 and Docker Desktop (running).

```bash
npm run setup   # install deps, create api/.env and web/.env.local from the examples
npm run dev     # starts Postgres + Redis in Docker, then the API and web app
```

- Web: http://localhost:3001
- API: http://localhost:4000/health

To get a populated network to play with, run `npm run db:seed` and log in as **demo** / **password123**.

## Scripts (run from the repo root)

| Command                                                                | What it does                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`                                                          | Infra up, then API (watch mode) and web together                                     |
| `npm run infra:up` / `infra:down`                                      | Start / stop Postgres and Redis                                                      |
| `npm run infra:reset`                                                  | Stop and **delete** local DB and Redis data                                          |
| `npm run lint` / `typecheck` / `build`                                 | Checks for both apps (CI runs these)                                                 |
| `npm test` / `npm run test:e2e`                                        | Unit tests / API e2e tests (needs infra up)                                          |
| `npm run db:generate` / `db:migrate`                                   | Create / apply Drizzle migrations                                                    |
| `npm run db:studio`                                                    | Browse the database in Drizzle Studio                                                |
| `npm run db:seed`                                                      | Add ~60 fake people, tweets, likes and follows (`-- --reset` wipes everything first) |
| `npm run counters:reconcile`                                           | Recompute every stored count from the source rows                                    |
| `npm run lab:explain` / `lab:bloom` / `lab:stampede` / `lab:ratelimit` | Experiments that measure each concept                                                |

## Layout

```
api/     NestJS API: src/config (env validation), src/db (Drizzle), src/redis, src/health
web/     Next.js app
infra/   docker-compose.yml for local Postgres and Redis
docs/    concepts.md: what each concept is, why we need it, where it lives in the code
```

## MVP scope

In: auth, tweets, follows, home timeline, profiles, likes, replies.
Out for now: DMs, search, media (search and media arrive in Phase 5).

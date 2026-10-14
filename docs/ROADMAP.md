# Roadmap

From an empty repo to a load-tested, deployed Twitter clone on free tools. Each task lists the concepts it teaches. Tick tasks as they ship.

## 1. Set up the workshop (week 1): done

Done when the API and web app both run locally with one command.

- [x] Install the basics: Git, Docker Desktop, Node.js 24. _Concepts: none_
- [x] Create the repo: npm-workspaces monorepo with /api, /web, /infra, /docs. _Concepts: monorepo_
- [x] Write the MVP scope in the README. _Concepts: none_
- [x] Start Postgres 16 and Redis 7 with Docker Compose, using healthchecks and `up --wait`. _Concepts: container healthchecks_
- [x] Scaffold the apps: NestJS on Fastify with zod-validated env; the Next.js page shows live API/DB/Redis status. _Concepts: 12-factor config, graceful shutdown_
- [x] Health endpoint with deadlines: `GET /health` with a 1s timeout per dependency, 503 naming whichever is down. _Concepts: health checks, timeouts_
- [x] CI on every push: lint, typecheck, build, unit and e2e tests against real Postgres and Redis. _Concepts: CI_

## 2. Core monolith (weeks 2–4)

Done when two accounts can follow each other and see each other's tweets.

- [ ] Design the schema: users, tweets, follows, likes. Index `tweets(author_id, id desc)`, `follows(follower_id)`, `follows(followee_id)`. Run EXPLAIN before and after. _Concepts: B-tree indexes_
- [ ] Set up migrations with drizzle-kit. _Concepts: schema migrations_
- [ ] Snowflake-style ID generator: 64-bit IDs from timestamp + worker ID + sequence. Unique across instances, sortable by time, no DB round trip. _Concepts: Snowflake IDs_
- [ ] Build auth: argon2 password hashing, a short-lived JWT access token, and a refresh token that rotates on every use (reuse means theft, so revoke the family). _Concepts: password hashing, JWT + refresh rotation_
- [ ] Bloom filter for "username taken?": hand-built on Redis SETBIT/GETBIT with k hashes. "No" is certain; "maybe" falls back to Postgres. Measure the false-positive rate against size, then compare with RedisBloom `BF.ADD`. _Concepts: bloom filter, probabilistic data structures_
- [ ] Post a tweet: `POST /tweets`, 280-character limit, zod validation. _Concepts: input validation_
- [ ] Follow and unfollow: `POST`/`DELETE /users/:id/follow`; block following yourself.
- [ ] Profile endpoint: user info plus their tweets, newest first.
- [ ] Home timeline v1 (fan-out on read): one SQL query joining follows and tweets, ordered by tweet ID. _Concepts: fan-out on read_
- [ ] Cursor pagination: `?before=<tweetId>` instead of OFFSET everywhere. _Concepts: cursor pagination_
- [ ] Frontend screens: login, signup, compose box, home feed, profile.

## 3. Caching and engagement (weeks 5–6)

Done when feeds load from cache and likes, replies and retweets work.

- [ ] Likes and replies (`reply_to_id`, thread view).
- [ ] Retweets: a tweet that references the original.
- [ ] Cache hot objects in Redis: cache-aside, TTL jitter, and a single-flight lock against stampedes. _Concepts: cache-aside, cache stampede protection_
- [ ] Move counters to Redis: INCR counters flushed to Postgres every minute. _Concepts: write-behind_
- [ ] Rate limiting, two ways: token bucket and sliding-window log, each as an atomic Redis Lua script. _Concepts: rate limiter, atomic Lua scripts_
- [ ] Idempotency keys on `POST /tweets`: a retry with the same `Idempotency-Key` returns the first result. _Concepts: idempotency_
- [ ] Integration tests for auth, posting, rate limits and the timeline.

## 4. Async work and real-time (weeks 7–9)

Done when posting a tweet updates followers' feeds in the background and notifications arrive live.

- [ ] BullMQ worker process, separate from the API. _Concepts: message queues, producer/consumer_
- [ ] Retries with exponential backoff and jitter; a dead-letter queue after 5 failures, with replay. _Concepts: exponential backoff, dead-letter queue_
- [ ] Fan-out on write: push the tweet ID to each follower's Redis list, capped at ~800 entries. _Concepts: fan-out on write_
- [ ] Hybrid timeline: skip fan-out above 10k followers and merge at read time. _Concepts: hybrid fan-out_
- [ ] Notifications: table plus worker (follows, likes, replies, mentions).
- [ ] WebSocket gateway, with Redis pub/sub so it works across API instances. _Concepts: WebSockets, pub/sub_

## 5. Media and search (weeks 10–11)

Done when users can attach images and search, and a search outage doesn't take the app down.

- [ ] MinIO in Docker Compose (S3-compatible; Cloudflare R2 later). _Concepts: object storage_
- [ ] Presigned uploads straight from the browser. _Concepts: presigned URLs_
- [ ] Image resize worker (sharp).
- [ ] Meilisearch fed through a transactional outbox. _Concepts: transactional outbox, eventual consistency_
- [ ] Circuit breaker (opossum) around search and storage: open for 30s, fall back to Postgres ILIKE, half-open probe. _Concepts: circuit breaker, graceful degradation_
- [ ] Hashtags and trending: Redis sorted set with time decay. _Concepts: sorted sets, time-decay ranking_

## 6. Prove it scales (weeks 12–14)

Done when you have requests-per-second numbers for each endpoint.

- [ ] Seed ~1M users and 20M tweets, including a few celebrity accounts.
- [ ] Prometheus + Grafana: p95/p99 latency, DB connections, Redis memory, queue depth. _Concepts: observability, tail latency_
- [ ] k6 load tests: timeline reads, posting, following. _Concepts: load testing_
- [ ] Fix the top 3 bottlenecks the data shows (EXPLAIN ANALYZE). _Concepts: query planning_
- [ ] PgBouncer. _Concepts: connection pooling_
- [ ] Read replica + 2 API instances behind Nginx; read-your-writes from the primary. _Concepts: read replicas, load balancing_
- [ ] Shard the timeline cache over 2 Redis nodes on a consistent-hash ring with virtual nodes; add a third and measure how many keys move. _Concepts: consistent hashing, sharding_
- [ ] Bulkheads: separate pools and limits so slow search can't starve timelines. _Concepts: bulkhead_

## 7. Deploy and split (weeks 15+)

Done when it runs on a public URL with automatic deploys and nightly backups.

- [ ] Oracle Cloud Always Free ARM VM running Docker Compose.
- [ ] Production Postgres on the VM, not exposed publicly.
- [ ] Nightly pg_dump to Cloudflare R2, plus one test restore. _Concepts: backups and restore_
- [ ] Optional: Neon free Postgres for the public demo.
- [ ] Cloudflare in front: DNS, HTTPS, caching, R2 for media. _Concepts: CDN_
- [ ] Continuous deployment from GitHub Actions on merge to main. _Concepts: CD_
- [ ] Kafka via Redpanda: `tweets.created` partitioned by author_id; consumer groups for fan-out, notifications and search; replay from an offset. Only once load tests show BullMQ is the limit. _Concepts: Kafka, partitions, consumer groups_
- [ ] Extract the timeline service as the first microservice, consuming Kafka. _Concepts: microservices_
- [ ] Optional: k3s with rolling deploys gated on `/health`. _Concepts: Kubernetes_

import { existsSync } from 'node:fs';
import { z } from 'zod';

// Every setting the API needs, validated once at boot. A missing or malformed
// variable crashes the process immediately instead of failing on first use
// (12-factor: config lives in the environment, not in code).
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
  // Each running API instance needs its own worker ID (0..1023) so their
  // Snowflake IDs never collide.
  WORKER_ID: z.coerce.number().int().min(0).max(1023).default(0),
  // Signs access tokens. Anyone holding it can mint a login, so it is long,
  // random, and never committed for production.
  JWT_SECRET: z.string().min(32),
  // Set in production when web and API live on sibling subdomains
  // (e.g. "example.com" for app.example.com + api.example.com).
  COOKIE_DOMAIN: z.string().optional(),
  // Off in most e2e tests, which create many accounts from one address.
  RATE_LIMIT_ENABLED: z.stringbool().default(true),
  // How often pending counter changes move from Redis to Postgres. 0 turns
  // the timer off (tests flush by hand).
  COUNTER_FLUSH_INTERVAL_MS: z.coerce.number().int().min(0).default(60_000),
  // Authors with at least this many followers are not fanned out on write;
  // their tweets are merged into timelines at read time instead (hybrid).
  FANOUT_MAX_FOLLOWERS: z.coerce.number().int().min(1).default(10_000),
  // First retry delay for background jobs; doubles each attempt.
  JOB_BACKOFF_MS: z.coerce.number().int().min(1).default(1_000),
  // Object storage (S3 API: RustFS locally, Cloudflare R2 in production).
  // ENDPOINT is how this server reaches it; PUBLIC_ENDPOINT is how browsers
  // do (presigned upload URLs are signed for that host); MEDIA_BASE_URL is
  // where finished images are served from (a CDN in production).
  STORAGE_ENDPOINT: z.url().default('http://localhost:9000'),
  STORAGE_PUBLIC_ENDPOINT: z.url().default('http://localhost:9000'),
  STORAGE_BUCKET: z.string().min(3).default('twittermf'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_ACCESS_KEY: z.string().default('twitter'),
  STORAGE_SECRET_KEY: z.string().default('twitter-dev-secret'),
  MEDIA_BASE_URL: z.url().optional(), // default: <public endpoint>/<bucket>
  // Full-text search.
  MEILI_URL: z.url().default('http://localhost:7700'),
  MEILI_KEY: z.string().default('twitter-dev-master-key'),
  SEARCH_INDEX_PREFIX: z.string().default(''), // tests use their own indexes
  // How long a tripped circuit breaker stays open before probing again.
  BREAKER_RESET_MS: z.coerce.number().int().min(1).default(30_000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  // Local convenience only: real deployments inject real env vars, and
  // loadEnvFile never overrides a variable that is already set.
  if (existsSync('.env')) process.loadEnvFile('.env');

  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

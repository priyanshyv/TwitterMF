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

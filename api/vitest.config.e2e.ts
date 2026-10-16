import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Test files share one database, so run them one at a time.
    fileParallelism: false,
    // A separate database and Redis DB (index 1): tests wipe data freely
    // without touching what you see in dev.
    env: {
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ??
        'postgres://twitter:twitter@localhost:5432/twitter_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
      JWT_SECRET: 'test-secret-at-least-32-characters-long!!',
      // Tests flush counters by hand, so timing never makes them flaky.
      COUNTER_FLUSH_INTERVAL_MS: '0',
      // rate-limit.e2e-spec.ts turns limits back on for its own app.
      RATE_LIMIT_ENABLED: 'false',
      // Retries 10, 20, 40… ms instead of 1, 2, 4… s.
      JOB_BACKOFF_MS: '10',
    },
  },
});

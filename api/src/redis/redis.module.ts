import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export const REDIS = Symbol('REDIS');

// ioredis reconnects on its own, but emits an 'error' event on every failed
// attempt; with no listener, Node prints each one as an unhandled error.
// Log the transitions instead: once when the connection drops, once when
// it is back.
function logConnectionChanges(redis: Redis) {
  const logger = new Logger('Redis');
  let down = false;
  redis.on('error', (err: Error) => {
    if (down) return;
    down = true;
    logger.warn(`connection lost (${err.message || err.name}), retrying`);
  });
  redis.on('ready', () => {
    if (!down) return;
    down = false;
    logger.log('reconnected');
  });
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ENV],
      useFactory: (env: Env) => {
        const redis = new Redis(env.REDIS_URL, {
          // Fail a command after one reconnect attempt instead of queueing it
          // for ~20 retries: callers get a fast error they can handle.
          maxRetriesPerRequest: 1,
        });
        logConnectionChanges(redis);
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit();
  }
}

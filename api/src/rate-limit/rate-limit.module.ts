import { Global, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { RedisRateLimiter } from './redis-rate-limiter.js';

export const RATE_LIMITER = Symbol('RATE_LIMITER');

@Global()
@Module({
  providers: [
    {
      provide: RATE_LIMITER,
      inject: [REDIS],
      useFactory: (redis: Redis) => new RedisRateLimiter(redis),
    },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitModule {}

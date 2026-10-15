import { Global, Module } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';
import { RedisCache } from './redis-cache.js';

export const CACHE = Symbol('CACHE');

@Global()
@Module({
  providers: [
    {
      provide: CACHE,
      inject: [REDIS],
      useFactory: (r: Redis) => new RedisCache(r),
    },
  ],
  exports: [CACHE],
})
export class CacheModule {}

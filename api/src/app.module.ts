import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { CacheModule } from './cache/cache.module.js';
import { IdModule } from './common/id.module.js';
import { ConfigModule, ENV } from './config/config.module.js';
import { CountersModule } from './counters/counters.module.js';
import { loggerOptions } from './config/logger.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { RedisModule } from './redis/redis.module.js';
import { TweetsModule } from './tweets/tweets.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: loggerOptions }),
    DbModule,
    IdModule,
    RedisModule,
    CacheModule,
    CountersModule,
    RateLimitModule,
    HealthModule,
    AuthModule,
    UsersModule,
    TweetsModule,
  ],
})
export class AppModule {}

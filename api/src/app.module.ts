import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module.js';
import { BreakersModule } from './breakers/breakers.module.js';
import { CacheModule } from './cache/cache.module.js';
import { IdModule } from './common/id.module.js';
import { ConfigModule, ENV } from './config/config.module.js';
import { CountersModule } from './counters/counters.module.js';
import { loggerOptions } from './config/logger.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { MediaModule } from './media/media.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RateLimitModule } from './rate-limit/rate-limit.module.js';
import { RedisModule } from './redis/redis.module.js';
import { SearchModule } from './search/search.module.js';
import { StorageModule } from './storage/storage.module.js';
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
    JobsModule,
    RealtimeModule,
    BreakersModule,
    StorageModule,
    HealthModule,
    AuthModule,
    UsersModule,
    TweetsModule,
    NotificationsModule,
    MediaModule,
    SearchModule,
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { IdModule } from './common/id.module.js';
import { ConfigModule, ENV } from './config/config.module.js';
import { loggerOptions } from './config/logger.js';
import { DbModule } from './db/db.module.js';
import { HealthModule } from './health/health.module.js';
import { RedisModule } from './redis/redis.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: loggerOptions }),
    DbModule,
    IdModule,
    RedisModule,
    HealthModule,
  ],
})
export class AppModule {}

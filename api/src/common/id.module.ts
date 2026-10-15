import { Global, Module } from '@nestjs/common';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { Snowflake } from './snowflake.js';

export const SNOWFLAKE = Symbol('SNOWFLAKE');

@Global()
@Module({
  providers: [
    {
      provide: SNOWFLAKE,
      inject: [ENV],
      useFactory: (env: Env) => new Snowflake(env.WORKER_ID),
    },
  ],
  exports: [SNOWFLAKE],
})
export class IdModule {}

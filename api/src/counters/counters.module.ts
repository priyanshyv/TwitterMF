import { Global, Module } from '@nestjs/common';
import { CountersService } from './counters.service.js';

@Global()
@Module({
  providers: [CountersService],
  exports: [CountersService],
})
export class CountersModule {}

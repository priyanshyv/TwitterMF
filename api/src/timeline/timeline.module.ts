import { Module } from '@nestjs/common';
import { FanoutProcessor } from './fanout.processor.js';
import { TimelineService } from './timeline.service.js';

@Module({
  providers: [TimelineService, FanoutProcessor],
  exports: [TimelineService, FanoutProcessor],
})
export class TimelineModule {}

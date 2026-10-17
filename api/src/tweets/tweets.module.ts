import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module.js';
import { TimelineModule } from '../timeline/timeline.module.js';
import { UserRecordsModule } from '../users/user-records.module.js';
import { TweetsController } from './tweets.controller.js';
import { TweetsService } from './tweets.service.js';

@Module({
  imports: [UserRecordsModule, TimelineModule, MediaModule],
  controllers: [TweetsController],
  providers: [TweetsService],
  exports: [TweetsService],
})
export class TweetsModule {}

import { Module } from '@nestjs/common';
import { UserRecordsModule } from '../users/user-records.module.js';
import { TweetsController } from './tweets.controller.js';
import { TweetsService } from './tweets.service.js';

@Module({
  imports: [UserRecordsModule],
  controllers: [TweetsController],
  providers: [TweetsService],
  exports: [TweetsService],
})
export class TweetsModule {}

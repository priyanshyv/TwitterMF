import { Module } from '@nestjs/common';
import { TweetsController } from './tweets.controller.js';
import { TweetsService } from './tweets.service.js';

@Module({
  controllers: [TweetsController],
  providers: [TweetsService],
  exports: [TweetsService],
})
export class TweetsModule {}

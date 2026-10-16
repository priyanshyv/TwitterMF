import { Module } from '@nestjs/common';
import { TimelineModule } from '../timeline/timeline.module.js';
import { TweetsModule } from '../tweets/tweets.module.js';
import { UsernamesModule } from '../usernames/usernames.module.js';
import { FollowsService } from './follows.service.js';
import { UserRecordsModule } from './user-records.module.js';
import { UsersController } from './users.controller.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [UsernamesModule, TweetsModule, UserRecordsModule, TimelineModule],
  controllers: [UsersController],
  providers: [UsersService, FollowsService],
  exports: [UsersService],
})
export class UsersModule {}

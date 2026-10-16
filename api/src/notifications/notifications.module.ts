import { Module } from '@nestjs/common';
import { TweetsModule } from '../tweets/tweets.module.js';
import { UserRecordsModule } from '../users/user-records.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [TweetsModule, UserRecordsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

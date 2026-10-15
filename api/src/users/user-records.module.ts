import { Module } from '@nestjs/common';
import { UserRecordsService } from './user-records.service.js';

// Its own module so both UsersModule and TweetsModule can use it without
// importing each other.
@Module({
  providers: [UserRecordsService],
  exports: [UserRecordsService],
})
export class UserRecordsModule {}

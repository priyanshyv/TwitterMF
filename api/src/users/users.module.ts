import { Module } from '@nestjs/common';
import { UsernamesModule } from '../usernames/usernames.module.js';
import { UsersService } from './users.service.js';

@Module({
  imports: [UsernamesModule],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

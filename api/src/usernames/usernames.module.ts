import { Module } from '@nestjs/common';
import { UsernamesController } from './usernames.controller.js';
import { UsernamesService } from './usernames.service.js';

@Module({
  controllers: [UsernamesController],
  providers: [UsernamesService],
  exports: [UsernamesService],
})
export class UsernamesModule {}

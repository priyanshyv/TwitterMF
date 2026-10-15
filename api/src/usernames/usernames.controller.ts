import { Controller, Get, Inject, Param } from '@nestjs/common';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { UsernameSchema } from '../users/user.schemas.js';
import { UsernamesService } from './usernames.service.js';

@Controller('usernames')
export class UsernamesController {
  constructor(
    @Inject(UsernamesService) private readonly usernames: UsernamesService,
  ) {}

  // The sign-up form calls this as you type.
  @Get(':username')
  @RateLimit('username-check')
  check(@Param('username', new ZodPipe(UsernameSchema)) username: string) {
    return this.usernames.check(username);
  }
}

import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentUser } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PageQuerySchema, type PageQuery } from '../common/pagination.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { TweetsService } from './tweets.service.js';

const CreateTweetSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Write something first')
    // Count characters the way people see them: an emoji is 1, not 2.
    .refine((t) => [...t].length <= 280, 'Keep it to 280 characters'),
});

@Controller()
@UseGuards(AuthGuard)
export class TweetsController {
  constructor(@Inject(TweetsService) private readonly tweets: TweetsService) {}

  @Post('tweets')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreateTweetSchema))
    body: z.infer<typeof CreateTweetSchema>,
  ) {
    return this.tweets.create(user.id, body.text);
  }

  @Get('timeline')
  timeline(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(PageQuerySchema)) page: PageQuery,
  ) {
    return this.tweets.timeline(user.id, page);
  }
}

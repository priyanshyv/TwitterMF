import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentUser, OptionalAuth } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PageQuerySchema, type PageQuery } from '../common/pagination.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { TweetsService } from './tweets.service.js';

const IdSchema = z
  .string()
  .regex(/^\d{1,20}$/, 'Must be a tweet ID')
  .transform((v) => BigInt(v));
const TweetId = new ZodPipe(IdSchema);

const CreateTweetSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Write something first')
    // Count characters the way people see them: an emoji is 1, not 2.
    .refine((t) => [...t].length <= 280, 'Keep it to 280 characters'),
  replyToId: IdSchema.optional(),
});
type CreateTweet = z.infer<typeof CreateTweetSchema>;

@Controller()
@UseGuards(AuthGuard)
export class TweetsController {
  constructor(@Inject(TweetsService) private readonly tweets: TweetsService) {}

  // A reply is a tweet with replyToId.
  @Post('tweets')
  @RateLimit('post')
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodPipe(CreateTweetSchema)) body: CreateTweet,
  ) {
    return this.tweets.create(user.id, body.text, body.replyToId);
  }

  @Get('timeline')
  timeline(
    @CurrentUser() user: AuthUser,
    @Query(new ZodPipe(PageQuerySchema)) page: PageQuery,
  ) {
    return this.tweets.timeline(user.id, page);
  }

  @Get('tweets/:id')
  @OptionalAuth()
  thread(@Param('id', TweetId) id: bigint, @CurrentUser() viewer?: AuthUser) {
    return this.tweets.thread(id, viewer?.id);
  }

  @Get('tweets/:id/replies')
  @OptionalAuth()
  replies(
    @Param('id', TweetId) id: bigint,
    @Query(new ZodPipe(PageQuerySchema)) page: PageQuery,
    @CurrentUser() viewer?: AuthUser,
  ) {
    return this.tweets.replies(id, page, viewer?.id);
  }

  @Post('tweets/:id/like')
  @RateLimit('engage')
  like(@Param('id', TweetId) id: bigint, @CurrentUser() user: AuthUser) {
    return this.tweets.like(user.id, id);
  }

  @Delete('tweets/:id/like')
  @RateLimit('engage')
  unlike(@Param('id', TweetId) id: bigint, @CurrentUser() user: AuthUser) {
    return this.tweets.unlike(user.id, id);
  }

  @Post('tweets/:id/retweet')
  @RateLimit('engage')
  retweet(@Param('id', TweetId) id: bigint, @CurrentUser() user: AuthUser) {
    return this.tweets.retweet(user.id, id);
  }

  @Delete('tweets/:id/retweet')
  @RateLimit('engage')
  unretweet(@Param('id', TweetId) id: bigint, @CurrentUser() user: AuthUser) {
    return this.tweets.unretweet(user.id, id);
  }
}

import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard, CurrentUser, OptionalAuth } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { PageQuerySchema, type PageQuery } from '../common/pagination.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { z } from 'zod';
import { PROFILE_TABS, TweetsService } from '../tweets/tweets.service.js';
import { FollowsService } from './follows.service.js';
import { UserRecordsService, type UserRecord } from './user-records.service.js';
import { UsernameSchema } from './user.schemas.js';

const UsernameParam = new ZodPipe(UsernameSchema);
const ProfileTabQuery = new ZodPipe(z.enum(PROFILE_TABS).default('posts'));

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    @Inject(UserRecordsService) private readonly users: UserRecordsService,
    @Inject(FollowsService) private readonly follows: FollowsService,
    @Inject(TweetsService) private readonly tweets: TweetsService,
  ) {}

  @Get('suggestions')
  @OptionalAuth()
  suggestions(@CurrentUser() viewer: AuthUser | undefined) {
    return this.follows.suggestions(viewer?.id);
  }

  @Get(':username')
  @OptionalAuth()
  async profile(
    @Param('username', UsernameParam) username: string,
    @CurrentUser() viewer: AuthUser | undefined,
  ) {
    const user = await this.findOr404(username);
    const id = BigInt(user.id);
    const isMe = viewer?.id === id;
    const viewerFollows =
      viewer && !isMe ? await this.follows.isFollowing(viewer.id, id) : false;
    const { counts, ...publicUser } = user;
    return {
      user: publicUser,
      stats: counts,
      viewer: viewer ? { isMe, follows: viewerFollows } : null,
    };
  }

  @Get(':username/tweets')
  @OptionalAuth()
  async userTweets(
    @Param('username', UsernameParam) username: string,
    @Query(new ZodPipe(PageQuerySchema)) page: PageQuery,
    @Query('tab', ProfileTabQuery) tab: (typeof PROFILE_TABS)[number],
    @CurrentUser() viewer: AuthUser | undefined,
  ) {
    const user = await this.findOr404(username);
    return this.tweets.byAuthor(BigInt(user.id), page, viewer?.id, tab);
  }

  @Post(':username/follow')
  @HttpCode(204)
  @RateLimit('engage')
  async follow(
    @Param('username', UsernameParam) username: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    const user = await this.findOr404(username);
    await this.follows.follow(viewer.id, BigInt(user.id));
  }

  @Delete(':username/follow')
  @HttpCode(204)
  @RateLimit('engage')
  async unfollow(
    @Param('username', UsernameParam) username: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    const user = await this.findOr404(username);
    await this.follows.unfollow(viewer.id, BigInt(user.id));
  }

  // Both steps are cached: username -> ID, then ID -> user.
  private async findOr404(username: string): Promise<UserRecord> {
    const id = await this.users.idForUsername(username);
    const user = id ? await this.users.get(id) : null;
    if (!user) throw new NotFoundException(`No user called @${username}`);
    return user;
  }
}

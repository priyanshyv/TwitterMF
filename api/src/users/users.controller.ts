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
import { TweetsService } from '../tweets/tweets.service.js';
import { FollowsService } from './follows.service.js';
import { toPublicUser } from './user.dto.js';
import { UsernameSchema } from './user.schemas.js';
import { UsersService } from './users.service.js';

const UsernameParam = new ZodPipe(UsernameSchema);

@Controller('users')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    @Inject(UsersService) private readonly users: UsersService,
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
    const [stats, viewerFollows] = await Promise.all([
      this.follows.stats(user.id),
      viewer && viewer.id !== user.id
        ? this.follows.isFollowing(viewer.id, user.id)
        : false,
    ]);
    return {
      user: toPublicUser(user),
      stats,
      viewer: viewer
        ? { isMe: viewer.id === user.id, follows: viewerFollows }
        : null,
    };
  }

  @Get(':username/tweets')
  @OptionalAuth()
  async userTweets(
    @Param('username', UsernameParam) username: string,
    @Query(new ZodPipe(PageQuerySchema)) page: PageQuery,
  ) {
    const user = await this.findOr404(username);
    return this.tweets.byAuthor(user.id, page);
  }

  @Post(':username/follow')
  @HttpCode(204)
  async follow(
    @Param('username', UsernameParam) username: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    const user = await this.findOr404(username);
    await this.follows.follow(viewer.id, user.id);
  }

  @Delete(':username/follow')
  @HttpCode(204)
  async unfollow(
    @Param('username', UsernameParam) username: string,
    @CurrentUser() viewer: AuthUser,
  ) {
    const user = await this.findOr404(username);
    await this.follows.unfollow(viewer.id, user.id);
  }

  private async findOr404(username: string) {
    const user = await this.users.findByUsername(username);
    if (!user) throw new NotFoundException(`No user called @${username}`);
    return user;
  }
}

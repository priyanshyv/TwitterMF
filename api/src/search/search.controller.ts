import { Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { AuthGuard, CurrentUser, OptionalAuth } from '../auth/auth.guard.js';
import type { AuthUser } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RateLimit } from '../rate-limit/rate-limit.guard.js';
import { TweetsService } from '../tweets/tweets.service.js';
import {
  toUserRef,
  UserRecordsService,
} from '../users/user-records.service.js';
import { SearchService } from './search.service.js';
import { TrendsService } from './trends.service.js';

const SearchQuery = z.object({
  q: z.string().trim().min(1, 'Type something to search').max(100),
  type: z.enum(['tweets', 'users']).default('tweets'),
  page: z.coerce.number().int().min(0).max(50).default(0),
});

@Controller()
@UseGuards(AuthGuard)
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(TrendsService) private readonly trends: TrendsService,
    @Inject(TweetsService) private readonly tweets: TweetsService,
    @Inject(UserRecordsService) private readonly users: UserRecordsService,
  ) {}

  // `source` says which engine answered: "postgres" means search is
  // running degraded (Meilisearch down or its circuit breaker open).
  @Get('search')
  @OptionalAuth()
  @RateLimit('search')
  async find(
    @Query(new ZodPipe(SearchQuery)) query: z.infer<typeof SearchQuery>,
    @CurrentUser() viewer?: AuthUser,
  ) {
    if (query.type === 'tweets') {
      const hits = await this.search.searchTweets(query.q, query.page);
      return {
        source: hits.source,
        hasMore: hits.hasMore,
        tweets: await this.tweets.items(hits.ids, viewer?.id),
      };
    }
    const hits = await this.search.searchUsers(query.q, query.page);
    const records = await this.users.getMany(hits.ids);
    const followed = viewer
      ? await this.search.followedBy(viewer.id, hits.ids)
      : new Set();
    return {
      source: hits.source,
      hasMore: hits.hasMore,
      users: hits.ids.flatMap((id) => {
        const u = records.get(id);
        if (!u) return [];
        return [
          {
            ...toUserRef(u),
            bio: u.bio,
            followers: u.counts.followers,
            viewer: viewer
              ? { isMe: viewer.id.toString() === id, follows: followed.has(id) }
              : null,
          },
        ];
      }),
    };
  }

  @Get('trends')
  @OptionalAuth()
  async top() {
    return { trends: await this.trends.top(10) };
  }
}

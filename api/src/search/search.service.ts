import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { Meilisearch } from 'meilisearch';
import {
  BreakersService,
  isBreakerOpen,
} from '../breakers/breakers.service.js';
import { extractHashtags, HASHTAG_CHARS } from '../common/hashtags.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB, type Database } from '../db/db.module.js';
import { follows, tweets, users } from '../db/schema/index.js';

// Full-text search with Meilisearch: typo tolerance ("postgress" finds
// "postgres"), relevance ranking, instant results. A database LIKE can't do
// any of that well.
//
// Meilisearch holds a derived copy: Postgres stays the source of truth, and
// the index is updated by jobs from the outbox a moment after each change
// ("eventually consistent": a brand-new tweet may take a few hundred ms to
// become searchable). If it's lost, `npm run search:reindex` rebuilds it.
//
// Searches go through a circuit breaker. If Meilisearch is down or slow,
// the breaker opens and searches fall back to Postgres (substring matching
// on trigram indexes): worse results, but search keeps working.

export type SearchSource = 'meilisearch' | 'postgres';
export interface SearchHits {
  ids: string[];
  hasMore: boolean;
  source: SearchSource;
}

interface TweetDoc {
  id: string;
  text: string;
  hashtags: string[];
  authorId: string;
  authorUsername: string;
  authorDisplayName: string;
  createdAt: number;
}
interface UserDoc {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  followerCount: number;
}

const PAGE = 20;
const HASHTAG_QUERY = new RegExp(`^#([${HASHTAG_CHARS}]{1,50})$`, 'u');

@Injectable()
export class SearchService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Search');
  private readonly client: Meilisearch;
  private readonly tweetIndex: string;
  private readonly userIndex: string;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(DB) private readonly db: Database,
    @Inject(BreakersService) private readonly breakers: BreakersService,
  ) {
    this.client = new Meilisearch({
      host: env.MEILI_URL,
      apiKey: env.MEILI_KEY,
    });
    this.tweetIndex = `${env.SEARCH_INDEX_PREFIX}tweets`;
    this.userIndex = `${env.SEARCH_INDEX_PREFIX}users`;
  }

  async onApplicationBootstrap() {
    try {
      await this.configure();
    } catch (err) {
      this.logger.warn(
        `index setup skipped, Meilisearch unavailable: ${String(err)}`,
      );
    }
  }

  // Index settings: what to search, what to filter on, how to rank.
  async configure() {
    await Promise.all([
      this.client
        .index(this.tweetIndex)
        .updateSettings({
          searchableAttributes: [
            'text',
            'hashtags',
            'authorUsername',
            'authorDisplayName',
          ],
          filterableAttributes: ['hashtags', 'authorId'],
          sortableAttributes: ['createdAt'],
          // Relevance first, then newer tweets win ties.
          rankingRules: [
            'words',
            'typo',
            'proximity',
            'attribute',
            'sort',
            'exactness',
            'createdAt:desc',
          ],
          displayedAttributes: ['id'], // we hydrate from our own cache
        })
        .waitTask({ timeout: 10_000 }),
      this.client
        .index(this.userIndex)
        .updateSettings({
          searchableAttributes: ['username', 'displayName', 'bio'],
          // Among equally good matches, popular accounts first.
          rankingRules: [
            'words',
            'typo',
            'proximity',
            'attribute',
            'sort',
            'exactness',
            'followerCount:desc',
          ],
          displayedAttributes: ['id'],
        })
        .waitTask({ timeout: 10_000 }),
    ]);
  }

  // ---- Reads (API, behind the circuit breaker) ---------------------------

  async searchTweets(query: string, page: number): Promise<SearchHits> {
    const tag = HASHTAG_QUERY.exec(query.trim())?.[1]?.toLowerCase();
    try {
      const res = await this.breakers.run('search', () =>
        this.client.index(this.tweetIndex).search(tag ? '' : query, {
          filter: tag ? `hashtags = "${tag}"` : undefined,
          sort: tag ? ['createdAt:desc'] : undefined,
          limit: PAGE + 1,
          offset: page * PAGE,
        }),
      );
      return this.hits(
        res.hits.map((h) => String(h.id)),
        'meilisearch',
      );
    } catch (err) {
      this.logFallback(err);
      const pattern = likePattern(tag ? `#${tag}` : query);
      const { rows } = await this.db.execute<{ id: string }>(sql`
        select id from tweets
        where retweet_of_id is null and text ilike ${pattern}
        order by id desc
        limit ${PAGE + 1} offset ${page * PAGE}`);
      return this.hits(
        rows.map((r) => r.id),
        'postgres',
      );
    }
  }

  async searchUsers(query: string, page: number): Promise<SearchHits> {
    try {
      const res = await this.breakers.run('search', () =>
        this.client
          .index(this.userIndex)
          .search(query, { limit: PAGE + 1, offset: page * PAGE }),
      );
      return this.hits(
        res.hits.map((h) => String(h.id)),
        'meilisearch',
      );
    } catch (err) {
      this.logFallback(err);
      const pattern = likePattern(query.replace(/^@/, ''));
      const { rows } = await this.db.execute<{ id: string }>(sql`
        select id from users
        where username ilike ${pattern} or display_name ilike ${pattern}
        order by follower_count desc, id
        limit ${PAGE + 1} offset ${page * PAGE}`);
      return this.hits(
        rows.map((r) => r.id),
        'postgres',
      );
    }
  }

  // ---- Writes (worker, retried by the queue) -----------------------------

  // Indexes the tweet as it is in Postgres right now, so running it twice,
  // or out of order, still ends in the right state (idempotent).
  async indexTweet(id: string): Promise<void> {
    const [row] = await this.db
      .select({
        id: tweets.id,
        text: tweets.text,
        createdAt: tweets.createdAt,
        authorId: users.id,
        username: users.username,
        displayName: users.displayName,
      })
      .from(tweets)
      .innerJoin(users, eq(users.id, tweets.authorId))
      .where(and(eq(tweets.id, BigInt(id)), isNull(tweets.retweetOfId)));
    const index = this.client.index<TweetDoc>(this.tweetIndex);
    const task = row
      ? await index
          .addDocuments([toTweetDoc(row)], { primaryKey: 'id' })
          .waitTask({ timeout: 5_000 })
      : await index.deleteDocument(id).waitTask({ timeout: 5_000 });
    if (task.status === 'failed')
      throw new Error(`index task failed: ${task.error?.message}`);
  }

  async indexUser(id: string): Promise<void> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, BigInt(id)));
    const index = this.client.index<UserDoc>(this.userIndex);
    const task = row
      ? await index
          .addDocuments([toUserDoc(row)], { primaryKey: 'id' })
          .waitTask({ timeout: 5_000 })
      : await index.deleteDocument(id).waitTask({ timeout: 5_000 });
    if (task.status === 'failed')
      throw new Error(`index task failed: ${task.error?.message}`);
  }

  // Rebuilds both indexes from Postgres in batches (npm run search:reindex,
  // and after seeding). Also refreshes follower counts used for ranking.
  async reindexAll(): Promise<{ tweets: number; users: number }> {
    await this.configure();
    const tweetIndex = this.client.index<TweetDoc>(this.tweetIndex);
    const userIndex = this.client.index<UserDoc>(this.userIndex);
    await tweetIndex.deleteAllDocuments().waitTask({ timeout: 30_000 });
    await userIndex.deleteAllDocuments().waitTask({ timeout: 30_000 });

    let tweetCount = 0;
    for (let after = -1n; ;) {
      const batch = await this.db
        .select({
          id: tweets.id,
          text: tweets.text,
          createdAt: tweets.createdAt,
          authorId: users.id,
          username: users.username,
          displayName: users.displayName,
        })
        .from(tweets)
        .innerJoin(users, eq(users.id, tweets.authorId))
        .where(and(gt(tweets.id, after), isNull(tweets.retweetOfId)))
        .orderBy(tweets.id)
        .limit(1_000);
      if (batch.length === 0) break;
      await tweetIndex
        .addDocuments(batch.map(toTweetDoc), { primaryKey: 'id' })
        .waitTask({ timeout: 60_000 });
      tweetCount += batch.length;
      after = batch[batch.length - 1].id;
    }
    const allUsers = await this.db.select().from(users);
    if (allUsers.length)
      await userIndex
        .addDocuments(allUsers.map(toUserDoc), { primaryKey: 'id' })
        .waitTask({ timeout: 60_000 });
    return { tweets: tweetCount, users: allUsers.length };
  }

  async deleteAllDocuments(): Promise<void> {
    await Promise.all(
      [this.tweetIndex, this.userIndex].map((uid) =>
        this.client
          .index(uid)
          .deleteAllDocuments()
          .waitTask({ timeout: 10_000 }),
      ),
    );
  }

  async ping(): Promise<boolean> {
    return this.client
      .health()
      .then(() => true)
      .catch(() => false);
  }

  // Who the viewer follows among these users (for Follow buttons).
  async followedBy(viewerId: bigint, userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await this.db
      .select({ id: follows.followeeId })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, viewerId),
          inArray(follows.followeeId, userIds.map(BigInt)),
        ),
      );
    return new Set(rows.map((r) => r.id.toString()));
  }

  private hits(ids: string[], source: SearchSource): SearchHits {
    return { ids: ids.slice(0, PAGE), hasMore: ids.length > PAGE, source };
  }

  private logFallback(err: unknown) {
    if (!isBreakerOpen(err))
      this.logger.warn(`Meilisearch failed, using Postgres: ${String(err)}`);
  }
}

// %term%, with LIKE's own wildcards in the user's text escaped.
function likePattern(text: string) {
  return `%${text.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

function toTweetDoc(row: {
  id: bigint;
  text: string;
  createdAt: Date;
  authorId: bigint;
  username: string;
  displayName: string;
}): TweetDoc {
  return {
    id: row.id.toString(),
    text: row.text,
    hashtags: extractHashtags(row.text),
    authorId: row.authorId.toString(),
    authorUsername: row.username,
    authorDisplayName: row.displayName,
    createdAt: row.createdAt.getTime(),
  };
}

function toUserDoc(row: typeof users.$inferSelect): UserDoc {
  return {
    id: row.id.toString(),
    username: row.username,
    displayName: row.displayName,
    bio: row.bio,
    followerCount: row.followerCount,
  };
}

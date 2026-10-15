import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { CACHE } from '../cache/cache.module.js';
import type { RedisCache } from '../cache/redis-cache.js';
import { SNOWFLAKE } from '../common/id.module.js';
import { toPage, type Page, type PageQuery } from '../common/pagination.js';
import type { Snowflake } from '../common/snowflake.js';
import {
  CountersService,
  type CounterChange,
} from '../counters/counters.service.js';
import { DB, type Database } from '../db/db.module.js';
import { likes, tweets } from '../db/schema/index.js';
import {
  toUserRef,
  UserRecordsService,
  type UserRecord,
} from '../users/user-records.service.js';
import type { FeedItem, TweetRecord, TweetView } from './tweet.dto.js';

const TWEET_TTL_SECONDS = 600;
const tweetCacheKey = (id: string) => `cache:tweet:${id}`;

// Reads are split in two:
//   1. Which tweets? A query that returns only IDs, served straight from an
//      index (cheap, and always fresh).
//   2. What's in them? "Hydration": tweet and user bodies from the cache,
//      counts from stored count + pending change, and the viewer's own
//      likes and retweets. Popular tweets appear in thousands of timelines,
//      so their bodies are read from Redis instead of Postgres every time.
@Injectable()
export class TweetsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SNOWFLAKE) private readonly ids: Snowflake,
    @Inject(CACHE) private readonly cache: RedisCache,
    @Inject(CountersService) private readonly counters: CountersService,
    @Inject(UserRecordsService) private readonly users: UserRecordsService,
  ) {}

  // ---- Writes ------------------------------------------------------------

  async create(
    authorId: bigint,
    text: string,
    replyToId?: bigint,
  ): Promise<TweetView> {
    // Replying to a retweet means replying to the original.
    const parentId = replyToId ? await this.contentId(replyToId) : null;
    const id = this.ids.next();
    await this.db
      .insert(tweets)
      .values({ id, authorId, text, replyToId: parentId });

    const changes: CounterChange[] = [
      { entity: 'user', id: authorId, field: 'tweets', by: 1 },
    ];
    if (parentId)
      changes.push({ entity: 'tweet', id: parentId, field: 'replies', by: 1 });
    await this.counters.change(changes);
    return this.view(id, authorId);
  }

  // Liking twice is a no-op, so retries and double-clicks are harmless. The
  // count only moves when a row was actually inserted or deleted.
  async like(userId: bigint, tweetId: bigint): Promise<TweetView> {
    const target = await this.contentId(tweetId);
    const inserted = await this.db
      .insert(likes)
      .values({ userId, tweetId: target })
      .onConflictDoNothing()
      .returning({ id: likes.tweetId });
    if (inserted.length)
      await this.counters.change([
        { entity: 'tweet', id: target, field: 'likes', by: 1 },
      ]);
    return this.view(target, userId);
  }

  async unlike(userId: bigint, tweetId: bigint): Promise<TweetView> {
    const target = await this.contentId(tweetId);
    const deleted = await this.db
      .delete(likes)
      .where(and(eq(likes.userId, userId), eq(likes.tweetId, target)))
      .returning({ id: likes.tweetId });
    if (deleted.length)
      await this.counters.change([
        { entity: 'tweet', id: target, field: 'likes', by: -1 },
      ]);
    return this.view(target, userId);
  }

  async retweet(userId: bigint, tweetId: bigint): Promise<TweetView> {
    const target = await this.contentId(tweetId);
    // The partial unique index (author_id, retweet_of_id) makes a second
    // retweet of the same tweet a no-op.
    const inserted = await this.db
      .insert(tweets)
      .values({
        id: this.ids.next(),
        authorId: userId,
        text: '',
        retweetOfId: target,
      })
      .onConflictDoNothing()
      .returning({ id: tweets.id });
    if (inserted.length)
      await this.counters.change([
        { entity: 'tweet', id: target, field: 'retweets', by: 1 },
        { entity: 'user', id: userId, field: 'tweets', by: 1 },
      ]);
    return this.view(target, userId);
  }

  async unretweet(userId: bigint, tweetId: bigint): Promise<TweetView> {
    const target = await this.contentId(tweetId);
    const deleted = await this.db
      .delete(tweets)
      .where(and(eq(tweets.authorId, userId), eq(tweets.retweetOfId, target)))
      .returning({ id: tweets.id });
    if (deleted.length) {
      await this.cache.invalidate(
        deleted.map((d) => tweetCacheKey(d.id.toString())),
      );
      await this.counters.change([
        { entity: 'tweet', id: target, field: 'retweets', by: -1 },
        { entity: 'user', id: userId, field: 'tweets', by: -1 },
      ]);
    }
    return this.view(target, userId);
  }

  // ---- Reads -------------------------------------------------------------

  // A profile's tweets and retweets, newest first.
  // Served by tweets(author_id, id desc), as an index-only scan.
  async byAuthor(
    authorId: bigint,
    page: PageQuery,
    viewerId?: bigint,
  ): Promise<Page<FeedItem>> {
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select id from tweets
      where author_id = ${authorId} ${olderThan(page.before)}
      order by id desc
      limit ${page.limit + 1}`);
    return this.page(rows, page.limit, viewerId);
  }

  // Home timeline v1, "fan-out on read": built at request time from the
  // tweets of everyone you follow, plus your own.
  //
  // The LATERAL join takes each followed account's newest tweets straight
  // from the (author_id, id desc) index, then merges them. The obvious
  // "author_id IN (...) ORDER BY id" walks every recent tweet on the site
  // instead; `npm run lab:explain` shows the difference (~30x at 1M tweets).
  //
  // Cost grows with how many accounts you follow, which is why Phase 4
  // switches to fan-out on write.
  async timeline(userId: bigint, page: PageQuery): Promise<Page<FeedItem>> {
    const n = page.limit + 1;
    const { rows } = await this.db.execute<{ id: string }>(sql`
      with sources as (
        select followee_id as author_id from follows where follower_id = ${userId}
        union all
        select ${userId}::bigint
      )
      select t.id
      from sources s
      cross join lateral (
        select id from tweets
        where author_id = s.author_id ${olderThan(page.before)}
        order by id desc
        limit ${n}
      ) t
      order by t.id desc
      limit ${n}`);
    return this.page(rows, page.limit, userId);
  }

  // A tweet plus the chain of tweets it replies to, oldest first.
  async thread(tweetId: bigint, viewerId?: bigint) {
    const target = await this.contentId(tweetId);
    // Walk reply_to_id upwards, one hop per iteration (at most 25).
    const { rows } = await this.db.execute<{ id: string }>(sql`
      with recursive chain as (
        select id, reply_to_id, 0 as depth from tweets where id = ${target}
        union all
        select t.id, t.reply_to_id, c.depth + 1
        from tweets t join chain c on t.id = c.reply_to_id
        where c.depth < 25
      )
      select id from chain where depth > 0 order by depth desc`);
    const views = await this.hydrate(
      [...rows.map((r) => r.id), target.toString()],
      viewerId,
    );
    const tweet = views.pop();
    if (!tweet) throw new NotFoundException('That tweet does not exist');
    return { tweet: tweet.tweet, ancestors: views.map((v) => v.tweet) };
  }

  // Direct replies to a tweet, newest first.
  // Served by the partial index on (reply_to_id, id desc).
  async replies(
    tweetId: bigint,
    page: PageQuery,
    viewerId?: bigint,
  ): Promise<Page<FeedItem>> {
    const target = await this.contentId(tweetId);
    const { rows } = await this.db.execute<{ id: string }>(sql`
      select id from tweets
      where reply_to_id = ${target} ${olderThan(page.before)}
      order by id desc
      limit ${page.limit + 1}`);
    return this.page(rows, page.limit, viewerId);
  }

  // ---- Hydration ---------------------------------------------------------

  private async page(
    rows: { id: string }[],
    limit: number,
    viewerId?: bigint,
  ): Promise<Page<FeedItem>> {
    const page = toPage(rows, limit);
    return {
      items: await this.hydrate(
        page.items.map((r) => r.id),
        viewerId,
      ),
      nextCursor: page.nextCursor,
    };
  }

  private async view(id: bigint, viewerId?: bigint): Promise<TweetView> {
    const [item] = await this.hydrate([id.toString()], viewerId);
    if (!item) throw new NotFoundException('That tweet does not exist');
    return item.tweet;
  }

  // Turns row IDs into full feed items, in the same order. Rows that no
  // longer exist are skipped.
  private async hydrate(
    rowIds: string[],
    viewerId?: bigint,
  ): Promise<FeedItem[]> {
    if (rowIds.length === 0) return [];

    // Round 1: the rows themselves. Round 2: what they point at (retweeted
    // originals, the tweets being replied to). Each round is one MGET, plus
    // one SQL query for whatever wasn't cached.
    const records = await this.records(rowIds);
    const contentOf = (r: TweetRecord) => r.retweetOfId ?? r.id;
    const pointedAt = [...records.values()].flatMap((r) =>
      [r.retweetOfId, records.get(contentOf(r))?.replyToId].filter(
        (x): x is string => !!x,
      ),
    );
    for (const [id, r] of await this.records(
      pointedAt.filter((id) => !records.has(id)),
    ))
      records.set(id, r);
    // A retweet's original may itself be a reply.
    const parents = [...records.values()]
      .map((r) => records.get(contentOf(r))?.replyToId)
      .filter((id): id is string => !!id && !records.has(id));
    for (const [id, r] of await this.records(parents)) records.set(id, r);

    const contentIds = [
      ...new Set([...records.values()].map(contentOf)),
    ].filter((id) => records.has(id));
    const [authors, pending, viewer] = await Promise.all([
      this.users.getMany([
        ...new Set([...records.values()].map((r) => r.authorId)),
      ]),
      this.counters.pending('tweet', contentIds),
      this.viewerState(viewerId, contentIds),
    ]);

    const items: FeedItem[] = [];
    for (const rowId of rowIds) {
      const row = records.get(rowId);
      const content = row && records.get(contentOf(row));
      const author = content && authors.get(content.authorId);
      if (!row || !content || !author) continue;

      const parent = content.replyToId
        ? records.get(content.replyToId)
        : undefined;
      const parentAuthor = parent && authors.get(parent.authorId);
      const retweeter = row.retweetOfId ? authors.get(row.authorId) : undefined;
      const d = pending.get(content.id) ?? {};

      items.push({
        id: row.id,
        retweetedBy: retweeter ? toUserRef(retweeter) : null,
        tweet: {
          id: content.id,
          text: content.text,
          createdAt: content.createdAt,
          author: toUserRef(author as UserRecord),
          replyTo:
            parent && parentAuthor
              ? { id: parent.id, author: toUserRef(parentAuthor) }
              : null,
          counts: {
            likes: content.counts.likes + (d.likes ?? 0),
            replies: content.counts.replies + (d.replies ?? 0),
            retweets: content.counts.retweets + (d.retweets ?? 0),
          },
          viewer: viewer && {
            liked: viewer.liked.has(content.id),
            retweeted: viewer.retweeted.has(content.id),
          },
        },
      });
    }
    return items;
  }

  // Tweet rows by ID, cache-aside.
  private async records(ids: string[]): Promise<Map<string, TweetRecord>> {
    const cached = await this.cache.getMany<TweetRecord>(
      [...new Set(ids)].map(tweetCacheKey),
      TWEET_TTL_SECONDS,
      async (keys) => {
        const rows = await this.db
          .select()
          .from(tweets)
          .where(
            inArray(
              tweets.id,
              keys.map((k) => BigInt(k.slice('cache:tweet:'.length))),
            ),
          );
        return new Map(
          rows.map((t) => [
            tweetCacheKey(t.id.toString()),
            {
              id: t.id.toString(),
              authorId: t.authorId.toString(),
              text: t.text,
              createdAt: t.createdAt.toISOString(),
              replyToId: t.replyToId?.toString() ?? null,
              retweetOfId: t.retweetOfId?.toString() ?? null,
              counts: {
                likes: t.likeCount,
                replies: t.replyCount,
                retweets: t.retweetCount,
              },
            },
          ]),
        );
      },
    );
    return new Map([...cached.values()].map((r) => [r.id, r]));
  }

  // Which of these tweets the viewer liked or retweeted. Per-user, so it is
  // not cached; both lookups use primary-key/unique indexes.
  private async viewerState(viewerId: bigint | undefined, ids: string[]) {
    if (viewerId === undefined) return null;
    if (ids.length === 0)
      return { liked: new Set<string>(), retweeted: new Set<string>() };
    const bigIds = ids.map(BigInt);
    const [liked, retweeted] = await Promise.all([
      this.db
        .select({ id: likes.tweetId })
        .from(likes)
        .where(and(eq(likes.userId, viewerId), inArray(likes.tweetId, bigIds))),
      this.db
        .select({ id: tweets.retweetOfId })
        .from(tweets)
        .where(
          and(
            eq(tweets.authorId, viewerId),
            inArray(tweets.retweetOfId, bigIds),
          ),
        ),
    ]);
    return {
      liked: new Set(liked.map((r) => r.id.toString())),
      retweeted: new Set(retweeted.map((r) => r.id!.toString())),
    };
  }

  // The tweet an action really targets: a retweet stands in for its original.
  private async contentId(tweetId: bigint): Promise<bigint> {
    const record = (await this.records([tweetId.toString()])).get(
      tweetId.toString(),
    );
    if (!record) throw new NotFoundException('That tweet does not exist');
    return BigInt(record.retweetOfId ?? record.id);
  }
}

function olderThan(before: bigint | undefined) {
  return before === undefined ? sql`` : sql`and id < ${before}`;
}

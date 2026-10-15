import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { SNOWFLAKE } from '../common/id.module.js';
import { toPage, type Page, type PageQuery } from '../common/pagination.js';
import type { Snowflake } from '../common/snowflake.js';
import { DB, type Database } from '../db/db.module.js';
import { tweets } from '../db/schema/index.js';
import { toTweetView, type TweetRow, type TweetView } from './tweet.dto.js';

// Raw queries skip Drizzle's column mapping, and timestamps come back as
// Postgres' text format. Have Postgres emit exact ISO-8601 instead of relying
// on JavaScript's lenient date parsing.
const TWEET_COLUMNS = sql`t.id, t.text, t.author_id, u.username, u.display_name,
  to_char(t.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at`;

@Injectable()
export class TweetsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SNOWFLAKE) private readonly ids: Snowflake,
  ) {}

  async create(authorId: bigint, text: string): Promise<TweetView> {
    const [tweet] = await this.db
      .insert(tweets)
      .values({ id: this.ids.next(), authorId, text })
      .returning({ id: tweets.id });
    const [row] = await this.query(sql`where t.id = ${tweet.id}`, 1);
    return toTweetView(row);
  }

  // A profile's tweets, newest first. Served by tweets(author_id, id desc).
  async byAuthor(authorId: bigint, page: PageQuery): Promise<Page<TweetView>> {
    const rows = await this.query(
      sql`where t.author_id = ${authorId} ${olderThan(page.before)}
          order by t.id desc`,
      page.limit + 1,
    );
    return toPage(rows.map(toTweetView), page.limit);
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
  async timeline(userId: bigint, page: PageQuery): Promise<Page<TweetView>> {
    const n = page.limit + 1;
    const { rows } = await this.db.execute<TweetRow>(sql`
      with sources as (
        select followee_id as author_id from follows where follower_id = ${userId}
        union all
        select ${userId}::bigint
      )
      select ${TWEET_COLUMNS}
      from sources s
      cross join lateral (
        select id, text, created_at, author_id from tweets
        where author_id = s.author_id ${olderThan(page.before, sql`id`)}
        order by id desc
        limit ${n}
      ) t
      join users u on u.id = t.author_id
      order by t.id desc
      limit ${n}
    `);
    return toPage(rows.map(toTweetView), page.limit);
  }

  private async query(where: ReturnType<typeof sql>, limit: number) {
    const { rows } = await this.db.execute<TweetRow>(sql`
      select ${TWEET_COLUMNS}
      from tweets t
      join users u on u.id = t.author_id
      ${where}
      limit ${limit}
    `);
    return rows;
  }
}

function olderThan(before: bigint | undefined, column = sql`t.id`) {
  return before === undefined ? sql`` : sql`and ${column} < ${before}`;
}

import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  type AnyPgColumn,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

// IDs are 64-bit Snowflakes (see common/snowflake.ts). They exceed JavaScript's
// safe integer range (2^53), so Drizzle hands them to us as BigInt and the API
// sends them to clients as strings.
const id = (name: string) => bigint(name, { mode: 'bigint' });
const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
// Stored counts, so pages never run COUNT(*). Increments land in Redis first
// and are flushed here in batches (see counters/counters.service.ts).
const count = (name: string) => integer(name).notNull().default(0);

export const users = pgTable(
  'users',
  {
    id: id('id').primaryKey(),
    username: varchar('username', { length: 15 }).notNull(),
    displayName: varchar('display_name', { length: 50 }).notNull(),
    bio: varchar('bio', { length: 160 }).notNull().default(''),
    passwordHash: text('password_hash').notNull(),
    followerCount: count('follower_count'),
    followingCount: count('following_count'),
    tweetCount: count('tweet_count'),
    createdAt: createdAt(),
  },
  (t) => [
    // "Alice" and "alice" are the same account: uniqueness ignores case.
    uniqueIndex('users_username_lower_idx').on(sql`lower(${t.username})`),
    check('users_username_format', sql`${t.username} ~ '^[A-Za-z0-9_]{1,15}$'`),
  ],
);

export const tweets = pgTable(
  'tweets',
  {
    id: id('id').primaryKey(),
    authorId: id('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    // A reply points at the tweet it answers. If that tweet is deleted the
    // reply stays, just detached ("this tweet is unavailable").
    replyToId: id('reply_to_id').references((): AnyPgColumn => tweets.id, {
      onDelete: 'set null',
    }),
    // A retweet is a row of its own (so it gets a time-sorted ID and shows up
    // in followers' timelines) that points at the original, with no text.
    retweetOfId: id('retweet_of_id').references((): AnyPgColumn => tweets.id, {
      onDelete: 'cascade',
    }),
    likeCount: count('like_count'),
    replyCount: count('reply_count'),
    retweetCount: count('retweet_count'),
    createdAt: createdAt(),
  },
  (t) => [
    // Serves "this user's tweets, newest first" (profiles, the timeline).
    // Snowflake IDs sort by time, so id desc = newest first.
    index('tweets_author_id_id_idx').on(t.authorId, t.id.desc()),
    // Serves a thread's replies. Partial: most tweets aren't replies, so
    // the index only holds the ones that are.
    index('tweets_reply_to_id_id_idx')
      .on(t.replyToId, t.id.desc())
      .where(sql`${t.replyToId} is not null`),
    // One retweet per user per tweet; retweeting twice is a no-op.
    uniqueIndex('tweets_one_retweet_per_user_idx')
      .on(t.authorId, t.retweetOfId)
      .where(sql`${t.retweetOfId} is not null`),
    check(
      'tweets_text_or_retweet',
      sql`(${t.retweetOfId} is null and char_length(${t.text}) between 1 and 280)
          or (${t.retweetOfId} is not null and ${t.text} = '')`,
    ),
  ],
);

export const follows = pgTable(
  'follows',
  {
    followerId: id('follower_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    followeeId: id('followee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    // The primary key's index starts with follower_id, so it also serves
    // "who do I follow?". The extra index serves "who follows me?".
    primaryKey({ columns: [t.followerId, t.followeeId] }),
    index('follows_followee_id_idx').on(t.followeeId),
    check('follows_no_self_follow', sql`${t.followerId} <> ${t.followeeId}`),
  ],
);

export const likes = pgTable(
  'likes',
  {
    userId: id('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tweetId: id('tweet_id')
      .notNull()
      .references(() => tweets.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.tweetId] }),
    index('likes_tweet_id_idx').on(t.tweetId),
  ],
);

// One row per issued refresh token. Rotation links each token to the one
// that replaced it; all tokens from one login share a family.
export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: id('id').primaryKey(),
    userId: id('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: id('family_id').notNull(),
    // SHA-256 of the token. The raw token only ever lives in the cookie, so a
    // database leak doesn't hand out working sessions.
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    // Set when this token was exchanged for a newer one.
    rotatedAt: timestamp('rotated_at', { withTimezone: true }),
    // Set when the whole family was killed (logout, or theft detected).
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('refresh_tokens_family_id_idx').on(t.familyId)],
);

export type User = typeof users.$inferSelect;
export type Tweet = typeof tweets.$inferSelect;

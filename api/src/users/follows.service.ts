import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module.js';
import { follows, tweets } from '../db/schema/index.js';

export interface ProfileStats {
  followers: number;
  following: number;
  tweets: number;
}

@Injectable()
export class FollowsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async follow(followerId: bigint, followeeId: bigint): Promise<void> {
    if (followerId === followeeId)
      throw new BadRequestException("You can't follow yourself");
    // Following twice is a no-op, not an error: retries and double-clicks
    // are harmless (the primary key prevents duplicate rows).
    await this.db
      .insert(follows)
      .values({ followerId, followeeId })
      .onConflictDoNothing();
  }

  async unfollow(followerId: bigint, followeeId: bigint): Promise<void> {
    await this.db
      .delete(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followeeId, followeeId),
        ),
      );
  }

  async isFollowing(followerId: bigint, followeeId: bigint): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql`1` })
      .from(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followeeId, followeeId),
        ),
      )
      .limit(1);
    return !!row;
  }

  // COUNT(*) on every profile view is fine for now: each count is an index
  // scan over one user's rows. With celebrity accounts (millions of
  // followers) it gets slow; Phase 3 moves these to Redis counters.
  async stats(userId: bigint): Promise<ProfileStats> {
    const count = (q: ReturnType<typeof sql>) => sql<number>`(${q})::int`;
    const [row] = await this.db
      .select({
        followers: count(
          sql`select count(*) from ${follows} where ${follows.followeeId} = ${userId}`,
        ),
        following: count(
          sql`select count(*) from ${follows} where ${follows.followerId} = ${userId}`,
        ),
        tweets: count(
          sql`select count(*) from ${tweets} where ${tweets.authorId} = ${userId}`,
        ),
      })
      .from(sql`(select 1) as one`);
    return row;
  }

  // "Who to follow": the newest accounts you don't follow yet.
  async suggestions(viewerId: bigint | undefined, limit = 5) {
    const { rows } = await this.db.execute<{
      id: string;
      username: string;
      display_name: string;
    }>(sql`
      select u.id, u.username, u.display_name
      from users u
      where ${
        viewerId === undefined
          ? sql`true`
          : sql`u.id <> ${viewerId}
        and not exists (
          select 1 from follows f
          where f.follower_id = ${viewerId} and f.followee_id = u.id
        )`
      }
      order by u.id desc
      limit ${limit}
    `);
    return rows.map((r) => ({
      id: r.id,
      username: r.username,
      displayName: r.display_name,
    }));
  }
}

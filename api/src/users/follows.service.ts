import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { CountersService } from '../counters/counters.service.js';
import { DB, type Database } from '../db/db.module.js';
import { follows } from '../db/schema/index.js';

@Injectable()
export class FollowsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CountersService) private readonly counters: CountersService,
  ) {}

  async follow(followerId: bigint, followeeId: bigint): Promise<void> {
    if (followerId === followeeId)
      throw new BadRequestException("You can't follow yourself");
    // Following twice is a no-op, not an error: retries and double-clicks
    // are harmless (the primary key prevents duplicate rows). Counts only
    // move when a row was actually added.
    const inserted = await this.db
      .insert(follows)
      .values({ followerId, followeeId })
      .onConflictDoNothing()
      .returning({ id: follows.followeeId });
    if (inserted.length) await this.countFollow(followerId, followeeId, 1);
  }

  async unfollow(followerId: bigint, followeeId: bigint): Promise<void> {
    const deleted = await this.db
      .delete(follows)
      .where(
        and(
          eq(follows.followerId, followerId),
          eq(follows.followeeId, followeeId),
        ),
      )
      .returning({ id: follows.followeeId });
    if (deleted.length) await this.countFollow(followerId, followeeId, -1);
  }

  private countFollow(followerId: bigint, followeeId: bigint, by: number) {
    return this.counters.change([
      { entity: 'user', id: followeeId, field: 'followers', by },
      { entity: 'user', id: followerId, field: 'following', by },
    ]);
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

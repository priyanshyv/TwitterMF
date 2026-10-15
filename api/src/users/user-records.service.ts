import { Inject, Injectable } from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import { CACHE } from '../cache/cache.module.js';
import type { RedisCache } from '../cache/redis-cache.js';
import { CountersService } from '../counters/counters.service.js';
import { DB, type Database } from '../db/db.module.js';
import { users } from '../db/schema/index.js';

// The cached, JSON-safe shape of a user (no password hash, IDs as strings).
export interface UserRecord {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  createdAt: string;
  counts: { followers: number; following: number; tweets: number };
}

export interface UserRef {
  id: string;
  username: string;
  displayName: string;
}

const USER_TTL_SECONDS = 300;
const USERNAME_TTL_SECONDS = 3_600;

export const userCacheKey = (id: string) => `cache:user:${id}`;
export const usernameCacheKey = (name: string) =>
  `cache:uname:${name.toLowerCase()}`;

// Every page shows users (tweet authors, profiles), so they are read far
// more often than they change: a good fit for cache-aside.
@Injectable()
export class UserRecordsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(CACHE) private readonly cache: RedisCache,
    @Inject(CountersService) private readonly counters: CountersService,
  ) {}

  // Users by ID, with counts that include not-yet-flushed changes.
  async getMany(ids: string[]): Promise<Map<string, UserRecord>> {
    const cached = await this.cache.getMany<UserRecord>(
      ids.map(userCacheKey),
      USER_TTL_SECONDS,
      (keys) => this.load(keys.map((k) => k.slice('cache:user:'.length))),
    );
    const found = [...cached.values()];
    const pending = await this.counters.pending(
      'user',
      found.map((u) => u.id),
    );
    return new Map(
      found.map((u) => {
        const d = pending.get(u.id) ?? {};
        return [
          u.id,
          {
            ...u,
            counts: {
              followers: u.counts.followers + (d.followers ?? 0),
              following: u.counts.following + (d.following ?? 0),
              tweets: u.counts.tweets + (d.tweets ?? 0),
            },
          },
        ];
      }),
    );
  }

  async get(id: string): Promise<UserRecord | null> {
    return (await this.getMany([id])).get(id) ?? null;
  }

  // Username -> ID, cached (including "no such user", briefly).
  idForUsername(username: string): Promise<string | null> {
    return this.cache.get(
      usernameCacheKey(username),
      USERNAME_TTL_SECONDS,
      async () => {
        const [row] = await this.db
          .select({ id: users.id })
          .from(users)
          .where(sql`lower(${users.username}) = lower(${username})`)
          .limit(1);
        return row ? row.id.toString() : null;
      },
    );
  }

  private async load(ids: string[]): Promise<Map<string, UserRecord>> {
    const rows = await this.db
      .select()
      .from(users)
      .where(inArray(users.id, ids.map(BigInt)));
    return new Map(
      rows.map((u) => [
        userCacheKey(u.id.toString()),
        {
          id: u.id.toString(),
          username: u.username,
          displayName: u.displayName,
          bio: u.bio,
          createdAt: u.createdAt.toISOString(),
          counts: {
            followers: u.followerCount,
            following: u.followingCount,
            tweets: u.tweetCount,
          },
        },
      ]),
    );
  }
}

export function toUserRef(u: UserRecord): UserRef {
  return { id: u.id, username: u.username, displayName: u.displayName };
}

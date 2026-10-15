import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { PG_UNIQUE_VIOLATION, pgErrorCode } from '../common/pg-errors.js';
import { SNOWFLAKE } from '../common/id.module.js';
import type { Snowflake } from '../common/snowflake.js';
import { DB, type Database } from '../db/db.module.js';
import { users, type User } from '../db/schema/index.js';
import { UsernamesService } from '../usernames/usernames.service.js';

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SNOWFLAKE) private readonly ids: Snowflake,
    @Inject(UsernamesService) private readonly usernames: UsernamesService,
  ) {}

  async create(input: {
    username: string;
    displayName: string;
    passwordHash: string;
  }): Promise<User> {
    try {
      const [user] = await this.db
        .insert(users)
        .values({ id: this.ids.next(), ...input })
        .returning();
      await this.usernames.add(user.username);
      return user;
    } catch (err) {
      // The unique index is the real guarantee: two sign-ups racing for the
      // same name can both pass any earlier check, but only one insert wins.
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION)
        throw new ConflictException('That username is taken');
      throw err;
    }
  }

  // Case-insensitive, and served by the lower(username) unique index.
  async findByUsername(username: string): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.username}) = lower(${username})`)
      .limit(1);
    return user;
  }

  async findById(id: bigint): Promise<User | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);
    return user;
  }
}

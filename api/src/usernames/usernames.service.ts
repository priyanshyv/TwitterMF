import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { asc, gt, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { DB, type Database } from '../db/db.module.js';
import { users } from '../db/schema/index.js';
import { REDIS } from '../redis/redis.module.js';
import { bloomSize } from './bloom.js';
import { RedisBloomFilter } from './redis-bloom-filter.js';

// Sized for 1M accounts at a 1% false-positive rate: 1.2 MB in Redis.
const CAPACITY = 1_000_000;
const FALSE_POSITIVE_RATE = 0.01;
const REBUILD_BATCH = 5_000;

export interface Availability {
  username: string;
  available: boolean;
  // Which layer answered. "bloom" means Postgres was never asked.
  checkedBy: 'bloom' | 'database';
}

@Injectable()
export class UsernamesService implements OnApplicationBootstrap {
  private readonly logger = new Logger('UsernameBloom');
  private readonly filter: RedisBloomFilter;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) redis: Redis,
  ) {
    const { bits, hashes } = bloomSize(CAPACITY, FALSE_POSITIVE_RATE);
    this.filter = new RedisBloomFilter(redis, 'bloom:usernames', bits, hashes);
  }

  async check(username: string): Promise<Availability> {
    const name = username.toLowerCase();

    // Fast path: a "no" from the filter is certain, so most checks of fresh
    // names never reach Postgres. If Redis is slow or down, skip it.
    let maybeTaken = true;
    try {
      maybeTaken = await withTimeout(
        this.filter.mightContain(name),
        200,
        'bloom check',
      );
    } catch (err) {
      this.logger.warn(`filter unavailable, asking Postgres: ${String(err)}`);
    }
    if (!maybeTaken) return { username, available: true, checkedBy: 'bloom' };

    // "Maybe": only Postgres knows for sure.
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.username}) = ${name}`)
      .limit(1);
    if (!row) this.logger.debug(`false positive for "${name}"`);
    return { username, available: !row, checkedBy: 'database' };
  }

  // Called after every sign-up. If it fails, the filter wrongly says the name
  // is free; sign-up still can't take it twice, because the unique index in
  // Postgres has the final word.
  async add(username: string): Promise<void> {
    try {
      await withTimeout(
        this.filter.add(username.toLowerCase()),
        200,
        'bloom add',
      );
    } catch (err) {
      this.logger.warn(`could not add "${username}": ${String(err)}`);
    }
  }

  // Redis may lose the filter (flushed, new instance). Bloom filters can be
  // rebuilt from the source of truth at any time, so do that on boot.
  async onApplicationBootstrap() {
    try {
      if (await this.filter.exists()) return;
      const count = await this.rebuild();
      this.logger.log(`rebuilt from ${count} usernames`);
    } catch (err) {
      this.logger.warn(`rebuild skipped: ${String(err)}`);
    }
  }

  async rebuild(): Promise<number> {
    let count = 0;
    let after = -1n;
    // Keyset pagination: "id > last seen id" stays fast at any depth.
    for (;;) {
      const batch = await this.db
        .select({ id: users.id, username: users.username })
        .from(users)
        .where(gt(users.id, after))
        .orderBy(asc(users.id))
        .limit(REBUILD_BATCH);
      if (batch.length === 0) break;
      await this.filter.addMany(batch.map((u) => u.username.toLowerCase()));
      count += batch.length;
      after = batch[batch.length - 1].id;
    }
    return count;
  }
}

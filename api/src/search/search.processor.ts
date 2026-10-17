import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module.js';
import { tweets } from '../db/schema/index.js';
import type { SearchJob } from '../jobs/queues.js';
import { SearchService } from './search.service.js';
import { TrendsService } from './trends.service.js';

// Worker side of search: keeps Meilisearch and trending in step with
// Postgres. If Meilisearch is down, the job fails and the queue retries it
// with backoff (and dead-letters it after 5 tries).
@Injectable()
export class SearchProcessor {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(TrendsService) private readonly trends: TrendsService,
  ) {}

  async process(job: SearchJob): Promise<void> {
    if (job.kind === 'tweet') return this.search.indexTweet(job.id);
    if (job.kind === 'user') return this.search.indexUser(job.id);
    const [row] = await this.db
      .select({ text: tweets.text, createdAt: tweets.createdAt })
      .from(tweets)
      .where(eq(tweets.id, BigInt(job.tweetId)));
    if (row) await this.trends.record(job.tweetId, row.text, row.createdAt);
  }
}

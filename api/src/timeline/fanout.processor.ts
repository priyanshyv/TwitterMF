import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Database } from '../db/db.module.js';
import { follows, users } from '../db/schema/index.js';
import type { FanoutJob } from '../jobs/queues.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { TimelineService } from './timeline.service.js';

// Fan-out on write, run by the worker: copy a new tweet's ID into the
// timeline of everyone who follows its author, then tell their open tabs.
@Injectable()
export class FanoutProcessor {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(TimelineService) private readonly timeline: TimelineService,
    @Inject(RealtimePublisher) private readonly realtime: RealtimePublisher,
  ) {}

  async process(job: FanoutJob): Promise<{ pushed: number }> {
    const authorId = BigInt(job.authorId);
    const [author] = await this.db
      .select({ followers: users.followerCount })
      .from(users)
      .where(eq(users.id, authorId));
    if (!author) return { pushed: 0 }; // account deleted meanwhile

    // Big accounts are not fanned out; readers merge their tweets in.
    if (this.timeline.isCelebrity(author.followers)) return { pushed: 0 };

    // Bounded by FANOUT_MAX_FOLLOWERS, so one query is fine.
    const rows = await this.db
      .select({ id: follows.followerId })
      .from(follows)
      .where(eq(follows.followeeId, authorId));
    const followerIds = rows.map((r) => r.id.toString());

    await this.timeline.push(followerIds, job.tweetId);
    await this.realtime.publish(followerIds, {
      type: 'timeline',
      tweetId: job.tweetId,
      authorId: job.authorId,
    });
    return { pushed: followerIds.length };
  }
}

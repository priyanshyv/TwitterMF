import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS } from '../redis/redis.module.js';

// Events pushed to a user's open browser tabs over WebSocket.
export type RealtimeEvent =
  | { type: 'notification'; unread: number }
  | { type: 'timeline'; tweetId: string; authorId: string };

export const userChannel = (userId: string) => `rt:user:${userId}`;

// Publish/subscribe: whoever publishes doesn't know who's listening. A worker
// publishes "new post for user 42" to Redis; whichever API instance holds
// user 42's WebSocket is subscribed to that channel and forwards it. That's
// what lets real-time work across many API instances.
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger('Realtime');

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async publish(userIds: string[], event: RealtimeEvent): Promise<void> {
    if (userIds.length === 0) return;
    const message = JSON.stringify(event);
    const pipeline = this.redis.pipeline();
    for (const id of userIds) pipeline.publish(userChannel(id), message);
    // Live updates are best effort: if Redis hiccups, the data is still
    // there on the next page load.
    await pipeline
      .exec()
      .catch((err: unknown) =>
        this.logger.warn(`publish failed: ${String(err)}`),
      );
  }
}

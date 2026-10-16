import {
  Global,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import {
  jobOptions,
  QUEUE,
  type FanoutJob,
  type NotificationJob,
} from './queues.js';

export const QUEUES = Symbol('QUEUES');
export const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');
export type Queues = Record<keyof typeof QUEUE, Queue>;

// The producer side. Controllers and services call these after their
// database write has committed.
@Injectable()
export class JobsService {
  private readonly logger = new Logger('Jobs');

  constructor(@Inject(QUEUES) private readonly queues: Queues) {}

  fanout(job: FanoutJob) {
    // A fixed job ID makes enqueueing idempotent: adding the same tweet
    // twice (a retried request) is ignored while the first is still known.
    return this.add(this.queues.fanout, 'tweet', job, `fanout-${job.tweetId}`);
  }

  notify(job: NotificationJob) {
    return this.add(this.queues.notifications, job.kind, job);
  }

  // Enqueueing must never break the user's action: the tweet or like is
  // already saved. If Redis is down, log it and move on. (The gap between
  // "saved in Postgres" and "queued in Redis" is the dual-write problem;
  // Phase 5's transactional outbox closes it.)
  private async add(queue: Queue, name: string, data: object, jobId?: string) {
    try {
      await withTimeout(
        queue.add(name, data, { jobId }),
        500,
        `enqueue ${name}`,
      );
    } catch (err) {
      this.logger.warn(
        `could not enqueue ${queue.name}/${name}: ${String(err)}`,
      );
    }
  }
}

@Global()
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      inject: [ENV],
      useFactory: (env: Env) => {
        // BullMQ needs its own connection: workers block on it waiting for
        // jobs, and it must retry forever (maxRetriesPerRequest: null)
        // instead of failing commands the way the app's connection does.
        const connection = new Redis(env.REDIS_URL, {
          maxRetriesPerRequest: null,
        });
        connection.on('error', () => undefined); // reconnects on its own
        return connection;
      },
    },
    {
      provide: QUEUES,
      inject: [ENV, QUEUE_CONNECTION],
      useFactory: (env: Env, connection: Redis): Queues => {
        const defaultJobOptions = jobOptions(env.JOB_BACKOFF_MS);
        const make = (name: string) =>
          new Queue(name, { connection, defaultJobOptions });
        return {
          fanout: make(QUEUE.fanout),
          notifications: make(QUEUE.notifications),
          deadLetter: make(QUEUE.deadLetter),
        };
      },
    },
    JobsService,
  ],
  exports: [QUEUES, QUEUE_CONNECTION, JobsService],
})
export class JobsModule implements OnApplicationShutdown {
  constructor(
    @Inject(QUEUES) private readonly queues: Queues,
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
  ) {}

  async onApplicationShutdown() {
    await Promise.all(Object.values(this.queues).map((q) => q.close()));
    // Queues don't close a connection they were handed; we own it.
    await this.connection.quit().catch(() => undefined);
  }
}

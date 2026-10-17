import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { QUEUE_CONNECTION, QUEUES, type Queues } from '../jobs/jobs.module.js';
import {
  QUEUE,
  type DeadLetterJob,
  type FanoutJob,
  type MediaJob,
  type NotificationJob,
  type SearchJob,
  type QueueName,
} from '../jobs/queues.js';
import { MediaProcessor } from '../media/media.processor.js';
import { SearchProcessor } from '../search/search.processor.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FanoutProcessor } from '../timeline/fanout.processor.js';

// The consumer side: one BullMQ Worker per queue, each pulling jobs from
// Redis and running them, several at a time (concurrency).
@Injectable()
export class WorkerService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger('Worker');
  private readonly workers: Worker[] = [];

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    @Inject(QUEUES) private readonly queues: Queues,
    @Inject(FanoutProcessor) private readonly fanout: FanoutProcessor,
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
    @Inject(MediaProcessor) private readonly media: MediaProcessor,
    @Inject(SearchProcessor) private readonly search: SearchProcessor,
  ) {}

  onModuleInit() {
    this.start<FanoutJob>(QUEUE.fanout, 5, (job) =>
      this.fanout.process(job.data),
    );
    this.start<NotificationJob>(QUEUE.notifications, 10, (job) =>
      this.notifications.handle(job.data),
    );
    // Image work is CPU-heavy; a few at a time per worker process.
    this.start<MediaJob>(QUEUE.media, 2, (job) => this.media.process(job.data));
    this.start<SearchJob>(QUEUE.search, 5, (job) =>
      this.search.process(job.data),
    );
  }

  private start<T>(
    name: QueueName,
    concurrency: number,
    run: (job: Job<T>) => Promise<unknown>,
  ) {
    const worker = new Worker<T>(name, run, {
      connection: this.connection,
      concurrency,
    });

    worker.on('failed', (job, err) => {
      if (!job) return;
      // Some failures are final (a file that isn't an image): the job threw
      // UnrecoverableError, BullMQ skips the retries, and it's not a dead
      // letter either: there's nothing to replay.
      if (
        err instanceof UnrecoverableError ||
        err.name === 'UnrecoverableError'
      ) {
        this.logger.warn(`${name}/${job.name} failed for good: ${err.message}`);
        return;
      }
      const attempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < attempts) {
        this.logger.warn(
          `${name}/${job.name} failed (attempt ${job.attemptsMade}/${attempts}), retrying: ${err.message}`,
        );
        return;
      }
      // Out of attempts: park it in the dead-letter queue with everything
      // needed to understand and replay it, instead of silently dropping it.
      this.logger.error(
        `${name}/${job.name} gave up after ${attempts} attempts: ${err.message}`,
      );
      const dead: DeadLetterJob = {
        queue: name,
        name: job.name,
        data: job.data,
        failedReason: err.message,
        attemptsMade: job.attemptsMade,
        failedAt: new Date().toISOString(),
      };
      void this.queues.deadLetter
        .add(`${name}/${job.name}`, dead, {
          removeOnComplete: false,
          removeOnFail: false,
        })
        .catch((e: unknown) =>
          this.logger.error(`could not dead-letter: ${String(e)}`),
        );
    });
    worker.on('error', (err) =>
      this.logger.warn(`${name} worker error: ${err.message}`),
    );
    this.workers.push(worker);
  }

  // Finish the jobs in hand before the connections close (graceful
  // shutdown: a deploy shouldn't leave half-done fan-outs).
  async beforeApplicationShutdown() {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}

import {
  Global,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { Database } from '../db/db.module.js';
import { outbox } from '../db/schema/index.js';
import { jobOptions, QUEUE, type OutboxMessage } from './queues.js';

export const QUEUES = Symbol('QUEUES');
export const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');
export type Queues = Record<keyof typeof QUEUE, Queue>;

// The producer side. Services call add() inside the database transaction
// that makes the change, passing the transaction: the outbox rows commit
// (or roll back) together with the change itself.
@Injectable()
export class OutboxService {
  async add(tx: Pick<Database, 'insert'>, messages: OutboxMessage[]) {
    if (messages.length === 0) return;
    await tx.insert(outbox).values(
      messages.map((m) => ({
        queue: m.queue,
        name: m.name,
        payload: m.data,
      })),
    );
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
          search: make(QUEUE.search),
          media: make(QUEUE.media),
          deadLetter: make(QUEUE.deadLetter),
        };
      },
    },
    OutboxService,
  ],
  exports: [QUEUES, QUEUE_CONNECTION, OutboxService],
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

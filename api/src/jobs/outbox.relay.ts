import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { inArray, sql } from 'drizzle-orm';
import type { Pool, PoolClient } from 'pg';
import { withTimeout } from '../common/with-timeout.js';
import { DB, PG_POOL, type Database } from '../db/db.module.js';
import { outbox } from '../db/schema/index.js';
import { QUEUES, type Queues } from './jobs.module.js';
import { QUEUE, type QueueName } from './queues.js';

const BATCH = 100;
const POLL_MS = 1_000;

const QUEUE_KEY: Partial<Record<QueueName, keyof Queues>> = {
  [QUEUE.fanout]: 'fanout',
  [QUEUE.notifications]: 'notifications',
  [QUEUE.search]: 'search',
  [QUEUE.media]: 'media',
};

// Moves outbox rows into the job queues (runs in the worker process).
//
// Wake-ups: Postgres LISTEN/NOTIFY tells us the instant new rows commit, and
// a 1 s poll covers anything missed (say, rows written while we restarted).
//
// Each batch, in one transaction:
//   1. SELECT … FOR UPDATE SKIP LOCKED  lock up to 100 rows; another relay
//      running at the same time skips them and takes the next ones, so
//      several workers can relay in parallel without doing anything twice
//   2. add them to BullMQ, with job ID "outbox-<row id>"
//   3. DELETE them, COMMIT
// If step 2 fails (Redis down), the transaction rolls back and the rows wait
// for the next try: nothing is lost. If we crash after 2 but before 3, the
// rows are relayed again; the same job IDs make BullMQ ignore the repeat,
// and the consumers are idempotent anyway (at-least-once, again).
@Injectable()
export class OutboxRelay
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('Outbox');
  private listener?: PoolClient;
  private timer?: NodeJS.Timeout;
  private draining = false;
  private again = false;
  private stopped = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUES) private readonly queues: Queues,
  ) {}

  async onApplicationBootstrap() {
    await this.listen();
    this.timer = setInterval(() => void this.drain(), POLL_MS);
    this.timer.unref();
    void this.drain(); // whatever piled up while no relay was running
  }

  // Relays everything currently in the outbox. Concurrent calls coalesce:
  // a call that arrives mid-drain makes the running drain loop once more.
  async drain(): Promise<number> {
    if (this.draining) {
      this.again = true;
      return 0;
    }
    this.draining = true;
    let moved = 0;
    try {
      do {
        this.again = false;
        let n: number;
        do {
          n = await this.batch();
          moved += n;
        } while (n === BATCH && !this.stopped);
      } while (this.again && !this.stopped);
    } catch (err) {
      this.logger.warn(`relay paused, will retry: ${String(err)}`);
    } finally {
      this.draining = false;
    }
    return moved;
  }

  private batch(): Promise<number> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{
        id: string;
        queue: QueueName;
        name: string;
        payload: object;
      }>(sql`
        select id, queue, name, payload from outbox
        order by id
        limit ${BATCH}
        for update skip locked`);
      if (rows.length === 0) return 0;

      const byQueue = new Map<keyof Queues, typeof rows>();
      for (const row of rows) {
        const key = QUEUE_KEY[row.queue];
        if (!key)
          throw new Error(`outbox row ${row.id}: unknown queue ${row.queue}`);
        byQueue.set(key, [...(byQueue.get(key) ?? []), row]);
      }
      for (const [key, group] of byQueue)
        await withTimeout(
          this.queues[key].addBulk(
            group.map((r) => ({
              name: r.name,
              data: r.payload,
              opts: { jobId: `outbox-${r.id}` },
            })),
          ),
          2_000,
          'outbox relay',
        );

      await tx.delete(outbox).where(
        inArray(
          outbox.id,
          rows.map((r) => BigInt(r.id)),
        ),
      );
      return rows.length;
    });
  }

  // A dedicated connection that stays in LISTEN mode.
  private async listen() {
    if (this.stopped) return;
    try {
      this.listener = await this.pool.connect();
      this.listener.on('notification', () => void this.drain());
      this.listener.on('error', (err) => {
        this.logger.warn(`listener lost (${err.message}), reconnecting`);
        this.listener?.release(true);
        this.listener = undefined;
        setTimeout(() => void this.listen(), 1_000).unref();
      });
      await this.listener.query('LISTEN outbox');
    } catch (err) {
      this.logger.warn(`cannot LISTEN yet (${String(err)}); polling only`);
      setTimeout(() => void this.listen(), 5_000).unref();
    }
  }

  async beforeApplicationShutdown() {
    this.stopped = true;
    clearInterval(this.timer);
    await this.drain(); // hand over what's left before going
    this.listener?.release();
  }

  async pending(): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(outbox);
    return row.n;
  }
}

// Background job dashboard for the terminal.
//   npm run jobs              queue sizes and the dead-letter queue
//   npm run jobs -- --replay  re-run every dead-lettered job
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module.js';
import { listDeadLetters, replayDeadLetters } from '../src/jobs/dead-letter.js';
import { QUEUES, type Queues } from '../src/jobs/jobs.module.js';

const app = await NestFactory.createApplicationContext(AppModule, {
  logger: ['error'],
});
const queues = app.get<Queues>(QUEUES);

if (process.argv.includes('--replay')) {
  const n = await replayDeadLetters(queues);
  console.log(
    n
      ? `Replayed ${n} job(s). Run npm run jobs to watch them.`
      : 'Nothing to replay.',
  );
} else {
  const rows = await Promise.all(
    (['fanout', 'notifications'] as const).map(async (name) => {
      const c = await queues[name].getJobCounts(
        'waiting',
        'active',
        'delayed',
        'completed',
        'failed',
      );
      return { queue: name, ...c };
    }),
  );
  console.table(rows);
  const dead = await listDeadLetters(queues);
  if (dead.length === 0) console.log('\nDead-letter queue: empty.');
  else {
    console.log(
      `\nDead-letter queue: ${dead.length} job(s). Fix the cause, then: npm run jobs -- --replay`,
    );
    console.table(
      dead.map((d) => ({
        job: `${d.queue}/${d.name}`,
        attempts: d.attemptsMade,
        failedAt: d.failedAt,
        reason: d.failedReason.slice(0, 60),
      })),
    );
  }
}
await app.close();

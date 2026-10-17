import type { Queues } from './jobs.module.js';
import { QUEUE, type DeadLetterJob, type QueueName } from './queues.js';

const BY_NAME: Record<QueueName, keyof Queues> = {
  [QUEUE.fanout]: 'fanout',
  [QUEUE.notifications]: 'notifications',
  [QUEUE.search]: 'search',
  [QUEUE.media]: 'media',
  [QUEUE.deadLetter]: 'deadLetter',
};

export async function listDeadLetters(queues: Queues) {
  const jobs = await queues.deadLetter.getJobs(['waiting'], 0, -1, true);
  return jobs.map((j) => ({ id: j.id!, ...(j.data as DeadLetterJob) }));
}

// Puts dead jobs back on their original queue with a fresh set of attempts
// (after you've fixed whatever made them fail), then removes them here.
export async function replayDeadLetters(queues: Queues): Promise<number> {
  const jobs = await queues.deadLetter.getJobs(['waiting'], 0, -1, true);
  for (const job of jobs) {
    const dead = job.data as DeadLetterJob;
    await queues[BY_NAME[dead.queue]].add(dead.name, dead.data);
    await job.remove();
  }
  return jobs.length;
}

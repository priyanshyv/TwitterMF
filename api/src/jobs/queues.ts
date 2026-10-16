// Every background job in one place: queue names, job names, payloads.
//
// A queue decouples "something happened" from "deal with it". The API
// (producer) records the event in Redis and answers the user at once; a
// separate worker process (consumer) does the slow part: writing a tweet ID
// into 5,000 timelines, creating notifications. If the worker is down or
// slow, jobs wait in the queue instead of making requests slow or failing.

export const QUEUE = {
  fanout: 'fanout',
  notifications: 'notifications',
  // Jobs that failed every attempt land here, untouched, for a human to
  // inspect and replay (`npm run jobs`). No worker consumes it.
  deadLetter: 'dead-letter',
} as const;
export type QueueName = (typeof QUEUE)[keyof typeof QUEUE];

export interface FanoutJob {
  tweetId: string;
  authorId: string;
}

export type NotificationJob =
  | { kind: 'follow'; actorId: string; followeeId: string }
  | { kind: 'like'; actorId: string; tweetId: string }
  | { kind: 'retweet'; actorId: string; tweetId: string }
  // A new tweet: notifies the author of the tweet it replies to, and
  // everyone it @mentions.
  | { kind: 'tweet'; actorId: string; tweetId: string };

export interface DeadLetterJob {
  queue: QueueName;
  name: string;
  data: unknown;
  failedReason: string;
  attemptsMade: number;
  failedAt: string;
}

export const ATTEMPTS = 5;

// Retries: 1 s, 2 s, 4 s, 8 s (exponential backoff), each randomly shortened
// by up to half (jitter) so that 1,000 jobs failing together don't all retry
// at the same instant and knock the recovering service over again.
export function jobOptions(backoffMs: number) {
  return {
    attempts: ATTEMPTS,
    backoff: { type: 'exponential' as const, delay: backoffMs, jitter: 0.5 },
    // Keep a short history of successes for debugging; failures move to
    // the dead-letter queue, so drop them from here once handled.
    removeOnComplete: { age: 60 * 60, count: 1_000 },
    removeOnFail: { age: 24 * 60 * 60 },
  };
}

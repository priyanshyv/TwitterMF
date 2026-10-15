// Shapes returned by the NestJS API. IDs are strings: they are 64-bit
// Snowflakes, too big for a JavaScript number.

export interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  createdAt: string;
}

export interface UserRef {
  id: string;
  username: string;
  displayName: string;
}

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  author: UserRef;
  replyTo: { id: string; author: UserRef } | null;
  counts: { likes: number; replies: number; retweets: number };
  // What the logged-in viewer has done to it; null when logged out.
  viewer: { liked: boolean; retweeted: boolean } | null;
}

// A row in a timeline or profile. `id` is the row's own ID (the pagination
// cursor); for a retweet, `tweet` is the original.
export interface FeedItem {
  id: string;
  retweetedBy: UserRef | null;
  tweet: Tweet;
}

export interface Thread {
  tweet: Tweet;
  ancestors: Tweet[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Profile {
  user: User;
  stats: { followers: number; following: number; tweets: number };
  viewer: { isMe: boolean; follows: boolean } | null;
}

export type Suggestion = UserRef;

export type DependencyStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  db: DependencyStatus;
  redis: DependencyStatus;
  uptimeSeconds: number;
}

export interface UsernameAvailability {
  username: string;
  available: boolean;
  checkedBy: 'bloom' | 'database';
}

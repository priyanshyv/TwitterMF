import type { UserRef } from '../users/user-records.service.js';

// What clients see. IDs are strings (64-bit Snowflakes).
export interface TweetView {
  id: string;
  text: string;
  createdAt: string;
  author: UserRef;
  // Set when this tweet answers another one.
  replyTo: { id: string; author: UserRef } | null;
  counts: { likes: number; replies: number; retweets: number };
  // What the logged-in viewer has done to it; null for logged-out visitors.
  viewer: { liked: boolean; retweeted: boolean } | null;
}

// One entry in a timeline or profile. `id` is the row's own ID and is what
// pagination cursors use. For a retweet that's the retweet's ID (so it sorts
// by when it was retweeted), while `tweet` is the original.
export interface FeedItem {
  id: string;
  retweetedBy: UserRef | null;
  tweet: TweetView;
}

// The cached, JSON-safe shape of a tweet row.
export interface TweetRecord {
  id: string;
  authorId: string;
  text: string;
  createdAt: string;
  replyToId: string | null;
  retweetOfId: string | null;
  counts: { likes: number; replies: number; retweets: number };
}

// Shapes returned by the NestJS API. IDs are strings: they are 64-bit
// Snowflakes, too big for a JavaScript number.

export interface User {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  createdAt: string;
}

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  author: { id: string; username: string; displayName: string };
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

export interface Suggestion {
  id: string;
  username: string;
  displayName: string;
}

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

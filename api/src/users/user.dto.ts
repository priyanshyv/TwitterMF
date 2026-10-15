import type { User } from '../db/schema/index.js';

// What clients see of a user. IDs go out as strings: a 64-bit Snowflake
// doesn't fit in a JavaScript number without losing digits.
export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  createdAt: string;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id.toString(),
    username: user.username,
    displayName: user.displayName,
    bio: user.bio,
    createdAt: user.createdAt.toISOString(),
  };
}

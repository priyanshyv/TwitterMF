// Every limit in one place. `key` says whose quota a request spends:
//   ip           per client address (anonymous endpoints)
//   user         per logged-in account (needs AuthGuard to run first)
//   ip+username  per address AND target account, for logins: slows password
//                guessing against one account without letting someone lock
//                out a victim from everywhere.
export type RateLimitPolicy =
  | {
      algorithm: 'token-bucket';
      capacity: number;
      refillPerMinute: number;
      key: 'ip' | 'user';
    }
  | {
      algorithm: 'sliding-window';
      limit: number;
      windowMs: number;
      key: 'ip' | 'ip+username';
    };

export const POLICIES = {
  // 10 attempts per 15 minutes per account per address.
  login: {
    algorithm: 'sliding-window',
    limit: 10,
    windowMs: 15 * 60_000,
    key: 'ip+username',
  },
  // 10 new accounts per hour per address.
  signup: {
    algorithm: 'sliding-window',
    limit: 10,
    windowMs: 60 * 60_000,
    key: 'ip',
  },
  // Bursts of 10 tweets, then about one every 6 seconds.
  post: {
    algorithm: 'token-bucket',
    capacity: 10,
    refillPerMinute: 10,
    key: 'user',
  },
  // Likes, retweets, follows: bursts of 60, then one per second.
  engage: {
    algorithm: 'token-bucket',
    capacity: 60,
    refillPerMinute: 60,
    key: 'user',
  },
  // Image uploads: bursts of 20, then one every 3 seconds.
  upload: {
    algorithm: 'token-bucket',
    capacity: 20,
    refillPerMinute: 20,
    key: 'user',
  },
  // Search: bursts of 30, then one a second, per address.
  search: {
    algorithm: 'token-bucket',
    capacity: 30,
    refillPerMinute: 60,
    key: 'ip',
  },
  // The sign-up form checks names as you type.
  'username-check': {
    algorithm: 'token-bucket',
    capacity: 30,
    refillPerMinute: 120,
    key: 'ip',
  },
} satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof POLICIES;

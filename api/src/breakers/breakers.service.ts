import { Inject, Injectable, Logger } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

// A circuit breaker sits between us and a dependency that might be down
// (search, object storage), like the breaker in a fuse box:
//
//   closed     normal: calls go through, failures are counted
//   open       too many recent failures: calls fail IMMEDIATELY, without
//              touching the dependency, for BREAKER_RESET_MS (30 s)
//   half-open  after that, ONE trial call goes through; success closes the
//              breaker, failure opens it again
//
// Why: when search is down, every request waiting 5 s for it to time out
// would pile up and drag the whole API down with it. An open breaker turns
// "slow failure" into "instant failure", the caller falls back (search
// uses Postgres instead), and the struggling service gets breathing room.

export type BreakerName = 'search' | 'storage';
export type BreakerState = 'closed' | 'open' | 'half-open';

const SETTINGS: Record<BreakerName, { timeout: number }> = {
  // A search slower than this is treated as a failure.
  search: { timeout: 800 },
  // Storage calls move bigger payloads; give them longer.
  storage: { timeout: 3_000 },
};

type Task = () => Promise<unknown>;

@Injectable()
export class BreakersService {
  private readonly logger = new Logger('CircuitBreaker');
  private readonly breakers = new Map<
    BreakerName,
    CircuitBreaker<[Task], unknown>
  >();

  constructor(@Inject(ENV) private readonly env: Env) {}

  // Runs `task` through the named breaker. Rejects at once with an
  // "EOPENBREAKER" error while the breaker is open.
  run<T>(name: BreakerName, task: () => Promise<T>): Promise<T> {
    return this.breaker(name).fire(task) as Promise<T>;
  }

  states(): Record<BreakerName, BreakerState> {
    const state = (name: BreakerName): BreakerState => {
      const b = this.breakers.get(name);
      return !b || b.closed ? 'closed' : b.halfOpen ? 'half-open' : 'open';
    };
    return { search: state('search'), storage: state('storage') };
  }

  private breaker(name: BreakerName) {
    let breaker = this.breakers.get(name);
    if (breaker) return breaker;
    breaker = new CircuitBreaker((task: Task) => task(), {
      timeout: SETTINGS[name].timeout,
      // Open when at least half of the recent calls failed…
      errorThresholdPercentage: 50,
      // …but only once there have been enough calls to judge (no tripping
      // on the very first error after a quiet period).
      volumeThreshold: 5,
      // "Recent" = the last 10 seconds.
      rollingCountTimeout: 10_000,
      resetTimeout: this.env.BREAKER_RESET_MS,
    });
    breaker.on('open', () =>
      this.logger.warn(
        `${name}: OPEN, failing fast for ${this.env.BREAKER_RESET_MS} ms`,
      ),
    );
    breaker.on('halfOpen', () =>
      this.logger.log(`${name}: half-open, trying one request`),
    );
    breaker.on('close', () =>
      this.logger.log(`${name}: closed, back to normal`),
    );
    this.breakers.set(name, breaker);
    return breaker;
  }
}

export function isBreakerOpen(err: unknown) {
  return (err as { code?: string })?.code === 'EOPENBREAKER';
}

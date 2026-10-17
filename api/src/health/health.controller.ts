import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  BreakersService,
  type BreakerState,
} from '../breakers/breakers.service.js';
import { withTimeout } from '../common/with-timeout.js';
import { DB, type Database } from '../db/db.module.js';
import { REDIS } from '../redis/redis.module.js';
import { SearchService } from '../search/search.service.js';
import { StorageService } from '../storage/storage.service.js';

type DependencyStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  db: DependencyStatus;
  redis: DependencyStatus;
  // Reported, but they don't decide `status`: the app works without them
  // (search falls back to Postgres; only uploads stop).
  search: DependencyStatus;
  storage: DependencyStatus;
  breakers: Record<'search' | 'storage', BreakerState>;
  uptimeSeconds: number;
}

const CHECK_TIMEOUT_MS = 1_000;

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(SearchService) private readonly search: SearchService,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(BreakersService) private readonly breakers: BreakersService,
  ) {}

  // Readiness check: can this instance serve traffic right now? A load
  // balancer polls this and stops routing to instances that answer 503.
  // Only critical dependencies count: taking every API instance out of
  // rotation because search is down would turn a degraded feature into a
  // full outage.
  @Get()
  async check(): Promise<HealthReport> {
    const [db, redis, search, storage] = await Promise.all([
      this.probe(this.db.execute(sql`select 1`), 'postgres'),
      this.probe(this.redis.ping(), 'redis'),
      this.probe(this.truthy(this.search.ping()), 'search'),
      this.probe(this.truthy(this.storage.ping()), 'storage'),
    ]);

    const report: HealthReport = {
      status: db === 'up' && redis === 'up' ? 'ok' : 'degraded',
      db,
      redis,
      search,
      storage,
      breakers: this.breakers.states(),
      uptimeSeconds: Math.round(process.uptime()),
    };
    if (report.status !== 'ok') throw new ServiceUnavailableException(report);
    return report;
  }

  private async truthy(check: Promise<boolean>) {
    if (!(await check)) throw new Error('unreachable');
  }

  private async probe(
    check: Promise<unknown>,
    label: string,
  ): Promise<DependencyStatus> {
    try {
      await withTimeout(check, CHECK_TIMEOUT_MS, label);
      return 'up';
    } catch {
      return 'down';
    }
  }
}

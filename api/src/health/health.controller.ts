import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { withTimeout } from '../common/with-timeout.js';
import { DB, type Database } from '../db/db.module.js';
import { REDIS } from '../redis/redis.module.js';

type DependencyStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  db: DependencyStatus;
  redis: DependencyStatus;
  uptimeSeconds: number;
}

const CHECK_TIMEOUT_MS = 1_000;

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  // Readiness check: can this instance serve traffic right now? A load
  // balancer polls this and stops routing to instances that answer 503.
  @Get()
  async check(): Promise<HealthReport> {
    const [db, redis] = await Promise.all([
      this.probe(this.db.execute(sql`select 1`), 'postgres'),
      this.probe(this.redis.ping(), 'redis'),
    ]);

    const report: HealthReport = {
      status: db === 'up' && redis === 'up' ? 'ok' : 'degraded',
      db,
      redis,
      uptimeSeconds: Math.round(process.uptime()),
    };
    if (report.status !== 'ok') throw new ServiceUnavailableException(report);
    return report;
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

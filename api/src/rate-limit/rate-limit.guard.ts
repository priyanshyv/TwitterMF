import {
  applyDecorators,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import type { AuthedRequest } from '../auth/auth.types.js';
import { withTimeout } from '../common/with-timeout.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { POLICIES, type PolicyName, type RateLimitPolicy } from './policies.js';
import { RATE_LIMITER } from './rate-limit.module.js';
import type {
  RateLimitResult,
  RedisRateLimiter,
} from './redis-rate-limiter.js';

const POLICY = 'rateLimitPolicy';

// @RateLimit('post') on a route. Put it after @UseGuards(AuthGuard) for
// per-user policies, so the user is known when this runs.
export const RateLimit = (policy: PolicyName) =>
  applyDecorators(SetMetadata(POLICY, policy), UseGuards(RateLimitGuard));

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger('RateLimit');

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RedisRateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.env.RATE_LIMIT_ENABLED) return true;
    const name = this.reflector.get<PolicyName>(POLICY, context.getHandler());
    const policy: RateLimitPolicy = POLICIES[name];
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const key = `rl:${name}:${subject(policy, req)}`;

    let result: RateLimitResult;
    try {
      result = await withTimeout(this.check(policy, key), 200, 'rate limit');
    } catch (err) {
      // Fail open: if Redis is down, let requests through rather than take
      // the whole app down with it. (A bank might choose fail closed.)
      this.logger.warn(`limiter unavailable, allowing request: ${String(err)}`);
      return true;
    }

    const limit =
      policy.algorithm === 'token-bucket' ? policy.capacity : policy.limit;
    reply.header('RateLimit-Limit', limit);
    reply.header('RateLimit-Remaining', result.remaining);
    if (result.allowed) return true;

    const seconds = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
    reply.header('Retry-After', seconds);
    throw new HttpException(
      {
        statusCode: 429,
        message: `Too many requests. Try again in ${humanize(seconds)}.`,
        retryAfterSeconds: seconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  private check(policy: RateLimitPolicy, key: string) {
    return policy.algorithm === 'token-bucket'
      ? this.limiter.tokenBucket(key, policy.capacity, policy.refillPerMinute)
      : this.limiter.slidingWindow(key, policy.limit, policy.windowMs);
  }
}

// Behind a load balancer or Cloudflare, req.ip is the proxy's address unless
// Fastify is told to trust X-Forwarded-For; revisit when deploying (Phase 7).
function subject(policy: RateLimitPolicy, req: AuthedRequest) {
  switch (policy.key) {
    case 'user':
      return `user:${req.user?.id ?? `ip:${req.ip}`}`;
    case 'ip':
      return `ip:${req.ip}`;
    case 'ip+username': {
      const body = req.body as { username?: unknown } | undefined;
      const username = String(body?.username ?? '')
        .toLowerCase()
        .slice(0, 15);
      return `ip:${req.ip}:user:${username}`;
    }
  }
}

function humanize(seconds: number) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

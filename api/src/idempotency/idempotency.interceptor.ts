import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnprocessableEntityException,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import type { FastifyReply } from 'fastify';
import type { Redis } from 'ioredis';
import {
  catchError,
  from,
  mergeMap,
  of,
  throwError,
  type Observable,
} from 'rxjs';
import type { AuthedRequest } from '../auth/auth.types.js';
import { withTimeout } from '../common/with-timeout.js';
import { REDIS } from '../redis/redis.module.js';

// Idempotency keys: "do this at most once, even if I ask twice".
//
// A phone posts a tweet, the connection drops before the answer arrives, and
// the app retries. Did the first attempt land? Without a key, the retry may
// post the tweet twice. With one, the client sends the same random
// `Idempotency-Key` on every retry of the same action, and the server:
//
//   first time       -> claims the key (SET NX), runs the request, stores
//                       the response for 24 hours
//   same key again   -> replays the stored response; nothing runs twice
//   still running    -> 409, so a fast double-submit can't race the first
//   different body   -> 422: the key belongs to a different request
//   request failed   -> releases the key, so a retry can try for real
//
// Keys are scoped per user, so two accounts can't collide or peek.

const PENDING_TTL_MS = 60_000; // a crashed request can't hold a key forever
const DONE_TTL_SECONDS = 24 * 60 * 60;
const KEY_FORMAT = /^[A-Za-z0-9_:-]{1,100}$/;

type Stored =
  | { state: 'pending'; fingerprint: string }
  | { state: 'done'; fingerprint: string; status: number; body: unknown };

export const Idempotent = () => UseInterceptors(IdempotencyInterceptor);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Idempotency');

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return from(this.handle(context, next)).pipe(mergeMap((out) => out));
  }

  private async handle(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    const header = req.headers['idempotency-key'];
    if (header === undefined) return next.handle(); // optional for clients

    if (typeof header !== 'string' || !KEY_FORMAT.test(header))
      throw new HttpException(
        'Idempotency-Key must be 1–100 letters, digits, "-", "_" or ":"',
        400,
      );

    const key = `idem:${req.user?.id ?? 'anon'}:${header}`;
    const fingerprint = createHash('sha256')
      .update(`${req.method} ${req.url} ${JSON.stringify(req.body ?? null)}`)
      .digest('hex');
    const status =
      this.reflector.get<number>(HTTP_CODE_METADATA, context.getHandler()) ??
      (req.method === 'POST' ? 201 : 200);

    let claimed: boolean;
    try {
      const pending: Stored = { state: 'pending', fingerprint };
      claimed =
        (await withTimeout(
          this.redis.set(
            key,
            JSON.stringify(pending),
            'PX',
            PENDING_TTL_MS,
            'NX',
          ),
          200,
          'idempotency claim',
        )) === 'OK';
    } catch (err) {
      // Redis down: process normally rather than refuse to post at all.
      this.logger.warn(`unavailable, processing without a key: ${String(err)}`);
      return next.handle();
    }

    if (!claimed) {
      const raw = await this.redis.get(key);
      const stored = raw ? (JSON.parse(raw) as Stored) : null;
      if (!stored) return next.handle(); // expired in between: treat as new
      if (stored.fingerprint !== fingerprint)
        throw new UnprocessableEntityException(
          'This Idempotency-Key was already used for a different request',
        );
      if (stored.state === 'pending')
        throw new ConflictException(
          'A request with this Idempotency-Key is still in progress',
        );
      reply.status(stored.status);
      reply.header('Idempotent-Replayed', 'true');
      return of(stored.body);
    }

    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        const done: Stored = { state: 'done', fingerprint, status, body };
        await this.redis
          .set(key, JSON.stringify(done), 'EX', DONE_TTL_SECONDS)
          .catch(() => undefined);
        return body;
      }),
      catchError((err: unknown) =>
        from(this.redis.del(key).catch(() => 0)).pipe(
          mergeMap(() => throwError(() => err)),
        ),
      ),
    );
  }
}

import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { SNOWFLAKE } from '../common/id.module.js';
import type { Snowflake } from '../common/snowflake.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DB, type Database } from '../db/db.module.js';
import { refreshTokens } from '../db/schema/index.js';
import {
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  type AuthUser,
} from './auth.types.js';

// Two requests refreshing at the same moment (two tabs, or Next.js
// prefetching) would otherwise look like a stolen token being replayed.
// Within this window, an already-rotated token may rotate once more.
const ROTATION_GRACE_MS = 10_000;

export type RotateResult =
  | { ok: true; userId: bigint; refreshToken: string }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reused' };

@Injectable()
export class TokensService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(DB) private readonly db: Database,
    @Inject(SNOWFLAKE) private readonly ids: Snowflake,
  ) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  // ---- Access tokens: short-lived JWTs, checked without a database lookup.

  signAccessToken(user: AuthUser): Promise<string> {
    return new SignJWT({ username: user.username })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id.toString())
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AuthUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
      });
      if (!payload.sub || typeof payload.username !== 'string') return null;
      return { id: BigInt(payload.sub), username: payload.username };
    } catch {
      return null; // expired, tampered with, or not a JWT at all
    }
  }

  // ---- Refresh tokens: long-lived, random, stored hashed, single use.

  // Starts a new family (one per login).
  issueRefreshToken(userId: bigint): Promise<string> {
    return this.insertRefreshToken(this.db, userId, this.ids.next());
  }

  // Exchanges a refresh token for a new one. Each token works once; using an
  // old one again means someone else has a copy, so the whole family dies.
  async rotate(rawToken: string): Promise<RotateResult> {
    const now = new Date();
    const result = await this.db.transaction(async (tx) => {
      // FOR UPDATE: concurrent refreshes of the same token queue up here
      // instead of both seeing "not rotated yet".
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, sha256(rawToken)))
        .for('update');

      if (!row) return { ok: false, reason: 'unknown' } as const;
      if (row.revokedAt) return { ok: false, reason: 'revoked' } as const;
      if (row.expiresAt <= now)
        return { ok: false, reason: 'expired' } as const;

      if (row.rotatedAt) {
        const age = now.getTime() - row.rotatedAt.getTime();
        if (age > ROTATION_GRACE_MS) {
          await tx
            .update(refreshTokens)
            .set({ revokedAt: now })
            .where(
              and(
                eq(refreshTokens.familyId, row.familyId),
                isNull(refreshTokens.revokedAt),
              ),
            );
          return { ok: false, reason: 'reused' } as const;
        }
      } else {
        await tx
          .update(refreshTokens)
          .set({ rotatedAt: now })
          .where(eq(refreshTokens.id, row.id));
      }

      const refreshToken = await this.insertRefreshToken(
        tx,
        row.userId,
        row.familyId,
      );
      return { ok: true, userId: row.userId, refreshToken } as const;
    });
    return result;
  }

  // Logout: kills every token from this login, wherever it was copied to.
  async revokeFamilyOf(rawToken: string): Promise<void> {
    const [row] = await this.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(rawToken)));
    if (!row) return;
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.familyId, row.familyId),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  private async insertRefreshToken(
    db: Pick<Database, 'insert'>,
    userId: bigint,
    familyId: bigint,
  ): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    await db.insert(refreshTokens).values({
      id: this.ids.next(),
      userId,
      familyId,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
    });
    return raw;
  }
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

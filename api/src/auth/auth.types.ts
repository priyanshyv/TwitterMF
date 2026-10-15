import type { FastifyRequest } from 'fastify';

export interface AuthUser {
  id: bigint;
  username: string;
}

export type AuthedRequest = FastifyRequest & { user?: AuthUser };

export const ACCESS_COOKIE = 'tmf_at';
export const REFRESH_COOKIE = 'tmf_rt';
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

import type { CookieSerializeOptions } from '@fastify/cookie';
import type { FastifyReply } from 'fastify';
import type { Env } from '../config/env.js';
import {
  ACCESS_COOKIE,
  ACCESS_TTL_SECONDS,
  REFRESH_COOKIE,
  REFRESH_TTL_SECONDS,
} from './auth.types.js';

// Tokens live in httpOnly cookies: page JavaScript can't read them, so an XSS
// bug can't steal a session. SameSite=Lax stops other sites from sending
// them along with forged POSTs (CSRF).
function baseOptions(env: Env): CookieSerializeOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    path: '/',
    domain: env.COOKIE_DOMAIN,
  };
}

export function setAuthCookies(
  reply: FastifyReply,
  env: Env,
  tokens: { accessToken: string; refreshToken: string },
) {
  const base = baseOptions(env);
  reply.setCookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    maxAge: ACCESS_TTL_SECONDS,
  });
  reply.setCookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    maxAge: REFRESH_TTL_SECONDS,
  });
}

export function clearAuthCookies(reply: FastifyReply, env: Env) {
  const base = baseOptions(env);
  reply.clearCookie(ACCESS_COOKIE, base);
  reply.clearCookie(REFRESH_COOKIE, base);
}

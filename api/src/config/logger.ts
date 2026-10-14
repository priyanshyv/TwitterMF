import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';
import type { Env } from './env.js';

// Nest's own startup chatter: one line per module and per route. Useful when
// debugging dependency injection, noise the rest of the time.
const NEST_BOOT_CONTEXTS = new Set([
  'NestFactory',
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestApplication',
]);

export function loggerOptions(env: Env): Params {
  const dev = env.NODE_ENV === 'development';

  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      // One readable line per request. In production the full structured
      // req/res fields stay in the JSON, so logs remain searchable.
      customSuccessMessage: (req, res, ms) =>
        `${req.method} ${req.url} ${res.statusCode} ${Math.round(ms)}ms`,
      customErrorMessage: (req, res) =>
        `${req.method} ${req.url} ${res.statusCode}`,
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500
          ? 'error'
          : res.statusCode >= 400
            ? 'warn'
            : 'info',
      // pino-http only sees the status code and invents a "failed with status
      // code 500" error with a useless stack. Nest's exception filter already
      // logs the real error, so drop the invented one.
      customErrorObject: (_req, _res, _err, val: Record<string, unknown>) => {
        const { err: _drop, ...rest } = val;
        return rest;
      },
      // Only set in dev: pino crashes on `hooks: undefined` instead of
      // falling back to its defaults.
      ...(dev && {
        hooks: {
          logMethod(args, method) {
            const first: unknown = args[0];
            const context =
              typeof first === 'object' && first !== null
                ? (first as { context?: unknown }).context
                : undefined;
            if (typeof context === 'string' && NEST_BOOT_CONTEXTS.has(context))
              return;
            method.apply(this, args);
          },
        },
      }),
      // JSON logs in production (for Loki/Grafana later), one short line each
      // in dev.
      transport: dev
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'SYS:h:MM:ss TT',
              ignore: 'pid,hostname,context,req,res,responseTime',
            },
          }
        : undefined,
    },
    // Health checks run every few seconds; don't flood the logs.
    exclude: [{ method: RequestMethod.GET, path: 'health' }],
  };
}

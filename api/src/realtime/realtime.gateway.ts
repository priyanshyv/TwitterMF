import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { WebSocket, WebSocketServer } from 'ws';
import { ACCESS_COOKIE } from '../auth/auth.types.js';
import { TokensService } from '../auth/tokens.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { REDIS } from '../redis/redis.module.js';
import { userChannel } from './realtime.publisher.js';

const PATH = '/ws';
const HEARTBEAT_MS = 30_000;

// The browser keeps one WebSocket open to /ws; the server pushes events
// down it (new notification, new posts) instead of the browser polling.
//
// With several API instances behind a load balancer, a user's socket lives
// on just one of them, but events are produced anywhere (usually the worker).
// So every instance keeps one Redis subscriber connection and subscribes to
// `rt:user:<id>` for each user connected to it. A PUBLISH reaches whichever
// instance holds the socket. Subscribing only to connected users (instead of
// everything) means each instance receives only the traffic it can deliver.
@Injectable()
export class RealtimeGateway
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger('Realtime');
  private readonly sockets = new Map<string, Set<WebSocket>>();
  private readonly alive = new WeakSet<WebSocket>();
  private wss?: WebSocketServer;
  private subscriber?: Redis;
  private heartbeat?: NodeJS.Timeout;

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Inject(TokensService) private readonly tokens: TokensService,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap() {
    // Only the HTTP API serves WebSockets; the worker and scripts boot the
    // same modules without an HTTP server.
    const server = this.adapterHost.httpAdapter?.getHttpServer?.();
    if (!server) return;

    // A connection in subscriber mode can't run other commands, so it gets
    // its own.
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('error', () => undefined);
    this.subscriber.on('message', (channel: string, message: string) => {
      const userId = channel.slice('rt:user:'.length);
      for (const ws of this.sockets.get(userId) ?? [])
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
    });

    this.wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });
    server.on(
      'upgrade',
      (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        void this.upgrade(req, socket, head);
      },
    );

    // Connections can die without a goodbye (laptop lid closed, Wi-Fi gone).
    // Ping every 30 s; a socket that didn't answer the last ping is dropped.
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss?.clients ?? []) {
        if (!this.alive.has(ws)) {
          ws.terminate();
          continue;
        }
        this.alive.delete(ws);
        ws.ping();
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== PATH) return reject(socket, 404, 'Not Found');

    // Browsers attach cookies to WebSocket handshakes from any site, so a
    // malicious page could open a socket as you (cross-site WebSocket
    // hijacking). CORS doesn't cover WebSockets: check Origin by hand.
    const origin = req.headers.origin;
    if (origin && !this.env.CORS_ORIGIN.split(',').includes(origin))
      return reject(socket, 403, 'Forbidden');

    const token =
      readCookie(req.headers.cookie, ACCESS_COOKIE) ??
      bearer(req.headers.authorization);
    const user = token ? await this.tokens.verifyAccessToken(token) : null;
    if (!user) return reject(socket, 401, 'Unauthorized');

    this.wss!.handleUpgrade(req, socket, head, (ws) =>
      this.connected(ws, user.id.toString()),
    );
  }

  private connected(ws: WebSocket, userId: string) {
    this.alive.add(ws);
    ws.on('pong', () => this.alive.add(ws));
    ws.on('message', () => undefined); // the protocol is server -> client only

    let set = this.sockets.get(userId);
    if (!set) {
      set = new Set();
      this.sockets.set(userId, set);
      void this.subscriber
        ?.subscribe(userChannel(userId))
        .catch(() => undefined);
    }
    set.add(ws);
    ws.send(JSON.stringify({ type: 'hello' }));

    ws.on('close', () => {
      set.delete(ws);
      if (set.size === 0) {
        this.sockets.delete(userId);
        void this.subscriber
          ?.unsubscribe(userChannel(userId))
          .catch(() => undefined);
      }
    });
  }

  // Runs before the HTTP server closes: open sockets would otherwise keep
  // it waiting.
  async beforeApplicationShutdown() {
    clearInterval(this.heartbeat);
    for (const ws of this.wss?.clients ?? [])
      ws.close(1001, 'Server restarting');
    this.wss?.close();
    await this.subscriber?.quit().catch(() => undefined);
  }

  // For tests and /health-style introspection.
  connectedUsers(): number {
    return this.sockets.size;
  }
}

function reject(socket: Duplex, status: number, text: string) {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\n\r\n`);
}

function readCookie(header: string | undefined, name: string) {
  for (const part of header?.split(';') ?? []) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function bearer(header: string | undefined) {
  return header?.startsWith('Bearer ') ? header.slice(7) : undefined;
}

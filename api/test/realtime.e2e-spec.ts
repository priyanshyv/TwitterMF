import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { WebSocket } from 'ws';
import { createTestApp, resetData, signup } from './helpers.js';

describe('WebSocket gateway', () => {
  let app: NestFastifyApplication;
  let url: string;
  const sockets: WebSocket[] = [];

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0, '127.0.0.1');
    url = `ws://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/ws`;
  });
  beforeEach(async () => {
    await resetData(app);
  });
  afterEach(() => {
    for (const ws of sockets.splice(0)) ws.terminate();
  });
  afterAll(async () => {
    await app.close();
  });

  // Connects like a browser would: cookie + Origin. Resolves with a helper
  // that waits for the next message matching a type.
  function connect(cookie: string, origin = 'http://localhost:3001') {
    const ws = new WebSocket(url, { headers: { cookie, origin } });
    sockets.push(ws);
    const messages: { type: string }[] = [];
    const waiters: (() => void)[] = [];
    ws.on('message', (raw) => {
      messages.push(JSON.parse(String(raw)));
      waiters.splice(0).forEach((w) => w());
    });
    const next = async (type: string, timeoutMs = 5_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const i = messages.findIndex((m) => m.type === type);
        if (i >= 0) return messages.splice(i, 1)[0] as Record<string, unknown>;
        if (Date.now() > deadline) throw new Error(`no "${type}" message`);
        await new Promise<void>((r) => {
          waiters.push(r);
          setTimeout(r, 50);
        });
      }
    };
    return { ws, next };
  }
  const rejected = (ws: WebSocket) =>
    new Promise<number>((resolve) => {
      ws.on('unexpected-response', (_req, res) => resolve(res.statusCode ?? 0));
      ws.on('error', () => undefined);
    });

  it('pushes a new notification to the recipient, live', async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    const live = connect(alice.cookie);
    await live.next('hello');

    await app.inject({
      method: 'POST',
      url: '/users/alice/follow',
      headers: { cookie: bob.cookie },
    });

    expect(await live.next('notification')).toEqual({
      type: 'notification',
      unread: 1,
    });
  });

  it("tells followers' open tabs about new posts", async () => {
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    await app.inject({
      method: 'POST',
      url: '/users/alice/follow',
      headers: { cookie: bob.cookie },
    });
    const live = connect(bob.cookie);
    await live.next('hello');

    const res = await app.inject({
      method: 'POST',
      url: '/tweets',
      payload: { text: 'breaking news' },
      headers: { cookie: alice.cookie },
    });

    expect(await live.next('timeline')).toEqual({
      type: 'timeline',
      tweetId: res.json().id,
      authorId: alice.user.id,
    });
  });

  it('rejects connections without a session, and from other sites', async () => {
    const alice = await signup(app, 'alice');
    expect(await rejected(new WebSocket(url))).toBe(401);
    expect(
      await rejected(
        new WebSocket(url, {
          headers: { cookie: alice.cookie, origin: 'https://evil.example' },
        }),
      ),
    ).toBe(403);
  });
});

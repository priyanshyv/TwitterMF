import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { sql } from 'drizzle-orm';
import { DB, type Database } from '../src/db/db.module.js';
import { cookieValue, createTestApp, resetData, signup } from './helpers.js';

describe('auth', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetData(app);
  });
  afterAll(async () => {
    await app.close();
  });

  const refresh = (refreshToken: string) =>
    app.inject({
      method: 'POST',
      url: '/auth/refresh',
      cookies: { tmf_rt: refreshToken },
    });

  describe('signup', () => {
    it('creates the account, logs in, and hides the password hash', async () => {
      const { res, cookie } = await signup(app, 'alice');

      expect(res.json().user).toMatchObject({
        username: 'alice',
        displayName: 'ALICE',
        id: expect.stringMatching(/^\d+$/),
      });
      expect(res.body).not.toContain('argon2');
      const access = res.cookies.find((c) => c.name === 'tmf_at');
      expect(access).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

      const me = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { cookie },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.username).toBe('alice');
    });

    it('treats usernames as case-insensitive', async () => {
      await signup(app, 'alice');
      const res = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: {
          username: 'ALICE',
          displayName: 'Other',
          password: 'password123',
        },
      });
      expect(res.statusCode).toBe(409);
    });

    it('rejects invalid input with a reason per field', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/signup',
        payload: { username: 'bad name!', displayName: '', password: 'short' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().issues.map((i: { path: string }) => i.path)).toEqual(
        expect.arrayContaining(['username', 'displayName', 'password']),
      );
    });
  });

  describe('login', () => {
    it('logs in with the right password, any username casing', async () => {
      await signup(app, 'alice', 'correct horse battery');
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'Alice', password: 'correct horse battery' },
      });
      expect(res.statusCode).toBe(200);
      expect(cookieValue(res, 'tmf_at')).toBeTruthy();
    });

    it('gives the same answer for a wrong password and an unknown user', async () => {
      await signup(app, 'alice');
      const wrongPassword = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'alice', password: 'nope-nope-nope' },
      });
      const noSuchUser = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { username: 'nobody', password: 'nope-nope-nope' },
      });
      expect(wrongPassword.statusCode).toBe(401);
      expect(noSuchUser.statusCode).toBe(401);
      expect(wrongPassword.json().message).toBe(noSuchUser.json().message);
    });
  });

  describe('access tokens', () => {
    it('rejects requests without a token', async () => {
      const res = await app.inject({ method: 'GET', url: '/auth/me' });
      expect(res.statusCode).toBe(401);
    });

    it('accepts a Bearer header as well as the cookie', async () => {
      const { res } = await signup(app);
      const token = cookieValue(res, 'tmf_at');
      const me = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(200);
    });

    it('rejects a tampered token', async () => {
      const { res } = await signup(app);
      const token = cookieValue(res, 'tmf_at')!;
      const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
      const me = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: { authorization: `Bearer ${tampered}` },
      });
      expect(me.statusCode).toBe(401);
    });
  });

  describe('refresh token rotation', () => {
    it('swaps the refresh token for a new one on every use', async () => {
      const { res } = await signup(app);
      const first = cookieValue(res, 'tmf_rt')!;

      const r1 = await refresh(first);
      const second = cookieValue(r1, 'tmf_rt')!;
      expect(r1.statusCode).toBe(200);
      expect(second).not.toBe(first);

      const r2 = await refresh(second);
      expect(r2.statusCode).toBe(200);
    });

    it('allows an old token once more within the grace window (parallel refreshes)', async () => {
      const { res } = await signup(app);
      const first = cookieValue(res, 'tmf_rt')!;

      await refresh(first);
      const again = await refresh(first);

      expect(again.statusCode).toBe(200);
    });

    it('detects reuse of an old token and ends the whole session', async () => {
      const { res } = await signup(app);
      const stolen = cookieValue(res, 'tmf_rt')!;
      const r1 = await refresh(stolen);
      const current = cookieValue(r1, 'tmf_rt')!;

      // Pretend a minute passed since the rotation (past the grace window).
      await app
        .get<Database>(DB)
        .execute(
          sql`update refresh_tokens set rotated_at = now() - interval '1 minute' where rotated_at is not null`,
        );

      const replay = await refresh(stolen);
      expect(replay.statusCode).toBe(401);
      expect(replay.json().message).toContain('used from somewhere else');

      // The legitimate user's newer token is dead too: the family was revoked.
      const legit = await refresh(current);
      expect(legit.statusCode).toBe(401);
    });

    it('rejects an unknown token and clears the cookies', async () => {
      const res = await refresh('made-up-token');
      expect(res.statusCode).toBe(401);
      expect(cookieValue(res, 'tmf_rt')).toBe('');
    });
  });

  describe('logout', () => {
    it('revokes the session so its refresh token stops working', async () => {
      const { res, cookie } = await signup(app);
      const refreshToken = cookieValue(res, 'tmf_rt')!;

      const out = await app.inject({
        method: 'POST',
        url: '/auth/logout',
        headers: { cookie },
      });
      expect(out.statusCode).toBe(204);
      expect(cookieValue(out, 'tmf_rt')).toBe('');

      expect((await refresh(refreshToken)).statusCode).toBe(401);
    });
  });
});

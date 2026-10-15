import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from './helpers.js';

// Browsers send a "preflight" OPTIONS request before cross-origin DELETEs
// and requests with custom headers; if the answer doesn't allow them, the
// real request never leaves the browser.
describe('CORS for the web app', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('allows DELETE and the Idempotency-Key header from the web origin', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/tweets/1/like',
      headers: {
        origin: 'http://localhost:3001',
        'access-control-request-method': 'DELETE',
        'access-control-request-headers': 'idempotency-key,content-type',
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(
      'http://localhost:3001',
    );
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(String(res.headers['access-control-allow-methods'])).toContain(
      'DELETE',
    );
    expect(String(res.headers['access-control-allow-headers'])).toContain(
      'idempotency-key',
    );
  });

  it('does not allow other origins', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/tweets/1/like',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'DELETE',
      },
    });
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { QueueEvents } from 'bullmq';
import sharp from 'sharp';
import { QUEUE_CONNECTION } from '../src/jobs/jobs.module.js';
import { StorageService } from '../src/storage/storage.service.js';
import { createTestApp, resetData, settle, signup } from './helpers.js';

// Real uploads against the RustFS container (bucket "twittermf-test").
describe('image uploads', () => {
  let app: NestFastifyApplication;
  let alice: Awaited<ReturnType<typeof signup>>;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await resetData(app);
    alice = await signup(app, 'alice');
  });
  afterAll(async () => {
    await app.close();
  });

  const call = (
    method: 'GET' | 'POST',
    url: string,
    payload?: object,
    cookie = alice.cookie,
  ) => app.inject({ method, url, payload, headers: { cookie } });

  const png = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#1d9bf0' } })
      .png()
      .toBuffer();

  // The browser's part: ask for a URL, PUT the bytes straight to storage,
  // say "done".
  async function upload(
    body: Buffer,
    contentType = 'image/png',
    cookie = alice.cookie,
  ) {
    const start = await call(
      'POST',
      '/media/uploads',
      { contentType, bytes: body.length },
      cookie,
    );
    expect(start.statusCode).toBe(201);
    const { id, uploadUrl, headers } = start.json();
    const put = await fetch(uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(body),
      headers,
    });
    expect(put.status).toBe(200);
    const done = await call('POST', `/media/${id}/complete`, undefined, cookie);
    return { id: id as string, done };
  }

  it('uploads, resizes to WebP, and deletes the original', async () => {
    const { id, done } = await upload(await png(3000, 1500));
    expect(done.json().status).toBe('processing');
    await settle(app);

    const media = (await call('GET', `/media/${id}`)).json();
    expect(media).toMatchObject({ status: 'ready', width: 1600, height: 800 });
    const image = await fetch(media.url); // public, no credentials
    expect(image.status).toBe(200);
    expect(image.headers.get('content-type')).toBe('image/webp');
    expect(
      (await sharp(Buffer.from(await image.arrayBuffer())).metadata()).width,
    ).toBe(1600);
    expect(
      (
        await sharp(
          Buffer.from(await (await fetch(media.thumbUrl)).arrayBuffer()),
        ).metadata()
      ).width,
    ).toBe(600);

    expect(await app.get(StorageService).head(`uploads/${id}`)).toBeNull();
  });

  it('never upscales small images', async () => {
    const { id } = await upload(await png(400, 300));
    await settle(app);
    expect((await call('GET', `/media/${id}`)).json()).toMatchObject({
      width: 400,
      height: 300,
    });
  });

  it('strips EXIF metadata (GPS, camera info) from photos', async () => {
    const jpeg = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#ff0' },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret location' } })
      .toBuffer();
    expect((await sharp(jpeg).metadata()).exif).toBeDefined();

    const { id } = await upload(jpeg, 'image/jpeg');
    await settle(app);
    const { url } = (await call('GET', `/media/${id}`)).json();
    const served = Buffer.from(await (await fetch(url)).arrayBuffer());
    expect((await sharp(served).metadata()).exif).toBeUndefined();
  });

  it('attaches images to a tweet (text optional) and shows them in feeds', async () => {
    const a = await upload(await png(1200, 1200));
    const b = await upload(await png(1200, 600));
    const res = await call('POST', '/tweets', { mediaIds: [a.id, b.id] });
    expect(res.statusCode).toBe(201);
    expect(res.json().media.map((m: { id: string }) => m.id)).toEqual([
      a.id,
      b.id,
    ]);

    await settle(app);
    const [item] = (await call('GET', '/timeline')).json().items;
    expect(item.tweet.text).toBe('');
    expect(item.tweet.media).toMatchObject([
      { id: a.id, status: 'ready', width: 1200, height: 1200 },
      { id: b.id, status: 'ready', width: 1200, height: 600 },
    ]);
  });

  it("won't attach an image twice, or someone else's", async () => {
    const { id } = await upload(await png(100, 100));
    expect((await call('POST', '/tweets', { mediaIds: [id] })).statusCode).toBe(
      201,
    );
    expect(
      (await call('POST', '/tweets', { text: 'again', mediaIds: [id] }))
        .statusCode,
    ).toBe(400);

    const bob = await signup(app, 'bob');
    const mine = await upload(await png(100, 100));
    const stolen = await call(
      'POST',
      '/tweets',
      { text: 'mine now', mediaIds: [mine.id] },
      bob.cookie,
    );
    expect(stolen.statusCode).toBe(400);
  });

  it('rejects files that are too big or not images, before any upload', async () => {
    const big = await call('POST', '/media/uploads', {
      contentType: 'image/png',
      bytes: 6 * 1024 * 1024,
    });
    const pdf = await call('POST', '/media/uploads', {
      contentType: 'application/pdf',
      bytes: 1000,
    });
    expect(big.statusCode).toBe(400);
    expect(pdf.statusCode).toBe(400);
  });

  it('only accepts the exact upload it signed for', async () => {
    const start = (
      await call('POST', '/media/uploads', {
        contentType: 'image/png',
        bytes: 100,
      })
    ).json();
    // 200 bytes instead of the promised 100: the signature doesn't match.
    const tooBig = await fetch(start.uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(200),
      headers: start.headers,
    });
    expect(tooBig.status).toBe(403);
    expect((await call('POST', `/media/${start.id}/complete`)).statusCode).toBe(
      400,
    );
  });

  it('marks a corrupt "image" as failed without retrying it', async () => {
    const events = new QueueEvents('media', {
      connection: app.get(QUEUE_CONNECTION).duplicate(),
    });
    let failures = 0;
    events.on('failed', () => failures++);
    await events.waitUntilReady();

    const { id } = await upload(
      Buffer.from('this is not a png at all'),
      'image/png',
    );
    await settle(app);
    await new Promise((r) => setTimeout(r, 100));

    expect((await call('GET', `/media/${id}`)).json().status).toBe('failed');
    expect(failures).toBe(1); // one attempt, not five
    await events.close();
  });
});

describe('profile tabs', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('splits a profile into posts, replies, media and likes', async () => {
    await resetData(app);
    const alice = await signup(app, 'alice');
    const bob = await signup(app, 'bob');
    const as = (
      cookie: string,
      method: 'GET' | 'POST',
      url: string,
      payload?: object,
    ) => app.inject({ method, url, payload, headers: { cookie } });

    const bobs = (
      await as(bob.cookie, 'POST', '/tweets', { text: 'bob original' })
    ).json();
    await as(alice.cookie, 'POST', '/tweets', { text: 'plain post' });
    await as(alice.cookie, 'POST', '/tweets', {
      text: 'a reply',
      replyToId: bobs.id,
    });
    await as(alice.cookie, 'POST', `/tweets/${bobs.id}/retweet`);
    await as(alice.cookie, 'POST', `/tweets/${bobs.id}/like`);
    const image = await sharp({
      create: { width: 50, height: 50, channels: 3, background: '#000' },
    })
      .png()
      .toBuffer();
    const up = (
      await as(alice.cookie, 'POST', '/media/uploads', {
        contentType: 'image/png',
        bytes: image.length,
      })
    ).json();
    await fetch(up.uploadUrl, {
      method: 'PUT',
      body: new Uint8Array(image),
      headers: up.headers,
    });
    await as(alice.cookie, 'POST', `/media/${up.id}/complete`);
    await as(alice.cookie, 'POST', '/tweets', {
      text: 'with a photo',
      mediaIds: [up.id],
    });
    await settle(app);

    const tab = async (name: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/users/alice/tweets?tab=${name}`,
        })
      )
        .json()
        .items.map((i: { tweet: { text: string } }) => i.tweet.text);
    expect(await tab('posts')).toEqual([
      'with a photo',
      'bob original',
      'plain post',
    ]); // retweet included
    expect(await tab('replies')).toEqual(['a reply']);
    expect(await tab('media')).toEqual(['with a photo']);
    expect(await tab('likes')).toEqual(['bob original']);
    expect(
      (await app.inject({ method: 'GET', url: '/users/alice/tweets?tab=nope' }))
        .statusCode,
    ).toBe(400);
  });
});

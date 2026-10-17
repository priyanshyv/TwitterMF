import { Inject, Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { CACHE } from '../cache/cache.module.js';
import type { RedisCache } from '../cache/redis-cache.js';
import { DB, type Database } from '../db/db.module.js';
import { media } from '../db/schema/index.js';
import type { MediaJob } from '../jobs/queues.js';
import { StorageService } from '../storage/storage.service.js';
import { largeKey, smallKey, uploadKey } from './media.service.js';

const SIZES = [
  { key: largeKey, max: 1600 },
  { key: smallKey, max: 600 },
];

// Runs in the worker: turns a raw upload into the images we actually serve.
//   - auto-rotates using the camera's EXIF orientation, then strips ALL
//     metadata. Phone photos carry EXIF, often including GPS coordinates of
//     where they were taken; publishing them would leak users' locations.
//   - resizes to two sizes (never upscales) and re-encodes as WebP, so a
//     6 MB phone photo becomes a ~200 KB image that loads fast everywhere.
//   - re-encoding also means we never serve the uploader's original bytes,
//     which could be a crafted file instead of a real image.
@Injectable()
export class MediaProcessor {
  private readonly logger = new Logger('Media');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(CACHE) private readonly cache: RedisCache,
  ) {}

  async process(job: MediaJob): Promise<{ status: string }> {
    const id = BigInt(job.mediaId);
    const [row] = await this.db.select().from(media).where(eq(media.id, id));
    // Already done (a repeated job) or gone: nothing to do.
    if (!row || row.status !== 'processing')
      return { status: row?.status ?? 'missing' };

    const original = await this.storage.get(uploadKey(job.mediaId)); // network errors: retry

    let outputs: { key: string; data: Buffer; width: number; height: number }[];
    try {
      outputs = await Promise.all(
        SIZES.map(async ({ key, max }) => {
          const { data, info } = await sharp(original, {
            animated: false, // first frame of a GIF
            limitInputPixels: 50_000_000, // refuse "decompression bombs"
          })
            .rotate()
            .resize(max, max, { fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 82 })
            .toBuffer({ resolveWithObject: true });
          return {
            key: key(job.mediaId),
            data,
            width: info.width,
            height: info.height,
          };
        }),
      );
    } catch (err) {
      // Not an image sharp can read: retrying won't change that. Mark it
      // failed and tell BullMQ not to retry (UnrecoverableError).
      await this.db
        .update(media)
        .set({ status: 'failed' })
        .where(eq(media.id, id));
      this.logger.warn(`media ${id} is not a usable image: ${String(err)}`);
      throw new UnrecoverableError('not a usable image');
    }

    for (const out of outputs)
      await this.storage.put(out.key, out.data, 'image/webp');
    const [large] = outputs;
    // RETURNING the tweet ID as it is NOW: the image may have been attached
    // to a tweet while we were resizing it (the row read above is stale).
    const [done] = await this.db
      .update(media)
      .set({ status: 'ready', width: large.width, height: large.height })
      .where(eq(media.id, id))
      .returning({ tweetId: media.tweetId });
    await this.storage.delete(uploadKey(job.mediaId)); // the original, EXIF and all

    // A tweet cached while this image was "processing" must reload it. Once
    // now, and once more shortly after, in case a reader cached the old
    // state in between (the same delayed double delete as counters).
    if (done?.tweetId) {
      const keys = [`cache:tweet:${done.tweetId}`];
      await this.cache.invalidate(keys);
      setTimeout(() => void this.cache.invalidate(keys), 2_000).unref();
    }
    return { status: 'ready' };
  }
}

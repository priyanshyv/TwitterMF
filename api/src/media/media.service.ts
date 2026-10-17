import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { isBreakerOpen } from '../breakers/breakers.service.js';
import { SNOWFLAKE } from '../common/id.module.js';
import type { Snowflake } from '../common/snowflake.js';
import { DB, type Database } from '../db/db.module.js';
import { media } from '../db/schema/index.js';
import { OutboxService } from '../jobs/jobs.module.js';
import { message } from '../jobs/queues.js';
import { StorageService } from '../storage/storage.service.js';

export const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_PER_TWEET = 4;

export const uploadKey = (id: string) => `uploads/${id}`;
export const largeKey = (id: string) => `media/${id}/large.webp`;
export const smallKey = (id: string) => `media/${id}/small.webp`;

type MediaRow = typeof media.$inferSelect;

// What clients get. URLs only once the image is ready.
export interface MediaView {
  id: string;
  status: MediaRow['status'];
  width: number | null;
  height: number | null;
  url: string | null; // up to 1600 px
  thumbUrl: string | null; // up to 600 px
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SNOWFLAKE) private readonly ids: Snowflake,
    @Inject(StorageService) private readonly storage: StorageService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  // Step 1: the browser says what it will upload; we answer with a URL that
  // allows exactly that upload (this key, this type, this size, 5 minutes).
  async createUpload(ownerId: bigint, contentType: string, bytes: number) {
    const id = this.ids.next();
    await this.db.insert(media).values({ id, ownerId, contentType, bytes });
    const uploadUrl = await this.storage.presignUpload(
      uploadKey(`${id}`),
      contentType,
      bytes,
    );
    return {
      id: `${id}`,
      uploadUrl,
      // The browser must send these exact headers: they're part of the signature.
      headers: { 'content-type': contentType },
    };
  }

  // Step 3 (step 2 was the browser uploading to storage): check the file
  // really arrived as promised, then hand it to the worker. Safe to call
  // twice: a second call just returns the current state.
  async complete(ownerId: bigint, id: bigint): Promise<MediaView> {
    const row = await this.ownRow(ownerId, id);
    if (row.status !== 'uploading') return this.toView(row);

    let stored: Awaited<ReturnType<StorageService['head']>>;
    try {
      stored = await this.storage.head(uploadKey(`${id}`));
    } catch (err) {
      // Storage is down (or its circuit breaker is open): fail fast and say
      // so, instead of making the user wait for a timeout.
      throw new ServiceUnavailableException(
        isBreakerOpen(err)
          ? 'Uploads are paused for a moment, please try again shortly'
          : 'Could not reach storage, please try again',
      );
    }
    if (!stored) throw new BadRequestException('Upload the file first');
    if (stored.bytes !== row.bytes || stored.contentType !== row.contentType)
      throw new BadRequestException(
        'The uploaded file is not what was announced',
      );

    const [updated] = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(media)
        .set({ status: 'processing' })
        .where(eq(media.id, id))
        .returning();
      await this.outbox.add(tx, [message.media(id)]);
      return rows;
    });
    return this.toView(updated);
  }

  async get(ownerId: bigint, id: bigint): Promise<MediaView> {
    return this.toView(await this.ownRow(ownerId, id));
  }

  // Attaches uploaded images to a new tweet, inside the tweet's transaction:
  // if any of them isn't usable, the whole tweet is rolled back.
  async attach(
    tx: Pick<Database, 'update'>,
    ownerId: bigint,
    tweetId: bigint,
    mediaIds: bigint[],
  ): Promise<void> {
    for (const [position, id] of mediaIds.entries()) {
      const rows = await tx
        .update(media)
        .set({ tweetId, position })
        .where(
          and(
            eq(media.id, id),
            eq(media.ownerId, ownerId),
            isNull(media.tweetId), // not already used in another tweet
            inArray(media.status, ['processing', 'ready']),
          ),
        )
        .returning({ id: media.id });
      if (rows.length === 0)
        throw new BadRequestException(
          `Image ${id} can't be attached (not yours, already used, or not uploaded)`,
        );
    }
  }

  // Images per tweet, for hydrating feeds.
  async forTweets(tweetIds: bigint[]): Promise<Map<string, MediaView[]>> {
    const out = new Map<string, MediaView[]>();
    if (tweetIds.length === 0) return out;
    const rows = await this.db
      .select()
      .from(media)
      .where(inArray(media.tweetId, tweetIds))
      .orderBy(asc(media.tweetId), asc(media.position));
    for (const row of rows) {
      const key = `${row.tweetId}`;
      out.set(key, [...(out.get(key) ?? []), this.toView(row)]);
    }
    return out;
  }

  toView(row: MediaRow): MediaView {
    const id = `${row.id}`;
    const ready = row.status === 'ready';
    return {
      id,
      status: row.status,
      width: row.width,
      height: row.height,
      url: ready ? this.storage.publicUrl(largeKey(id)) : null,
      thumbUrl: ready ? this.storage.publicUrl(smallKey(id)) : null,
    };
  }

  private async ownRow(ownerId: bigint, id: bigint): Promise<MediaRow> {
    const [row] = await this.db
      .select()
      .from(media)
      .where(and(eq(media.id, id), eq(media.ownerId, ownerId)));
    if (!row) throw new NotFoundException('No such upload');
    return row;
  }
}

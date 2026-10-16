import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { SNOWFLAKE } from '../common/id.module.js';
import { toPage, type Page, type PageQuery } from '../common/pagination.js';
import type { Snowflake } from '../common/snowflake.js';
import { DB, type Database } from '../db/db.module.js';
import { notifications, tweets } from '../db/schema/index.js';
import type { NotificationJob } from '../jobs/queues.js';
import { RealtimePublisher } from '../realtime/realtime.publisher.js';
import { TweetsService } from '../tweets/tweets.service.js';
import {
  toUserRef,
  UserRecordsService,
  type UserRef,
} from '../users/user-records.service.js';

type NotificationKind = 'follow' | 'like' | 'retweet' | 'reply' | 'mention';

export interface NotificationView {
  id: string;
  type: NotificationKind;
  createdAt: string;
  read: boolean;
  actor: UserRef;
  // The tweet it's about, with enough to show a preview and link to it.
  tweet: { id: string; text: string; author: UserRef } | null;
}

const MENTION = /(?:^|[^A-Za-z0-9_])@([A-Za-z0-9_]{1,15})/g;
const MAX_MENTIONS = 10;

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(SNOWFLAKE) private readonly ids: Snowflake,
    @Inject(UserRecordsService) private readonly users: UserRecordsService,
    @Inject(TweetsService) private readonly tweets: TweetsService,
    @Inject(RealtimePublisher) private readonly realtime: RealtimePublisher,
  ) {}

  // ---- Write side: runs in the worker -----------------------------------

  // Turns one event into notification rows. Safe to run twice for the same
  // job: the unique index swallows the repeat (ON CONFLICT DO NOTHING).
  async handle(job: NotificationJob): Promise<void> {
    const actorId = BigInt(job.actorId);
    const rows: { userId: bigint; type: NotificationKind; tweetId?: bigint }[] =
      [];

    if (job.kind === 'follow') {
      rows.push({ userId: BigInt(job.followeeId), type: 'follow' });
    } else if (job.kind === 'like' || job.kind === 'retweet') {
      const [tweet] = await this.tweetRows([job.tweetId]);
      if (tweet)
        rows.push({
          userId: tweet.authorId,
          type: job.kind,
          tweetId: tweet.id,
        });
    } else {
      const [tweet] = await this.tweetRows([job.tweetId]);
      if (!tweet) return; // deleted before the job ran: nothing to say
      if (tweet.replyToId) {
        const [parent] = await this.tweetRows([tweet.replyToId.toString()]);
        if (parent)
          rows.push({
            userId: parent.authorId,
            type: 'reply',
            tweetId: tweet.id,
          });
      }
      for (const userId of await this.mentionedUsers(tweet.text))
        rows.push({ userId, type: 'mention', tweetId: tweet.id });
    }

    // Never notify people about their own actions; a reply to someone who is
    // also mentioned only needs one notification.
    const recipients = new Set<bigint>();
    const values = [];
    for (const r of rows) {
      if (r.userId === actorId) continue;
      if (r.type === 'mention' && recipients.has(r.userId)) continue;
      recipients.add(r.userId);
      values.push({ id: this.ids.next(), actorId, ...r });
    }
    if (values.length === 0) return;

    const inserted = await this.db
      .insert(notifications)
      .values(values)
      .onConflictDoNothing()
      .returning({ userId: notifications.userId });

    // Tell each recipient's open tabs their new unread count.
    for (const userId of new Set(inserted.map((r) => r.userId)))
      await this.realtime.publish([userId.toString()], {
        type: 'notification',
        unread: await this.unreadCount(userId),
      });
  }

  // ---- Read side: the API -----------------------------------------------

  async list(userId: bigint, page: PageQuery): Promise<Page<NotificationView>> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          page.before === undefined
            ? undefined
            : sql`${notifications.id} < ${page.before}`,
        ),
      )
      .orderBy(sql`${notifications.id} desc`)
      .limit(page.limit + 1);
    const { items, nextCursor } = toPage(
      rows.map((r) => ({ ...r, id: r.id.toString() })),
      page.limit,
    );

    // Hydrate from the caches, like a timeline.
    const tweetIds = items.flatMap((n) =>
      n.tweetId ? [n.tweetId.toString()] : [],
    );
    const records = await this.tweets.records(tweetIds);
    const people = await this.users.getMany([
      ...new Set([
        ...items.map((n) => n.actorId.toString()),
        ...[...records.values()].map((t) => t.authorId),
      ]),
    ]);

    const views: NotificationView[] = [];
    for (const n of items) {
      const actor = people.get(n.actorId.toString());
      if (!actor) continue;
      const tweet = n.tweetId ? records.get(n.tweetId.toString()) : undefined;
      const tweetAuthor = tweet && people.get(tweet.authorId);
      views.push({
        id: n.id,
        type: n.type,
        createdAt: n.createdAt.toISOString(),
        read: n.readAt !== null,
        actor: toUserRef(actor),
        tweet:
          tweet && tweetAuthor
            ? { id: tweet.id, text: tweet.text, author: toUserRef(tweetAuthor) }
            : null,
      });
    }
    return { items: views, nextCursor };
  }

  // Served by the partial index on unread rows, so it stays cheap even for
  // someone with 100,000 old notifications.
  async unreadCount(userId: bigint): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    return row.n;
  }

  async markAllRead(userId: bigint): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(eq(notifications.userId, userId), isNull(notifications.readAt)),
      );
    // Clears the badge in the user's other tabs too.
    await this.realtime.publish([userId.toString()], {
      type: 'notification',
      unread: 0,
    });
  }

  private tweetRows(ids: string[]) {
    return this.db
      .select({
        id: tweets.id,
        authorId: tweets.authorId,
        text: tweets.text,
        replyToId: tweets.replyToId,
      })
      .from(tweets)
      .where(inArray(tweets.id, ids.map(BigInt)));
  }

  private async mentionedUsers(text: string): Promise<bigint[]> {
    const names = [
      ...new Set([...text.matchAll(MENTION)].map((m) => m[1].toLowerCase())),
    ].slice(0, MAX_MENTIONS);
    const ids = await Promise.all(
      names.map((n) => this.users.idForUsername(n)),
    );
    return ids.filter((id): id is string => id !== null).map(BigInt);
  }
}

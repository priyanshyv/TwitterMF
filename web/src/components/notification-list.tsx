'use client';

import {
  AtSign,
  Heart,
  MessageCircle,
  Repeat2,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import type { NotificationItem, NotificationType, Page } from '@/lib/api/types';
import { relativeTime } from '@/lib/format';
import { tweetHref } from '@/lib/links';
import { cn } from '@/lib/utils';
import { UserAvatar } from './user-avatar';

const KIND: Record<
  NotificationType,
  { icon: LucideIcon; color: string; verb: string }
> = {
  like: {
    icon: Heart,
    color: 'text-rose-600 dark:text-rose-400',
    verb: 'liked your post',
  },
  retweet: {
    icon: Repeat2,
    color: 'text-emerald-600 dark:text-emerald-400',
    verb: 'retweeted your post',
  },
  follow: { icon: UserPlus, color: 'text-sky-600', verb: 'followed you' },
  reply: {
    icon: MessageCircle,
    color: 'text-sky-600',
    verb: 'replied to your post',
  },
  mention: { icon: AtSign, color: 'text-sky-600', verb: 'mentioned you' },
};

export function NotificationList({
  initialPage,
}: {
  initialPage: Page<NotificationItem>;
}) {
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);

  // Opening the page counts as reading them all. Unread ones stay
  // highlighted until you leave, so you can still see which were new.
  useEffect(() => {
    if (initialPage.items.some((n) => !n.read))
      void api('/notifications/read', { method: 'POST' }).catch(
        () => undefined,
      );
  }, [initialPage]);

  async function loadMore() {
    setLoading(true);
    try {
      const page = await api<Page<NotificationItem>>(
        `/notifications?before=${cursor}`,
      );
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load more');
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0)
    return (
      <p className="px-4 py-12 text-center text-muted-foreground">
        Nothing yet. Likes, follows, replies and mentions show up here.
      </p>
    );

  return (
    <div>
      <ul className="divide-y">
        {items.map((n) => {
          const { icon: Icon, color, verb } = KIND[n.type];
          const href = n.tweet ? tweetHref(n.tweet) : `/${n.actor.username}`;
          return (
            <li key={n.id} className={cn(!n.read && 'bg-sky-500/[0.06]')}>
              <Link
                href={href}
                className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
              >
                <Icon
                  className={cn(
                    'mt-1 size-5 shrink-0',
                    color,
                    n.type === 'like' && 'fill-current',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <UserAvatar
                    name={n.actor.displayName}
                    seed={n.actor.username}
                    className="size-8 text-xs"
                  />
                  <p className="mt-2 text-[15px]">
                    <span className="font-bold">{n.actor.displayName}</span>{' '}
                    {verb}
                    <span
                      className="text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {' · '}
                      {relativeTime(n.createdAt)}
                    </span>
                  </p>
                  {n.tweet && (
                    <p className="mt-1 line-clamp-2 text-[15px] text-muted-foreground">
                      {n.tweet.text}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {cursor && (
        <div className="border-t p-3 text-center">
          <Button variant="ghost" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

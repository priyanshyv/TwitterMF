import { Repeat2 } from 'lucide-react';
import Link from 'next/link';
import type { FeedItem, Tweet } from '@/lib/api/types';
import { relativeTime } from '@/lib/format';
import { tweetHref } from '@/lib/links';
import { cn } from '@/lib/utils';
import { TweetActions } from './tweet-actions';
import { UserAvatar } from './user-avatar';

export function FeedItemCard({ item }: { item: FeedItem }) {
  return (
    <TweetCard
      tweet={item.tweet}
      header={
        item.retweetedBy && (
          <Link
            href={`/${item.retweetedBy.username}`}
            className="mb-1 ml-7 flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:underline"
          >
            <Repeat2 className="size-3.5" />
            {item.retweetedBy.displayName} retweeted
          </Link>
        )
      }
    />
  );
}

export function TweetCard({
  tweet,
  header,
  large,
  connector,
}: {
  tweet: Tweet;
  header?: React.ReactNode;
  // The focused tweet on a thread page.
  large?: boolean;
  // Draws the line down to the next tweet in a thread.
  connector?: boolean;
}) {
  const profile = `/${tweet.author.username}`;
  return (
    <article className="px-4 py-3">
      {header}
      <div className="flex gap-3">
        <div className="flex shrink-0 flex-col items-center">
          <Link href={profile} aria-label={tweet.author.displayName}>
            <UserAvatar name={tweet.author.displayName} />
          </Link>
          {connector && (
            <div className="mt-1 w-0.5 flex-1 bg-border" aria-hidden />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <header className="flex items-baseline gap-1.5 text-sm">
            <Link
              href={profile}
              className="truncate font-semibold hover:underline"
            >
              {tweet.author.displayName}
            </Link>
            <span className="truncate text-muted-foreground">
              @{tweet.author.username}
            </span>
            <span className="text-muted-foreground" aria-hidden>
              ·
            </span>
            {/* Server and browser compute "5m" a moment apart, so the text
                may differ by a second; that's expected, not a bug. */}
            <Link
              href={tweetHref(tweet)}
              className="shrink-0 text-muted-foreground hover:underline"
            >
              <time
                dateTime={tweet.createdAt}
                title={new Date(tweet.createdAt).toLocaleString('en')}
                suppressHydrationWarning
              >
                {relativeTime(tweet.createdAt)}
              </time>
            </Link>
          </header>
          {tweet.replyTo && (
            <p className="text-sm text-muted-foreground">
              Replying to{' '}
              <Link
                href={`/${tweet.replyTo.author.username}`}
                className="text-sky-600 hover:underline"
              >
                @{tweet.replyTo.author.username}
              </Link>
            </p>
          )}
          <Link href={tweetHref(tweet)} className="block">
            <p
              className={cn(
                'mt-0.5 break-words whitespace-pre-wrap',
                large && 'text-xl leading-snug',
              )}
            >
              {tweet.text}
            </p>
          </Link>
          <TweetActions tweet={tweet} />
        </div>
      </div>
    </article>
  );
}

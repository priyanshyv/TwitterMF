import { Repeat2 } from 'lucide-react';
import Link from 'next/link';
import type { FeedItem, Tweet } from '@/lib/api/types';
import { relativeTime } from '@/lib/format';
import { tweetHref } from '@/lib/links';
import { cn } from '@/lib/utils';
import { TweetActions } from './tweet-actions';
import { TweetText } from './tweet-text';
import { UserAvatar } from './user-avatar';

export function FeedItemCard({ item }: { item: FeedItem }) {
  return (
    <TweetCard
      tweet={item.tweet}
      header={
        item.retweetedBy && (
          <Link
            href={`/${item.retweetedBy.username}`}
            className="mb-1 flex items-center gap-3 text-[13px] font-bold text-muted-foreground hover:underline"
          >
            <span className="flex w-10 justify-end">
              <Repeat2 className="size-4" />
            </span>
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
  const avatar = (
    <Link
      href={profile}
      aria-label={tweet.author.displayName}
      className="shrink-0"
    >
      <UserAvatar
        name={tweet.author.displayName}
        seed={tweet.author.username}
      />
    </Link>
  );
  const names = (
    <>
      <Link href={profile} className="truncate font-bold hover:underline">
        {tweet.author.displayName}
      </Link>
      <span className="truncate text-muted-foreground">
        @{tweet.author.username}
      </span>
    </>
  );
  const replyingTo = tweet.replyTo && (
    <p className="text-[15px] text-muted-foreground">
      Replying to{' '}
      <Link
        href={`/${tweet.replyTo.author.username}`}
        className="text-sky-500 hover:underline"
      >
        @{tweet.replyTo.author.username}
      </Link>
    </p>
  );

  // The focused tweet: author on top, big text, the full date, actions in
  // their own row.
  if (large) {
    return (
      <article className="px-4 pt-3">
        <div className="flex items-center gap-3">
          {avatar}
          <div className="flex min-w-0 flex-col leading-tight">{names}</div>
        </div>
        <div className="mt-3">
          {replyingTo}
          <TweetText text={tweet.text} href={tweetHref(tweet)} large />
        </div>
        <p
          className="mt-4 text-[15px] text-muted-foreground"
          suppressHydrationWarning
        >
          {new Date(tweet.createdAt).toLocaleString('en', {
            hour: 'numeric',
            minute: '2-digit',
          })}{' '}
          ·{' '}
          {new Date(tweet.createdAt).toLocaleDateString('en', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })}
        </p>
        <div className="mt-3 border-t py-1">
          <TweetActions tweet={tweet} />
        </div>
      </article>
    );
  }

  return (
    <article
      className={cn(
        'px-4 pt-3 transition-colors hover:bg-muted/40',
        !connector && 'pb-1',
      )}
    >
      {header}
      <div className="flex gap-3">
        <div className="flex flex-col items-center">
          {avatar}
          {connector && (
            <div className="mt-1 w-0.5 flex-1 bg-border" aria-hidden />
          )}
        </div>
        <div className={cn('min-w-0 flex-1', connector && 'pb-3')}>
          <header className="flex items-baseline gap-1 text-[15px]">
            {names}
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
          {replyingTo}
          <TweetText text={tweet.text} href={tweetHref(tweet)} />
          <TweetActions tweet={tweet} />
        </div>
      </div>
    </article>
  );
}

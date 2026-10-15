import Link from 'next/link';
import type { Tweet } from '@/lib/api/types';
import { relativeTime } from '@/lib/format';
import { UserAvatar } from './user-avatar';

export function TweetCard({ tweet }: { tweet: Tweet }) {
  const profile = `/${tweet.author.username}`;
  return (
    <article className="flex gap-3 px-4 py-3">
      <Link
        href={profile}
        className="shrink-0"
        aria-label={tweet.author.displayName}
      >
        <UserAvatar name={tweet.author.displayName} />
      </Link>
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
          <time
            dateTime={tweet.createdAt}
            title={new Date(tweet.createdAt).toLocaleString('en')}
            className="shrink-0 text-muted-foreground"
            suppressHydrationWarning
          >
            {relativeTime(tweet.createdAt)}
          </time>
        </header>
        <p className="mt-0.5 break-words whitespace-pre-wrap">{tweet.text}</p>
      </div>
    </article>
  );
}

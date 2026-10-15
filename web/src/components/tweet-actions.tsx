'use client';

import { Heart, MessageCircle, Repeat2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '@/lib/api/client';
import type { Tweet } from '@/lib/api/types';
import { tweetHref } from '@/lib/links';
import { cn } from '@/lib/utils';

type Toggle = { on: boolean; count: number };

// Like and retweet flip instantly (optimistic UI), then settle on the
// counts the server returns, or roll back if it refuses (e.g. rate limited).
export function TweetActions({ tweet }: { tweet: Tweet }) {
  const router = useRouter();
  const loggedIn = tweet.viewer !== null;
  const [like, setLike] = useState<Toggle>({
    on: !!tweet.viewer?.liked,
    count: tweet.counts.likes,
  });
  const [retweet, setRetweet] = useState<Toggle>({
    on: !!tweet.viewer?.retweeted,
    count: tweet.counts.retweets,
  });

  async function toggle(
    kind: 'like' | 'retweet',
    state: Toggle,
    set: (t: Toggle) => void,
  ) {
    if (!loggedIn) return router.push('/login');
    const next = !state.on;
    set({ on: next, count: state.count + (next ? 1 : -1) });
    try {
      const fresh = await api<Tweet>(`/tweets/${tweet.id}/${kind}`, {
        method: next ? 'POST' : 'DELETE',
      });
      setLike({ on: !!fresh.viewer?.liked, count: fresh.counts.likes });
      setRetweet({
        on: !!fresh.viewer?.retweeted,
        count: fresh.counts.retweets,
      });
    } catch (err) {
      set(state);
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    }
  }

  return (
    <div className="mt-1 -ml-2 flex max-w-sm items-center justify-between text-muted-foreground">
      <Link
        href={tweetHref(tweet)}
        aria-label={`Reply (${tweet.counts.replies} replies)`}
        className="group flex items-center gap-1 rounded-full p-2 text-sm hover:text-sky-600"
      >
        <MessageCircle className="size-4" />
        <Count n={tweet.counts.replies} />
      </Link>
      <ActionButton
        label={retweet.on ? 'Undo retweet' : 'Retweet'}
        active={retweet.on}
        activeClass="text-emerald-600 dark:text-emerald-400"
        onClick={() => toggle('retweet', retweet, setRetweet)}
      >
        <Repeat2 className="size-4" />
        <Count n={retweet.count} />
      </ActionButton>
      <ActionButton
        label={like.on ? 'Unlike' : 'Like'}
        active={like.on}
        activeClass="text-rose-600 dark:text-rose-400"
        onClick={() => toggle('like', like, setLike)}
      >
        <Heart className={cn('size-4', like.on && 'fill-current')} />
        <Count n={like.count} />
      </ActionButton>
      <span className="w-12" aria-hidden />
    </div>
  );
}

function ActionButton(props: {
  label: string;
  active: boolean;
  activeClass: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      aria-pressed={props.active}
      onClick={props.onClick}
      className={cn(
        'flex items-center gap-1 rounded-full p-2 text-sm transition-colors hover:text-foreground',
        props.active && props.activeClass,
      )}
    >
      {props.children}
    </button>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="min-w-4 tabular-nums">
      {n > 0 ? n.toLocaleString('en') : ''}
    </span>
  );
}

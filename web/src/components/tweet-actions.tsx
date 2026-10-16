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

  // Which action the user just turned on: only that one bounces (not every
  // already-liked tweet when the page loads).
  const [popped, setPopped] = useState<'like' | 'retweet' | null>(null);

  async function toggle(
    kind: 'like' | 'retweet',
    state: Toggle,
    set: (t: Toggle) => void,
  ) {
    if (!loggedIn) return router.push('/login');
    const next = !state.on;
    setPopped(next ? kind : null);
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
    <div className="-ml-2 flex max-w-md items-center justify-between">
      <Link
        href={tweetHref(tweet)}
        aria-label={`Reply (${tweet.counts.replies} replies)`}
        className={cn(ACTION, TONE.sky)}
      >
        <Icon tone="sky">
          <MessageCircle />
        </Icon>
        <Count n={tweet.counts.replies} />
      </Link>
      <ActionButton
        label={retweet.on ? 'Undo retweet' : 'Retweet'}
        active={retweet.on}
        tone="emerald"
        onClick={() => toggle('retweet', retweet, setRetweet)}
      >
        <Icon tone="emerald" pop={popped === 'retweet' && retweet.on}>
          <Repeat2 />
        </Icon>
        <Count n={retweet.count} />
      </ActionButton>
      <ActionButton
        label={like.on ? 'Unlike' : 'Like'}
        active={like.on}
        tone="rose"
        onClick={() => toggle('like', like, setLike)}
      >
        <Icon tone="rose" pop={popped === 'like' && like.on}>
          <Heart className={cn(like.on && 'fill-current')} />
        </Icon>
        <Count n={like.count} />
      </ActionButton>
      <span className="w-16" aria-hidden />
    </div>
  );
}

const ACTION =
  'group flex items-center gap-0.5 text-[13px] text-muted-foreground transition-colors';
// Written out in full so Tailwind sees every class.
const TONE = {
  sky: 'hover:text-sky-500',
  emerald: 'hover:text-emerald-500',
  rose: 'hover:text-rose-500',
};
const CIRCLE = {
  sky: 'group-hover:bg-sky-500/10',
  emerald: 'group-hover:bg-emerald-500/10',
  rose: 'group-hover:bg-rose-500/10',
};
const ACTIVE = {
  sky: 'text-sky-500',
  emerald: 'text-emerald-500',
  rose: 'text-rose-500',
};

function ActionButton(props: {
  label: string;
  active: boolean;
  tone: keyof typeof TONE;
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
        ACTION,
        TONE[props.tone],
        props.active && ACTIVE[props.tone],
      )}
    >
      {props.children}
    </button>
  );
}

// The round hover target around each icon. `pop` replays a small bounce
// when an action turns on.
function Icon({
  children,
  tone,
  pop,
}: {
  children: React.ReactNode;
  tone: keyof typeof TONE;
  pop?: boolean;
}) {
  return (
    <span
      key={pop ? 'on' : 'off'}
      className={cn(
        'rounded-full p-2 transition-colors [&_svg]:size-[18px]',
        CIRCLE[tone],
        pop && 'motion-safe:animate-pop',
      )}
    >
      {children}
    </span>
  );
}

function Count({ n }: { n: number }) {
  return (
    <span className="min-w-5 tabular-nums">
      {n > 0 ? n.toLocaleString('en') : ''}
    </span>
  );
}

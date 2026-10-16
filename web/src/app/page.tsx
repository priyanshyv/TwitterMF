import { Feather, Gauge, Layers, Radio } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { ComposeBox } from '@/components/compose-box';
import { NewPostsBanner } from '@/components/new-posts-banner';
import { Columns, PageHeader } from '@/components/shell/columns';
import { TweetList } from '@/components/tweet-list';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { getMe, getTimeline } from '@/lib/api/server';

export default function Home() {
  return (
    <Suspense fallback={<FeedSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const me = await getMe();
  if (!me) return <Landing />;

  const timeline = (await getTimeline()) ?? { items: [], nextCursor: null };
  return (
    <Columns>
      <PageHeader title="Home" />
      <div className="border-b">
        <ComposeBox displayName={me.displayName} username={me.username} />
      </div>
      <NewPostsBanner />
      <TweetList
        // A new first tweet (after posting) remounts the list with fresh data.
        key={timeline.items[0]?.id ?? 'empty'}
        initialPage={timeline}
        endpoint="/timeline"
        empty="Your timeline is empty. Post something, or follow a few people."
      />
    </Columns>
  );
}

const FEATURES = [
  {
    icon: Layers,
    text: 'Timelines precomputed in Redis, celebrities merged at read time',
  },
  { icon: Radio, text: 'Live notifications over WebSockets and pub/sub' },
  {
    icon: Gauge,
    text: 'Caching, rate limiting, bloom filters, background jobs',
  },
];

function Landing() {
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-8 px-4 py-16 md:py-24">
      <Feather className="size-12 text-sky-500" strokeWidth={2} />
      <div className="flex flex-col gap-4">
        <h1 className="text-5xl font-extrabold tracking-tight text-balance sm:text-6xl">
          Happening now
        </h1>
        <p className="text-xl text-muted-foreground">
          A Twitter clone built from scratch to learn how systems like it scale.
        </p>
      </div>
      <div className="flex flex-col gap-3 sm:max-w-xs">
        <Button
          size="lg"
          className="h-11 rounded-full text-base font-bold"
          asChild
        >
          <Link href="/signup">Create account</Link>
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="h-11 rounded-full text-base font-bold"
          asChild
        >
          <Link href="/login">Log in</Link>
        </Button>
      </div>
      <ul className="flex flex-col gap-3 border-t pt-8 text-muted-foreground">
        {FEATURES.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3">
            <Icon className="size-5 shrink-0 text-sky-500" />
            {text}
          </li>
        ))}
      </ul>
    </main>
  );
}

function FeedSkeleton() {
  return (
    <Columns aside={false}>
      <div className="flex flex-col gap-6 p-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    </Columns>
  );
}

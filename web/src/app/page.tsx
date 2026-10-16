import Link from 'next/link';
import { Suspense } from 'react';
import { ComposeBox } from '@/components/compose-box';
import { NewPostsBanner } from '@/components/new-posts-banner';
import { TweetList } from '@/components/tweet-list';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { WhoToFollow } from '@/components/who-to-follow';
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
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <main className="min-w-0 rounded-xl border">
        <h1 className="px-4 py-3 text-lg font-semibold">Home</h1>
        <Separator />
        <ComposeBox displayName={me.displayName} />
        <Separator />
        <NewPostsBanner />
        <TweetList
          // A new first tweet (after posting) remounts the list with fresh data.
          key={timeline.items[0]?.id ?? 'empty'}
          initialPage={timeline}
          endpoint="/timeline"
          empty="Your timeline is empty. Post something, or follow a few people."
        />
      </main>
      <aside className="min-w-0">
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <WhoToFollow />
        </Suspense>
      </aside>
    </div>
  );
}

function Landing() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-20">
      <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
        See what&apos;s happening.
      </h1>
      <p className="max-w-prose text-lg text-muted-foreground">
        TwitterMF is a Twitter clone built to learn system design: bloom
        filters, rotating tokens, cursor pagination, and more as it grows.
      </p>
      <div className="flex flex-wrap gap-3">
        <Button size="lg" asChild>
          <Link href="/signup">Create account</Link>
        </Button>
        <Button size="lg" variant="outline" asChild>
          <Link href="/login">Log in</Link>
        </Button>
      </div>
      <Link
        href="/status"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        System status
      </Link>
    </main>
  );
}

function FeedSkeleton() {
  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex flex-col gap-6 rounded-xl border p-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-10 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-4 w-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

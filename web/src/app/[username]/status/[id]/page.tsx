import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ComposeBox } from '@/components/compose-box';
import { TweetCard } from '@/components/tweet-card';
import { TweetList } from '@/components/tweet-list';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { WhoToFollow } from '@/components/who-to-follow';
import { getMe, getReplies, getThread } from '@/lib/api/server';

export default function TweetPage({
  params,
}: PageProps<'/[username]/status/[id]'>) {
  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Suspense fallback={<Skeleton className="h-72 rounded-xl" />}>
        <ThreadContent params={params} />
      </Suspense>
      <aside className="min-w-0">
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <WhoToFollow />
        </Suspense>
      </aside>
    </div>
  );
}

async function ThreadContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,20}$/.test(id)) notFound();
  const [thread, replies, me] = await Promise.all([
    getThread(id),
    getReplies(id),
    getMe(),
  ]);
  if (!thread || !replies) notFound();

  return (
    <main className="min-w-0 rounded-xl border">
      <h1 className="px-4 py-3 text-lg font-semibold">Post</h1>
      <Separator />
      {/* The conversation so far, oldest first, joined by a line. */}
      {thread.ancestors.map((t) => (
        <TweetCard key={t.id} tweet={t} connector />
      ))}
      <TweetCard tweet={thread.tweet} large />
      <Separator />
      {me && (
        <>
          <ComposeBox
            displayName={me.displayName}
            replyToId={thread.tweet.id}
          />
          <Separator />
        </>
      )}
      <TweetList
        key={replies.items[0]?.id ?? 'empty'}
        initialPage={replies}
        endpoint={`/tweets/${thread.tweet.id}/replies`}
        empty="No replies yet."
      />
    </main>
  );
}

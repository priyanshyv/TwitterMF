import { MessageCircle } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { ComposeBox } from '@/components/compose-box';
import { EmptyState } from '@/components/empty-state';
import { Columns, PageHeader } from '@/components/shell/columns';
import { TweetCard } from '@/components/tweet-card';
import { TweetList } from '@/components/tweet-list';
import { Skeleton } from '@/components/ui/skeleton';
import { getMe, getReplies, getThread } from '@/lib/api/server';

export default function TweetPage({
  params,
}: PageProps<'/[username]/status/[id]'>) {
  return (
    <Columns>
      <PageHeader title="Post" back="/" />
      <Suspense fallback={<Skeleton className="m-4 h-48" />}>
        <ThreadContent params={params} />
      </Suspense>
    </Columns>
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
    <>
      {/* The conversation so far, oldest first, joined by a line. */}
      {thread.ancestors.map((t) => (
        <TweetCard key={t.id} tweet={t} connector />
      ))}
      <div className="border-b">
        <TweetCard tweet={thread.tweet} large />
      </div>
      {me && (
        <div className="border-b">
          <ComposeBox
            displayName={me.displayName}
            username={me.username}
            replyToId={thread.tweet.id}
            replyingTo={thread.tweet.author.username}
          />
        </div>
      )}
      <TweetList
        key={replies.items[0]?.id ?? 'empty'}
        initialPage={replies}
        endpoint={`/tweets/${thread.tweet.id}/replies`}
        empty={
          <EmptyState icon={MessageCircle} title="No replies yet">
            Start the conversation.
          </EmptyState>
        }
      />
    </>
  );
}

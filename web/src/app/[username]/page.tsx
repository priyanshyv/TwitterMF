import { CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { FollowButton } from '@/components/follow-button';
import { TweetList } from '@/components/tweet-list';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { UserAvatar } from '@/components/user-avatar';
import { WhoToFollow } from '@/components/who-to-follow';
import { getProfile, getUserTweets } from '@/lib/api/server';
import { joinedDate } from '@/lib/format';

export default function ProfilePage({ params }: PageProps<'/[username]'>) {
  return (
    <div className="mx-auto grid max-w-5xl gap-6 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileContent params={params} />
      </Suspense>
      <aside className="min-w-0">
        <Suspense fallback={<Skeleton className="h-64 rounded-xl" />}>
          <WhoToFollow />
        </Suspense>
      </aside>
    </div>
  );
}

async function ProfileContent({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const [profile, tweets] = await Promise.all([
    getProfile(decodeURIComponent(username)),
    getUserTweets(decodeURIComponent(username)),
  ]);
  if (!profile || !tweets) notFound();
  const { user, stats, viewer } = profile;

  return (
    <main className="min-w-0 rounded-xl border">
      <section className="flex flex-col gap-4 p-4">
        <div className="flex items-start justify-between gap-4">
          <UserAvatar name={user.displayName} className="size-20 text-2xl" />
          {viewer && !viewer.isMe && (
            <FollowButton
              username={user.username}
              initiallyFollowing={viewer.follows}
            />
          )}
          {!viewer && (
            <Button variant="outline" className="rounded-full" asChild>
              <Link href="/login">Log in to follow</Link>
            </Button>
          )}
        </div>
        <div>
          <h1 className="text-xl font-semibold">{user.displayName}</h1>
          <p className="text-muted-foreground">@{user.username}</p>
        </div>
        {user.bio && <p className="whitespace-pre-wrap">{user.bio}</p>}
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CalendarDays className="size-4" /> Joined{' '}
          {joinedDate(user.createdAt)}
        </p>
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
          <Stat label="Following" value={stats.following} />
          <Stat label="Followers" value={stats.followers} />
          <Stat label="Posts" value={stats.tweets} />
        </dl>
      </section>
      <Separator />
      <TweetList
        key={tweets.items[0]?.id ?? 'empty'}
        initialPage={tweets}
        endpoint={`/users/${user.username}/tweets`}
        empty={
          viewer?.isMe
            ? 'You haven’t posted yet.'
            : `@${user.username} hasn’t posted yet.`
        }
      />
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex gap-1">
      <dd className="font-semibold tabular-nums">
        {value.toLocaleString('en')}
      </dd>
      <dt className="text-muted-foreground">{label}</dt>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4">
      <Skeleton className="size-20 rounded-full" />
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-4 w-64" />
    </div>
  );
}

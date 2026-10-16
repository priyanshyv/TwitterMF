import { CalendarDays } from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { FollowButton } from '@/components/follow-button';
import { Columns, PageHeader } from '@/components/shell/columns';
import { TweetList } from '@/components/tweet-list';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { bannerStyle, UserAvatar } from '@/components/user-avatar';
import { getProfile, getUserTweets } from '@/lib/api/server';
import { joinedDate } from '@/lib/format';

export default function ProfilePage({ params }: PageProps<'/[username]'>) {
  return (
    <Columns>
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileContent params={params} />
      </Suspense>
    </Columns>
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
    <>
      <PageHeader
        title={user.displayName}
        subtitle={`${stats.tweets.toLocaleString('en')} posts`}
        back="/"
      />
      <section className="border-b">
        <div className="h-36 sm:h-48" style={bannerStyle(user.username)} />
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex items-start justify-between gap-4">
            <UserAvatar
              name={user.displayName}
              seed={user.username}
              className="-mt-12 size-24 text-3xl ring-4 ring-background sm:-mt-16 sm:size-32 sm:text-4xl"
            />
            <div className="pt-3">
              {viewer && !viewer.isMe && (
                <FollowButton
                  username={user.username}
                  initiallyFollowing={viewer.follows}
                />
              )}
              {!viewer && (
                <Button
                  variant="outline"
                  className="rounded-full font-bold"
                  asChild
                >
                  <Link href="/login">Log in to follow</Link>
                </Button>
              )}
            </div>
          </div>
          <div className="leading-tight">
            <h2 className="text-xl font-extrabold">{user.displayName}</h2>
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
          </dl>
        </div>
      </section>
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
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex gap-1">
      <dd className="font-bold text-foreground tabular-nums">
        {value.toLocaleString('en')}
      </dd>
      <dt className="text-muted-foreground">{label}</dt>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="h-36 rounded-none sm:h-48" />
      <div className="flex flex-col gap-3 p-4">
        <Skeleton className="-mt-16 size-28 rounded-full ring-4 ring-background" />
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>
    </div>
  );
}

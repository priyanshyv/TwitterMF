import {
  CalendarDays,
  Feather,
  Heart,
  ImageIcon,
  MessageCircle,
} from 'lucide-react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';
import { EmptyState } from '@/components/empty-state';
import { FollowButton } from '@/components/follow-button';
import { Columns, PageHeader } from '@/components/shell/columns';
import { Tab, Tabs } from '@/components/shell/tabs';
import { TweetList } from '@/components/tweet-list';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { bannerStyle, UserAvatar } from '@/components/user-avatar';
import {
  getProfile,
  getUserTweets,
  type ProfileTab,
  userTweetsPath,
} from '@/lib/api/server';
import type { FeedItem, Page } from '@/lib/api/types';
import { joinedDate } from '@/lib/format';

const TABS: { tab: ProfileTab; label: string }[] = [
  { tab: 'posts', label: 'Posts' },
  { tab: 'replies', label: 'Replies' },
  { tab: 'media', label: 'Media' },
  { tab: 'likes', label: 'Likes' },
];

export default function ProfilePage({
  params,
  searchParams,
}: PageProps<'/[username]'>) {
  return (
    <Columns>
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfileContent params={params} searchParams={searchParams} />
      </Suspense>
    </Columns>
  );
}

async function ProfileContent({
  params,
  searchParams,
}: Pick<PageProps<'/[username]'>, 'params' | 'searchParams'>) {
  const [{ username: raw }, query] = await Promise.all([params, searchParams]);
  const username = decodeURIComponent(raw);
  const tab = TABS.find((t) => t.tab === query.tab)?.tab ?? 'posts';
  // Both requests start together; the tweets stream in under their tabs.
  const tweets = getUserTweets(username, tab);
  const profile = await getProfile(username);
  if (!profile) notFound();
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
      <Tabs label="Profile sections" className="border-b">
        {TABS.map((t) => (
          <Tab
            key={t.tab}
            href={
              t.tab === 'posts'
                ? `/${user.username}`
                : `/${user.username}?tab=${t.tab}`
            }
            active={t.tab === tab}
          >
            {t.label}
          </Tab>
        ))}
      </Tabs>
      <Suspense key={tab} fallback={<FeedSkeleton />}>
        <ProfileTweets
          tweets={tweets}
          endpoint={userTweetsPath(user.username, tab)}
          empty={emptyState(tab, user.username, !!viewer?.isMe)}
        />
      </Suspense>
    </>
  );
}

async function ProfileTweets({
  tweets,
  endpoint,
  empty,
}: {
  tweets: Promise<Page<FeedItem> | null>;
  endpoint: string;
  empty: React.ReactNode;
}) {
  const page = await tweets;
  if (!page) notFound();
  return (
    <TweetList
      key={page.items[0]?.id ?? 'empty'}
      initialPage={page}
      endpoint={endpoint}
      empty={empty}
    />
  );
}

function emptyState(tab: ProfileTab, username: string, isMe: boolean) {
  const who = isMe ? 'You' : `@${username}`;
  const copy = {
    posts: {
      icon: Feather,
      title: isMe ? 'You haven’t posted yet' : `${who} hasn’t posted yet`,
      body: isMe
        ? 'Your posts will show up here.'
        : 'When they do, their posts show up here.',
    },
    replies: {
      icon: MessageCircle,
      title: 'No replies yet',
      body: `Replies ${isMe ? 'you write' : 'they write'} to other posts show up here.`,
    },
    media: {
      icon: ImageIcon,
      title: 'No photos yet',
      body: `Posts with images ${isMe ? 'you share' : 'they share'} show up here.`,
    },
    likes: {
      icon: Heart,
      title: 'No likes yet',
      body: `Posts ${isMe ? 'you like' : 'they like'} show up here.`,
    },
  }[tab];
  return (
    <EmptyState icon={copy.icon} title={copy.title}>
      {copy.body}
    </EmptyState>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-6 p-4">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
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

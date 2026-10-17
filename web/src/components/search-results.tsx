'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import type { SearchResponse } from '@/lib/api/types';
import { FollowButton } from './follow-button';
import { FeedItemCard } from './tweet-card';
import { UserAvatar } from './user-avatar';

// The first page comes from the server; "Load more" asks for the next page.
export function SearchResults({
  q,
  type,
  initial,
}: {
  q: string;
  type: 'tweets' | 'users';
  initial: SearchResponse;
}) {
  const [pages, setPages] = useState([initial]);
  const [loading, setLoading] = useState(false);
  const last = pages[pages.length - 1];

  async function loadMore() {
    setLoading(true);
    try {
      const next = await api<SearchResponse>(
        `/search?q=${encodeURIComponent(q)}&type=${type}&page=${pages.length}`,
      );
      setPages((p) => [...p, next]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load more');
    } finally {
      setLoading(false);
    }
  }

  const tweets = pages.flatMap((p) => p.tweets ?? []);
  const people = pages.flatMap((p) => p.users ?? []);
  if (tweets.length === 0 && people.length === 0)
    return (
      <div className="px-8 py-16 text-center">
        <p className="text-xl font-extrabold">No results for “{q}”</p>
        <p className="mt-1 text-muted-foreground">
          Try different words, or a #hashtag.
        </p>
      </div>
    );

  return (
    <div>
      <ul className="divide-y">
        {tweets.map((item) => (
          <li key={item.id}>
            <FeedItemCard item={item} />
          </li>
        ))}
        {people.map((p) => (
          <li
            key={p.id}
            className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <Link href={`/${p.username}`} className="shrink-0">
              <UserAvatar name={p.displayName} seed={p.username} />
            </Link>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/${p.username}`} className="min-w-0 leading-tight">
                  <span className="block truncate font-bold hover:underline">
                    {p.displayName}
                  </span>
                  <span className="block truncate text-muted-foreground">
                    @{p.username}
                  </span>
                </Link>
                {p.viewer && !p.viewer.isMe && (
                  <FollowButton
                    username={p.username}
                    initiallyFollowing={p.viewer.follows}
                    size="sm"
                  />
                )}
              </div>
              {p.bio && <p className="mt-1 text-[15px]">{p.bio}</p>}
              <p className="mt-1 text-[13px] text-muted-foreground">
                {p.followers.toLocaleString('en')} followers
              </p>
            </div>
          </li>
        ))}
      </ul>
      {last.hasMore && (
        <div className="border-t p-3 text-center">
          <Button variant="ghost" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import type { FeedItem, Page } from '@/lib/api/types';
import { EmptyState } from './empty-state';
import { FeedItemCard } from './tweet-card';

// The first page is rendered on the server; "Load more" fetches older pages
// in the browser, passing the last tweet's ID as the cursor.
export function TweetList({
  initialPage,
  endpoint,
  empty,
}: {
  initialPage: Page<FeedItem>;
  endpoint: string;
  empty: React.ReactNode;
}) {
  const [tweets, setTweets] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [loading, setLoading] = useState(false);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const sep = endpoint.includes('?') ? '&' : '?';
      const page = await api<Page<FeedItem>>(
        `${endpoint}${sep}before=${cursor}`,
      );
      setTweets((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load more');
    } finally {
      setLoading(false);
    }
  }

  if (tweets.length === 0) {
    return typeof empty === 'string' ? <EmptyState title={empty} /> : empty;
  }

  return (
    <div>
      <ul className="divide-y">
        {tweets.map((t) => (
          <li key={t.id}>
            <FeedItemCard item={t} />
          </li>
        ))}
      </ul>
      {cursor && (
        <div className="border-t p-3 text-center">
          <Button variant="ghost" onClick={loadMore} disabled={loading}>
            {loading ? 'Loading…' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}

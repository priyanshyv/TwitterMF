'use client';

import { ArrowUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRealtime } from './realtime-provider';

// "Show 3 new posts": new tweets from people you follow are announced, not
// injected, so the list never jumps under the reader's thumb.
export function NewPostsBanner() {
  const router = useRouter();
  const [fresh, setFresh] = useState<string[]>([]);
  useRealtime((event) => {
    if (event.type === 'timeline')
      setFresh((ids) =>
        ids.includes(event.tweetId) ? ids : [...ids, event.tweetId],
      );
  });
  if (fresh.length === 0) return null;

  return (
    <div className="sticky top-16 z-10 flex justify-center py-2">
      <Button
        size="sm"
        className="rounded-full shadow-md"
        onClick={() => {
          setFresh([]);
          router.refresh();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
      >
        <ArrowUp />
        Show {fresh.length} new post{fresh.length === 1 ? '' : 's'}
      </Button>
    </div>
  );
}

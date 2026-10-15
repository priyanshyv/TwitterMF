'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import { charCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { UserAvatar } from './user-avatar';

const MAX = 280;

export function ComposeBox({ displayName }: { displayName: string }) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);

  const count = charCount(text.trim());
  const left = MAX - count;

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    try {
      await api('/tweets', { method: 'POST', body: { text } });
      setText('');
      router.refresh(); // re-render the timeline on the server
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post');
    } finally {
      setPosting(false);
    }
  }

  return (
    <form onSubmit={post} className="flex gap-3 px-4 py-3">
      <UserAvatar name={displayName} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <Textarea
          id="compose"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
              e.currentTarget.form?.requestSubmit();
          }}
          placeholder="What's happening?"
          aria-label="Write a tweet"
          rows={3}
          className="resize-none border-0 px-0 text-lg shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-end gap-3">
          <span
            className={cn(
              'text-sm tabular-nums text-muted-foreground',
              left < 20 && 'text-amber-600 dark:text-amber-400',
              left < 0 && 'text-destructive',
            )}
            aria-live="polite"
          >
            {left}
          </span>
          <Button type="submit" disabled={posting || count === 0 || left < 0}>
            {posting ? 'Posting…' : 'Post'}
          </Button>
        </div>
      </div>
    </form>
  );
}

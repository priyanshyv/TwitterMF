'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import { charCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { UserAvatar } from './user-avatar';

const MAX = 280;

export function ComposeBox({
  displayName,
  replyToId,
}: {
  displayName: string;
  replyToId?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  // One key per draft. If the request fails and the user presses Post again,
  // the same key goes with it, so a request that actually landed (but whose
  // answer got lost) is replayed instead of posted twice.
  const idempotencyKey = useRef<string>(null);

  const count = charCount(text.trim());
  const left = MAX - count;

  async function post(e: React.FormEvent) {
    e.preventDefault();
    idempotencyKey.current ??= crypto.randomUUID();
    setPosting(true);
    try {
      await api('/tweets', {
        method: 'POST',
        body: { text, replyToId },
        headers: { 'Idempotency-Key': idempotencyKey.current },
      });
      setText('');
      idempotencyKey.current = null; // the next tweet is a new action
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
          id={replyToId ? 'reply' : 'compose'}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            idempotencyKey.current = null; // edited: a different tweet now
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey))
              e.currentTarget.form?.requestSubmit();
          }}
          placeholder={replyToId ? 'Post your reply' : "What's happening?"}
          aria-label={replyToId ? 'Write a reply' : 'Write a tweet'}
          rows={replyToId ? 2 : 3}
          className="resize-none border-0 px-0 text-lg shadow-none focus-visible:ring-0"
        />
        <div className="flex items-center justify-end gap-3">
          <span
            className={cn(
              'text-sm text-muted-foreground tabular-nums',
              left < 20 && 'text-amber-600 dark:text-amber-400',
              left < 0 && 'text-destructive',
            )}
            aria-live="polite"
          >
            {left}
          </span>
          <Button type="submit" disabled={posting || count === 0 || left < 0}>
            {posting ? 'Posting…' : replyToId ? 'Reply' : 'Post'}
          </Button>
        </div>
      </div>
    </form>
  );
}

'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
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
  username,
  replyToId,
}: {
  displayName: string;
  username: string;
  replyToId?: string;
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  // One key per draft. If the request fails and the user presses Post again,
  // the same key goes with it, so a request that actually landed (but whose
  // answer got lost) is replayed instead of posted twice.
  const idempotencyKey = useRef<string>(null);

  // The sidebar's Post button links to /#compose.
  useEffect(() => {
    if (!replyToId && window.location.hash === '#compose')
      input.current?.focus();
  }, [replyToId]);

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
    <form onSubmit={post} className="flex gap-3 px-4 pt-3 pb-2">
      <UserAvatar name={displayName} seed={username} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Textarea
          ref={input}
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
          rows={replyToId ? 1 : 2}
          // Grows with the text (field-sizing: content), no scrollbar.
          className="min-h-0 resize-none rounded-none border-0 bg-transparent px-0 py-2 text-xl shadow-none placeholder:text-muted-foreground/80 focus-visible:ring-0 md:text-xl dark:bg-transparent"
        />
        <div className="flex items-center justify-end gap-3 border-t pt-2">
          {count > 0 && <CharRing count={count} />}
          <Button
            type="submit"
            disabled={posting || count === 0 || left < 0}
            className="rounded-full px-5 font-bold"
          >
            {posting ? 'Posting…' : replyToId ? 'Reply' : 'Post'}
          </Button>
        </div>
      </div>
    </form>
  );
}

// A ring that fills as you type; the number appears for the last 20
// characters, and it turns red past the limit.
function CharRing({ count }: { count: number }) {
  const left = MAX - count;
  const r = 9;
  const circumference = 2 * Math.PI * r;
  const filled = Math.min(count / MAX, 1) * circumference;
  return (
    <div className="flex items-center gap-2" aria-live="polite">
      {left <= 20 && (
        <span
          className={cn(
            'text-sm tabular-nums',
            left < 0
              ? 'text-destructive'
              : 'text-amber-600 dark:text-amber-400',
          )}
        >
          {left}
        </span>
      )}
      <svg
        viewBox="0 0 24 24"
        className="size-6 -rotate-90"
        aria-label={`${left} characters left`}
      >
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          strokeWidth="2"
          className="stroke-border"
        />
        <circle
          cx="12"
          cy="12"
          r={r}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${circumference}`}
          className={cn(
            'transition-[stroke-dasharray]',
            left < 0
              ? 'stroke-destructive'
              : left <= 20
                ? 'stroke-amber-500'
                : 'stroke-sky-500',
          )}
        />
      </svg>
    </div>
  );
}

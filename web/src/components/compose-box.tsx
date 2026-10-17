'use client';

import { ImagePlus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api/client';
import type { MediaView } from '@/lib/api/types';
import { charCount } from '@/lib/format';
import { ALLOWED_TYPES, uploadImage } from '@/lib/upload';
import { cn } from '@/lib/utils';
import { UserAvatar } from './user-avatar';

const MAX = 280;
const MAX_IMAGES = 4;

interface Attachment {
  key: string;
  preview: string; // a local blob: URL, shown instantly while uploading
  progress: number;
  media?: MediaView; // set once uploaded
  error?: string;
}

export function ComposeBox({
  displayName,
  username,
  replyToId,
  replyingTo,
  id = replyToId ? 'reply' : 'compose',
  autoFocus,
  onPosted,
}: {
  displayName: string;
  username: string;
  replyToId?: string;
  replyingTo?: string; // username shown as "Replying to @x"
  id?: string;
  autoFocus?: boolean;
  onPosted?: () => void; // e.g. close the dialog it lives in
}) {
  const router = useRouter();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  // One key per draft. If the request fails and the user presses Post again,
  // the same key goes with it, so a request that actually landed (but whose
  // answer got lost) is replayed instead of posted twice.
  const idempotencyKey = useRef<string>(null);

  const count = charCount(text.trim());
  const left = MAX - count;
  const uploading = attachments.some((a) => !a.media && !a.error);
  const mediaIds = attachments.flatMap((a) => (a.media ? [a.media.id] : []));
  const canPost =
    (count > 0 || mediaIds.length > 0) && left >= 0 && !uploading && !posting;

  function update(key: string, patch: Partial<Attachment>) {
    setAttachments((list) =>
      list.map((a) => (a.key === key ? { ...a, ...patch } : a)),
    );
  }

  function addFiles(files: FileList | null) {
    const room = MAX_IMAGES - attachments.length;
    const picked = [...(files ?? [])]
      .filter((f) => ALLOWED_TYPES.includes(f.type))
      .slice(0, room);
    if ((files?.length ?? 0) > room)
      toast.message(`Up to ${MAX_IMAGES} images per post`);
    idempotencyKey.current = null; // different images: a different post
    for (const file of picked) {
      const key = crypto.randomUUID();
      setAttachments((list) => [
        ...list,
        { key, preview: URL.createObjectURL(file), progress: 0 },
      ]);
      uploadImage(file, (progress) => update(key, { progress }))
        .then((media) => update(key, { media, progress: 1 }))
        .catch((err: Error) => {
          update(key, { error: err.message });
          toast.error(err.message);
        });
    }
  }

  function remove(key: string) {
    setAttachments((list) => {
      const gone = list.find((a) => a.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return list.filter((a) => a.key !== key);
    });
    idempotencyKey.current = null;
  }

  async function post(e: React.FormEvent) {
    e.preventDefault();
    idempotencyKey.current ??= crypto.randomUUID();
    setPosting(true);
    try {
      await api('/tweets', {
        method: 'POST',
        body: { text, replyToId, mediaIds },
        headers: { 'Idempotency-Key': idempotencyKey.current },
      });
      setText('');
      attachments.forEach((a) => URL.revokeObjectURL(a.preview));
      setAttachments([]);
      idempotencyKey.current = null; // the next tweet is a new action
      router.refresh(); // re-render the timeline on the server
      onPosted?.();
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
        {replyingTo && (
          <p className="pt-1 text-[15px] text-muted-foreground">
            Replying to{' '}
            <a href={`/${replyingTo}`} className="text-sky-500 hover:underline">
              @{replyingTo}
            </a>
          </p>
        )}
        <Textarea
          ref={input}
          id={id}
          autoFocus={autoFocus}
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
        {attachments.length > 0 && (
          <div
            className={cn(
              'mb-3 grid gap-2',
              attachments.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
            )}
          >
            {attachments.map((a) => (
              <div
                key={a.key}
                className="relative overflow-hidden rounded-2xl border bg-muted"
              >
                {/* A local preview of the file being uploaded. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={a.preview}
                  alt=""
                  className={cn(
                    'w-full object-cover',
                    attachments.length > 1 ? 'aspect-square' : 'max-h-80',
                    (!a.media || a.error) && 'opacity-60',
                  )}
                />
                {!a.media && !a.error && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <UploadRing progress={a.progress} />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => remove(a.key)}
                  aria-label="Remove image"
                  className="absolute top-2 right-2 rounded-full bg-black/70 p-1.5 text-white hover:bg-black/85"
                >
                  <X className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3 border-t pt-2">
          <input
            ref={picker}
            type="file"
            accept={ALLOWED_TYPES.join(',')}
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = ''; // picking the same file again still fires
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-ml-2 rounded-full text-sky-500 hover:bg-sky-500/10 hover:text-sky-500"
            aria-label="Add images"
            disabled={attachments.length >= MAX_IMAGES}
            onClick={() => picker.current?.click()}
          >
            <ImagePlus className="size-5" />
          </Button>
          <div className="flex-1" />
          {count > 0 && <CharRing count={count} />}
          <Button
            type="submit"
            disabled={!canPost}
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

function UploadRing({ progress }: { progress: number }) {
  const r = 14;
  const c = 2 * Math.PI * r;
  return (
    <svg
      viewBox="0 0 36 36"
      className="size-10 -rotate-90 drop-shadow"
      aria-label={`Uploading ${Math.round(progress * 100)}%`}
    >
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="rgb(0 0 0 / 0.5)"
        stroke="rgb(255 255 255 / 0.3)"
        strokeWidth="3"
      />
      <circle
        cx="18"
        cy="18"
        r={r}
        fill="none"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${progress * c} ${c}`}
        className="transition-[stroke-dasharray]"
      />
    </svg>
  );
}

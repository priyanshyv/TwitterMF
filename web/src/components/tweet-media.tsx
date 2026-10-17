'use client';

import { ChevronLeft, ChevronRight, ImageOff, Loader2, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useState } from 'react';
import type { MediaView } from '@/lib/api/types';
import { cn } from '@/lib/utils';

// 1 image: its own shape (clamped); 2: side by side; 3: one tall + two
// stacked; 4: a 2x2 grid. Like Twitter, so photos crop predictably.
export function TweetMedia({
  media,
  large,
}: {
  media: MediaView[];
  large?: boolean;
}) {
  const [viewing, setViewing] = useState<number | null>(null);
  if (media.length === 0) return null;
  const one = media.length === 1 ? media[0] : null;
  const ratio =
    one?.width && one.height
      ? Math.min(Math.max(one.width / one.height, 0.75), 2)
      : 16 / 9;
  const ready = media.filter((m) => m.status === 'ready' && m.url);

  return (
    <>
      <div
        className={cn(
          'mt-3 grid overflow-hidden rounded-2xl border bg-muted',
          media.length > 1 && 'aspect-video grid-cols-2 gap-0.5',
          media.length > 2 && 'grid-rows-2',
        )}
        style={
          one
            ? { aspectRatio: String(ratio), maxHeight: large ? 680 : 510 }
            : undefined
        }
      >
        {media.map((m, i) => (
          <MediaTile
            key={m.id}
            media={m}
            // Grid tiles are small: the 600px version is plenty.
            src={media.length > 1 ? (m.thumbUrl ?? m.url) : m.url}
            onOpen={() => setViewing(ready.indexOf(m))}
            className={cn(media.length === 3 && i === 0 && 'row-span-2')}
          />
        ))}
      </div>
      {viewing !== null && ready.length > 0 && (
        <Lightbox
          media={ready}
          index={viewing}
          onIndex={setViewing}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

function MediaTile({
  media,
  src,
  onOpen,
  className,
}: {
  media: MediaView;
  src: string | null;
  onOpen: () => void;
  className?: string;
}) {
  if (media.status !== 'ready' || !src)
    return (
      <div
        className={cn(
          'flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground',
          className,
        )}
      >
        {media.status === 'failed' ? (
          <>
            <ImageOff className="size-4" /> Image unavailable
          </>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Processing…
          </>
        )}
      </div>
    );
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="View image"
      className={cn('block min-h-0 cursor-zoom-in overflow-hidden', className)}
    >
      {/* Already resized to WebP by our worker and served with long cache
          headers, so Next's image optimizer has nothing to add. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        className="size-full object-cover transition-opacity hover:opacity-90"
      />
    </button>
  );
}

// Full-screen viewer. Radix's Dialog gives focus trapping, Escape to close
// and scroll locking; the arrow keys step through the post's images.
function Lightbox({
  media,
  index,
  onIndex,
  onClose,
}: {
  media: MediaView[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const current = media[index];
  const many = media.length > 1;
  const step = (by: number) =>
    onIndex((index + by + media.length) % media.length);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/95 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={(e) => {
            if (!many) return;
            if (e.key === 'ArrowRight') step(1);
            if (e.key === 'ArrowLeft') step(-1);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none sm:p-12"
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <DialogPrimitive.Title className="sr-only">
            Image {index + 1} of {media.length}
          </DialogPrimitive.Title>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            key={current.id}
            src={current.url ?? ''}
            alt=""
            width={current.width ?? undefined}
            height={current.height ?? undefined}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          <DialogPrimitive.Close
            aria-label="Close"
            className={cn(ROUND, 'top-3 left-3')}
          >
            <X />
          </DialogPrimitive.Close>
          {many && (
            <>
              <button
                type="button"
                aria-label="Previous image"
                onClick={() => step(-1)}
                className={cn(ROUND, 'top-1/2 left-3 -translate-y-1/2')}
              >
                <ChevronLeft />
              </button>
              <button
                type="button"
                aria-label="Next image"
                onClick={() => step(1)}
                className={cn(ROUND, 'top-1/2 right-3 -translate-y-1/2')}
              >
                <ChevronRight />
              </button>
              <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1 text-sm text-white tabular-nums">
                {index + 1} / {media.length}
              </p>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

// The lightbox is always dark, whatever the theme, so these are fixed colors.
const ROUND =
  'absolute flex size-10 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80 [&_svg]:size-5';

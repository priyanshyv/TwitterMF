import { ImageOff, Loader2 } from 'lucide-react';
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
  if (media.length === 0) return null;
  const one = media.length === 1 ? media[0] : null;
  const ratio =
    one?.width && one.height
      ? Math.min(Math.max(one.width / one.height, 0.75), 2)
      : 16 / 9;

  return (
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
          className={cn(media.length === 3 && i === 0 && 'row-span-2')}
        />
      ))}
    </div>
  );
}

function MediaTile({
  media,
  className,
}: {
  media: MediaView;
  className?: string;
}) {
  if (media.status !== 'ready' || !media.url)
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
    <a
      href={media.url}
      target="_blank"
      rel="noreferrer"
      className={cn('block min-h-0 overflow-hidden', className)}
    >
      {/* Already resized to WebP by our worker and served with long cache
          headers, so Next's image optimizer has nothing to add. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={media.url}
        alt=""
        loading="lazy"
        width={media.width ?? undefined}
        height={media.height ?? undefined}
        className="size-full object-cover transition-opacity hover:opacity-90"
      />
    </a>
  );
}

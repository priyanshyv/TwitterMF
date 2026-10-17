'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

// @mentions and #hashtags (letters of any script, with combining marks so
// #भारत stays whole), not when glued to a preceding word ("email#x").
const TOKEN =
  /((?<![\p{L}\p{M}\p{N}_])@[A-Za-z0-9_]{1,15}|(?<![\p{L}\p{M}\p{N}_&])#[\p{L}\p{M}\p{N}_]{1,50})/gu;

// Tweet text with @mentions and #hashtags as links. Clicking anywhere else
// opens the tweet (the whole text can't be one link: links can't nest).
export function TweetText({
  text,
  href,
  large,
}: {
  text: string;
  href: string;
  large?: boolean;
}) {
  const router = useRouter();
  if (!text) return null;
  return (
    <p
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('a')) return;
        if (window.getSelection()?.toString()) return; // selecting text, not clicking
        router.push(href);
      }}
      className={cn(
        'mt-0.5 cursor-pointer break-words whitespace-pre-wrap',
        large && 'text-xl leading-snug',
      )}
    >
      {text.split(TOKEN).map((part, i) =>
        i % 2 === 0 ? (
          part
        ) : (
          <Link
            key={i}
            href={
              part.startsWith('@')
                ? `/${part.slice(1)}`
                : `/search?q=${encodeURIComponent(part)}`
            }
            className="text-sky-500 hover:underline"
          >
            {part}
          </Link>
        ),
      )}
    </p>
  );
}

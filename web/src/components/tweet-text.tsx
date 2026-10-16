'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

const MENTION = /(@[A-Za-z0-9_]{1,15})/g;

// Tweet text with @mentions as profile links. Clicking anywhere else opens
// the tweet (the whole text can't be one link: links can't contain links).
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
      {text.split(MENTION).map((part, i) =>
        i % 2 === 1 ? (
          <Link
            key={i}
            href={`/${part.slice(1)}`}
            className="text-sky-600 hover:underline"
          >
            {part}
          </Link>
        ) : (
          part
        ),
      )}
    </p>
  );
}

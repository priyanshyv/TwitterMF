import { Feather } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export function Logo({
  withText,
  className,
}: {
  withText?: boolean;
  className?: string;
}) {
  return (
    <Link
      href="/"
      aria-label="TwitterMF home"
      className={cn(
        'inline-flex items-center gap-2 rounded-full p-2 font-bold tracking-tight hover:bg-muted',
        className,
      )}
    >
      <Feather className="size-7 text-sky-500" strokeWidth={2.25} />
      {withText && <span className="text-xl">TwitterMF</span>}
    </Link>
  );
}

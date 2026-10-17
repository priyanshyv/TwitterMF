import Link from 'next/link';
import { cn } from '@/lib/utils';

// A row of tabs that are plain links (?tab=…), so every tab has its own
// URL: shareable, and the back button works.
export function Tabs({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <nav className={cn('flex', className)} aria-label={label}>
      {children}
    </nav>
  );
}

export function Tab({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 justify-center text-[15px] transition-colors hover:bg-muted/50',
        active ? 'font-bold' : 'font-medium text-muted-foreground',
      )}
    >
      <span
        className={cn(
          'relative py-3.5',
          active &&
            'after:absolute after:inset-x-0 after:bottom-0 after:h-1 after:rounded-full after:bg-sky-500',
        )}
      >
        {children}
      </span>
    </Link>
  );
}

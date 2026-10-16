'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

export function useIsActive(href: string) {
  const pathname = usePathname();
  return href === '/' ? pathname === '/' : pathname === href;
}

// A sidebar entry: icon always, label from the xl breakpoint up.
export function NavLink({
  href,
  label,
  icon,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const active = useIsActive(href);
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex items-center gap-4 rounded-full p-3 text-xl transition-colors hover:bg-muted xl:pr-6',
        active && 'font-bold [&_svg]:stroke-[2.5]',
      )}
    >
      <span className="relative [&_svg]:size-[26px]">
        {icon}
        {badge}
      </span>
      <span className="hidden xl:inline">{label}</span>
    </Link>
  );
}

// A bottom-bar tab on phones.
export function TabLink({
  href,
  label,
  icon,
  badge,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: React.ReactNode;
}) {
  const active = useIsActive(href);
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex flex-1 items-center justify-center py-3 text-muted-foreground',
        active && 'text-foreground [&_svg]:stroke-[2.5]',
      )}
    >
      <span className="relative [&_svg]:size-6">
        {icon}
        {badge}
      </span>
    </Link>
  );
}

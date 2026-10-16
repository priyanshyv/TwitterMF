import type { CSSProperties } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

// Every person gets their own color, derived from their username, so the
// same person always looks the same and a feed is easy to scan.
function hueOf(seed: string) {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = (h * 33) ^ seed.charCodeAt(i);
  return Math.abs(h) % 360;
}

export function UserAvatar({
  name,
  seed,
  className,
}: {
  name: string;
  // Usually the username; falls back to the display name.
  seed?: string;
  className?: string;
}) {
  const style = {
    '--hue': hueOf((seed ?? name).toLowerCase()),
  } as CSSProperties;
  return (
    <Avatar className={cn('size-10', className)} style={style}>
      <AvatarFallback className="bg-[oklch(0.92_0.05_var(--hue))] text-[length:inherit] font-semibold text-[oklch(0.42_0.12_var(--hue))] dark:bg-[oklch(0.33_0.07_var(--hue))] dark:text-[oklch(0.9_0.07_var(--hue))]">
        {initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

// A soft banner in the same color family as the avatar, for profiles.
export function bannerStyle(seed: string): CSSProperties {
  const hue = hueOf(seed.toLowerCase());
  return {
    backgroundImage: `linear-gradient(135deg, oklch(0.78 0.09 ${hue}), oklch(0.62 0.12 ${(hue + 40) % 360}))`,
  };
}

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getMe } from '@/lib/api/server';
import { LogoutButton } from './logout-button';
import { UserAvatar } from './user-avatar';

export async function UserNav() {
  const me = await getMe();
  if (!me) {
    return (
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/login">Log in</Link>
        </Button>
        <Button size="sm" asChild>
          <Link href="/signup">Sign up</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <Link
        href={`/${me.username}`}
        className="flex items-center gap-2 rounded-full py-1 pr-3 pl-1 hover:bg-muted"
      >
        <UserAvatar name={me.displayName} className="size-7 text-xs" />
        <span className="hidden text-sm font-medium sm:inline">
          @{me.username}
        </span>
      </Link>
      <LogoutButton />
    </div>
  );
}

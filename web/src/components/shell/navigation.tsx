import { Bell, House, PenLine, UserRound } from 'lucide-react';
import Link from 'next/link';
import { LogoutButton } from '@/components/logout-button';
import { Logo } from '@/components/logo';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/user-avatar';
import { getMe, getUnreadCount } from '@/lib/api/server';
import { NavLink, TabLink } from './nav-link';
import { UnreadBadge } from './unread-badge';

// Who's looking, for the navigation. The layout sits outside app/error.tsx,
// so this must never throw: if the API is unreachable, render as logged out
// and let the page's own error boundary explain.
async function viewer() {
  const me = await getMe().catch(() => null);
  const unread = me ? await getUnreadCount().catch(() => 0) : 0;
  return { me, unread };
}

// Desktop: a sticky left column. Icons only on md, with labels from xl.
export async function SideNav() {
  const { me, unread } = await viewer();
  return (
    <header className="sticky top-0 hidden h-svh shrink-0 flex-col justify-between px-2 py-2 md:flex xl:w-64">
      <div className="flex flex-col items-center gap-1 xl:items-stretch">
        <Logo className="mb-2 self-center xl:self-start" />
        <nav
          aria-label="Main"
          className="flex flex-col items-center gap-1 xl:items-stretch"
        >
          <NavLink href="/" label="Home" icon={<House />} />
          {me && (
            <>
              <NavLink
                href="/notifications"
                label="Notifications"
                icon={<Bell />}
                badge={<UnreadBadge initial={unread} />}
              />
              <NavLink
                href={`/${me.username}`}
                label="Profile"
                icon={<UserRound />}
              />
            </>
          )}
        </nav>
        {me ? (
          <Button
            asChild
            size="lg"
            className="mt-4 size-12 rounded-full text-base font-bold xl:h-12 xl:w-full"
          >
            <Link href="/#compose" aria-label="Post">
              <PenLine className="xl:hidden" />
              <span className="hidden xl:inline">Post</span>
            </Link>
          </Button>
        ) : (
          <div className="mt-4 hidden flex-col gap-2 xl:flex">
            <Button asChild size="lg" className="rounded-full font-bold">
              <Link href="/signup">Create account</Link>
            </Button>
            <Button
              asChild
              size="lg"
              variant="outline"
              className="rounded-full font-bold"
            >
              <Link href="/login">Log in</Link>
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 xl:items-stretch">
        <ThemeToggle />
        {me && (
          <div className="flex items-center gap-3 rounded-full p-2 xl:pr-1">
            <Link
              href={`/${me.username}`}
              className="shrink-0"
              aria-label="Your profile"
            >
              <UserAvatar name={me.displayName} seed={me.username} />
            </Link>
            <div className="hidden min-w-0 flex-1 leading-tight xl:block">
              <p className="truncate text-sm font-bold">{me.displayName}</p>
              <p className="truncate text-sm text-muted-foreground">
                @{me.username}
              </p>
            </div>
            <span className="hidden xl:inline-flex">
              <LogoutButton />
            </span>
          </div>
        )}
      </div>
    </header>
  );
}

// Phones: a small top bar (scrolls away) and a bottom tab bar.
export async function MobileNav() {
  const { me, unread } = await viewer();
  return (
    <>
      <div className="flex h-14 items-center justify-between px-2 md:hidden">
        <Logo />
        <div className="flex items-center">
          <ThemeToggle />
          {me ? (
            <LogoutButton />
          ) : (
            <Button asChild size="sm" className="ml-1 rounded-full">
              <Link href="/login">Log in</Link>
            </Button>
          )}
        </div>
      </div>
      {me && (
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        >
          <TabLink href="/" label="Home" icon={<House />} />
          <TabLink
            href="/notifications"
            label="Notifications"
            icon={<Bell />}
            badge={<UnreadBadge initial={unread} />}
          />
          <TabLink
            href={`/${me.username}`}
            label="Profile"
            icon={<UserRound />}
          />
        </nav>
      )}
    </>
  );
}

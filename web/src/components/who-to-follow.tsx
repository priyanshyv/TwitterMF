import Link from 'next/link';
import { getSuggestions } from '@/lib/api/server';
import { FollowButton } from './follow-button';
import { UserAvatar } from './user-avatar';

export async function WhoToFollow() {
  const people = await getSuggestions().catch(() => []);
  if (people.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border">
      <h2 className="px-4 pt-3 pb-2 text-xl font-extrabold">Who to follow</h2>
      <ul>
        {people.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
          >
            <Link
              href={`/${p.username}`}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <UserAvatar name={p.displayName} seed={p.username} />
              <span className="min-w-0 leading-tight">
                <span className="block truncate font-bold hover:underline">
                  {p.displayName}
                </span>
                <span className="block truncate text-muted-foreground">
                  @{p.username}
                </span>
              </span>
            </Link>
            <FollowButton
              username={p.username}
              initiallyFollowing={false}
              size="sm"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

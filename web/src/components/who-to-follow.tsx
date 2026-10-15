import Link from 'next/link';
import { getSuggestions } from '@/lib/api/server';
import { FollowButton } from './follow-button';
import { UserAvatar } from './user-avatar';

export async function WhoToFollow() {
  const people = await getSuggestions();
  if (people.length === 0) return null;
  return (
    <section className="rounded-xl border">
      <h2 className="px-4 pt-3 pb-1 font-semibold">Who to follow</h2>
      <ul>
        {people.map((p) => (
          <li key={p.id} className="flex items-center gap-3 px-4 py-2.5">
            <Link
              href={`/${p.username}`}
              className="flex min-w-0 flex-1 items-center gap-3"
            >
              <UserAvatar name={p.displayName} className="size-9" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold hover:underline">
                  {p.displayName}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
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

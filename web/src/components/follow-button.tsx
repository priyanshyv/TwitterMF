'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';

// Optimistic: the button flips instantly and rolls back if the API says no.
export function FollowButton({
  username,
  initiallyFollowing,
  size,
}: {
  username: string;
  initiallyFollowing: boolean;
  size?: 'sm' | 'default';
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initiallyFollowing);
  const [busy, setBusy] = useState(false);
  const [hover, setHover] = useState(false);

  async function toggle() {
    const next = !following;
    setFollowing(next);
    setBusy(true);
    try {
      await api(`/users/${username}/follow`, {
        method: next ? 'POST' : 'DELETE',
      });
      router.refresh(); // follower counts and the timeline change too
    } catch (err) {
      setFollowing(!next);
      toast.error(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      size={size}
      variant={following ? 'outline' : 'default'}
      onClick={toggle}
      disabled={busy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="min-w-24 rounded-full"
    >
      {following ? (hover ? 'Unfollow' : 'Following') : 'Follow'}
    </Button>
  );
}

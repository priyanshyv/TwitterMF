'use client';

import { Bell } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useRealtime } from './realtime-provider';

export function NotificationBell({ initialUnread }: { initialUnread: number }) {
  const [unread, setUnread] = useState(initialUnread);
  // The worker publishes the new unread count; the API forwards it here.
  useRealtime((event) => {
    if (event.type === 'notification') setUnread(event.unread);
  });

  return (
    <Button variant="ghost" size="icon" className="relative" asChild>
      <Link
        href="/notifications"
        aria-label={
          unread ? `Notifications (${unread} unread)` : 'Notifications'
        }
      >
        <Bell />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-sky-600 px-1 text-[10px] leading-none font-semibold text-white tabular-nums">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </Link>
    </Button>
  );
}

'use client';

import { useState } from 'react';
import { useRealtime } from '@/components/realtime-provider';

// The unread notification count, kept live over the WebSocket: the worker
// publishes the new count, the API forwards it here.
export function UnreadBadge({ initial }: { initial: number }) {
  const [unread, setUnread] = useState(initial);
  useRealtime((event) => {
    if (event.type === 'notification') setUnread(event.unread);
  });
  if (unread === 0) return null;
  return (
    <span
      aria-label={`${unread} unread`}
      className="absolute -top-1 -right-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-sky-500 px-1 text-[11px] leading-none font-bold text-white tabular-nums ring-2 ring-background"
    >
      {unread > 99 ? '99+' : unread}
    </span>
  );
}

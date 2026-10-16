'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { api } from '@/lib/api/client';
import { PUBLIC_API_URL } from '@/lib/api/config';
import type { RealtimeEvent } from '@/lib/api/types';

type Listener = (event: RealtimeEvent) => void;
const RealtimeContext = createContext<((fn: Listener) => () => void) | null>(
  null,
);

const WS_URL = `${PUBLIC_API_URL.replace(/^http/, 'ws')}/ws`;

// One WebSocket per tab, opened only while some component is listening
// (the bell, the "new posts" banner), shared by all of them.
export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [listening, setListening] = useState(0);

  useEffect(() => {
    if (listening === 0) return;
    let ws: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    const emit = (event: RealtimeEvent) =>
      listeners.current.forEach((fn) => fn(event));

    // Reconnect with exponential backoff (1 s, 2 s, 4 s… up to 30 s) and
    // jitter (a random 50-100% of it). After a deploy, thousands of tabs
    // reconnect at once; jitter spreads them out instead of a stampede.
    const retry = () => {
      if (stopped) return;
      const base = Math.min(30_000, 1_000 * 2 ** attempt++);
      timer = setTimeout(connect, base / 2 + (Math.random() * base) / 2);
    };

    async function connect() {
      // Any authenticated call refreshes an expired access token (the
      // socket authenticates with that cookie), and gives us the unread
      // count we may have missed while disconnected.
      try {
        const { unread } = await api<{ unread: number }>(
          '/notifications/unread-count',
        );
        emit({ type: 'notification', unread });
      } catch {
        return retry(); // logged out or API down: try again later
      }
      if (stopped) return;
      ws = new WebSocket(WS_URL);
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (message) =>
        emit(JSON.parse(String(message.data)) as RealtimeEvent);
      ws.onclose = retry;
    }

    void connect();
    return () => {
      stopped = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [listening > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stable across renders: listeners re-subscribe only when it changes, and
  // a new function every render would loop (subscribe -> state -> render).
  const subscribe = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    setListening((n) => n + 1);
    return () => {
      listeners.current.delete(fn);
      setListening((n) => n - 1);
    };
  }, []);

  return (
    <RealtimeContext.Provider value={subscribe}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime(listener: Listener) {
  const subscribe = useContext(RealtimeContext);
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => subscribe?.((event) => latest.current(event)), [subscribe]);
}

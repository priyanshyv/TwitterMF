import { cookies } from 'next/headers';
import { ACCESS_COOKIE, SERVER_API_URL } from './config';
import type {
  FeedItem,
  HealthReport,
  NotificationItem,
  Page,
  Profile,
  SearchResponse,
  Suggestion,
  Thread,
  Trend,
  User,
} from './types';

// Server-side calls (server components). The browser's cookies are
// forwarded, so the API sees the same logged-in user.
async function get<T>(path: string): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  let res: Response;
  try {
    res = await fetch(`${SERVER_API_URL}${path}`, {
      headers: { cookie: cookieHeader },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    // Down, restarting, or too slow: one clear line instead of a stack of
    // ECONNREFUSED errors. app/error.tsx shows the visitor a retry button.
    throw new Error(`API unreachable at ${SERVER_API_URL} (GET ${path})`);
  }
  // 401: not logged in. 400/404: no such user (or a name that can't exist).
  if ([400, 401, 404].includes(res.status)) return null;
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export async function getMe(): Promise<User | null> {
  // No access token means logged out (proxy.ts already swapped an expiring
  // one for a fresh one), so skip a request that can only answer 401.
  if (!(await cookies()).has(ACCESS_COOKIE)) return null;
  return (await get<{ user: User }>('/auth/me'))?.user ?? null;
}

export function getTimeline(): Promise<Page<FeedItem> | null> {
  return get<Page<FeedItem>>('/timeline');
}

export function getThread(id: string): Promise<Thread | null> {
  return get<Thread>(`/tweets/${encodeURIComponent(id)}`);
}

export function getReplies(id: string): Promise<Page<FeedItem> | null> {
  return get<Page<FeedItem>>(`/tweets/${encodeURIComponent(id)}/replies`);
}

export function getProfile(username: string): Promise<Profile | null> {
  return get<Profile>(`/users/${encodeURIComponent(username)}`);
}

export type ProfileTab = 'posts' | 'replies' | 'media' | 'likes';

export function userTweetsPath(username: string, tab: ProfileTab) {
  return `/users/${encodeURIComponent(username)}/tweets?tab=${tab}`;
}

export function getUserTweets(
  username: string,
  tab: ProfileTab = 'posts',
): Promise<Page<FeedItem> | null> {
  return get<Page<FeedItem>>(userTweetsPath(username, tab));
}

export function getNotifications(): Promise<Page<NotificationItem> | null> {
  return get<Page<NotificationItem>>('/notifications');
}

export async function getUnreadCount(): Promise<number> {
  return (
    (await get<{ unread: number }>('/notifications/unread-count'))?.unread ?? 0
  );
}

export function search(
  q: string,
  type: 'tweets' | 'users',
): Promise<SearchResponse | null> {
  return get<SearchResponse>(`/search?q=${encodeURIComponent(q)}&type=${type}`);
}

export async function getTrends(): Promise<Trend[]> {
  return (await get<{ trends: Trend[] }>('/trends'))?.trends ?? [];
}

export async function getSuggestions(): Promise<Suggestion[]> {
  return (await get<Suggestion[]>('/users/suggestions')) ?? [];
}

// Returns null when the API itself can't be reached. A degraded API still
// answers (with 503), so its report is returned either way.
export async function getHealth(): Promise<HealthReport | null> {
  try {
    const res = await fetch(`${SERVER_API_URL}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return (await res.json()) as HealthReport;
  } catch {
    return null;
  }
}

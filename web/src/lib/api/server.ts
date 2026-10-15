import { cookies } from 'next/headers';
import { SERVER_API_URL } from './config';
import type {
  HealthReport,
  Page,
  Profile,
  Suggestion,
  Tweet,
  User,
} from './types';

// Server-side calls (server components). The browser's cookies are
// forwarded, so the API sees the same logged-in user.
async function get<T>(path: string): Promise<T | null> {
  const cookieHeader = (await cookies()).toString();
  const res = await fetch(`${SERVER_API_URL}${path}`, {
    headers: { cookie: cookieHeader },
    signal: AbortSignal.timeout(3_000),
  });
  // 401: not logged in. 400/404: no such user (or a name that can't exist).
  if ([400, 401, 404].includes(res.status)) return null;
  if (!res.ok) throw new Error(`API ${path} failed with ${res.status}`);
  return (await res.json()) as T;
}

export async function getMe(): Promise<User | null> {
  return (await get<{ user: User }>('/auth/me'))?.user ?? null;
}

export function getTimeline(): Promise<Page<Tweet> | null> {
  return get<Page<Tweet>>('/timeline');
}

export function getProfile(username: string): Promise<Profile | null> {
  return get<Profile>(`/users/${encodeURIComponent(username)}`);
}

export function getUserTweets(username: string): Promise<Page<Tweet> | null> {
  return get<Page<Tweet>>(`/users/${encodeURIComponent(username)}/tweets`);
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

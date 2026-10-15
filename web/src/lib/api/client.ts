'use client';

import { PUBLIC_API_URL } from './config';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

// One refresh at a time: if five requests hit a 401 together, they all wait
// for the same refresh instead of racing five rotations of one token.
let refreshing: Promise<boolean> | null = null;
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${PUBLIC_API_URL}/auth/refresh`, {
    method: 'POST',
    credentials: 'include',
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

// Browser-side calls (forms, buttons). Cookies ride along via
// `credentials: 'include'`. An expired access token is refreshed once and
// the request retried, so a tab left open for an hour still works.
export async function api<T = void>(
  path: string,
  init: { method?: string; body?: unknown } = {},
  retry = true,
): Promise<T> {
  const res = await fetch(`${PUBLIC_API_URL}${path}`, {
    method: init.method ?? 'GET',
    credentials: 'include',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refreshSession()) return api<T>(path, init, false);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : (body.message ?? `Request failed (${res.status})`);
    throw new ApiError(res.status, message, body.issues);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

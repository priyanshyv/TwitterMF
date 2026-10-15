import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  SERVER_API_URL,
} from './lib/api/config';

// Runs before every page request. The access token lives 15 minutes; when it
// is missing or about to expire but a refresh token exists, swap it here, so
// server components render as the logged-in user instead of bouncing them.
export async function proxy(request: NextRequest) {
  const access = request.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!refresh || (access && !expiresWithin(access, 30))) return;

  let res: Response;
  try {
    res = await fetch(`${SERVER_API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { cookie: `${REFRESH_COOKIE}=${refresh}` },
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    return; // API unreachable: render as-is rather than block the page
  }

  // Hand the new cookies to this request (so the page renders with them)
  // and to the browser (so the next request has them).
  const setCookies = res.headers.getSetCookie();
  for (const header of setCookies) {
    const [pair] = header.split(';');
    const eq = pair.indexOf('=');
    const name = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value) request.cookies.set(name, value);
    else request.cookies.delete(name);
  }
  const response = NextResponse.next({
    request: { headers: new Headers(request.headers) },
  });
  for (const header of setCookies)
    response.headers.append('set-cookie', header);
  return response;
}

// Reads the JWT's expiry without verifying it. That's safe here: this only
// decides whether to refresh early; the API still verifies every token.
function expiresWithin(jwt: string, seconds: number) {
  try {
    const payload = JSON.parse(
      atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')),
    );
    return payload.exp * 1000 - Date.now() < seconds * 1000;
  } catch {
    return true;
  }
}

export const config = {
  // Pages only: skip static files, images and anything with a file extension.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};

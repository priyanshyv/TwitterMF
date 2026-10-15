// The browser calls the API at its public URL. The Next.js server may reach
// it over a private network instead (e.g. http://api:4000 inside Docker).
export const PUBLIC_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export const SERVER_API_URL = process.env.API_INTERNAL_URL ?? PUBLIC_API_URL;

export const ACCESS_COOKIE = 'tmf_at';
export const REFRESH_COOKIE = 'tmf_rt';

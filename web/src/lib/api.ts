// Base URL of the NestJS API. NEXT_PUBLIC_ makes it available in the browser
// too, which client components will need from Phase 2 on.
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type DependencyStatus = 'up' | 'down';

export interface HealthReport {
  status: 'ok' | 'degraded';
  db: DependencyStatus;
  redis: DependencyStatus;
  uptimeSeconds: number;
}

// Returns null when the API itself can't be reached. A degraded API still
// answers (with 503), so its report is returned either way.
export async function getHealth(): Promise<HealthReport | null> {
  try {
    const res = await fetch(`${API_URL}/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return (await res.json()) as HealthReport;
  } catch {
    return null;
  }
}

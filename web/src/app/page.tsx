import { connection } from 'next/server';
import { Suspense } from 'react';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getHealth, type DependencyStatus } from '@/lib/api';

const SERVICES = [
  { key: 'api', name: 'API', detail: 'NestJS on port 4000' },
  { key: 'db', name: 'Postgres', detail: 'Tweets, users, follows' },
  { key: 'redis', name: 'Redis', detail: 'Cache, counters, queues' },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-4 py-12">
      <section className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          A Twitter clone, built one concept at a time.
        </h1>
        <p className="text-muted-foreground">
          Phase 1 is done: the stack runs end to end. Sign-up and tweets arrive
          in Phase 2.
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>System status</CardTitle>
          <CardDescription>Checked live on every page load.</CardDescription>
        </CardHeader>
        <Suspense fallback={<StatusSkeleton />}>
          <Status />
        </Suspense>
      </Card>
    </main>
  );
}

async function Status() {
  // Health must be checked on every request, never baked in at build time.
  await connection();
  const health = await getHealth();

  const states: Record<(typeof SERVICES)[number]['key'], DependencyStatus> = {
    api: health ? 'up' : 'down',
    db: health?.db ?? 'down',
    redis: health?.redis ?? 'down',
  };

  return (
    <>
      <CardContent>
        <ul className="divide-y">
          {SERVICES.map((service) => (
            <li
              key={service.key}
              className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="font-medium">{service.name}</p>
                <p className="text-sm text-muted-foreground">
                  {service.detail}
                </p>
              </div>
              <StatusBadge status={states[service.key]} />
            </li>
          ))}
        </ul>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        {health ? (
          <>API uptime {formatUptime(health.uptimeSeconds)}</>
        ) : (
          <>
            Can&apos;t reach the API. Is{' '}
            <code className="mx-1 font-mono text-foreground">npm run dev</code>{' '}
            running?
          </>
        )}
      </CardFooter>
    </>
  );
}

function StatusBadge({ status }: { status: DependencyStatus }) {
  if (status === 'up') {
    return (
      <Badge
        variant="outline"
        className="gap-1.5 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
      >
        <span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />
        Up
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1.5">
      <span className="size-1.5 rounded-full bg-destructive" aria-hidden />
      Down
    </Badge>
  );
}

function StatusSkeleton() {
  return (
    <CardContent className="flex flex-col gap-5">
      {SERVICES.map((service) => (
        <div key={service.key} className="flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-36" />
          </div>
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
      ))}
    </CardContent>
  );
}

function formatUptime(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

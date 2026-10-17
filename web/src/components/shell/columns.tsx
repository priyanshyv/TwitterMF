import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';
import { SearchBox } from '@/components/search-box';
import { Trends } from '@/components/trends';
import { Skeleton } from '@/components/ui/skeleton';
import { WhoToFollow } from '@/components/who-to-follow';

// The page body: a 600px timeline column with borders down both sides,
// and on wide screens a right rail (search box stuck to the top, then
// trends and suggestions scrolling with the page).
export function Columns({
  children,
  aside = true,
  search = true,
  trends = true,
}: {
  children: React.ReactNode;
  aside?: boolean;
  search?: boolean;
  trends?: boolean;
}) {
  return (
    <div className="flex justify-center gap-8 lg:justify-start">
      <main className="min-h-svh w-full max-w-[600px] min-w-0 md:border-x">
        {children}
      </main>
      {aside && (
        <aside className="hidden w-[330px] shrink-0 lg:block">
          {search && (
            <div className="sticky top-0 z-10 bg-background py-2">
              <SearchBox />
            </div>
          )}
          <div className="flex flex-col gap-4 py-3">
            {trends && (
              <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
                <Trends />
              </Suspense>
            )}
            <Suspense fallback={<Skeleton className="h-72 rounded-2xl" />}>
              <WhoToFollow />
            </Suspense>
            <p className="px-4 text-xs leading-relaxed text-muted-foreground">
              TwitterMF · built to learn system design ·{' '}
              <Link href="/status" className="hover:underline">
                System status
              </Link>
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}

// A see-through header that sticks to the top of the column.
export function PageHeader({
  title,
  subtitle,
  back,
}: {
  title: string;
  subtitle?: string;
  // Where the back arrow goes; no arrow when omitted.
  back?: string;
}) {
  return (
    <div className="sticky top-0 z-10 flex h-14 items-center gap-6 border-b bg-background/80 px-4 backdrop-blur-md">
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="-ml-2 rounded-full p-2 transition-colors hover:bg-muted"
        >
          <ArrowLeft className="size-5" />
        </Link>
      )}
      <div className="min-w-0 leading-tight">
        <h1 className="truncate text-xl font-bold">{title}</h1>
        {subtitle && (
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

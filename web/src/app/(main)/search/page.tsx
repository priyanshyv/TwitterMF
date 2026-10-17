import { TriangleAlert } from 'lucide-react';
import { Suspense } from 'react';
import { SearchBox } from '@/components/search-box';
import { SearchResults } from '@/components/search-results';
import { Columns } from '@/components/shell/columns';
import { Trends } from '@/components/trends';
import { Tab, Tabs } from '@/components/shell/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { search } from '@/lib/api/server';

export default function SearchPage({ searchParams }: PageProps<'/search'>) {
  return (
    <Columns search={false} trends={false}>
      <Suspense fallback={<Skeleton className="m-4 h-11 rounded-full" />}>
        <SearchContent searchParams={searchParams} />
      </Suspense>
    </Columns>
  );
}

async function SearchContent({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = typeof params.q === 'string' ? params.q.trim() : '';
  const type = params.type === 'users' ? 'users' : 'tweets';

  return (
    <>
      <div className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur-md">
        <div className="px-4 py-2">
          {/* key: a new query (e.g. a clicked hashtag) resets the box */}
          <SearchBox key={q} initial={q} autoFocus={!q} />
        </div>
        {q && (
          <Tabs label="Result type">
            <Tab
              href={`/search?q=${encodeURIComponent(q)}`}
              active={type === 'tweets'}
            >
              Top
            </Tab>
            <Tab
              href={`/search?q=${encodeURIComponent(q)}&type=users`}
              active={type === 'users'}
            >
              People
            </Tab>
          </Tabs>
        )}
      </div>
      {q ? (
        <Suspense
          key={`${q}:${type}`}
          fallback={<Skeleton className="m-4 h-40" />}
        >
          <Results q={q} type={type} />
        </Suspense>
      ) : (
        <div className="p-4">
          <Suspense fallback={<Skeleton className="h-64 rounded-2xl" />}>
            <Trends title="What's happening" />
          </Suspense>
        </div>
      )}
    </>
  );
}

async function Results({ q, type }: { q: string; type: 'tweets' | 'users' }) {
  const res = await search(q, type);
  if (!res)
    return (
      <p className="p-8 text-center text-muted-foreground">
        Search failed. Try again.
      </p>
    );
  return (
    <>
      {res.source === 'postgres' && (
        <p className="flex items-start gap-2 border-b bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          Search is running in basic mode right now: exact matches only, no typo
          tolerance. Results are still real.
        </p>
      )}
      <SearchResults key={`${q}:${type}`} q={q} type={type} initial={res} />
    </>
  );
}

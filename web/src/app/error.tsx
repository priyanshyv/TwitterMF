'use client'; // error boundaries must be client components

import { Button } from '@/components/ui/button';

// Shown when a page fails to render, most often because the API is down or
// restarting. Retrying re-renders the page on the server.
export default function ErrorPage({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <main className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        The page couldn&apos;t load. If the server is restarting, it should be
        back in a few seconds.
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}

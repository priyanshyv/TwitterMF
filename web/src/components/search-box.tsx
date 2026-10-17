'use client';

import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SearchBox({
  initial = '',
  autoFocus,
}: {
  initial?: string;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState(initial);
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (q.trim()) router.push(`/search?q=${encodeURIComponent(q.trim())}`);
      }}
      className="group flex h-11 items-center gap-3 rounded-full border border-transparent bg-muted px-4 focus-within:border-sky-500 focus-within:bg-background"
    >
      <Search className="size-4 text-muted-foreground group-focus-within:text-sky-500" />
      <input
        id="search"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        aria-label="Search posts and people"
        autoFocus={autoFocus}
        maxLength={100}
        className="w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
      />
    </form>
  );
}

import Link from 'next/link';
import { getTrends } from '@/lib/api/server';

// Hashtags used most in the last 24 hours, recent uses weighted more.
export async function Trends({ title = 'Trends' }: { title?: string }) {
  const trends = await getTrends().catch(() => []);
  return (
    <section className="overflow-hidden rounded-2xl border">
      <h2 className="px-4 pt-3 pb-2 text-xl font-extrabold">{title}</h2>
      {trends.length === 0 ? (
        <p className="px-4 pb-4 text-[15px] text-muted-foreground">
          Nothing trending in the last 24 hours. Post with a #hashtag to start
          something.
        </p>
      ) : (
        <ol>
          {trends.map((t, i) => (
            <li key={t.tag}>
              <Link
                href={`/search?q=${encodeURIComponent(`#${t.tag}`)}`}
                className="block px-4 py-2.5 transition-colors hover:bg-muted/40"
              >
                <p className="text-[13px] text-muted-foreground">
                  {i + 1} · Trending
                </p>
                <p className="font-bold">#{t.tag}</p>
                <p className="text-[13px] text-muted-foreground">
                  {t.posts.toLocaleString('en')} post{t.posts === 1 ? '' : 's'}
                </p>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

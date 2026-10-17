import { Feather, Layers, Radio, Search } from 'lucide-react';
import Link from 'next/link';
import { ThemeToggle } from '@/components/theme-toggle';

const POINTS = [
  { icon: Layers, text: 'Timelines precomputed in Redis' },
  { icon: Radio, text: 'Live notifications over WebSockets' },
  { icon: Search, text: 'Typo-tolerant search that survives outages' },
];

// Log in and sign up: no app navigation, just the brand and the form.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-sky-500 via-sky-600 to-violet-700 text-white lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold"
          aria-label="TwitterMF home"
        >
          <Feather className="size-8" strokeWidth={2.25} /> TwitterMF
        </Link>
        <div className="relative z-10 max-w-md">
          <h2 className="text-5xl leading-tight font-extrabold text-balance">
            Built one system-design idea at a time.
          </h2>
          <ul className="mt-8 flex flex-col gap-4 text-lg text-white/90">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="rounded-full bg-white/15 p-2">
                  <Icon className="size-5" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-white/70">
          Free and open source, from an empty repo to scale.
        </p>
        {/* A big, faint feather in the corner. */}
        <Feather
          className="pointer-events-none absolute -right-24 -bottom-24 size-[28rem] text-white/10"
          strokeWidth={1}
        />
      </aside>
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4">
          <Link href="/" className="lg:invisible" aria-label="TwitterMF home">
            <Feather className="size-8 text-sky-500" strokeWidth={2.25} />
          </Link>
          <ThemeToggle />
        </div>
        <div className="flex flex-1 items-center justify-center px-6 pb-16">
          <div className="w-full max-w-sm">{children}</div>
        </div>
      </main>
    </div>
  );
}

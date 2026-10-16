import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { RealtimeProvider } from '@/components/realtime-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { ThemeToggle } from '@/components/theme-toggle';
import { Toaster } from '@/components/ui/sonner';
import { UserNav } from '@/components/user-nav';
import Link from 'next/link';
import { Suspense } from 'react';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'TwitterMF',
  description: 'A scalable Twitter clone built on free tools',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // next-themes sets the `dark` class before React hydrates, so the
    // attribute legitimately differs between server and client.
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-svh antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <RealtimeProvider>
            <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur">
              <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
                <Link href="/" className="text-lg font-semibold tracking-tight">
                  TwitterMF
                </Link>
                <div className="flex items-center gap-1">
                  {/* Reads cookies, so it renders per request; the rest of the
                    header is static and ships instantly. */}
                  <Suspense>
                    <UserNav />
                  </Suspense>
                  <ThemeToggle />
                </div>
              </div>
            </header>
            {children}
          </RealtimeProvider>
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}

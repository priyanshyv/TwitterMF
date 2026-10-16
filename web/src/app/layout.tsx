import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { RealtimeProvider } from '@/components/realtime-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { MobileNav, SideNav } from '@/components/shell/navigation';
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
            <div className="mx-auto flex min-h-svh max-w-[1280px] justify-center pb-16 md:pb-0">
              {/* The navigation reads cookies, so it renders per request
                  inside Suspense; the page shell ships instantly. */}
              <Suspense
                fallback={<div className="hidden w-[72px] md:block xl:w-64" />}
              >
                <SideNav />
              </Suspense>
              <div className="min-w-0 flex-1 md:px-4">
                <Suspense fallback={<div className="h-14 md:hidden" />}>
                  <MobileNav />
                </Suspense>
                {children}
              </div>
            </div>
          </RealtimeProvider>
          <Toaster position="bottom-center" />
        </ThemeProvider>
      </body>
    </html>
  );
}

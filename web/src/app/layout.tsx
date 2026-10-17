import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { RealtimeProvider } from '@/components/realtime-provider';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
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
          <RealtimeProvider>{children}</RealtimeProvider>
          {/* Above the phone tab bar (64px) on small screens. */}
          <Toaster position="bottom-center" mobileOffset={{ bottom: 80 }} />
        </ThemeProvider>
      </body>
    </html>
  );
}

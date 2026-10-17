import { Suspense } from 'react';
import { MobileNav, SideNav } from '@/components/shell/navigation';

// The app shell: sidebar on desktop, top bar + tab bar on phones.
export default function MainLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="mx-auto flex min-h-svh max-w-[1280px] justify-center pb-16 md:pb-0">
      {/* The navigation reads cookies, so it renders per request inside
          Suspense; the page shell ships instantly. */}
      <Suspense fallback={<div className="hidden w-[72px] md:block xl:w-64" />}>
        <SideNav />
      </Suspense>
      <div className="min-w-0 flex-1 md:px-4">
        <Suspense fallback={<div className="h-14 md:hidden" />}>
          <MobileNav />
        </Suspense>
        {children}
      </div>
    </div>
  );
}

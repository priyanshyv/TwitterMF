import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { NotificationList } from '@/components/notification-list';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { getNotifications } from '@/lib/api/server';

export default function NotificationsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      <main className="rounded-xl border">
        <h1 className="px-4 py-3 text-lg font-semibold">Notifications</h1>
        <Separator />
        <Suspense fallback={<Skeleton className="m-4 h-40" />}>
          <Notifications />
        </Suspense>
      </main>
    </div>
  );
}

async function Notifications() {
  const page = await getNotifications();
  if (!page) redirect('/login');
  return (
    <NotificationList key={page.items[0]?.id ?? 'empty'} initialPage={page} />
  );
}

import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { NotificationList } from '@/components/notification-list';
import { Columns, PageHeader } from '@/components/shell/columns';
import { Skeleton } from '@/components/ui/skeleton';
import { getNotifications } from '@/lib/api/server';

export default function NotificationsPage() {
  return (
    <Columns>
      <PageHeader title="Notifications" />
      <Suspense fallback={<Skeleton className="m-4 h-40" />}>
        <Notifications />
      </Suspense>
    </Columns>
  );
}

async function Notifications() {
  const page = await getNotifications();
  if (!page) redirect('/login');
  return (
    <NotificationList key={page.items[0]?.id ?? 'empty'} initialPage={page} />
  );
}

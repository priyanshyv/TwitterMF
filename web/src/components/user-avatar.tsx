import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';

export function UserAvatar({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <Avatar className={cn('size-10', className)}>
      <AvatarFallback className="font-medium">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

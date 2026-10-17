import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon?: LucideIcon;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-2 px-8 py-16 text-center">
      {Icon && (
        <div className="mb-2 rounded-full bg-muted p-4 text-muted-foreground">
          <Icon className="size-6" />
        </div>
      )}
      <p className="text-xl font-extrabold">{title}</p>
      {children && (
        <p className="text-[15px] text-muted-foreground">{children}</p>
      )}
    </div>
  );
}

import { cn } from '@/lib/utils';

export function PageHeader({
  title,
  description,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b bg-background px-6 py-2',
        className,
      )}
    >
      {/* the title keeps a readable width; when space runs out the controls wrap below it */}
      <div className="min-w-48 flex-1">
        <h1 className="truncate text-sm font-semibold">{title}</h1>
        {description && <p className="truncate text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">{children}</div>
    </header>
  );
}

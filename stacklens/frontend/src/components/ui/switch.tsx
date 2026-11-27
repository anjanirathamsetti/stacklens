'use client';
import { cn } from '@/lib/utils';

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors cursor-pointer',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-input dark:bg-muted',
        className,
      )}
    >
      <span
        className={cn(
          'pointer-events-none block size-4 rounded-full shadow-sm ring-0 transition-transform',
          // the thumb contrasts with the track: page colour on the accent, white when off
          checked ? 'translate-x-4 bg-background' : 'translate-x-0.5 bg-white',
        )}
      />
    </button>
  );
}

import { cn } from '@/lib/utils';

/** Coral accent of the StackLens mark (the focused call). */
export const BRAND_ACCENT = '#ff5a46';

/**
 * StackLens symbol: viewfinder brackets (the lens) around three indented call bars (the
 * waterfall); the coral bar is the call in focus. Drawn on a 32-unit grid so the bars land on
 * whole pixels at 16px. Brackets and bars follow `currentColor`, so it adapts to light/dark.
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path d="M4.5 11V4.5H11M21 4.5H27.5V11M27.5 21V27.5H21M11 27.5H4.5V21" stroke="currentColor" strokeWidth="3" fill="none" />
      <rect x="8" y="8" width="10" height="4" fill="currentColor" />
      <rect x="11" y="14" width="12" height="4" fill={BRAND_ACCENT} />
      <rect x="14" y="20" width="10" height="4" fill="currentColor" />
    </svg>
  );
}

/** The "StackLens" wordmark in Outfit 500 with tight tracking (font loaded in the root layout). */
export function Wordmark({ className }: { className?: string }) {
  return <span className={cn('font-brand font-medium tracking-[-0.035em]', className)}>StackLens</span>;
}

/** Symbol + wordmark lockup. */
export function Logo({
  className,
  markClassName,
  wordmarkClassName,
}: {
  className?: string;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark className={cn('size-7', markClassName)} />
      <Wordmark className={wordmarkClassName} />
    </span>
  );
}

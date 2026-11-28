'use client';
import { cn } from '@/lib/utils';

/**
 * Trace id as a link to the trace in StackLens. The PDF keeps it clickable (absolute URL, so it
 * works from a saved file), which replaces printing call trees: those are too big for paper.
 * The link carries only the id – no time filters that could hide the trace.
 */
export function TraceLink({ id, children, className }: { id: string; children?: React.ReactNode; className?: string }) {
  const href = `${typeof window === 'undefined' ? '' : window.location.origin}/traces/${encodeURIComponent(id)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={cn('break-all font-mono text-brand underline decoration-brand/40 underline-offset-2', className)}
    >
      {children ?? id}
    </a>
  );
}

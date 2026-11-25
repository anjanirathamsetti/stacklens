import { Boxes } from 'lucide-react';
import { cn, KIND_META, METHOD_COLORS, statusTone } from '@/lib/utils';
import type { SpanKind } from '@/lib/api-types';

export function MethodBadge({ method, className }: { method: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex w-[52px] shrink-0 justify-center rounded-md border px-1.5 py-0.5 font-mono text-[10.5px] font-semibold tracking-wide',
        METHOD_COLORS[method] ?? 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {method}
    </span>
  );
}

export function StatusCodeBadge({ code }: { code: number }) {
  const tone = statusTone(code);
  const cls =
    tone === 'success'
      ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/25 dark:text-emerald-300'
      : tone === 'warning'
        ? 'bg-amber-500/10 text-amber-700 border-amber-500/30 dark:text-amber-300'
        : tone === 'error'
          ? 'bg-rose-500/10 text-rose-700 border-rose-500/25 dark:text-rose-300'
          : 'bg-muted text-muted-foreground border-border';
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 font-mono text-[11px] font-medium', cls)}>
      <span className="size-1.5 rounded-full bg-current opacity-80" />
      {code}
    </span>
  );
}

/** Outcome pill used in headers ("success" / "client error" / "error"). */
export function OutcomeBadge({ code, failed }: { code?: number; failed?: boolean }) {
  const tone = failed && !code ? 'error' : statusTone(code);
  const label = tone === 'success' ? 'success' : tone === 'warning' ? 'client error' : tone === 'error' ? 'error' : 'ok';
  const cls =
    tone === 'success' || tone === 'neutral'
      ? 'bg-emerald-500/12 text-emerald-700 border-emerald-500/30 dark:text-emerald-300'
      : tone === 'warning'
        ? 'bg-amber-500/12 text-amber-700 border-amber-500/30 dark:text-amber-300'
        : 'bg-rose-500/12 text-rose-700 border-rose-500/30 dark:text-rose-300';
  return <span className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', cls)}>{label}</span>;
}

/** Application chip – like a provider badge: icon + uppercase mono name. */
export function AppBadge({ name, className }: { name: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/50 px-1.5 py-0.5 font-mono text-[10.5px] font-medium uppercase tracking-wide text-foreground/80',
        className,
      )}
    >
      <Boxes className="size-3 shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </span>
  );
}

export function KindBadge({ kind, className }: { kind: SpanKind; className?: string }) {
  const m = KIND_META[kind] ?? KIND_META.function;
  return (
    <span className={cn('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium', m.soft, m.text, className)}>
      <span className={cn('size-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  );
}

export function KindLegend() {
  const kinds: SpanKind[] = ['controller', 'handler', 'service', 'repository', 'db', 'function'];
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {kinds.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={cn('size-2 rounded-sm', KIND_META[k].dot)} />
          {KIND_META[k].label}
        </span>
      ))}
    </div>
  );
}

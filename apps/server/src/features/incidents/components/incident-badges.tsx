import { Siren } from 'lucide-react';
import { cn } from '@/lib/utils';

export function stateTone(code: number) {
  if (code === 1) return 'bg-sky-500/10 text-sky-700 dark:text-sky-300';
  if (code === 2) return 'bg-violet-500/10 text-violet-700 dark:text-violet-300';
  if (code === 3) return 'bg-amber-500/10 text-amber-700 dark:text-amber-300';
  if (code === 6 || code === 7) return 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
  return 'bg-muted text-muted-foreground';
}

export function StateBadge({ code, label, className }: { code: number; label: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        stateTone(code),
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {label}
    </span>
  );
}

export function PriorityBadge({ code, label }: { code: number; label?: string }) {
  const tone =
    code === 1
      ? 'border-rose-400/40 text-rose-600 dark:text-rose-300'
      : code === 2
        ? 'border-orange-400/40 text-orange-600 dark:text-orange-300'
        : code === 3
          ? 'border-amber-400/40 text-amber-700 dark:text-amber-300'
          : 'text-muted-foreground';
  return (
    <span
      className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11px] whitespace-nowrap', tone)}
      title={label}
    >
      P{code}
      {label && <span className="font-sans text-[10px] opacity-80">{label.replace(/^\d+\s*-\s*/, '')}</span>}
    </span>
  );
}

export function IncidentChip({ number, stateCode, state }: { number: string; stateCode: number; state: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] font-medium', stateTone(stateCode))}
      title={`${number} · ${state}`}
    >
      <Siren className="size-3" />
      <span className="font-mono">{number}</span>
    </span>
  );
}

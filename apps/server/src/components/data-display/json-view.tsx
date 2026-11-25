'use client';
import { useState } from 'react';
import { ChevronRight, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

type Json = unknown;

function isMarker(v: any): v is { $t: string; [k: string]: any } {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.$t === 'string';
}

/** Convert serialized trace values back to plain JSON for copy-paste. */
export function toPlain(v: Json): Json {
  if (Array.isArray(v)) return v.filter((x) => !(isMarker(x) && x.$t === 'more')).map(toPlain);
  if (isMarker(v)) {
    switch (v.$t) {
      case 'undefined':
        return undefined;
      case 'Date':
        return v.v;
      case 'Error':
        return { name: v.name, message: v.message };
      case 'Map':
        return Object.fromEntries((v.entries ?? []).map(([k, val]: any) => [String(k), toPlain(val)]));
      case 'Set':
        return (v.values ?? []).map(toPlain);
      default:
        return `[${v.name ?? v.$t}]`;
    }
  }
  if (v && typeof v === 'object') {
    const out: Record<string, Json> = {};
    for (const [k, val] of Object.entries(v)) if (k !== '$class') out[k] = toPlain(val);
    return out;
  }
  return v;
}

function Primitive({ v }: { v: Json }) {
  if (v === null) return <span className="text-muted-foreground">null</span>;
  if (typeof v === 'string') {
    if (v === '[REDACTED]') return <span className="rounded bg-warning/15 px-1 text-warning">REDACTED</span>;
    return <span className="text-emerald-600 dark:text-emerald-400 break-all">&quot;{v}&quot;</span>;
  }
  if (typeof v === 'number') return <span className="text-sky-600 dark:text-sky-400">{v}</span>;
  if (typeof v === 'boolean') return <span className="text-violet-600 dark:text-violet-400">{String(v)}</span>;
  return <span>{String(v)}</span>;
}

function MarkerView({ v }: { v: { $t: string; [k: string]: any } }) {
  const chip = 'rounded bg-muted px-1 text-muted-foreground';
  switch (v.$t) {
    case 'undefined':
      return <span className="text-muted-foreground italic">undefined</span>;
    case 'fn':
      return <span className={chip}>ƒ {v.name}()</span>;
    case 'circular':
      return <span className={chip}>[Circular]</span>;
    case 'Date':
      return (
        <span>
          <span className="text-amber-600 dark:text-amber-400">{v.v}</span> <span className={chip}>Date</span>
        </span>
      );
    case 'Buffer':
      return <span className={chip}>Buffer({v.length})</span>;
    case 'Promise':
      return <span className={chip}>Promise</span>;
    case 'more':
      return <span className="text-muted-foreground italic">… {v.count} more</span>;
    case 'ref':
      return (
        <span className={chip}>
          {v.name}
          {v.summary ? ` · ${v.summary}` : ''}
        </span>
      );
    case 'Error':
      return (
        <span className="text-destructive">
          {v.name}: {v.message}
        </span>
      );
    default:
      return <span className={chip}>{v.$t}</span>;
  }
}

function Node({ k, v, depth, defaultOpen }: { k?: string | number; v: Json; depth: number; defaultOpen: number }) {
  const isObj = v !== null && typeof v === 'object' && !isMarker(v);
  const isMapOrSet = isMarker(v) && (v.$t === 'Map' || v.$t === 'Set');
  const [open, setOpen] = useState(depth < defaultOpen);

  const keyEl =
    k !== undefined ? (
      <span className="text-foreground/80">
        {typeof k === 'number' ? <span className="text-muted-foreground">{k}</span> : k}
        <span className="text-muted-foreground">: </span>
      </span>
    ) : null;

  if (!isObj && !isMapOrSet) {
    return (
      <div className="pl-4 leading-5">
        {keyEl}
        {isMarker(v) ? <MarkerView v={v} /> : <Primitive v={v} />}
      </div>
    );
  }

  let entries: [string | number, Json][];
  let label: string;
  let brackets: [string, string];
  if (isMapOrSet) {
    const m = v as any;
    entries =
      m.$t === 'Map'
        ? (m.entries ?? []).map(([kk, vv]: any, i: number) => [typeof kk === 'string' ? kk : i, vv])
        : (m.values ?? []).map((vv: any, i: number) => [i, vv]);
    label = `${m.$t}(${m.size})`;
    brackets = ['{', '}'];
  } else if (Array.isArray(v)) {
    entries = v.map((x, i) => [i, x]);
    label = `Array(${v.length})`;
    brackets = ['[', ']'];
  } else {
    const o = v as Record<string, Json>;
    entries = Object.entries(o).filter(([kk]) => kk !== '$class');
    label = (o.$class as string) ?? '';
    brackets = ['{', '}'];
  }

  return (
    <div className={depth > 0 ? 'pl-4' : ''}>
      <button onClick={() => setOpen((x) => !x)} className="group -ml-4 flex items-center leading-5 cursor-pointer text-left">
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="ml-0.5">
          {keyEl}
          {label && <span className="mr-1 text-sky-700 dark:text-sky-300">{label}</span>}
          <span className="text-muted-foreground">{brackets[0]}</span>
          {!open && (
            <span className="text-muted-foreground">
              {' '}
              {entries.length} {entries.length === 1 ? 'item' : 'items'} {brackets[1]}
            </span>
          )}
        </span>
      </button>
      {open && (
        <>
          <div className="border-l border-border/70 ml-[-9px] pl-[9px]">
            {entries.map(([kk, vv]) => (
              <Node key={String(kk)} k={kk} v={vv} depth={depth + 1} defaultOpen={defaultOpen} />
            ))}
          </div>
          <div className="leading-5 text-muted-foreground">{brackets[1]}</div>
        </>
      )}
    </div>
  );
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className={cn(
        'grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer',
        className,
      )}
      aria-label="Copy"
    >
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function JsonView({ value, defaultOpen = 2, className }: { value: Json; defaultOpen?: number; className?: string }) {
  return (
    <div className={cn('relative font-mono text-xs', className)}>
      <div className="pl-4">
        <Node v={value} depth={0} defaultOpen={defaultOpen} />
      </div>
    </div>
  );
}

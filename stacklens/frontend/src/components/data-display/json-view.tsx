'use client';
import { useState } from 'react';
import { looksLikeSql } from '@stacklens/shared/sql-format';
import { InlineSql } from '@/components/data-display/sql-view';
import { ChevronRight, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/lib/language-context';

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

/* ------------------------------ search ------------------------------ */

/** Text a leaf value is searched by (strings, numbers, dates, error messages…). */
function leafText(v: Json): string {
  if (v === null) return 'null';
  if (typeof v !== 'object') return String(v);
  if (isMarker(v)) return [v.v, v.name, v.message, v.summary, v.$t].filter((x) => x !== undefined).join(' ');
  return '';
}

/** Children of a container value as [key, value] pairs (same shape Node renders). */
function childrenOf(v: Json): [string | number, Json][] | undefined {
  if (v === null || typeof v !== 'object') return undefined;
  if (isMarker(v)) {
    const m = v as any;
    if (m.$t === 'Map') return (m.entries ?? []).map(([kk, vv]: any, i: number) => [typeof kk === 'string' ? kk : i, vv]);
    if (m.$t === 'Set') return (m.values ?? []).map((vv: any, i: number) => [i, vv]);
    return undefined;
  }
  if (Array.isArray(v)) return v.map((x, i) => [i, x]);
  return Object.entries(v as Record<string, Json>).filter(([kk]) => kk !== '$class');
}

const matchCache = new WeakMap<object, Map<string, boolean>>();

/** Does any key or value inside `v` contain `q` (lower-case)? Memoized per object and query. */
export function jsonMatches(v: Json, q: string): boolean {
  if (!q) return true;
  const kids = childrenOf(v);
  if (!kids) return leafText(v).toLowerCase().includes(q);
  const obj = v as object;
  let byQ = matchCache.get(obj);
  const hit = byQ?.get(q);
  if (hit !== undefined) return hit;
  const label = !Array.isArray(v) && !isMarker(v) ? String((v as Record<string, Json>).$class ?? '') : '';
  const result = label.toLowerCase().includes(q) || kids.some(([kk, vv]) => String(kk).toLowerCase().includes(q) || jsonMatches(vv, q));
  if (!byQ) matchCache.set(obj, (byQ = new Map()));
  byQ.set(q, result);
  return result;
}

/** Highlight occurrences of `q` in `text`. */
function Hl({ text, q }: { text: string; q?: string }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const parts: React.ReactNode[] = [];
  let from = 0;
  let at = lower.indexOf(q);
  if (at < 0) return <>{text}</>;
  while (at >= 0) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} className="rounded-sm bg-amber-300/60 px-px text-inherit dark:bg-amber-400/35">
        {text.slice(at, at + q.length)}
      </mark>,
    );
    from = at + q.length;
    at = lower.indexOf(q, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return <>{parts}</>;
}

function Primitive({ v, q }: { v: Json; q?: string }) {
  const py = useLanguage() === 'python';
  if (v === null) return <span className="text-muted-foreground">{py ? 'None' : 'null'}</span>;
  if (typeof v === 'string') {
    if (v === '[REDACTED]') return <span className="rounded bg-warning/15 px-1 text-warning">REDACTED</span>;
    if (looksLikeSql(v) && !q) return <InlineSql sql={v} />;
    return (
      <span className="text-emerald-600 dark:text-emerald-400 break-all">
        &quot;
        <Hl text={v} q={q} />
        &quot;
      </span>
    );
  }
  if (typeof v === 'number')
    return (
      <span className="text-sky-600 dark:text-sky-400">
        <Hl text={String(v)} q={q} />
      </span>
    );
  if (typeof v === 'boolean')
    return (
      <span className="text-violet-600 dark:text-violet-400">
        <Hl text={py ? (v ? 'True' : 'False') : String(v)} q={q} />
      </span>
    );
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

function Node({ k, v, depth, defaultOpen, q }: { k?: string | number; v: Json; depth: number; defaultOpen: number; q?: string }) {
  const py = useLanguage() === 'python';
  const isObj = v !== null && typeof v === 'object' && !isMarker(v);
  const isMapOrSet = isMarker(v) && (v.$t === 'Map' || v.$t === 'Set');
  const [manualOpen, setOpen] = useState(depth < defaultOpen);
  // while searching, matching branches are opened automatically
  const open = q ? true : manualOpen;
  const keyMatch = !!q && k !== undefined && String(k).toLowerCase().includes(q);

  const keyEl =
    k !== undefined ? (
      <span className="text-foreground/80">
        {typeof k === 'number' ? (
          <span className="text-muted-foreground">
            <Hl text={String(k)} q={q} />
          </span>
        ) : (
          <Hl text={k} q={q} />
        )}
        <span className="text-muted-foreground">: </span>
      </span>
    ) : null;

  if (!isObj && !isMapOrSet) {
    return (
      <div className="pl-4 leading-5">
        {keyEl}
        {isMarker(v) ? <MarkerView v={v} /> : <Primitive v={v} q={q} />}
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
    label = py ? `${m.$t === 'Map' ? 'dict' : 'set'}(${m.size})` : `${m.$t}(${m.size})`;
    brackets = ['{', '}'];
  } else if (Array.isArray(v)) {
    entries = v.map((x, i) => [i, x]);
    label = py ? `list(${v.length})` : `Array(${v.length})`;
    brackets = ['[', ']'];
  } else {
    const o = v as Record<string, Json>;
    entries = Object.entries(o).filter(([kk]) => kk !== '$class');
    label = (o.$class as string) ?? '';
    brackets = ['{', '}'];
  }

  // a matching key shows its whole value; otherwise only children that contain a match
  const childQ = keyMatch ? undefined : q;
  if (childQ) entries = entries.filter(([kk, vv]) => String(kk).toLowerCase().includes(childQ) || jsonMatches(vv, childQ));

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
              <Node key={String(kk)} k={kk} v={vv} depth={depth + 1} defaultOpen={defaultOpen} q={childQ} />
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

/**
 * Collapsible JSON tree. `filter` keeps only keys / values containing the text (case-insensitive),
 * opens the branches that hold them and highlights the matches.
 */
export function JsonView({
  value,
  defaultOpen = 2,
  className,
  filter,
}: {
  value: Json;
  defaultOpen?: number;
  className?: string;
  filter?: string;
}) {
  const q = filter?.trim().toLowerCase() || undefined;
  if (q && !jsonMatches(value, q)) return <div className={cn('text-xs text-muted-foreground', className)}>No fields match “{filter}”.</div>;
  return (
    <div className={cn('relative font-mono text-xs', className)}>
      <div className="pl-4">
        <Node v={value} depth={0} defaultOpen={defaultOpen} q={q} />
      </div>
    </div>
  );
}

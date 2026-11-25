'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronRight, MessageSquareText } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { cn, formatMs, KIND_META, SEVERITY, severityOf } from '@/lib/utils';
import { flatten, type SpanNode } from '@/lib/span-tree';
import type { SpanKind } from '@/lib/api-types';

export const KIND_SHORT: Record<SpanKind, string> = {
  http: 'HTTP',
  controller: 'CTRL',
  handler: 'HNDL',
  service: 'SVC',
  repository: 'REPO',
  db: 'SQL',
  function: 'FN',
  job: 'JOB',
};

const ROW_H = 36;
const INDENT = 18;
const GRID = 'grid-cols-[36px_minmax(300px,48%)_1fr_76px]';

function niceTicks(duration: number) {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 30000, 60000];
  const step = steps.find((s) => duration / s <= 6) ?? duration / 5;
  const out: number[] = [];
  for (let v = 0; v <= duration + 1e-9; v += step) out.push(v);
  return out;
}

export function CallTree({
  roots,
  byId,
  duration,
  selectedId,
  onSelect,
  collapsed,
  setCollapsed,
  filter,
  errorOrigins,
}: {
  roots: SpanNode[];
  byId: Map<string, SpanNode>;
  duration: number;
  selectedId?: string;
  onSelect: (id: string) => void;
  collapsed: Set<string>;
  setCollapsed: (s: Set<string>) => void;
  filter: string;
  errorOrigins?: Set<string>;
}) {
  const rows = useMemo(() => flatten(roots, collapsed), [roots, collapsed]);
  const order = useMemo(() => {
    // call sequence number in execution order (by start time)
    const all = [...byId.values()].sort((a, b) => a.start - b.start);
    return new Map(all.map((n, i) => [n.id, i]));
  }, [byId]);
  const needle = filter.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!needle) return null;
    const m = new Set<string>();
    for (const n of byId.values()) if (n.name.toLowerCase().includes(needle)) m.add(n.id);
    return m;
  }, [needle, byId]);
  const [hoverId, setHoverId] = useState<string>();
  const containerRef = useRef<HTMLDivElement>(null);
  const ticks = useMemo(() => niceTicks(duration), [duration]);

  const selected = selectedId ? byId.get(selectedId) : undefined;
  // ids on the path root → selected (highlight the guide lines along it)
  const pathIds = useMemo(() => {
    const s = new Set<string>();
    let cur = selected;
    while (cur) {
      s.add(cur.id);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return s;
  }, [selected, byId]);
  // descendants of the selected node (render them as "inside the lens")
  const subtree = useMemo(() => {
    const s = new Set<string>();
    const walk = (n: SpanNode) => n.children.forEach((c) => (s.add(c.id), walk(c)));
    if (selected) walk(selected);
    return s;
  }, [selected]);

  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setCollapsed(next);
  };

  // Keyboard navigation: ↑ ↓ to move, ← → to collapse / expand
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      const idx = rows.findIndex((r) => r.id === selectedId);
      const cur = rows[idx];
      if (e.key === 'ArrowDown' && idx < rows.length - 1) onSelect(rows[idx + 1].id);
      else if (e.key === 'ArrowUp' && idx > 0) onSelect(rows[idx - 1].id);
      else if (e.key === 'ArrowLeft' && cur) {
        if (cur.children.length && !collapsed.has(cur.id)) toggle(cur.id);
        else if (cur.parentId) onSelect(cur.parentId);
      } else if (e.key === 'ArrowRight' && cur?.children.length) {
        if (collapsed.has(cur.id)) toggle(cur.id);
        else onSelect(cur.children[0].id);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    containerRef.current?.querySelector(`[data-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const pos = (ms: number) => (duration ? (ms / duration) * 100 : 0);

  return (
    <div ref={containerRef} className="relative min-w-[700px]">
      {/* header */}
      <div
        className={cn(
          'sticky top-0 z-20 grid h-9 items-center border-b bg-background/95 text-[11px] font-medium text-muted-foreground backdrop-blur',
          GRID,
        )}
      >
        <div className="pl-4">#</div>
        <div className="pl-2">Function call</div>
        <div className="relative h-full px-3">
          <div className="relative h-full">
            {ticks.map((t, i) => (
              <span
                key={t}
                className="absolute top-1/2 -translate-y-1/2 font-mono text-[10px] tabular-nums"
                style={{ left: `${pos(t)}%`, transform: `translate(${i === 0 ? '0' : pos(t) > 92 ? '-100%' : '-50%'}, -50%)` }}
              >
                {formatMs(t)}
              </span>
            ))}
          </div>
        </div>
        <div className="pr-4 text-right">Total · self</div>
      </div>

      <div className="relative">
        {/* timeline overlay: grid lines + selected-call lens */}
        <div className={cn('pointer-events-none absolute inset-0 z-0 grid', GRID)}>
          <div />
          <div />
          <div className="relative px-3">
            <div className="relative h-full">
              {ticks.map((t) => (
                <div key={t} className="absolute inset-y-0 border-l border-dashed border-border/70" style={{ left: `${pos(t)}%` }} />
              ))}
              {selected && selected.parentId !== null && (
                <div
                  className="absolute inset-y-0 border-x border-brand/40 bg-brand/[0.06]"
                  style={{ left: `${pos(selected.start)}%`, width: `${Math.max(pos(selected.duration), 0.2)}%` }}
                />
              )}
            </div>
          </div>
        </div>

        {rows.map((n) => {
          const meta = KIND_META[n.kind] ?? KIND_META.function;
          const left = pos(n.start);
          const width = Math.max(pos(n.duration), 0.3);
          const selfPct = n.duration ? (n.selfTime / n.duration) * 100 : 100;
          const isSel = n.id === selectedId;
          const dimmed =
            (matchIds && !matchIds.has(n.id)) ||
            (selected && selected.parentId !== null && !pathIds.has(n.id) && !subtree.has(n.id) && hoverId !== n.id);
          const isCollapsed = collapsed.has(n.id);
          const isRoot = n.parentId === null;
          const isErr = n.status === 'error' && !isRoot;
          const origin = !!errorOrigins?.has(n.id) && isErr;
          const sev = isErr ? severityOf(n) : null;
          const S = sev ? SEVERITY[sev] : null;
          // only the call that actually threw gets the severity colour; callers it bubbled through keep their layer colour
          const barColor = origin && S ? S.bar : meta.bar;
          const trackColor = origin && S ? S.track : cn(meta.bar, 'opacity-25');
          const labelRight = left + width < 80;
          // ancestors chain for guide lines
          const ancestors: SpanNode[] = [];
          let a = n.parentId ? byId.get(n.parentId) : undefined;
          while (a) {
            ancestors.unshift(a);
            a = a.parentId ? byId.get(a.parentId) : undefined;
          }

          return (
            <div
              key={n.id}
              data-id={n.id}
              onClick={() => onSelect(n.id)}
              onMouseEnter={() => setHoverId(n.id)}
              onMouseLeave={() => setHoverId(undefined)}
              style={{ height: ROW_H }}
              className={cn(
                'group relative z-10 grid cursor-pointer items-center border-b border-border/40 text-[12.5px] transition-[background-color,opacity]',
                GRID,
                isSel ? 'bg-brand/[0.09]' : 'hover:bg-accent/50',
                dimmed && !isSel && 'opacity-60 hover:opacity-100',
              )}
            >
              {/* selection / error accent */}
              <span className={cn('absolute inset-y-0 left-0 w-[3px]', isSel ? 'bg-brand' : origin && S ? S.accent : 'bg-transparent')} />

              <div className="pl-4 font-mono text-[10px] tabular-nums text-muted-foreground">{isRoot ? '' : order.get(n.id)}</div>

              <div className="relative flex h-full min-w-0 items-center pr-2">
                {/* indent guides */}
                {ancestors.map((anc, i) => (
                  <span
                    key={anc.id}
                    className={cn(
                      'absolute inset-y-0 border-l',
                      pathIds.has(anc.id) && (isSel || pathIds.has(n.id) || subtree.has(n.id)) ? 'border-brand/50' : 'border-border',
                    )}
                    style={{ left: 8 + i * INDENT + 7 }}
                  />
                ))}
                {ancestors.length > 0 && (
                  <span
                    className="absolute h-px w-[9px] bg-border"
                    style={{ left: 8 + (ancestors.length - 1) * INDENT + 7, top: ROW_H / 2 }}
                  />
                )}
                <span className="flex shrink-0 items-center" style={{ paddingLeft: 8 + ancestors.length * INDENT }}>
                  {n.children.length > 0 ? (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggle(n.id);
                      }}
                      className="grid size-4 place-items-center rounded border bg-background text-muted-foreground hover:text-foreground cursor-pointer"
                      aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                    >
                      <ChevronRight className={cn('size-3 transition-transform', !isCollapsed && 'rotate-90')} />
                    </button>
                  ) : (
                    <span className="grid size-4 place-items-center">
                      <span className={cn('size-1.5 rounded-full', origin && S ? S.dot : meta.dot)} />
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'ml-2 w-[38px] shrink-0 rounded px-1 py-[1px] text-center font-mono text-[9.5px] font-semibold tracking-wide',
                    cn(meta.soft, meta.text),
                  )}
                >
                  {KIND_SHORT[n.kind]}
                </span>
                <span className="ml-2 min-w-0 truncate font-mono">
                  {n.className && <span className="text-muted-foreground">{n.className}.</span>}
                  <span className={cn('font-semibold', origin && S?.text)}>{n.className ? n.method : n.name}</span>
                  {!isRoot && <span className="text-muted-foreground">({n.params.join(', ')})</span>}
                </span>
                <span className="ml-2 flex shrink-0 items-center gap-1">
                  {isErr &&
                    S &&
                    (origin ? (
                      <Tooltip
                        content={
                          sev === 'warning' ? 'A client error (4xx) was thrown inside this call' : 'The error was thrown inside this call'
                        }
                      >
                        <span className={cn('inline-flex items-center gap-1 rounded px-1 text-[10px] font-medium', S.soft, S.text)}>
                          <AlertTriangle className="size-3" /> {sev === 'warning' ? '4xx' : 'threw'}
                        </span>
                      </Tooltip>
                    ) : (
                      <Tooltip content="An error from a child call passed through here">
                        <AlertTriangle className={cn('size-3 opacity-60', S.text)} />
                      </Tooltip>
                    ))}
                  {n.logs?.length ? (
                    <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <MessageSquareText className="size-3" />
                      {n.logs.length}
                    </span>
                  ) : null}
                  {isCollapsed && n.descendants > 0 && (
                    <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">+{n.descendants}</span>
                  )}
                </span>
              </div>

              {/* timeline */}
              <div className="relative h-full px-3">
                <div className="relative h-full">
                  <Tooltip
                    content={
                      <div className="space-y-0.5 font-mono text-[11px]">
                        <div className="font-medium">{n.name}</div>
                        <div className="text-muted-foreground">
                          start +{formatMs(n.start)} · total {formatMs(n.duration)} · self {formatMs(n.selfTime)}
                        </div>
                      </div>
                    }
                  >
                    <div
                      className="absolute top-1/2 h-[16px] -translate-y-1/2"
                      style={{ left: `${left}%`, width: `${width}%`, minWidth: 3 }}
                    >
                      <div
                        className={cn(
                          'absolute inset-0 rounded-[4px]',
                          trackColor,
                          isSel && 'ring-2 ring-brand/60 ring-offset-1 ring-offset-background',
                        )}
                      />
                      <div
                        className={cn('absolute inset-y-0 left-0 rounded-[4px]', barColor)}
                        style={{ width: `${selfPct}%`, minWidth: 3 }}
                      />
                    </div>
                  </Tooltip>
                  <span
                    className={cn(
                      'pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap font-mono text-[10px] tabular-nums',
                      isSel ? 'text-foreground' : 'text-muted-foreground',
                    )}
                    style={labelRight ? { left: `calc(${left + width}% + 6px)` } : { right: `calc(${100 - left}% + 6px)` }}
                  >
                    {formatMs(n.duration)}
                  </span>
                </div>
              </div>

              <div className="pr-4 text-right leading-tight">
                <div className="font-mono text-[11px] font-medium tabular-nums">{formatMs(n.duration)}</div>
                <div className="font-mono text-[10px] tabular-nums text-muted-foreground">{formatMs(n.selfTime)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

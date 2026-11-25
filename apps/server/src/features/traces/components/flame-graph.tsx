'use client';
import { useMemo, useState } from 'react';
import { ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { cn, formatMs, KIND_META, SEVERITY, severityOf } from '@/lib/utils';
import type { SpanNode } from '@/lib/span-tree';

const ROW = 24;

/**
 * Time-ordered icicle chart (a "flame chart"): x = wall-clock time, y = call depth.
 * Click to select, double-click to zoom into a call.
 */
export function FlameGraph({
  byId,
  duration,
  selectedId,
  onSelect,
}: {
  byId: Map<string, SpanNode>;
  duration: number;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  const [zoomId, setZoomId] = useState<string | null>(null);
  const zoom = zoomId ? byId.get(zoomId) : undefined;
  const d0 = zoom ? zoom.start : 0;
  const d1 = zoom ? zoom.start + Math.max(zoom.duration, 0.001) : Math.max(duration, 0.001);
  const span = d1 - d0;
  const nodes = useMemo(() => [...byId.values()], [byId]);
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth));
  const baseDepth = zoom?.depth ?? 0;

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {zoom ? (
            <>
              Zoomed into <span className="font-mono text-foreground">{zoom.name}</span> · {formatMs(zoom.duration)}
            </>
          ) : (
            <>Click a frame to inspect · double-click to zoom · width = wall-clock time</>
          )}
        </div>
        {zoom && (
          <Button variant="outline" size="sm" onClick={() => setZoomId(null)}>
            <ZoomOut /> Reset zoom
          </Button>
        )}
      </div>
      <div className="relative overflow-hidden rounded-md border bg-muted/20" style={{ height: (maxDepth - baseDepth + 1) * ROW + 8 }}>
        {nodes.map((n) => {
          const end = n.start + n.duration;
          if (end < d0 || n.start > d1 || n.depth < baseDepth) return null;
          const left = ((Math.max(n.start, d0) - d0) / span) * 100;
          const width = ((Math.min(end, d1) - Math.max(n.start, d0)) / span) * 100;
          if (width <= 0) return null;
          const meta = KIND_META[n.kind] ?? KIND_META.function;
          const label = n.className ? `${n.className}.${n.method}` : n.name;
          return (
            <Tooltip
              key={n.id}
              content={
                <div className="space-y-0.5">
                  <div className="font-mono font-medium">{label}</div>
                  <div className="text-muted-foreground">
                    {formatMs(n.duration)} total · {formatMs(n.selfTime)} self
                  </div>
                </div>
              }
            >
              <div
                onClick={() => onSelect(n.id)}
                onDoubleClick={() => setZoomId(n.id === zoomId ? null : n.id)}
                className={cn(
                  'absolute flex cursor-pointer items-center overflow-hidden rounded-[3px] border border-background/60 px-1.5 text-[11px] font-medium text-white transition-[filter] hover:brightness-110',
                  n.status === 'error' && n.parentId !== null && !n.children.some((c) => c.status === 'error')
                    ? SEVERITY[severityOf(n) ?? 'error'].bar
                    : meta.bar,
                  n.id === selectedId && 'ring-2 ring-foreground ring-offset-1 ring-offset-background z-10',
                )}
                style={{
                  left: `${left}%`,
                  width: `max(${width}%, 2px)`,
                  top: 4 + (n.depth - baseDepth) * ROW,
                  height: ROW - 2,
                }}
              >
                <span className="truncate font-mono drop-shadow-sm">{label}</span>
              </div>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

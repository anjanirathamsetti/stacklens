'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn, formatMs } from '@/lib/utils';
import type { MetricsBucket } from '@stacklens/shared/api-types';

export const C = {
  brand: 'var(--brand)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  error: 'var(--destructive)',
  muted: 'var(--muted-foreground)',
  grid: 'var(--border)',
  p50: 'oklch(0.72 0.12 200)',
  p95: 'var(--brand)',
  p99: 'oklch(0.66 0.17 300)',
  c3xx: 'oklch(0.7 0.1 230)',
};

export function tickFormatter(rangeMs: number) {
  return (t: number) => {
    const d = new Date(t);
    if (rangeMs > 2 * 86_400_000)
      return (
        d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString([], { hour: '2-digit', hour12: false }) +
        'h'
      );
    if (rangeMs > 86_400_000) return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
    if (rangeMs <= 10 * 60_000) return d.toLocaleTimeString([], { hour12: false });
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  };
}

function fullTime(t: number, bucketMs: number) {
  const opts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    second: bucketMs < 60_000 ? '2-digit' : undefined,
    hour12: false,
  };
  const a = new Date(t);
  const b = new Date(t + bucketMs);
  return `${a.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${a.toLocaleTimeString([], opts)} – ${b.toLocaleTimeString([], opts)}`;
}

type TipRow = { name: string; value: number; color: string; dataKey: string };

function ChartTooltip({
  active,
  payload,
  label,
  bucketMs,
  format,
  footer,
}: {
  active?: boolean;
  payload?: TipRow[];
  label?: number;
  bucketMs: number;
  format?: (v: number) => string;
  footer?: (rows: TipRow[]) => React.ReactNode;
}) {
  if (!active || !payload?.length || label === undefined) return null;
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
  return (
    <div className="min-w-48 rounded-lg border bg-popover/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <div className="mb-1.5 font-medium text-muted-foreground">{fullTime(label, bucketMs)}</div>
      <div className="space-y-1">
        {rows.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-mono font-medium tabular-nums">{format ? format(p.value) : p.value}</span>
          </div>
        ))}
      </div>
      {footer && <div className="mt-1.5 border-t pt-1.5 text-muted-foreground">{footer(rows)}</div>}
      <div className="mt-1.5 text-[10px] text-muted-foreground/80">drag to zoom · click to drill in</div>
    </div>
  );
}

const axisProps = { stroke: C.muted, fontSize: 10, tickLine: false, axisLine: false } as const;
const compactTick = (v: number) => (Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(v));

/* ------------------------------------------------------------------ */
/* Shared behaviour: drag-to-zoom, click-to-zoom, toggleable legend    */
/* ------------------------------------------------------------------ */

function useDragZoom(bucketMs: number, onZoom?: (from: number, to: number) => void) {
  const [a, setA] = useState<number | null>(null);
  const [b, setB] = useState<number | null>(null);
  const handlers = onZoom
    ? {
        onMouseDown: (e: any) => e?.activeLabel !== undefined && (setA(Number(e.activeLabel)), setB(Number(e.activeLabel))),
        onMouseMove: (e: any) => a !== null && e?.activeLabel !== undefined && setB(Number(e.activeLabel)),
        onMouseUp: () => {
          if (a !== null && b !== null) {
            const from = Math.min(a, b);
            const to = Math.max(a, b) + bucketMs;
            onZoom(from, to);
          }
          setA(null);
          setB(null);
        },
        onMouseLeave: () => (setA(null), setB(null)),
      }
    : {};
  const area =
    a !== null && b !== null && a !== b ? (
      <ReferenceArea x1={Math.min(a, b)} x2={Math.max(a, b)} fill={C.brand} fillOpacity={0.12} stroke={C.brand} strokeOpacity={0.4} />
    ) : null;
  return { handlers, area, dragging: a !== null };
}

/** Animate on first paint only – live refreshes shouldn't make charts dance. */
function useFirstPaint(hasData: boolean) {
  const done = useRef(false);
  const [animate, setAnimate] = useState(true);
  useEffect(() => {
    if (!hasData || done.current) return undefined;
    done.current = true;
    const t = setTimeout(() => setAnimate(false), 900);
    return () => clearTimeout(t);
  }, [hasData]);
  return animate;
}

export function ToggleLegend({
  items,
  hidden,
  onToggle,
  className,
}: {
  items: { key: string; label: string; color: string; value?: React.ReactNode }[];
  hidden: Set<string>;
  onToggle: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {items.map((it) => {
        const off = hidden.has(it.key);
        return (
          <button
            key={it.key}
            onClick={() => onToggle(it.key)}
            title={off ? `Show ${it.label}` : `Hide ${it.label}`}
            className={cn(
              'inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-all cursor-pointer',
              off ? 'border-dashed text-muted-foreground/60' : 'bg-card hover:bg-accent',
            )}
          >
            <span className={cn('size-2 rounded-full transition-opacity', off && 'opacity-30')} style={{ background: it.color }} />
            <span className={cn(off && 'line-through')}>{it.label}</span>
            {it.value !== undefined && <span className="font-mono tabular-nums text-muted-foreground">{it.value}</span>}
          </button>
        );
      })}
    </div>
  );
}

function useHidden(initial: string[] = []) {
  const [hidden, setHidden] = useState<Set<string>>(new Set(initial));
  const toggle = (k: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return { hidden, toggle };
}

interface SeriesProps {
  data: MetricsBucket[];
  bucketMs: number;
  rangeMs: number;
  height?: number;
  syncId?: string;
  /** called with an absolute window when the user drags or clicks */
  onZoom?: (from: number, to: number) => void;
  showLegend?: boolean;
}

/* ------------------------------------------------------------------ */
/* Charts                                                              */
/* ------------------------------------------------------------------ */

export function VolumeChart({ data, bucketMs, rangeMs, height = 220, syncId, onZoom, showLegend = true }: SeriesProps) {
  const { hidden, toggle } = useHidden();
  const { handlers, area, dragging } = useDragZoom(bucketMs, onZoom);
  const animate = useFirstPaint(data.length > 0);
  const rows = data.map((d) => ({ t: d.t, ok: d.count - d.errors, errors: d.errors }));
  const totals = rows.reduce((a, r) => ({ ok: a.ok + r.ok, errors: a.errors + r.errors }), { ok: 0, errors: 0 });
  return (
    <div>
      <ResponsiveContainer debounce={120} width="100%" height={height}>
        <BarChart
          data={rows}
          syncId={syncId}
          margin={{ top: 8, right: 4, left: -18, bottom: 0 }}
          barCategoryGap={1}
          {...handlers}
          style={{ cursor: onZoom ? (dragging ? 'col-resize' : 'crosshair') : undefined, userSelect: 'none' }}
        >
          <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="3 3" />
          <XAxis dataKey="t" {...axisProps} tickFormatter={tickFormatter(rangeMs)} minTickGap={48} />
          <YAxis {...axisProps} allowDecimals={false} width={44} tickFormatter={compactTick} />
          <RTooltip
            cursor={{ fill: 'var(--accent)', opacity: 0.7 }}
            content={<ChartTooltip bucketMs={bucketMs} footer={(r) => `${r.reduce((a, x) => a + (x.value || 0), 0)} requests`} />}
          />
          {!hidden.has('ok') && (
            <Bar
              dataKey="ok"
              name="Successful"
              stackId="a"
              fill={C.brand}
              fillOpacity={0.8}
              activeBar={{ fillOpacity: 1 }}
              isAnimationActive={animate}
              animationDuration={600}
            />
          )}
          {!hidden.has('errors') && (
            <Bar
              dataKey="errors"
              name="Failed"
              stackId="a"
              fill={C.error}
              fillOpacity={0.75}
              radius={[2, 2, 0, 0]}
              activeBar={{ fillOpacity: 1 }}
              isAnimationActive={animate}
              animationDuration={600}
            />
          )}
          {area}
        </BarChart>
      </ResponsiveContainer>
      {showLegend && (
        <ToggleLegend
          className="px-2 pt-1"
          hidden={hidden}
          onToggle={toggle}
          items={[
            { key: 'ok', label: 'Successful', color: C.brand, value: totals.ok },
            { key: 'errors', label: 'Failed', color: C.error, value: totals.errors },
          ]}
        />
      )}
    </div>
  );
}

export function LatencyChart({ data, bucketMs, rangeMs, height = 220, syncId, onZoom, p95Overall }: SeriesProps & { p95Overall?: number }) {
  const { hidden, toggle } = useHidden();
  const { handlers, area } = useDragZoom(bucketMs, onZoom);
  const animate = useFirstPaint(data.length > 0);
  const rows = data.map((d) => ({ t: d.t, p50: d.count ? d.p50 : null, p95: d.count ? d.p95 : null, p99: d.count ? d.p99 : null }));
  const series = [
    { key: 'p50', label: 'p50', color: C.p50, w: 1.5 },
    { key: 'p95', label: 'p95', color: C.p95, w: 2.25 },
    { key: 'p99', label: 'p99', color: C.p99, w: 1.5 },
  ];
  return (
    <div>
      <ResponsiveContainer debounce={120} width="100%" height={height}>
        <LineChart
          data={rows}
          syncId={syncId}
          margin={{ top: 8, right: 8, left: -10, bottom: 0 }}
          {...handlers}
          style={{ cursor: onZoom ? 'crosshair' : undefined, userSelect: 'none' }}
        >
          <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="3 3" />
          <XAxis dataKey="t" {...axisProps} tickFormatter={tickFormatter(rangeMs)} minTickGap={48} />
          <YAxis {...axisProps} width={52} tickFormatter={(v) => formatMs(v)} />
          <RTooltip cursor={{ stroke: C.muted, strokeDasharray: '3 3' }} content={<ChartTooltip bucketMs={bucketMs} format={formatMs} />} />
          {p95Overall ? (
            <ReferenceLine
              y={p95Overall}
              stroke={C.p95}
              strokeDasharray="4 4"
              strokeOpacity={0.6}
              label={{ value: `p95 ${formatMs(p95Overall)}`, position: 'insideTopRight', fontSize: 10, fill: C.muted }}
            />
          ) : null}
          {series
            .filter((s) => !hidden.has(s.key))
            .map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={s.w}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
                connectNulls
                isAnimationActive={animate}
                animationDuration={700}
              />
            ))}
          {area}
        </LineChart>
      </ResponsiveContainer>
      <ToggleLegend
        className="px-2 pt-1"
        hidden={hidden}
        onToggle={toggle}
        items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
      />
    </div>
  );
}

export function StatusChart({ data, bucketMs, rangeMs, height = 220, syncId, onZoom }: SeriesProps) {
  const { hidden, toggle } = useHidden();
  const { handlers, area } = useDragZoom(bucketMs, onZoom);
  const animate = useFirstPaint(data.length > 0);
  const series = [
    { key: 'c2xx', label: '2xx', color: C.success },
    { key: 'c3xx', label: '3xx', color: C.c3xx },
    { key: 'c4xx', label: '4xx', color: C.warning },
    { key: 'c5xx', label: '5xx', color: C.error },
  ] as const;
  const totals = Object.fromEntries(series.map((s) => [s.key, data.reduce((a, d) => a + d[s.key], 0)]));
  return (
    <div>
      <ResponsiveContainer debounce={120} width="100%" height={height}>
        <AreaChart
          data={data}
          syncId={syncId}
          margin={{ top: 8, right: 4, left: -18, bottom: 0 }}
          {...handlers}
          style={{ cursor: onZoom ? 'crosshair' : undefined, userSelect: 'none' }}
        >
          <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="3 3" />
          <XAxis dataKey="t" {...axisProps} tickFormatter={tickFormatter(rangeMs)} minTickGap={48} />
          <YAxis {...axisProps} allowDecimals={false} width={44} tickFormatter={compactTick} />
          <RTooltip cursor={{ stroke: C.muted, strokeDasharray: '3 3' }} content={<ChartTooltip bucketMs={bucketMs} />} />
          {series
            .filter((s) => !hidden.has(s.key))
            .map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stackId="s"
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.18}
                strokeWidth={1.5}
                activeDot={{ r: 3 }}
                isAnimationActive={animate}
              />
            ))}
          {area}
        </AreaChart>
      </ResponsiveContainer>
      <ToggleLegend
        className="px-2 pt-1"
        hidden={hidden}
        onToggle={toggle}
        items={series.map((s) => ({ key: s.key, label: s.label, color: s.color, value: totals[s.key] }))}
      />
    </div>
  );
}

export function ErrorRateChart({ data, bucketMs, rangeMs, height = 220, syncId, onZoom, errorRate }: SeriesProps & { errorRate?: number }) {
  const { handlers, area } = useDragZoom(bucketMs, onZoom);
  const animate = useFirstPaint(data.length > 0);
  const rows = data.map((d) => ({ t: d.t, rate: d.count ? +((d.errors / d.count) * 100).toFixed(2) : null }));
  return (
    <div>
      <ResponsiveContainer debounce={120} width="100%" height={height}>
        <AreaChart
          data={rows}
          syncId={syncId}
          margin={{ top: 8, right: 8, left: -14, bottom: 0 }}
          {...handlers}
          style={{ cursor: onZoom ? 'crosshair' : undefined, userSelect: 'none' }}
        >
          <defs>
            <linearGradient id="errFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.error} stopOpacity={0.25} />
              <stop offset="100%" stopColor={C.error} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={C.grid} strokeDasharray="3 3" />
          <XAxis dataKey="t" {...axisProps} tickFormatter={tickFormatter(rangeMs)} minTickGap={48} />
          <YAxis {...axisProps} width={48} tickFormatter={(v) => `${v}%`} domain={[0, (max: number) => Math.max(5, Math.ceil(max))]} />
          <RTooltip
            cursor={{ stroke: C.muted, strokeDasharray: '3 3' }}
            content={<ChartTooltip bucketMs={bucketMs} format={(v) => `${v}%`} />}
          />
          {errorRate !== undefined && (
            <ReferenceLine
              y={+(errorRate * 100).toFixed(2)}
              stroke={C.error}
              strokeDasharray="4 4"
              strokeOpacity={0.5}
              label={{ value: `avg ${(errorRate * 100).toFixed(1)}%`, position: 'insideTopRight', fontSize: 10, fill: C.muted }}
            />
          )}
          <Area
            type="monotone"
            dataKey="rate"
            name="Error rate"
            stroke={C.error}
            strokeOpacity={0.85}
            fill="url(#errFill)"
            strokeWidth={1.75}
            connectNulls
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)' }}
            isAnimationActive={animate}
          />
          {area}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Tiny inline sparkline for KPI cards. */
export function Spark({ values, color = C.brand, height = 36 }: { values: number[]; color?: string; height?: number }) {
  const rows = values.map((v, i) => ({ i, v }));
  const id = `spark-${color.replace(/[^a-z0-9]/gi, '')}`;
  return (
    <ResponsiveContainer debounce={120} width="100%" height={height}>
      <AreaChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="v" stroke={color} fill={`url(#${id})`} strokeWidth={1.5} isAnimationActive={false} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

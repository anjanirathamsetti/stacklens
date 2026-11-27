'use client';
import { useId, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Accent palette – one hue per metric, used sparingly (icon chip, line, hover border). */
export const ACCENTS = {
  blue: {
    stroke: 'oklch(0.64 0.17 255)',
    chip: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    ring: 'hover:border-blue-500/40',
    dot: 'bg-blue-500',
  },
  cyan: {
    stroke: 'oklch(0.7 0.12 205)',
    chip: 'bg-cyan-500/10 text-cyan-700 dark:text-cyan-400',
    ring: 'hover:border-cyan-500/40',
    dot: 'bg-cyan-500',
  },
  violet: {
    stroke: 'oklch(0.63 0.19 295)',
    chip: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
    ring: 'hover:border-violet-500/40',
    dot: 'bg-violet-500',
  },
  emerald: {
    stroke: 'oklch(0.68 0.15 160)',
    chip: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    ring: 'hover:border-emerald-500/40',
    dot: 'bg-emerald-500',
  },
  slate: {
    stroke: 'oklch(0.62 0.03 260)',
    chip: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
    ring: 'hover:border-slate-500/40',
    dot: 'bg-slate-500',
  },
  amber: {
    stroke: 'oklch(0.77 0.15 75)',
    chip: 'bg-amber-500/12 text-amber-700 dark:text-amber-400',
    ring: 'hover:border-amber-500/40',
    dot: 'bg-amber-500',
  },
  rose: {
    stroke: 'oklch(0.68 0.17 18)',
    chip: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
    ring: 'hover:border-rose-500/40',
    dot: 'bg-rose-500',
  },
} as const;
export type Accent = keyof typeof ACCENTS;
export type Health = 'ok' | 'warn' | 'bad';

export interface KpiPoint {
  t: number;
  v: number | null;
}

function DeltaPill({ cur, prev, higherIsBad, mode = 'pct' }: { cur: number; prev: number; higherIsBad?: boolean; mode?: 'pct' | 'pp' }) {
  // nothing to compare with (first period of traffic): show no change chip rather than a "new" label everywhere
  if (!prev) return null;
  const diff = mode === 'pp' ? (cur - prev) * 100 : ((cur - prev) / prev) * 100;
  const flat = Math.abs(diff) < 0.5;
  const up = diff > 0;
  const bad = higherIsBad ? up : !up;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      title="Change vs. the previous period of the same length"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums',
        flat
          ? 'bg-muted text-muted-foreground'
          : bad
            ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
            : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
      )}
    >
      <Icon className="size-3" />
      {flat ? '0' : Math.abs(diff) >= 1000 ? '999+' : Math.abs(diff).toFixed(Math.abs(diff) < 10 ? 1 : 0)}
      {mode === 'pp' ? 'pp' : '%'}
    </span>
  );
}

function ChartTip({ active, payload, format }: { active?: boolean; payload?: { payload: KpiPoint }[]; format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  if (p.v === null) return null;
  return (
    <div className="rounded-md border bg-popover/95 px-2 py-1 text-[11px] shadow-lg backdrop-blur">
      <span className="text-muted-foreground">
        {new Date(p.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
      </span>{' '}
      <span className="font-mono font-medium">{format(p.v)}</span>
    </div>
  );
}

export function KpiCard({
  title,
  icon: Icon,
  value,
  unit,
  accent,
  health = 'ok',
  healthLabel,
  delta,
  series,
  format,
  footer,
  href,
  cta,
  loading,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  value: React.ReactNode;
  unit?: string;
  accent: Accent;
  health?: Health;
  healthLabel?: string;
  delta?: { cur: number; prev: number; higherIsBad?: boolean; mode?: 'pct' | 'pp' };
  series?: KpiPoint[];
  format?: (v: number) => string;
  footer?: React.ReactNode;
  href?: string;
  cta?: string;
  loading?: boolean;
}) {
  const router = useRouter();
  const gid = useId().replace(/:/g, '');
  // health overrides the accent so problems stand out, otherwise each metric keeps its own hue
  const a = ACCENTS[health === 'bad' ? 'rose' : health === 'warn' ? 'amber' : accent];
  const fmt = format ?? ((v: number) => String(Math.round(v * 100) / 100));

  // Trim leading empty buckets, and trailing buckets without a value (ratios like error rate or
  // latency have none when there was no traffic), so the line spans the whole panel. Real zeros
  // (no requests) are kept, so a drop in traffic still shows.
  const data = useMemo(() => {
    if (!series?.length) return [];
    const first = series.findIndex((p) => p.v !== null && p.v !== 0);
    let last = series.length - 1;
    while (last > 0 && series[last].v === null) last--;
    const trimmed = series.slice(first > 0 ? Math.max(0, first - 1) : 0, last + 1);
    const known = trimmed.filter((p) => p.v !== null);
    // a single measurement (one burst of traffic) reads better as a level line than a lone dot
    if (known.length === 1) return [{ t: series[0].t, v: known[0].v }, { ...known[0] }];
    return trimmed.length > 1 ? trimmed : series;
  }, [series]);
  const values = data.map((d) => d.v).filter((v): v is number => v !== null);

  const lastIdx = data.reduce((last, d, i) => (d.v !== null ? i : last), -1);
  const peak = values.length ? Math.max(...values) : 0;

  return (
    <Card
      onClick={href ? () => router.push(href) : undefined}
      style={{ '--kpi': a.stroke } as React.CSSProperties}
      className={cn(
        'group relative flex flex-col overflow-hidden transition-all duration-200',
        href && cn('cursor-pointer hover:-translate-y-0.5 hover:shadow-md', a.ring),
        health === 'bad' && 'border-rose-500/35 bg-gradient-to-b from-rose-500/[0.05] to-transparent',
        health === 'warn' && 'border-amber-500/35 bg-gradient-to-b from-amber-500/[0.05] to-transparent',
      )}
    >
      {/* accent hairline along the top edge */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px opacity-60 transition-opacity duration-200 group-hover:opacity-100"
        style={{ background: 'linear-gradient(90deg, transparent, var(--kpi), transparent)' }}
      />

      <div className="flex items-center justify-between gap-2 px-4 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              'grid size-8 shrink-0 place-items-center rounded-lg ring-1 ring-inset ring-current/15 transition-transform duration-200 group-hover:scale-105',
              a.chip,
            )}
          >
            <Icon className="size-4" />
          </span>
          <span className="truncate text-[13px] font-medium text-muted-foreground">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {health !== 'ok' && healthLabel && (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold', a.chip)}>
              <span className={cn('size-1.5 rounded-full animate-pulse-dot', a.dot)} />
              {healthLabel}
            </span>
          )}
          {delta && <DeltaPill {...delta} />}
        </div>
      </div>

      <div className="flex items-baseline gap-1.5 px-4 pt-3">
        {loading ? (
          <span className="h-9 w-28 animate-pulse rounded-md bg-muted" />
        ) : (
          <>
            <span className="text-[32px] font-semibold leading-9 tracking-tight tabular-nums">{value}</span>
            {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
          </>
        )}
      </div>
      <div className="flex h-5 items-center justify-between gap-2 px-4 pt-0.5 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{footer}</span>
        {href && cta && (
          <span className="flex shrink-0 translate-x-1 items-center gap-0.5 font-medium text-foreground/80 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
            {cta} <ArrowRight className="size-3" />
          </span>
        )}
      </div>

      {/* chart sits in an inset panel so it never touches the card edges */}
      <div
        className="relative mx-3 mb-3 mt-3 h-[76px] overflow-hidden rounded-lg border border-border/60 bg-muted/30 dark:bg-white/[0.02]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* two faint guide lines */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-dashed border-border/50" />
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-dashed border-border/50" />
        {data.length > 1 && peak > 0 ? (
          <>
            <span className="pointer-events-none absolute right-2 top-1.5 z-10 font-mono text-[9.5px] tabular-nums text-muted-foreground/70">
              peak {fmt(peak)}
            </span>
            <ResponsiveContainer debounce={120} width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 14, right: 10, left: 10, bottom: 8 }}>
                <defs>
                  <linearGradient id={`kpi-${gid}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={a.stroke} stopOpacity={0.35} />
                    <stop offset="70%" stopColor={a.stroke} stopOpacity={0.06} />
                    <stop offset="100%" stopColor={a.stroke} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" hide />
                <YAxis hide domain={[0, (max: number) => max * 1.1 || 1]} />
                <RTooltip
                  cursor={{ stroke: a.stroke, strokeOpacity: 0.35, strokeDasharray: '3 3' }}
                  content={<ChartTip format={fmt} />}
                  wrapperStyle={{ outline: 'none' }}
                />
                <Area
                  type="monotone"
                  dataKey="v"
                  stroke={a.stroke}
                  strokeWidth={2}
                  strokeLinecap="round"
                  fill={`url(#kpi-${gid})`}
                  connectNulls
                  className="dark:[&_.recharts-area-curve]:drop-shadow-[0_0_6px_var(--kpi)]"
                  dot={(p: { cx?: number; cy?: number; index?: number }) =>
                    p.index === lastIdx && p.cx !== undefined && p.cy !== undefined ? (
                      <g key="last">
                        <circle cx={p.cx} cy={p.cy} r={6} fill={a.stroke} opacity={0.18} className="animate-pulse" />
                        <circle cx={p.cx} cy={p.cy} r={3} fill={a.stroke} stroke="var(--card)" strokeWidth={1.5} />
                      </g>
                    ) : (
                      <g key={p.index} />
                    )
                  }
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--card)', fill: a.stroke }}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </>
        ) : (
          !loading && <div className="grid h-full place-items-center text-[11px] text-muted-foreground">No data in this range</div>
        )}
      </div>
    </Card>
  );
}

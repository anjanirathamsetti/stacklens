'use client';
import { useId, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from 'lucide-react';
import { Area, AreaChart, ReferenceLine, ResponsiveContainer, Tooltip as RTooltip, XAxis, YAxis } from 'recharts';
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
  if (!prev && !cur) return null;
  if (!prev)
    return (
      <span
        className="inline-flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
        title="No data in the previous period"
      >
        new
      </span>
    );
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

  // Trim leading empty buckets so the chart uses the full card width
  const data = useMemo(() => {
    if (!series?.length) return [];
    const first = series.findIndex((p) => p.v !== null && p.v !== 0);
    const trimmed = first > 0 ? series.slice(Math.max(0, first - 1)) : series;
    return trimmed.length > 1 ? trimmed : series;
  }, [series]);
  const values = data.map((d) => d.v).filter((v): v is number => v !== null);
  const avg = values.length ? values.reduce((x, y) => x + y, 0) / values.length : 0;

  return (
    <Card
      onClick={href ? () => router.push(href) : undefined}
      className={cn(
        'group relative flex flex-col overflow-hidden transition-all duration-200',
        href && cn('cursor-pointer hover:-translate-y-0.5 hover:shadow-md', a.ring),
        health === 'bad' && 'border-rose-500/30',
        health === 'warn' && 'border-amber-500/30',
      )}
    >
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-lg transition-transform duration-200 group-hover:scale-105',
              a.chip,
            )}
          >
            <Icon className="size-3.5" />
          </span>
          <span className="truncate text-xs font-medium text-muted-foreground">{title}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {health !== 'ok' && healthLabel && (
            <span className={cn('inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium', a.chip)}>
              <span className={cn('size-1.5 rounded-full animate-pulse-dot', a.dot)} />
              {healthLabel}
            </span>
          )}
          {delta && <DeltaPill {...delta} />}
        </div>
      </div>

      <div className="flex items-baseline gap-1 px-4 pt-2">
        {loading ? (
          <span className="h-8 w-24 animate-pulse rounded-md bg-muted" />
        ) : (
          <>
            <span className="text-[28px] font-semibold leading-8 tracking-tight tabular-nums">{value}</span>
            {unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
          </>
        )}
      </div>
      <div className="flex h-5 items-center justify-between gap-2 px-4 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">{footer}</span>
        {href && cta && (
          <span className="flex shrink-0 translate-x-1 items-center gap-0.5 opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100">
            {cta} <ArrowRight className="size-3" />
          </span>
        )}
      </div>

      <div className="mt-auto h-16" onClick={(e) => e.stopPropagation()}>
        {data.length > 1 && (
          <ResponsiveContainer debounce={120} width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={`kpi-${gid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={a.stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={a.stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={[0, (max: number) => max * 1.15 || 1]} />
              <ReferenceLine y={avg} stroke={a.stroke} strokeOpacity={0.35} strokeDasharray="3 3" />
              <RTooltip
                cursor={{ stroke: a.stroke, strokeOpacity: 0.4 }}
                content={<ChartTip format={fmt} />}
                wrapperStyle={{ outline: 'none' }}
              />
              <Area
                type="monotone"
                dataKey="v"
                stroke={a.stroke}
                strokeWidth={1.75}
                fill={`url(#kpi-${gid})`}
                connectNulls
                dot={false}
                activeDot={{ r: 3.5, strokeWidth: 2, stroke: 'var(--card)', fill: a.stroke }}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

'use client';
import { tickFormatter } from '@/components/charts/time-series-charts';

/**
 * Static SVG charts for PDF exports. They are drawn at a fixed size in user units (≈ CSS px at
 * A4 width) and scale as vectors, so they stay crisp in the PDF – unlike the interactive
 * recharts charts, which measure their container and animate.
 */

export interface PrintSeries {
  label: string;
  color: string;
  values: (number | null)[];
  type: 'bar' | 'line' | 'area';
  /** bars with the same stack id are stacked */
  stack?: string;
  dashed?: boolean;
}

/** 1, 2, 4, 6, 8 × 10ⁿ – a round axis maximum at or above `v`. */
function niceMax(v: number): number {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  // four gridlines: every step of these stays a round number (8 → 2, 6 → 1.5)
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 4 ? 4 : f <= 6 ? 6 : f <= 8 ? 8 : 10;
  return nice * exp;
}

export function TimeChart({
  t,
  bucketMs,
  series,
  height = 170,
  width = 700,
  yFormat = (v) => String(Math.round(v * 100) / 100),
  refLine,
}: {
  /** bucket start times */
  t: number[];
  bucketMs: number;
  series: PrintSeries[];
  height?: number;
  width?: number;
  yFormat?: (v: number) => string;
  /** dashed horizontal reference, e.g. the overall p95 */
  refLine?: { value: number; label: string; color: string };
}) {
  const padL = 46;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const n = Math.max(1, t.length);
  const step = plotW / n;

  // stacked bar totals decide the axis together with lines
  const stackTotals = new Map<string, number[]>();
  for (const s of series)
    if (s.type === 'bar') {
      const key = s.stack ?? s.label;
      const tot = stackTotals.get(key) ?? new Array(n).fill(0);
      s.values.forEach((v, i) => (tot[i] += v ?? 0));
      stackTotals.set(key, tot);
    }
  const peak = Math.max(
    0,
    refLine?.value ?? 0,
    ...[...stackTotals.values()].flat(),
    ...series.filter((s) => s.type !== 'bar').flatMap((s) => s.values.filter((v): v is number => v !== null)),
  );
  const yMax = niceMax(peak);
  const y = (v: number) => padT + plotH - (v / yMax) * plotH;
  const xMid = (i: number) => padL + step * i + step / 2;

  const rangeMs = t.length ? t[t.length - 1] + bucketMs - t[0] : bucketMs;
  const fmtX = tickFormatter(rangeMs);
  const tickEvery = Math.max(1, Math.ceil(n / 6));

  const offsets = new Map<string, number[]>();
  const barW = Math.max(1, Math.min(18, step * 0.72));

  return (
    <div className="break-inside-avoid">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label={series.map((s) => s.label).join(', ')}>
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={width - padR} y1={y(yMax * f)} y2={y(yMax * f)} stroke="var(--border)" strokeWidth={f === 0 ? 1 : 0.6} />
            <text x={padL - 6} y={y(yMax * f) + 3} textAnchor="end" fontSize={9} fill="var(--muted-foreground)">
              {f === 0 ? '0' : yFormat(yMax * f)}
            </text>
          </g>
        ))}
        {t.map((ts, i) =>
          i % tickEvery === 0 ? (
            <text key={ts} x={xMid(i)} y={height - 5} textAnchor="middle" fontSize={9} fill="var(--muted-foreground)">
              {fmtX(ts)}
            </text>
          ) : null,
        )}
        {series.map((s) => {
          if (s.type === 'bar') {
            const key = s.stack ?? s.label;
            const base = offsets.get(key) ?? new Array(n).fill(0);
            const bars = s.values.map((v, i) => {
              if (!v) return null;
              const top = y(base[i] + v);
              const h = y(base[i]) - top;
              base[i] += v;
              return <rect key={i} x={xMid(i) - barW / 2} y={top} width={barW} height={Math.max(0.5, h)} fill={s.color} rx={0.8} />;
            });
            offsets.set(key, base);
            return <g key={s.label}>{bars}</g>;
          }
          // line / area: break the path at gaps (null = no traffic in the bucket)
          const segs: [number, number][][] = [[]];
          s.values.forEach((v, i) => {
            if (v === null) {
              if (segs[segs.length - 1].length) segs.push([]);
            } else segs[segs.length - 1].push([xMid(i), y(v)]);
          });
          const paths = segs
            .filter((g) => g.length)
            .map((g) => g.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)}`).join(''));
          return (
            <g key={s.label}>
              {s.type === 'area' &&
                segs
                  .filter((g) => g.length)
                  .map((g, i) => (
                    <path
                      key={i}
                      d={`${paths[i]}L${g[g.length - 1][0].toFixed(1)},${y(0)}L${g[0][0].toFixed(1)},${y(0)}Z`}
                      fill={s.color}
                      fillOpacity={0.12}
                      stroke="none"
                    />
                  ))}
              {paths.map((d, i) => (
                <path
                  key={i}
                  d={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeLinejoin="round"
                  strokeDasharray={s.dashed ? '4 3' : undefined}
                />
              ))}
            </g>
          );
        })}
        {refLine && refLine.value > 0 && (
          <g>
            <line
              x1={padL}
              x2={width - padR}
              y1={y(refLine.value)}
              y2={y(refLine.value)}
              stroke={refLine.color}
              strokeDasharray="3 3"
              strokeWidth={0.8}
            />
            <text x={width - padR} y={y(refLine.value) - 3} textAnchor="end" fontSize={8.5} fill={refLine.color}>
              {refLine.label}
            </text>
          </g>
        )}
      </svg>
      <ChartLegend items={series.map((s) => [s.label, s.color])} />
    </div>
  );
}

export function ChartLegend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-3 pl-[46px] text-[9.5px] text-muted-foreground">
      {items.map(([label, color]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-sm" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

/** Small area sparkline for KPI tiles. */
export function Sparkline({
  values,
  color = 'var(--viz)',
  width = 160,
  height = 28,
}: {
  values: (number | null)[];
  color?: string;
  width?: number;
  height?: number;
}) {
  const nums = values.map((v) => v ?? 0);
  if (nums.length < 2) return null;
  const max = Math.max(...nums) || 1;
  const pts = nums.map((v, i) => [(i / (nums.length - 1)) * width, height - 1 - (v / max) * (height - 3)] as const);
  const d = pts.map(([x, yy], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${yy.toFixed(1)}`).join('');
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="mt-1.5 block h-7 w-full" preserveAspectRatio="none" aria-hidden>
      <path d={`${d}L${width},${height}L0,${height}Z`} fill={color} fillOpacity={0.12} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Tiny bar trend (error groups, SLO days). `colors` may colour each bar. */
export function MiniBars({
  values,
  color = 'var(--viz)',
  colors,
  width = 72,
  height = 18,
}: {
  values: number[];
  color?: string;
  colors?: string[];
  width?: number;
  height?: number;
}) {
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  // at most 10 units per bar, right-aligned, so a short series doesn't turn into one wide block
  const w = Math.min(width / values.length, 10);
  const x0 = width - w * values.length;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="block" aria-hidden>
      {values.map((v, i) => {
        const h = v ? Math.max(2, (v / max) * height) : 1;
        return (
          <rect
            key={i}
            x={x0 + i * w + 0.5}
            y={height - h}
            width={Math.max(0.8, w - 1)}
            height={h}
            fill={colors?.[i] ?? color}
            fillOpacity={v ? 0.85 : 0.2}
            rx={0.5}
          />
        );
      })}
    </svg>
  );
}

/** Horizontal share bar (layers, budgets). */
export function ShareBar({ pct, color = 'var(--viz)' }: { pct: number; color?: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
    </div>
  );
}

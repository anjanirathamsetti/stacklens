'use client';
import { Suspense, startTransition, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, AlertTriangle, Gauge, Timer, Users, GitBranch, ChevronRight } from 'lucide-react';
import { KpiCard } from '@/features/overview/components/kpi-card';
import { PageHeader } from '@/components/layout/page-header';
import { FilterBar } from '@/components/layout/filter-bar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useLive } from '@/components/layout/providers';
import { MethodBadge } from '@/components/data-display/trace-badges';
import { ErrorRateChart, LatencyChart, StatusChart, VolumeChart } from '@/components/charts/time-series-charts';
import { useFilters, useLiveRefresh } from '@/lib/url-filters';
import { useSettings } from '@/lib/settings-context';
import { cn, formatMs, KIND_META, timeAgo } from '@/lib/utils';
import type { Metrics } from '@stacklens/shared/api-types';

/** "22.9ms" → ["22.9", "ms"] so the unit can be styled separately */
function splitMs(ms: number): [string, string] {
  const f = formatMs(ms);
  const m = /^([\d.]+)(.*)$/.exec(f);
  return m ? [m[1], m[2]] : [f, ''];
}

const compact = (n: number) => (n >= 10_000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : n.toLocaleString());

function ChartCard({
  title,
  description,
  right,
  children,
  className,
}: {
  title: string;
  description?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3.5">
        <div>
          <div className="text-sm font-medium">{title}</div>
          {description && <div className="text-xs text-muted-foreground">{description}</div>}
        </div>
        {right}
      </div>
      <div className="flex-1 px-2 pb-3 pt-2">{children}</div>
    </Card>
  );
}

function bucketLabel(ms: number) {
  if (ms < 60_000) return `${ms / 1000}s`;
  if (ms < 3_600_000) return `${ms / 60_000}m`;
  if (ms < 86_400_000) return `${ms / 3_600_000}h`;
  return `${ms / 86_400_000}d`;
}

function OverviewInner() {
  const { apiQuery, key, set, globalQs } = useFilters();
  const { live } = useLive();
  const { thresholds: th } = useSettings().settings;
  const [m, setM] = useState<Metrics | null>(null);
  const [volumeTab, setVolumeTab] = useState('volume');

  const load = useCallback(() => {
    fetch(`/api/metrics?${apiQuery()}`, { cache: 'no-store' })
      .then((r) => r.json())
      // low priority: a click (e.g. sidebar toggle) interrupts this render instead of waiting for it
      .then((d) => startTransition(() => setM(d)))
      .catch(() => {});
  }, [apiQuery]);

  useEffect(load, [key, load]);
  useLiveRefresh(load, live, 5000);

  const rangeMs = m ? m.to - m.from : 3_600_000;
  const zoom = (from: number, to: number) => set({ range: 'abs', from, to });
  const totalLayer = m?.layers.reduce((a, l) => a + l.ms, 0) ?? 0;
  const t = m?.totals;
  const p = m?.previous;
  const series = m?.series ?? [];

  return (
    <>
      <PageHeader title="Overview" description="Live health of every instrumented application" />
      <FilterBar onRefresh={load} />
      <div className="flex-1 overflow-y-auto">
        <div className="space-y-4 p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <KpiCard
              title="Requests"
              icon={Activity}
              accent="blue"
              loading={!t}
              value={t ? compact(t.total) : '–'}
              delta={t && p ? { cur: t.total, prev: p.total } : undefined}
              series={series.map((s) => ({ t: s.t, v: s.count }))}
              format={(v) => `${Math.round(v)} requests`}
              footer={
                t && (
                  <>
                    <span className="text-foreground/80">{(t.total - t.errors).toLocaleString()}</span> ok ·{' '}
                    <span className={t.errors ? 'text-rose-600 dark:text-rose-400' : ''}>{t.errors.toLocaleString()}</span> failed
                  </>
                )
              }
              href={`/traces${globalQs}`}
              cta="View traces"
            />
            <KpiCard
              title="Throughput"
              icon={Gauge}
              accent="cyan"
              loading={!t}
              value={t ? (t.rpm < 10 ? t.rpm.toFixed(2) : t.rpm.toFixed(0)) : '–'}
              unit="req/min"
              delta={t && p ? { cur: t.rpm, prev: p.rpm } : undefined}
              series={m ? series.map((s) => ({ t: s.t, v: s.count / (m.bucketMs / 60_000) })) : []}
              format={(v) => `${v.toFixed(1)}/min`}
              footer={
                m && (
                  <>
                    peak{' '}
                    <span className="text-foreground/80">
                      {Math.max(0, ...series.map((s) => s.count / (m.bucketMs / 60_000))).toFixed(1)}/min
                    </span>
                  </>
                )
              }
              href={`/hotspots${globalQs}`}
              cta="Hotspots"
            />
            <KpiCard
              title="Error rate"
              icon={AlertTriangle}
              accent="emerald"
              health={!t ? 'ok' : t.errorRate >= th.errorBad ? 'bad' : t.errorRate >= th.errorWarn ? 'warn' : 'ok'}
              healthLabel={t && t.errorRate >= th.errorBad ? 'Critical' : 'Elevated'}
              loading={!t}
              value={t ? (t.errorRate * 100).toFixed(2) : '–'}
              unit="%"
              delta={t && p ? { cur: t.errorRate, prev: p.errorRate, higherIsBad: true, mode: 'pp' } : undefined}
              series={series.map((s) => ({ t: s.t, v: s.count ? (s.errors / s.count) * 100 : null }))}
              format={(v) => `${v.toFixed(2)}% failed`}
              footer={
                t && (
                  <>
                    <span className="text-foreground/80">{t.errors.toLocaleString()}</span> of {t.total.toLocaleString()} requests failed
                    (5xx)
                  </>
                )
              }
              href={`/errors${globalQs}`}
              cta="View errors"
            />
            <KpiCard
              title="p95 latency"
              icon={Timer}
              accent="violet"
              health={!t ? 'ok' : t.p95 >= th.p95Bad ? 'bad' : t.p95 >= th.p95Warn ? 'warn' : 'ok'}
              healthLabel={t && t.p95 >= th.p95Bad ? 'Slow' : 'Degraded'}
              loading={!t}
              value={t ? splitMs(t.p95)[0] : '–'}
              unit={t ? splitMs(t.p95)[1] : undefined}
              delta={t && p ? { cur: t.p95, prev: p.p95, higherIsBad: true } : undefined}
              series={series.map((s) => ({ t: s.t, v: s.count ? s.p95 : null }))}
              format={(v) => `p95 ${formatMs(v)}`}
              footer={
                t && (
                  <>
                    p50 <span className="text-foreground/80">{formatMs(t.p50)}</span> · p99{' '}
                    <span className="text-foreground/80">{formatMs(t.p99)}</span>
                  </>
                )
              }
              href={`/traces${globalQs}${globalQs ? '&' : '?'}minDuration=${Math.floor(t?.p95 ?? 0)}`}
              cta="Slow traces"
            />
            <KpiCard
              title="Active users"
              icon={Users}
              accent="emerald"
              loading={!t}
              value={t?.users ?? '–'}
              delta={t && p ? { cur: t.users, prev: p.users } : undefined}
              series={series.map((s) => ({ t: s.t, v: s.users }))}
              format={(v) => `${Math.round(v)} users`}
              footer={
                m?.users[0] && (
                  <>
                    most active <span className="font-mono text-foreground/80">{m.users[0].userId}</span> · {m.users[0].count} req
                  </>
                )
              }
              href={m?.users[0] ? `/traces${globalQs}${globalQs ? '&' : '?'}user=${encodeURIComponent(m.users[0].userId)}` : undefined}
              cta="Their traces"
            />
            <KpiCard
              title="Calls per request"
              icon={GitBranch}
              accent="slate"
              loading={!t}
              value={t ? t.avgSpans.toFixed(1) : '–'}
              unit="calls"
              delta={t && p ? { cur: t.avgSpans, prev: p.avgSpans, higherIsBad: true } : undefined}
              series={series.map((s) => ({ t: s.t, v: s.count ? s.spans : null }))}
              format={(v) => `${v.toFixed(1)} calls`}
              footer={
                t &&
                m && (
                  <>
                    peak <span className="text-foreground/80">{Math.max(0, ...series.map((s) => s.spans)).toFixed(1)}</span> · instrumented
                    functions per request
                  </>
                )
              }
              href={`/hotspots${globalQs}`}
              cta="Hotspots"
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard
              className="xl:col-span-2"
              title="Requests"
              description={m ? `${bucketLabel(m.bucketMs)} buckets · drag across the chart to zoom, click a bar to drill in` : undefined}
              right={
                <Tabs value={volumeTab} onValueChange={setVolumeTab}>
                  <TabsList>
                    <TabsTrigger value="volume">Volume</TabsTrigger>
                    <TabsTrigger value="status">Status codes</TabsTrigger>
                    <TabsTrigger value="errors">Error rate</TabsTrigger>
                  </TabsList>
                </Tabs>
              }
            >
              {m &&
                (volumeTab === 'volume' ? (
                  <VolumeChart data={series} bucketMs={m.bucketMs} rangeMs={rangeMs} onZoom={zoom} syncId="overview" />
                ) : volumeTab === 'status' ? (
                  <StatusChart data={series} bucketMs={m.bucketMs} rangeMs={rangeMs} onZoom={zoom} syncId="overview" />
                ) : (
                  <ErrorRateChart
                    data={series}
                    bucketMs={m.bucketMs}
                    rangeMs={rangeMs}
                    onZoom={zoom}
                    syncId="overview"
                    errorRate={t?.errorRate}
                  />
                ))}
            </ChartCard>

            <ChartCard title="Time by layer" description="Self time spent in each layer of your code">
              <div className="space-y-3 px-2 pt-2">
                {m?.layers.length ? (
                  m.layers.map((l) => {
                    const meta = KIND_META[l.kind] ?? KIND_META.function;
                    const pctv = totalLayer ? (l.ms / totalLayer) * 100 : 0;
                    return (
                      <Link
                        key={l.kind}
                        href={`/hotspots${globalQs}${globalQs ? '&' : '?'}kind=${l.kind}`}
                        className="group -mx-1.5 block rounded-md px-1.5 py-1 transition-colors hover:bg-accent/60"
                        title={`See ${meta.label} hotspots`}
                      >
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5">
                            <span className={cn('size-2 rounded-sm transition-transform group-hover:scale-125', meta.dot)} />
                            <span className="transition-colors group-hover:text-foreground">{meta.label}</span>
                            <ChevronRight className="size-3 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-60" />
                          </span>
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {formatMs(l.ms)} · {pctv.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div
                            className={cn('h-full rounded-full opacity-80 transition-all duration-500 group-hover:opacity-100', meta.bar)}
                            style={{ width: `${Math.max(pctv, 0.8)}%` }}
                          />
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="py-10 text-center text-xs text-muted-foreground">No data in this range</div>
                )}
                {m &&
                  (() => {
                    const codes = [
                      {
                        k: '2xx',
                        label: 'Success',
                        bar: 'bg-emerald-500/80',
                        chip: 'bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-400',
                        ring: 'hover:ring-emerald-500/30',
                      },
                      {
                        k: '3xx',
                        label: 'Redirect',
                        bar: 'bg-sky-500/70',
                        chip: 'bg-sky-500/[0.08] text-sky-700 dark:text-sky-400',
                        ring: 'hover:ring-sky-500/30',
                      },
                      {
                        k: '4xx',
                        label: 'Client',
                        bar: 'bg-amber-400/90',
                        chip: 'bg-amber-500/[0.09] text-amber-700 dark:text-amber-400',
                        ring: 'hover:ring-amber-500/30',
                      },
                      {
                        k: '5xx',
                        label: 'Server',
                        bar: 'bg-rose-400',
                        chip: 'bg-rose-500/[0.08] text-rose-600 dark:text-rose-400',
                        ring: 'hover:ring-rose-500/30',
                      },
                    ] as const;
                    const total = codes.reduce((x, c) => x + m.statusCodes[c.k], 0) || 1;
                    return (
                      <div className="border-t pt-3">
                        <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>Status codes</span>
                          <span className="font-mono">{total.toLocaleString()} responses</span>
                        </div>
                        <div className="mb-2.5 flex h-1.5 overflow-hidden rounded-full bg-muted">
                          {codes.map((c) =>
                            m.statusCodes[c.k] ? (
                              <div
                                key={c.k}
                                className={cn('h-full transition-all duration-500', c.bar)}
                                style={{ width: `${(m.statusCodes[c.k] / total) * 100}%` }}
                                title={`${c.k}: ${m.statusCodes[c.k]}`}
                              />
                            ) : null,
                          )}
                        </div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {codes.map((c) => {
                            const n = m.statusCodes[c.k];
                            return (
                              <Link
                                key={c.k}
                                href={`/traces${globalQs}${globalQs ? '&' : '?'}status=${c.k === '3xx' ? '' : c.k}`}
                                title={`Show ${c.k} traces`}
                                className={cn(
                                  'rounded-md px-2 py-1.5 ring-1 ring-transparent transition-all hover:-translate-y-px',
                                  n ? c.chip : 'bg-muted/40 text-muted-foreground',
                                  c.ring,
                                )}
                              >
                                <div className="flex items-center justify-between text-[10px] opacity-80">
                                  <span className="font-mono font-medium">{c.k}</span>
                                  <span>{((n / total) * 100).toFixed(n && n / total < 0.1 ? 1 : 0)}%</span>
                                </div>
                                <div className="font-mono text-sm font-semibold tabular-nums">{compact(n)}</div>
                              </Link>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
              </div>
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <ChartCard
              className="xl:col-span-2"
              title="Latency"
              description="Request duration percentiles · hover is synced with the requests chart · toggle lines below"
            >
              {m && (
                <LatencyChart data={series} bucketMs={m.bucketMs} rangeMs={rangeMs} onZoom={zoom} syncId="overview" p95Overall={t?.p95} />
              )}
            </ChartCard>
            <ChartCard title="Applications" description="Traffic per application">
              <div className="divide-y px-2">
                {m?.applications.length ? (
                  m.applications.map((a) => (
                    <button
                      key={a.application}
                      onClick={() => set({ app: a.application, project: a.project })}
                      className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-accent/40 cursor-pointer rounded-sm px-1"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{a.application}</div>
                        <div className="text-[11px] text-muted-foreground">{a.project}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs tabular-nums">{a.count} req</div>
                        <div className="text-[11px] text-muted-foreground">p95 {formatMs(a.p95)}</div>
                      </div>
                      {a.errors > 0 ? (
                        <Badge tone="error">{((a.errors / a.count) * 100).toFixed(1)}%</Badge>
                      ) : (
                        <Badge tone="success">0%</Badge>
                      )}
                    </button>
                  ))
                ) : (
                  <div className="py-10 text-center text-xs text-muted-foreground">No data in this range</div>
                )}
              </div>
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="overflow-hidden xl:col-span-2">
              <div className="px-4 pb-2 pt-3.5">
                <div className="text-sm font-medium">Top endpoints</div>
                <div className="text-xs text-muted-foreground">Most requested routes in this range</div>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-y bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="h-8 px-4 font-medium">Endpoint</th>
                    <th className="h-8 px-3 font-medium">Requests</th>
                    <th className="h-8 px-3 font-medium">Errors</th>
                    <th className="h-8 px-3 font-medium">Avg</th>
                    <th className="h-8 px-3 font-medium">p95</th>
                    <th className="h-8 w-8" />
                  </tr>
                </thead>
                <tbody>
                  {m?.routes.map((r) => (
                    <tr key={`${r.application}${r.method}${r.route}`} className="group border-b last:border-0 hover:bg-accent/40">
                      <td className="px-4 py-2">
                        <Link
                          href={`/traces${globalQs}${globalQs ? '&' : '?'}route=${encodeURIComponent(r.route)}&app=${encodeURIComponent(r.application)}`}
                          className="flex items-center gap-2"
                        >
                          {r.method && <MethodBadge method={r.method} />}
                          <span className="truncate font-mono text-[13px]">{r.route}</span>
                          <span className="truncate text-[11px] text-muted-foreground">{r.application}</span>
                        </Link>
                      </td>
                      <td className="px-3">
                        <div className="flex items-center gap-2">
                          <span className="w-8 font-mono text-xs tabular-nums">{r.count}</span>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full bg-brand"
                              style={{ width: `${(r.count / (m.routes[0]?.count || 1)) * 100}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-3">
                        {r.errors ? <Badge tone="error">{r.errors}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 font-mono text-xs tabular-nums">{formatMs(r.avg)}</td>
                      <td className="px-3 font-mono text-xs tabular-nums">{formatMs(r.p95)}</td>
                      <td className="pr-3">
                        <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            <ChartCard title="Top users" description="Click a user to filter everything by them">
              <div className="divide-y px-2">
                {m?.users.length ? (
                  m.users.map((u) => (
                    <button
                      key={u.userId}
                      onClick={() => set({ user: u.userId })}
                      className="flex w-full items-center gap-3 rounded-sm px-1 py-2 text-left hover:bg-accent/40 cursor-pointer"
                    >
                      <div className="grid size-7 place-items-center rounded-full bg-muted font-mono text-[10px] font-semibold uppercase text-muted-foreground">
                        {u.userId.replace(/[^a-z0-9]/gi, '').slice(-2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-xs font-medium">{u.userId}</div>
                        <div className="text-[11px] text-muted-foreground">last seen {timeAgo(u.lastSeen)}</div>
                      </div>
                      <div className="text-right font-mono text-xs tabular-nums">
                        {u.count} req
                        {u.errors > 0 && <div className="text-[11px] text-destructive">{u.errors} failed</div>}
                      </div>
                    </button>
                  ))
                ) : (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    No user ids captured. StackLens reads <code className="font-mono">req.user.id</code> or the{' '}
                    <code className="font-mono">x-user-id</code> header, or call <code className="font-mono">stacklens.setUser()</code>.
                  </div>
                )}
              </div>
            </ChartCard>
          </div>
        </div>
      </div>
    </>
  );
}

export default function OverviewPage() {
  return (
    <Suspense>
      <OverviewInner />
    </Suspense>
  );
}

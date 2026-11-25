'use client';
import { Suspense, startTransition, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Search, Trash2, Inbox, X, Activity, Timer, Gauge, ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { FilterBar } from '@/components/layout/filter-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Tooltip } from '@/components/ui/tooltip';
import { useLive } from '@/components/layout/providers';
import { AppBadge, MethodBadge, StatusCodeBadge } from '@/components/data-display/trace-badges';
import { TraceSheet } from '@/features/traces/components/trace-sheet';
import { useSettings } from '@/lib/settings-context';
import { VolumeChart } from '@/components/charts/time-series-charts';
import { Pagination, TableShell, filterKeyOf, usePageState } from '@/components/data-display/pagination';
import { useFilters, useLiveRefresh } from '@/lib/url-filters';
import { cn, formatDateTime, formatMs, timeAgo } from '@/lib/utils';
import type { Metrics, TraceSummary } from '@/lib/api-types';

function DurationBar({ ms, max }: { ms: number; max: number }) {
  const pct = Math.max(2, Math.min(100, (ms / Math.max(max, 1)) * 100));
  const tone = ms > 1000 ? 'bg-destructive' : ms > 300 ? 'bg-warning' : 'bg-brand';
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-16 text-right font-mono text-xs tabular-nums">{formatMs(ms)}</span>
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

type SortKey = 'time' | 'duration' | 'calls' | 'errors' | 'status';

function SortHeader({
  label,
  k,
  sort,
  order,
  onSort,
  className,
}: {
  label: string;
  k: SortKey;
  sort: SortKey;
  order: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  className?: string;
}) {
  const active = sort === k;
  const Icon = !active ? ArrowUpDown : order === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={cn('h-10 font-medium', className)} aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        onClick={() => onSort(k)}
        className={cn(
          'group -ml-1.5 inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors cursor-pointer hover:bg-accent hover:text-foreground',
          active && 'text-foreground',
        )}
        title={`Sort by ${label.toLowerCase()}`}
      >
        {label}
        <Icon className={cn('size-3.5', active ? 'text-brand' : 'opacity-40 group-hover:opacity-80')} />
      </button>
    </th>
  );
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn('size-3.5', tone ?? 'text-muted-foreground')} />
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs font-medium tabular-nums">{value}</span>
    </div>
  );
}

function TracesInner() {
  const { apiQuery, key, set, sp, globalQs, range } = useFilters();
  const { live } = useLive();
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [total, setTotal] = useState(0);
  const pg = usePageState(filterKeyOf(sp));
  // Beyond page 1 the window is frozen at the moment you left page 1, so new traces
  // arriving at the top don't shift rows between pages while you browse.
  const [anchor, setAnchor] = useState<number | null>(null);
  useEffect(() => {
    if (pg.page === 1) setAnchor(null);
    else if (anchor === null && range.kind === 'relative') setAnchor(Date.now());
  }, [pg.page]); // eslint-disable-line react-hooks/exhaustive-deps
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState(sp.get('search') ?? '');
  const status = sp.get('status') ?? '';
  const method = sp.get('method') ?? '';
  const route = sp.get('route') ?? '';
  const minDuration = sp.get('minDuration') ?? '';
  const sort = (['time', 'duration', 'calls', 'errors', 'status'].includes(sp.get('sort') ?? '') ? sp.get('sort') : 'time') as SortKey;
  const order = (sp.get('order') === 'asc' ? 'asc' : 'desc') as 'asc' | 'desc';
  const onSort = (k: SortKey) => {
    // first click sorts descending (newest / slowest / most first), second click flips
    const nextOrder = sort === k ? (order === 'desc' ? 'asc' : 'desc') : 'desc';
    set({ sort: k === 'time' && nextOrder === 'desc' ? '' : k, order: nextOrder === 'desc' ? '' : 'asc' });
  };
  const timeFormat = useSettings().settings.timeFormat;
  const openId = sp.get('trace');

  // debounce search into the URL
  useEffect(() => {
    if (search === (sp.get('search') ?? '')) return;
    const id = setTimeout(() => set({ search }), 250);
    return () => clearTimeout(id);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const extra = useMemo(
    () => ({
      search: sp.get('search') ?? '',
      status,
      method,
      route,
      minDuration,
      sort: sort === 'time' ? '' : sort,
      order: order === 'desc' ? '' : order,
      limit: pg.size,
      offset: pg.offset,
      ...(anchor ? { to: anchor } : {}),
    }),
    [sp, status, method, route, minDuration, sort, order, pg.size, pg.offset, anchor],
  );

  const load = useCallback(async () => {
    const q = apiQuery(extra);
    const [t, m] = await Promise.all([
      fetch(`/api/traces?${q}`, { cache: 'no-store' }).then((r) => r.json()),
      fetch(`/api/metrics?${q}`, { cache: 'no-store' }).then((r) => r.json()),
    ]);
    startTransition(() => {
      setTraces((prev) => {
        const old = new Set(prev.map((x) => x.id));
        if (prev.length) setFresh(new Set((t.traces as TraceSummary[]).filter((x) => !old.has(x.id)).map((x) => x.id)));
        return t.traces;
      });
      setTotal(t.total ?? t.traces.length);
      setMetrics(m);
      setLoading(false);
    });
  }, [apiQuery, extra]);

  useEffect(() => {
    load();
  }, [key, load]);
  useLiveRefresh(load, live && pg.page === 1);

  const clear = async () => {
    if (!confirm('Delete all captured traces? This cannot be undone.')) return;
    await fetch('/api/traces', { method: 'DELETE' });
    load();
  };

  const maxDuration = Math.max(1, ...traces.map((t) => t.duration));
  const filtered = !!(sp.get('search') || status || method || route || minDuration);
  const tt = metrics?.totals;

  return (
    <>
      <PageHeader title="Traces" description="Every request with its complete internal call tree">
        <Tooltip content="Delete all traces">
          <Button variant="outline" size="icon-sm" onClick={clear}>
            <Trash2 />
          </Button>
        </Tooltip>
      </PageHeader>
      <FilterBar onRefresh={load} />

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        <Card className="shrink-0 px-2 pb-2 pt-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-2 pb-1">
            <Stat icon={Activity} label="Requests" value={tt?.total ?? '–'} />
            <Stat
              icon={AlertTriangle}
              label="Error rate"
              value={tt ? `${(tt.errorRate * 100).toFixed(1)}%` : '–'}
              tone={tt?.errors ? 'text-destructive' : undefined}
            />
            <Stat icon={Timer} label="p50 / p95" value={tt ? `${formatMs(tt.p50)} / ${formatMs(tt.p95)}` : '–'} />
            <Stat icon={Gauge} label="Throughput" value={tt ? `${tt.rpm.toFixed(1)}/min` : '–'} />
            <span className="ml-auto text-[11px] text-muted-foreground">drag across the chart to zoom in</span>
          </div>
          {metrics && (
            <VolumeChart
              data={metrics.series}
              bucketMs={metrics.bucketMs}
              rangeMs={metrics.to - metrics.from}
              height={110}
              showLegend={false}
              onZoom={(from, to) => set({ range: 'abs', from, to })}
            />
          )}
        </Card>

        <TableShell
          scrollKey={`${pg.page}-${pg.size}-${filterKeyOf(sp)}`}
          footer={<Pagination page={pg.page} size={pg.size} total={total} onPage={pg.setPage} onSize={pg.setSize} noun="traces" />}
          toolbar={
            <div className="flex flex-wrap items-center gap-2 p-3">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search route, trace id, user or function name (e.g. UsersService.getById)…"
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={method} clearable className="w-36" onChange={(e) => set({ method: e.target.value })}>
                <option value="">All methods</option>
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </Select>
              <Select value={status} clearable className="w-36" onChange={(e) => set({ status: e.target.value })}>
                <option value="">Any status</option>
                <option value="ok">No errors</option>
                <option value="error">Has errors</option>
                <option value="2xx">2xx</option>
                <option value="4xx">4xx</option>
                <option value="5xx">5xx</option>
              </Select>
              {route && (
                <Badge tone="brand" className="h-8 gap-1.5 px-2 text-xs">
                  route: <span className="font-mono">{route}</span>
                  <button onClick={() => set({ route: '' })} className="cursor-pointer" aria-label="Clear route">
                    <X />
                  </button>
                </Badge>
              )}
              {minDuration && (
                <Badge tone="brand" className="h-8 gap-1.5 px-2 text-xs">
                  slower than <span className="font-mono">{formatMs(Number(minDuration))}</span>
                  <button onClick={() => set({ minDuration: '' })} className="cursor-pointer" aria-label="Clear duration filter">
                    <X />
                  </button>
                </Badge>
              )}
              {filtered && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch('');
                    set({ search: '', status: '', method: '', route: '', minDuration: '' });
                  }}
                >
                  Reset
                </Button>
              )}
            </div>
          }
          notice={
            pg.page > 1 && live ? (
              <div className="flex items-center justify-between gap-2 border-t bg-brand/[0.05] px-4 py-1.5 text-xs text-muted-foreground">
                <span>Live updates are paused while you browse page {pg.page}, so rows stay in place.</span>
                <button onClick={() => pg.setPage(1)} className="font-medium text-brand hover:underline cursor-pointer">
                  Jump to latest
                </button>
              </div>
            ) : null
          }
        >
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <SortHeader label="Time" k="time" sort={sort} order={order} onSort={onSort} className="pl-4 pr-3" />
                  <th className="h-10 px-3 font-medium">Request</th>
                  <SortHeader label="Status" k="status" sort={sort} order={order} onSort={onSort} className="px-3" />
                  <SortHeader label="Duration" k="duration" sort={sort} order={order} onSort={onSort} className="px-3" />
                  <SortHeader label="Calls" k="calls" sort={sort} order={order} onSort={onSort} className="px-3" />
                  <SortHeader label="Errors" k="errors" sort={sort} order={order} onSort={onSort} className="px-3" />
                  <th className="h-10 px-3 font-medium">User</th>
                  <th className="h-10 px-4 font-medium">Application</th>
                </tr>
              </thead>
              <tbody>
                {traces.map((t) => (
                  <tr
                    key={t.id}
                    onClick={(e) => (e.metaKey || e.ctrlKey ? window.open(`/traces/${t.id}${globalQs}`, '_blank') : set({ trace: t.id }))}
                    className={cn(
                      'cursor-pointer border-b last:border-0 transition-colors hover:bg-accent/60',
                      fresh.has(t.id) && 'animate-flash',
                      openId === t.id && 'bg-brand/[0.07] hover:bg-brand/10',
                    )}
                  >
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <div className="font-mono text-xs tabular-nums">{formatDateTime(t.startTime, timeFormat)}</div>
                      <div className="text-[11px] text-muted-foreground">{timeAgo(t.startTime)}</div>
                    </td>
                    <td className="max-w-[380px] px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {t.method ? <MethodBadge method={t.method} /> : <MethodBadge method="JOB" />}
                        <span className="truncate font-mono text-[13px]">{t.route ?? t.name.replace(/^\w+ /, '')}</span>
                      </div>
                      {t.url && t.route && t.url !== t.route && (
                        <div className="mt-0.5 truncate pl-[60px] font-mono text-[11px] text-muted-foreground">{t.url}</div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {t.statusCode ? (
                        <StatusCodeBadge code={t.statusCode} />
                      ) : (
                        <Badge tone={t.status === 'error' ? 'error' : 'success'}>{t.status}</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <DurationBar ms={t.duration} max={maxDuration} />
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <span className="font-mono text-xs tabular-nums">{t.spanCount}</span>
                      <span className="ml-1.5 text-[11px] text-muted-foreground">depth {t.maxDepth}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      {t.errorCount > 0 ? (
                        <Tooltip content={t.errors?.map((e) => `${e.spanName}: ${e.message}`).join('\n')}>
                          <span>
                            <Badge tone="error">
                              <AlertTriangle /> {t.errorCount}
                            </Badge>
                          </span>
                        </Tooltip>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      {t.userId ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            set({ user: t.userId });
                          }}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] hover:bg-brand/15 hover:text-brand cursor-pointer"
                          title="Filter by this user"
                        >
                          {t.userId}
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <AppBadge name={t.application} />
                      <div className="mt-1 text-[11px] text-muted-foreground">{t.project}</div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && traces.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <div className="grid size-10 place-items-center rounded-full bg-muted">
                  <Inbox className="size-5 text-muted-foreground" />
                </div>
                <div className="text-sm font-medium">No traces in this range</div>
                <p className="max-w-sm text-xs text-muted-foreground">
                  Widen the time range or clear a filter. New here? See the{' '}
                  <a href="/setup" className="underline underline-offset-2">
                    setup guide
                  </a>
                  .
                </p>
              </div>
            )}
          </div>
        </TableShell>
      </div>
      <TraceSheet
        traceId={openId}
        timeFormat={timeFormat}
        globalQs={globalQs}
        onClose={() => set({ trace: '' })}
        onPrev={(() => {
          const i = traces.findIndex((t) => t.id === openId);
          return i > 0 ? () => set({ trace: traces[i - 1].id }) : undefined;
        })()}
        onNext={(() => {
          const i = traces.findIndex((t) => t.id === openId);
          return i >= 0 && i < traces.length - 1 ? () => set({ trace: traces[i + 1].id }) : undefined;
        })()}
      />
    </>
  );
}

export default function TracesPage() {
  return (
    <Suspense>
      <TracesInner />
    </Suspense>
  );
}

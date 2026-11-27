'use client';
import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowUpRight,
  Bug,
  CheckCircle2,
  Gauge,
  Loader2,
  Newspaper,
  Sparkle,
  Target,
  TrendingUp,
  Turtle,
  Users,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ShareMenu, ViewsMenu } from '@/components/layout/view-controls';
import { useFacets } from '@/components/layout/filter-bar';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/input';
import { AppBadge, KindBadge, MethodBadge } from '@/components/data-display/trace-badges';
import { useFilters } from '@/lib/url-filters';
import { useResource } from '@/lib/use-resource';
import { cn, formatMs, timeAgo } from '@/lib/utils';
import type { Digest, DigestRoute, ErrorGroup } from '@stacklens/shared/api-types';
import { STATE_META, pct } from '@/features/slos/slo-format';
import { DeliveryCard } from '@/features/digest/components/delivery-card';

const PERIODS = {
  '24h': 'Last 24 hours',
  yesterday: 'Yesterday',
  today: 'Today so far',
  '7d': 'Last 7 days',
} as const;
type Period = keyof typeof PERIODS;

function windowOf(p: Period, now: number): { from: number; to: number } {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const m = midnight.getTime();
  if (p === 'yesterday') return { from: m - 86_400_000, to: m };
  if (p === 'today') return { from: m, to: now };
  if (p === '7d') return { from: now - 7 * 86_400_000, to: now };
  return { from: now - 86_400_000, to: now };
}

/** "+12%" coloured by whether the change is good or bad. */
function Delta({ cur, prev, higherIsBad }: { cur: number; prev: number; higherIsBad?: boolean }) {
  if (!prev) return <span className="text-[11px] text-muted-foreground">no data before</span>;
  const change = (cur - prev) / prev;
  if (Math.abs(change) < 0.005) return <span className="text-[11px] text-muted-foreground">no change</span>;
  const bad = higherIsBad ? change > 0 : change < 0;
  const Icon = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium', bad ? 'text-destructive' : 'text-success')}>
      <Icon className="size-3" />
      {Math.abs(change * 100).toFixed(Math.abs(change) < 0.1 ? 1 : 0)}%
    </span>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  delta,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  delta: React.ReactNode;
}) {
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 flex items-center gap-1.5">
        {delta}
        <span className="text-[11px] text-muted-foreground">vs period before</span>
      </div>
    </Card>
  );
}

function Section({
  icon: Icon,
  title,
  count,
  children,
  empty,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count?: number;
  children: React.ReactNode;
  empty: string;
  tone?: string;
}) {
  const isEmpty = count === 0;
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Icon className={cn('size-4 text-muted-foreground', !isEmpty && tone)} />
        <span className="text-sm font-semibold">{title}</span>
        {count !== undefined && count > 0 && <Badge tone="neutral">{count}</Badge>}
      </div>
      {isEmpty ? (
        <div className="flex items-center gap-2 px-4 py-4 text-sm text-muted-foreground">
          <CheckCircle2 className="size-4 text-success" /> {empty}
        </div>
      ) : (
        children
      )}
    </Card>
  );
}

function ErrorRow({ e, qs }: { e: ErrorGroup; qs: string }) {
  return (
    <Link href={`/traces/${e.sampleTraceId}${qs}`} className="flex items-start gap-3 border-b px-4 py-2.5 last:border-0 hover:bg-accent/50">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className={cn('font-medium', e.severity === 'warning' ? 'text-warning' : 'text-destructive')}>{e.name}</span>
          <span className="font-mono text-xs text-muted-foreground">in {e.spanName}</span>
          <KindBadge kind={e.kind} />
        </div>
        <div className="truncate text-xs text-muted-foreground">{e.message}</div>
      </div>
      <div className="shrink-0 text-right text-xs">
        <div className="font-mono font-medium tabular-nums">{e.count}×</div>
        <div className="text-muted-foreground">first {timeAgo(e.firstSeen)}</div>
      </div>
    </Link>
  );
}

function RouteTable({ rows, mode, qs }: { rows: DigestRoute[]; mode: 'regression' | 'slow' | 'busy'; qs: string }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
          <th className="h-8 pl-4 font-medium">Route</th>
          <th className="h-8 px-3 text-right font-medium">Requests</th>
          <th className="h-8 px-3 text-right font-medium">Errors</th>
          <th className="h-8 pr-4 text-right font-medium">{mode === 'regression' ? 'p95 before → now' : 'p95'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const q = new URLSearchParams(qs.replace(/^\?/, ''));
          q.set('app', r.application);
          q.set('route', r.route);
          if (r.method) q.set('method', r.method);
          return (
            <tr key={`${r.application}${r.method}${r.route}`} className="border-b last:border-0 hover:bg-accent/50">
              <td className="py-2 pl-4">
                <Link href={`/traces?${q}`} className="flex min-w-0 items-center gap-2">
                  {r.method && <MethodBadge method={r.method} />}
                  <span className="truncate font-mono text-[13px] hover:underline">{r.route}</span>
                  <AppBadge name={r.application} className="hidden lg:inline-flex" />
                </Link>
              </td>
              <td className="px-3 text-right font-mono text-xs tabular-nums">{r.count.toLocaleString()}</td>
              <td className="px-3 text-right font-mono text-xs tabular-nums">
                {r.errors ? <span className="text-destructive">{r.errors}</span> : <span className="text-muted-foreground">0</span>}
              </td>
              <td className="pr-4 text-right font-mono text-xs tabular-nums">
                {mode === 'regression' && r.previousP95 !== undefined ? (
                  <span>
                    <span className="text-muted-foreground">{formatMs(r.previousP95)}</span> →{' '}
                    <span className="font-medium text-destructive">{formatMs(r.p95)}</span>
                    <span className="ml-1.5 text-[11px] text-destructive">×{(r.p95 / r.previousP95).toFixed(1)}</span>
                  </span>
                ) : (
                  formatMs(r.p95)
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DigestInner() {
  const { sp, set } = useFilters();
  const period = (Object.keys(PERIODS).includes(sp.get('period') ?? '') ? sp.get('period') : '24h') as Period;
  const project = sp.get('project') ?? '';
  const facets = useFacets();
  // "now" rounded to the minute and advanced every 5 minutes, so the URL (the cache key) stays stable
  const [now, setNow] = useState(() => Math.floor(Date.now() / 60_000) * 60_000);
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 60_000) * 60_000), 300_000);
    return () => clearInterval(id);
  }, []);
  const url = useMemo(() => {
    const { from, to } = windowOf(period, now);
    const q = new URLSearchParams({ from: String(from), to: String(to) });
    if (project) q.set('project', project);
    return `/api/digest?${q}`;
  }, [period, project, now]);
  const { data: d, loading, error } = useResource<Digest>(url);
  const qs = d ? `?range=abs&from=${d.from}&to=${d.to}${project ? `&project=${encodeURIComponent(project)}` : ''}` : '';
  const attention = d?.slos.filter((s) => s.state === 'breached' || s.state === 'at-risk') ?? [];

  return (
    <>
      <PageHeader title="Daily digest" description="What changed compared with the period before">
        <Select value={period} onChange={(e) => set({ period: e.target.value === '24h' ? '' : e.target.value })} className="w-40">
          {Object.entries(PERIODS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Select value={project} clearable onChange={(e) => set({ project: e.target.value })} className="w-40">
          <option value="">All projects</option>
          {(facets?.projects ?? []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </Select>
        <ViewsMenu />
        <ShareMenu />
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-7xl gap-4 p-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            {!d ? (
              <div className="grid h-64 place-items-center text-sm text-muted-foreground">
                {error ? <span className="text-destructive">{error}</span> : <Loader2 className="size-5 animate-spin" />}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Newspaper className="size-3.5" />
                  {new Date(d.from).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} →{' '}
                  {new Date(d.to).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                  {loading && <Loader2 className="size-3 animate-spin" />}
                </div>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <Kpi
                    icon={TrendingUp}
                    label="Requests"
                    value={d.totals.total.toLocaleString()}
                    delta={<Delta cur={d.totals.total} prev={d.previous.total} />}
                  />
                  <Kpi
                    icon={Bug}
                    label="Error rate"
                    value={pct(d.totals.errorRate, 2)}
                    delta={<Delta cur={d.totals.errorRate} prev={d.previous.errorRate} higherIsBad />}
                  />
                  <Kpi
                    icon={Gauge}
                    label="p95 latency"
                    value={formatMs(d.totals.p95)}
                    delta={<Delta cur={d.totals.p95} prev={d.previous.p95} higherIsBad />}
                  />
                  <Kpi
                    icon={Users}
                    label="Users"
                    value={d.totals.users.toLocaleString()}
                    delta={<Delta cur={d.totals.users} prev={d.previous.users} />}
                  />
                </div>

                <Section
                  icon={Sparkle}
                  title="New errors"
                  count={d.newErrors.length}
                  empty="No new kinds of errors in this period."
                  tone="text-destructive"
                >
                  {d.newErrors.map((e) => (
                    <ErrorRow key={e.id} e={e} qs={qs} />
                  ))}
                </Section>

                <Section
                  icon={Turtle}
                  title="Slower than the period before"
                  count={d.regressions.length}
                  empty="No route got noticeably slower."
                  tone="text-warning"
                >
                  <RouteTable rows={d.regressions} mode="regression" qs={qs} />
                </Section>

                <div className="grid gap-4 xl:grid-cols-2">
                  <Section icon={Bug} title="Most frequent errors" count={d.topErrors.length} empty="No errors in this period.">
                    {d.topErrors.map((e) => (
                      <ErrorRow key={e.id} e={e} qs={qs} />
                    ))}
                  </Section>
                  <Section icon={Gauge} title="Slowest routes" count={d.slowestRoutes.length} empty="Not enough traffic yet.">
                    <RouteTable rows={d.slowestRoutes} mode="slow" qs={qs} />
                  </Section>
                </div>
                <Section icon={TrendingUp} title="Busiest routes" count={d.busiestRoutes.length} empty="No traffic in this period.">
                  <RouteTable rows={d.busiestRoutes} mode="busy" qs={qs} />
                </Section>
              </>
            )}
          </div>

          <div className="space-y-4">
            <Card className="overflow-hidden">
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <Target className="size-4 text-muted-foreground" /> SLOs
                </span>
                <Link href="/slos" className="text-xs text-muted-foreground hover:text-foreground">
                  Manage →
                </Link>
              </div>
              {!d ? null : d.slos.length === 0 ? (
                <div className="px-4 py-4 text-sm text-muted-foreground">
                  No SLOs yet.{' '}
                  <Link href="/slos" className="text-brand hover:underline">
                    Create one
                  </Link>{' '}
                  to see attainment here.
                </div>
              ) : (
                <div>
                  {attention.length === 0 && (
                    <div className="flex items-center gap-2 border-b px-4 py-2.5 text-sm text-muted-foreground">
                      <CheckCircle2 className="size-4 text-success" /> All objectives on track
                    </div>
                  )}
                  {d.slos.map((s) => (
                    <Link key={s.id} href="/slos" className="flex items-center gap-2.5 border-b px-4 py-2 last:border-0 hover:bg-accent/50">
                      <span className={cn('size-2 shrink-0 rounded-full', STATE_META[s.state].dot)} />
                      <span className="min-w-0 flex-1 truncate text-sm">{s.name}</span>
                      <span className={cn('text-xs', STATE_META[s.state].text)}>{STATE_META[s.state].label}</span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>
            <DeliveryCard />
          </div>
        </div>
      </div>
    </>
  );
}

export default function DigestPage() {
  return (
    <Suspense>
      <DigestInner />
    </Suspense>
  );
}

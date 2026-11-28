'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrintDocument, PrintEmpty, PrintSection, PrintStat } from '@/components/print/print-document';
import { PrintDelta } from '@/components/print/print-delta';
import { PrintTable } from '@/components/print/print-table';
import { ShareBar, Sparkline, TimeChart } from '@/components/print/print-charts';
import { globalFilters, printApiQuery } from '@/components/print/print-query';
import { usePrintData } from '@/components/print/use-print-data';
import { C } from '@/components/charts/time-series-charts';
import { AppBadge, MethodBadge } from '@/components/data-display/trace-badges';
import { useSettings } from '@/lib/settings-context';
import { cn, formatMs, KIND_META } from '@/lib/utils';
import type { Metrics } from '@stacklens/shared/api-types';

const pct1 = (n: number) => `${(n * 100).toFixed(2)}%`;

function OverviewReportInner() {
  const sp = useSearchParams();
  const { thresholds: th } = useSettings().settings;
  const { data, error, fetchedAt } = usePrintData<{ m: Metrics }>({ m: `/api/metrics?${printApiQuery(sp)}` });
  const m = data?.m;
  const t = m?.totals;
  const p = m?.previous;
  const series = m?.series ?? [];
  const ts = series.map((s) => s.t);
  const totalLayer = m?.layers.reduce((a, l) => a + l.ms, 0) ?? 0;
  const codes = m ? (['2xx', '3xx', '4xx', '5xx'] as const) : [];
  const totalCodes = m ? codes.reduce((a, c) => a + m.statusCodes[c], 0) || 1 : 1;
  const codeColor = { '2xx': C.success, '3xx': C.c3xx, '4xx': C.warning, '5xx': C.error } as const;

  return (
    <PrintDocument
      title="Overview"
      subtitle="Health of every instrumented application in the selected range"
      filters={globalFilters(sp)}
      generatedAt={fetchedAt}
      ready={!!m}
      error={error}
    >
      {m && t && p && (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <PrintStat label="Requests" value={t.total.toLocaleString()} sub={<PrintDelta cur={t.total} prev={p.total} />}>
              <Sparkline values={series.map((s) => s.count)} />
            </PrintStat>
            <PrintStat
              label="Throughput"
              value={t.rpm < 10 ? t.rpm.toFixed(2) : t.rpm.toFixed(0)}
              unit="req/min"
              sub={<PrintDelta cur={t.rpm} prev={p.rpm} />}
            >
              <Sparkline values={series.map((s) => s.count / (m.bucketMs / 60_000))} color={C.p50} />
            </PrintStat>
            <PrintStat
              label="Error rate"
              value={(t.errorRate * 100).toFixed(2)}
              unit="%"
              tone={t.errorRate >= th.errorBad ? 'error' : t.errorRate >= th.errorWarn ? 'warning' : undefined}
              sub={<PrintDelta cur={t.errorRate} prev={p.errorRate} higherIsBad mode="pp" />}
            >
              <Sparkline values={series.map((s) => (s.count ? (s.errors / s.count) * 100 : null))} color={C.error} />
            </PrintStat>
            <PrintStat
              label="p95 latency"
              value={formatMs(t.p95)}
              tone={t.p95 >= th.p95Bad ? 'error' : t.p95 >= th.p95Warn ? 'warning' : undefined}
              sub={
                <>
                  p50 {formatMs(t.p50)} · p99 {formatMs(t.p99)} · <PrintDelta cur={t.p95} prev={p.p95} higherIsBad />
                </>
              }
            >
              <Sparkline values={series.map((s) => (s.count ? s.p95 : null))} color={C.p99} />
            </PrintStat>
            <PrintStat label="Active users" value={t.users.toLocaleString()} sub={<PrintDelta cur={t.users} prev={p.users} />}>
              <Sparkline values={series.map((s) => s.users)} color={C.success} />
            </PrintStat>
            <PrintStat
              label="Calls per request"
              value={t.avgSpans.toFixed(1)}
              unit="calls"
              sub={<PrintDelta cur={t.avgSpans} prev={p.avgSpans} higherIsBad />}
            >
              <Sparkline values={series.map((s) => (s.count ? s.spans : null))} color={C.muted} />
            </PrintStat>
          </div>

          <PrintSection title="Requests" description="Requests per time bucket by status code class" keepTogether>
            <TimeChart
              t={ts}
              bucketMs={m.bucketMs}
              series={[
                { label: '2xx', color: C.brand, values: series.map((s) => s.c2xx), type: 'bar', stack: 'r' },
                { label: '3xx', color: C.c3xx, values: series.map((s) => s.c3xx), type: 'bar', stack: 'r' },
                { label: '4xx', color: C.warning, values: series.map((s) => s.c4xx), type: 'bar', stack: 'r' },
                { label: '5xx', color: C.error, values: series.map((s) => s.c5xx), type: 'bar', stack: 'r' },
              ]}
            />
          </PrintSection>

          <div className="grid grid-cols-2 gap-5">
            <PrintSection title="Error rate" description="Share of requests that failed (5xx)" keepTogether>
              <TimeChart
                t={ts}
                bucketMs={m.bucketMs}
                height={190}
                width={340}
                yFormat={(v) => `${v.toFixed(v < 10 ? 1 : 0)}%`}
                series={[
                  {
                    label: 'Error rate',
                    color: C.error,
                    values: series.map((s) => (s.count ? (s.errors / s.count) * 100 : null)),
                    type: 'area',
                  },
                ]}
              />
            </PrintSection>
            <PrintSection title="Latency" description="Request duration percentiles" keepTogether>
              <TimeChart
                t={ts}
                bucketMs={m.bucketMs}
                height={190}
                width={340}
                yFormat={formatMs}
                refLine={{ value: t.p95, label: `p95 ${formatMs(t.p95)}`, color: C.muted }}
                series={[
                  { label: 'p50', color: C.p50, values: series.map((s) => (s.count ? s.p50 : null)), type: 'line' },
                  { label: 'p95', color: C.p95, values: series.map((s) => (s.count ? s.p95 : null)), type: 'line' },
                  { label: 'p99', color: C.p99, values: series.map((s) => (s.count ? s.p99 : null)), type: 'line', dashed: true },
                ]}
              />
            </PrintSection>
          </div>

          <div className="grid grid-cols-2 gap-5">
            <PrintSection title="Time by layer" description="Self time spent in each layer of your code" keepTogether>
              {m.layers.length ? (
                <div className="space-y-2">
                  {m.layers.map((l) => {
                    const meta = KIND_META[l.kind] ?? KIND_META.function;
                    const share = totalLayer ? (l.ms / totalLayer) * 100 : 0;
                    return (
                      <div key={l.kind}>
                        <div className="mb-0.5 flex items-center justify-between text-[11px]">
                          <span className="flex items-center gap-1.5">
                            <span className={cn('size-2 rounded-sm', meta.dot)} />
                            {meta.label}
                          </span>
                          <span className="font-mono tabular-nums text-muted-foreground">
                            {formatMs(l.ms)} · {share.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                          <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${Math.max(share, 0.8)}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <PrintEmpty>No data in this range</PrintEmpty>
              )}
            </PrintSection>
            <PrintSection title="Status codes" description={`${totalCodes.toLocaleString()} responses`} keepTogether>
              <div className="space-y-2">
                {codes.map((c) => (
                  <div key={c}>
                    <div className="mb-0.5 flex justify-between text-[11px]">
                      <span className="font-mono font-medium">{c}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {m.statusCodes[c].toLocaleString()} · {((m.statusCodes[c] / totalCodes) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <ShareBar pct={(m.statusCodes[c] / totalCodes) * 100} color={codeColor[c]} />
                  </div>
                ))}
              </div>
            </PrintSection>
          </div>

          <PrintSection title="Top endpoints" description="Most requested routes in this range">
            <PrintTable
              rows={m.routes}
              rowKey={(r) => `${r.application}${r.method}${r.route}`}
              empty="No requests in this range"
              columns={[
                {
                  header: 'Endpoint',
                  width: '46%',
                  cell: (r) => (
                    <div className="flex items-start gap-1.5">
                      {r.method && <MethodBadge method={r.method} className="w-[46px]" />}
                      <div className="min-w-0">
                        <div className="break-all font-mono">{r.route}</div>
                        <div className="text-[10px] text-muted-foreground">{r.application}</div>
                      </div>
                    </div>
                  ),
                },
                { header: 'Requests', align: 'right', cell: (r) => <span className="font-mono">{r.count.toLocaleString()}</span> },
                {
                  header: 'Errors',
                  align: 'right',
                  cell: (r) => <span className={cn('font-mono', r.errors && 'text-destructive')}>{r.errors || '—'}</span>,
                },
                { header: 'Avg', align: 'right', cell: (r) => <span className="font-mono">{formatMs(r.avg)}</span> },
                { header: 'p95', align: 'right', cell: (r) => <span className="font-mono">{formatMs(r.p95)}</span> },
              ]}
            />
          </PrintSection>

          <div className="grid grid-cols-2 gap-5">
            <PrintSection title="Applications" description="Traffic per application">
              <PrintTable
                rows={m.applications}
                rowKey={(a) => `${a.project}/${a.application}`}
                empty="No data in this range"
                columns={[
                  {
                    header: 'Application',
                    width: '44%',
                    cell: (a) => (
                      <>
                        <AppBadge name={a.application} />
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{a.project}</div>
                      </>
                    ),
                  },
                  { header: 'Req', align: 'right', cell: (a) => <span className="font-mono">{a.count.toLocaleString()}</span> },
                  {
                    header: 'Errors',
                    align: 'right',
                    cell: (a) => (
                      <span className={cn('font-mono', a.errors && 'text-destructive')}>{pct1(a.count ? a.errors / a.count : 0)}</span>
                    ),
                  },
                  { header: 'p95', align: 'right', cell: (a) => <span className="font-mono">{formatMs(a.p95)}</span> },
                ]}
              />
            </PrintSection>
            <PrintSection title="Top users" description="Users with the most requests">
              <PrintTable
                rows={m.users}
                rowKey={(u) => u.userId}
                empty="No user ids captured"
                columns={[
                  { header: 'User', width: '46%', cell: (u) => <span className="break-all font-mono">{u.userId}</span> },
                  { header: 'Req', align: 'right', cell: (u) => <span className="font-mono">{u.count.toLocaleString()}</span> },
                  {
                    header: 'Failed',
                    align: 'right',
                    cell: (u) => <span className={cn('font-mono', u.errors && 'text-destructive')}>{u.errors || '—'}</span>,
                  },
                  { header: 'Avg', align: 'right', cell: (u) => <span className="font-mono">{formatMs(u.avg)}</span> },
                ]}
              />
            </PrintSection>
          </div>
        </>
      )}
    </PrintDocument>
  );
}

export default function OverviewReport() {
  return (
    <Suspense>
      <OverviewReportInner />
    </Suspense>
  );
}

'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrintDocument, PrintSection, PrintStat } from '@/components/print/print-document';
import { PrintTable } from '@/components/print/print-table';
import { TimeChart } from '@/components/print/print-charts';
import { globalFilters, MAX_PRINT_ROWS, pageOf, printApiQuery, printShortDateTime, type PrintFilter } from '@/components/print/print-query';
import { usePrintData } from '@/components/print/use-print-data';
import { TraceLink } from '@/components/print/trace-link';
import { C } from '@/components/charts/time-series-charts';
import { MethodBadge, StatusCodeBadge } from '@/components/data-display/trace-badges';
import { Badge } from '@/components/ui/badge';
import { cn, formatMs } from '@/lib/utils';
import type { Metrics, TraceSummary } from '@stacklens/shared/api-types';

const SORT_LABEL: Record<string, string> = { time: 'Time', duration: 'Duration', calls: 'Calls', errors: 'Errors', status: 'Status' };
const STATUS_LABEL: Record<string, string> = { ok: 'No errors', error: 'Has errors', '2xx': '2xx', '4xx': '4xx', '5xx': '5xx' };

function TracesReportInner() {
  const sp = useSearchParams();
  const all = sp.get('scope') === 'all';
  const { size, offset, page } = pageOf(sp);
  const sort = SORT_LABEL[sp.get('sort') ?? ''] ? (sp.get('sort') as string) : 'time';
  const order = sp.get('order') === 'asc' ? 'asc' : 'desc';
  const extra = {
    search: sp.get('search') ?? '',
    status: sp.get('status') ?? '',
    method: sp.get('method') ?? '',
    route: sp.get('route') ?? '',
    minDuration: sp.get('minDuration') ?? '',
    sort: sort === 'time' ? '' : sort,
    order: order === 'desc' ? '' : order,
  };
  const q = printApiQuery(sp, { ...extra, limit: all ? MAX_PRINT_ROWS : size, offset: all ? 0 : offset });
  const { data, error, fetchedAt } = usePrintData<{ t: { traces: TraceSummary[]; total: number }; m: Metrics }>({
    t: `/api/traces?${q}`,
    m: `/api/metrics?${printApiQuery(sp, extra)}`,
  });
  const traces = data?.t.traces ?? [];
  const total = data?.t.total ?? traces.length;
  const m = data?.m;
  const tt = m?.totals;

  const filters: PrintFilter[] = [...globalFilters(sp)];
  if (extra.search) filters.push({ label: 'Search', value: extra.search });
  if (extra.method) filters.push({ label: 'Method', value: extra.method });
  if (extra.status) filters.push({ label: 'Status', value: STATUS_LABEL[extra.status] ?? extra.status });
  if (extra.route) filters.push({ label: 'Route', value: extra.route });
  if (extra.minDuration) filters.push({ label: 'Slower than', value: formatMs(Number(extra.minDuration)) });
  filters.push({ label: 'Sorted by', value: `${SORT_LABEL[sort]} (${order === 'asc' ? 'ascending' : 'descending'})` });

  const notes = data
    ? [
        'Trace IDs link to the full trace (call tree, arguments, logs) in StackLens.',
        all
          ? total > traces.length
            ? `First ${traces.length.toLocaleString()} of ${total.toLocaleString()} matching traces (the PDF limit is ${MAX_PRINT_ROWS}). Narrow the filters to export the rest.`
            : `All ${total.toLocaleString()} matching traces.`
          : total
            ? `Traces ${(offset + 1).toLocaleString()}–${(offset + traces.length).toLocaleString()} of ${total.toLocaleString()} (page ${page}, as shown on screen).`
            : 'No traces match.',
      ]
    : [];

  return (
    <PrintDocument
      title="Traces"
      subtitle="Every request with its complete internal call tree"
      filters={filters}
      notes={notes}
      generatedAt={fetchedAt}
      ready={!!data}
      error={error}
      landscape
    >
      {m && tt && (
        <PrintSection title="Summary" keepTogether>
          <div className="mb-3 grid grid-cols-4 gap-2.5">
            <PrintStat label="Requests" value={tt.total.toLocaleString()} />
            <PrintStat label="Error rate" value={`${(tt.errorRate * 100).toFixed(1)}%`} tone={tt.errors ? 'error' : undefined} />
            <PrintStat label="p50 / p95" value={`${formatMs(tt.p50)} / ${formatMs(tt.p95)}`} />
            <PrintStat label="Throughput" value={tt.rpm.toFixed(1)} unit="/min" />
          </div>
          <TimeChart
            t={m.series.map((s) => s.t)}
            bucketMs={m.bucketMs}
            height={120}
            series={[
              { label: 'Requests', color: C.brand, values: m.series.map((s) => s.count - s.errors), type: 'bar', stack: 'v' },
              { label: 'Failed', color: C.error, values: m.series.map((s) => s.errors), type: 'bar', stack: 'v' },
            ]}
          />
        </PrintSection>
      )}

      <PrintSection title="Traces" right={`${total.toLocaleString()} matching`}>
        <PrintTable
          rows={traces}
          rowKey={(t) => t.id}
          empty="No traces in this range"
          columns={[
            {
              header: 'Time',
              width: '10%',
              cell: (t) => <span className="whitespace-nowrap font-mono text-[10px]">{printShortDateTime(t.startTime)}</span>,
            },
            {
              header: 'Request',
              width: '34%',
              cell: (t) => (
                <div className="flex items-start gap-1.5">
                  <MethodBadge method={t.method ?? 'JOB'} className="w-[46px]" />
                  <div className="min-w-0">
                    <div className="break-all font-mono">{t.route ?? t.name.replace(/^\w+ /, '')}</div>
                    {t.url && t.route && t.url !== t.route && (
                      <div className="break-all font-mono text-[9.5px] text-muted-foreground">{t.url}</div>
                    )}
                    <TraceLink id={t.id} className="text-[9px]" />
                  </div>
                </div>
              ),
            },
            {
              header: 'Status',
              width: '7%',
              className: 'whitespace-nowrap',
              cell: (t) =>
                t.statusCode ? (
                  <StatusCodeBadge code={t.statusCode} />
                ) : (
                  <Badge tone={t.status === 'error' ? 'error' : 'success'}>{t.status}</Badge>
                ),
            },
            {
              header: 'Duration',
              width: '7%',
              align: 'right',
              cell: (t) => (
                <span
                  className={cn('whitespace-nowrap font-mono', t.duration > 1000 ? 'text-destructive' : t.duration > 300 && 'text-warning')}
                >
                  {formatMs(t.duration)}
                </span>
              ),
            },
            {
              header: 'Calls',
              width: '6%',
              align: 'right',
              cell: (t) => (
                <>
                  <span className="font-mono">{t.spanCount}</span>
                  <div className="text-[9px] text-muted-foreground">depth {t.maxDepth}</div>
                </>
              ),
            },
            {
              header: 'Errors',
              width: '18%',
              cell: (t) =>
                t.errorCount ? (
                  <div>
                    <Badge tone="error">{t.errorCount}</Badge>
                    {t.errors?.[0] && (
                      <div className="mt-0.5 break-words text-[9.5px] text-destructive">
                        {t.errors[0].name}: {t.errors[0].message}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
            { header: 'User', width: '8%', cell: (t) => <span className="break-all font-mono text-[10px]">{t.userId ?? '—'}</span> },
            {
              header: 'Application',
              cell: (t) => (
                <>
                  <div className="break-all font-mono text-[10px] font-medium uppercase">{t.application}</div>
                  <div className="text-[9.5px] text-muted-foreground">{t.project}</div>
                </>
              ),
            },
          ]}
        />
      </PrintSection>
    </PrintDocument>
  );
}

export default function TracesReport() {
  return (
    <Suspense>
      <TracesReportInner />
    </Suspense>
  );
}

'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrintDocument, PrintEmpty, PrintSection, PrintStat } from '@/components/print/print-document';
import { PrintDelta } from '@/components/print/print-delta';
import { PrintTable, type PrintColumn } from '@/components/print/print-table';
import { printDateTime, printWindow } from '@/components/print/print-query';
import { usePrintData } from '@/components/print/use-print-data';
import { AppBadge, KindBadge, MethodBadge } from '@/components/data-display/trace-badges';
import { PERIODS, windowOf, type Period } from '@/features/digest/digest-period';
import { pct, STATE_META } from '@/features/slos/slo-format';
import { cn, formatMs } from '@/lib/utils';
import type { Digest, DigestRoute, ErrorGroup } from '@stacklens/shared/api-types';

const routeCol: PrintColumn<DigestRoute> = {
  header: 'Route',
  width: '52%',
  cell: (r) => (
    <div className="flex items-start gap-1.5">
      {r.method && <MethodBadge method={r.method} className="w-[46px]" />}
      <div className="min-w-0">
        <div className="break-all font-mono">{r.route}</div>
        <AppBadge name={r.application} className="mt-0.5" />
      </div>
    </div>
  ),
};

function routeColumns(mode: 'regression' | 'slow' | 'busy'): PrintColumn<DigestRoute>[] {
  return [
    routeCol,
    { header: 'Requests', align: 'right', cell: (r) => <span className="font-mono">{r.count.toLocaleString()}</span> },
    { header: 'Errors', align: 'right', cell: (r) => <span className={cn('font-mono', r.errors && 'text-destructive')}>{r.errors}</span> },
    {
      header: mode === 'regression' ? 'p95 before → now' : 'p95',
      align: 'right',
      width: mode === 'regression' ? '22%' : undefined,
      cell: (r) =>
        mode === 'regression' && r.previousP95 !== undefined ? (
          <span className="font-mono">
            <span className="text-muted-foreground">{formatMs(r.previousP95)}</span> →{' '}
            <span className="font-medium text-destructive">{formatMs(r.p95)}</span>
            <span className="ml-1 text-[9.5px] text-destructive">×{(r.p95 / r.previousP95).toFixed(1)}</span>
          </span>
        ) : (
          <span className="font-mono">{formatMs(r.p95)}</span>
        ),
    },
  ];
}

const errorColumns: PrintColumn<ErrorGroup>[] = [
  {
    header: 'Error',
    width: '62%',
    cell: (e) => (
      <>
        <div className="flex flex-wrap items-baseline gap-1.5">
          <span className={cn('font-medium', e.severity === 'warning' ? 'text-warning' : 'text-destructive')}>{e.name}</span>
          <span className="break-all font-mono text-[10px] text-muted-foreground">in {e.spanName}</span>
          <KindBadge kind={e.kind} className="text-[9px]" />
        </div>
        <div className="break-words text-muted-foreground">{e.message}</div>
      </>
    ),
  },
  { header: 'Events', align: 'right', cell: (e) => <span className="font-mono">{e.count.toLocaleString()}×</span> },
  { header: 'First seen', cell: (e) => <span className="text-[10px]">{printDateTime(e.firstSeen)}</span> },
];

function DigestReportInner() {
  const sp = useSearchParams();
  const period = ((sp.get('period') ?? '') in PERIODS ? sp.get('period') : '24h') as Period;
  const project = sp.get('project') ?? '';
  // same minute-rounded "now" as the Digest page, taken at the moment of the export
  const now = Math.floor(printWindow(sp).at / 60_000) * 60_000;
  const { from, to } = windowOf(period, now);
  const q = new URLSearchParams({ from: String(from), to: String(to) });
  if (project) q.set('project', project);
  const { data, error, fetchedAt } = usePrintData<{ d: Digest }>({ d: `/api/digest?${q}` });
  const d = data?.d;

  const filters = [
    { label: 'Period', value: `${PERIODS[period]} · ${printDateTime(from)} → ${printDateTime(to)}` },
    { label: 'Project', value: project || 'All projects' },
  ];

  return (
    <PrintDocument
      title="Daily digest"
      subtitle="What changed compared with the period before"
      filters={filters}
      generatedAt={fetchedAt}
      ready={!!d}
      error={error}
    >
      {d && (
        <>
          <div className="grid grid-cols-4 gap-2.5">
            <PrintStat
              label="Requests"
              value={d.totals.total.toLocaleString()}
              sub={<PrintDelta cur={d.totals.total} prev={d.previous.total} />}
            />
            <PrintStat
              label="Error rate"
              value={pct(d.totals.errorRate, 2)}
              sub={<PrintDelta cur={d.totals.errorRate} prev={d.previous.errorRate} higherIsBad />}
            />
            <PrintStat
              label="p95 latency"
              value={formatMs(d.totals.p95)}
              sub={<PrintDelta cur={d.totals.p95} prev={d.previous.p95} higherIsBad />}
            />
            <PrintStat
              label="Users"
              value={d.totals.users.toLocaleString()}
              sub={<PrintDelta cur={d.totals.users} prev={d.previous.users} />}
            />
          </div>

          <PrintSection title="New errors" description="Kinds of errors first seen in this period" right={d.newErrors.length || undefined}>
            {d.newErrors.length ? (
              <PrintTable rows={d.newErrors} rowKey={(e) => e.id} columns={errorColumns} />
            ) : (
              <PrintEmpty>No new kinds of errors in this period.</PrintEmpty>
            )}
          </PrintSection>

          <PrintSection
            title="Slower than the period before"
            description="Routes whose p95 grew the most"
            right={d.regressions.length || undefined}
          >
            {d.regressions.length ? (
              <PrintTable
                rows={d.regressions}
                rowKey={(r) => `${r.application}${r.method}${r.route}`}
                columns={routeColumns('regression')}
              />
            ) : (
              <PrintEmpty>No route got noticeably slower.</PrintEmpty>
            )}
          </PrintSection>

          <PrintSection title="Most frequent errors" right={d.topErrors.length || undefined}>
            {d.topErrors.length ? (
              <PrintTable rows={d.topErrors} rowKey={(e) => e.id} columns={errorColumns} />
            ) : (
              <PrintEmpty>No errors in this period.</PrintEmpty>
            )}
          </PrintSection>

          <div className="grid grid-cols-2 gap-5">
            <PrintSection title="Slowest routes">
              {d.slowestRoutes.length ? (
                <PrintTable rows={d.slowestRoutes} rowKey={(r) => `${r.application}${r.method}${r.route}`} columns={routeColumns('slow')} />
              ) : (
                <PrintEmpty>Not enough traffic yet.</PrintEmpty>
              )}
            </PrintSection>
            <PrintSection title="Busiest routes">
              {d.busiestRoutes.length ? (
                <PrintTable rows={d.busiestRoutes} rowKey={(r) => `${r.application}${r.method}${r.route}`} columns={routeColumns('busy')} />
              ) : (
                <PrintEmpty>No traffic in this period.</PrintEmpty>
              )}
            </PrintSection>
          </div>

          <PrintSection title="SLOs" keepTogether>
            {d.slos.length ? (
              <PrintTable
                rows={d.slos}
                rowKey={(s) => s.id}
                columns={[
                  {
                    header: 'Objective',
                    width: '40%',
                    cell: (s) => (
                      <span className="flex items-center gap-1.5">
                        <span className={cn('size-2 shrink-0 rounded-full', STATE_META[s.state].dot)} />
                        {s.name}
                      </span>
                    ),
                  },
                  { header: 'State', cell: (s) => <span className={STATE_META[s.state].text}>{STATE_META[s.state].label}</span> },
                  {
                    header: 'Latency',
                    align: 'right',
                    cell: (s) => <span className="font-mono">{s.total ? pct(s.latency.attained, 2) : '—'}</span>,
                  },
                  {
                    header: 'Availability',
                    align: 'right',
                    cell: (s) => <span className="font-mono">{s.total ? pct(s.availability.attained, 2) : '—'}</span>,
                  },
                ]}
              />
            ) : (
              <PrintEmpty>No SLOs yet.</PrintEmpty>
            )}
          </PrintSection>
        </>
      )}
    </PrintDocument>
  );
}

export default function DigestReport() {
  return (
    <Suspense>
      <DigestReportInner />
    </Suspense>
  );
}

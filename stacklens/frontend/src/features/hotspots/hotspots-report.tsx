'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrintDocument, PrintSection } from '@/components/print/print-document';
import { PrintTable } from '@/components/print/print-table';
import { ShareBar } from '@/components/print/print-charts';
import { globalFilters, printApiQuery, sliceForPrint } from '@/components/print/print-query';
import { usePrintData } from '@/components/print/use-print-data';
import { KindBadge } from '@/components/data-display/trace-badges';
import { cn, formatMs, KIND_META } from '@/lib/utils';
import type { Hotspot, SpanKind } from '@stacklens/shared/api-types';

const SORTS = { totalSelf: 'Total self time', calls: 'Calls', avg: 'Avg', p95: 'p95', errors: 'Errors' } as const;
type SortKey = keyof typeof SORTS;

function HotspotsReportInner() {
  const sp = useSearchParams();
  const search = sp.get('search') ?? '';
  const kind = (sp.get('kind') ?? '') as SpanKind | '';
  const sort: SortKey = (sp.get('sort') ?? '') in SORTS ? (sp.get('sort') as SortKey) : 'totalSelf';
  const { data, error, fetchedAt } = usePrintData<{ h: { hotspots: Hotspot[] } }>({ h: `/api/hotspots?${printApiQuery(sp, { search })}` });
  const items = (data?.h.hotspots ?? []).filter((h) => !kind || h.kind === kind).sort((a, b) => b[sort] - a[sort]);
  const { rows, note } = sliceForPrint(sp, items, 'functions');
  const maxSelf = Math.max(1, ...items.map((r) => r.totalSelf));

  const filters = [...globalFilters(sp)];
  if (search) filters.push({ label: 'Search', value: search });
  if (kind) filters.push({ label: 'Layer', value: KIND_META[kind]?.label ?? kind });
  filters.push({ label: 'Sorted by', value: SORTS[sort] });

  return (
    <PrintDocument
      title="Hotspots"
      landscape
      subtitle="Every instrumented function aggregated across the traces in range"
      filters={filters}
      notes={data ? [note] : []}
      generatedAt={fetchedAt}
      ready={!!data}
      error={error}
    >
      <PrintSection title="Functions" right={`${items.length.toLocaleString()} functions`}>
        <PrintTable
          rows={rows}
          rowKey={(h) => h.name}
          empty="No data in this range."
          columns={[
            {
              header: 'Function',
              width: '22%',
              cell: (h) => (
                <>
                  <div className="break-all font-mono">{h.name}</div>
                  <div className="text-[9.5px] text-muted-foreground">
                    in {h.traces} trace{h.traces === 1 ? '' : 's'}
                    {h.async ? ' · async' : ''}
                  </div>
                </>
              ),
            },
            { header: 'Layer', width: '9%', cell: (h) => <KindBadge kind={h.kind} className="text-[9px]" /> },
            { header: 'Calls', width: '7%', align: 'right', cell: (h) => <span className="font-mono">{h.calls.toLocaleString()}</span> },
            { header: 'Avg', width: '8%', align: 'right', cell: (h) => <span className="font-mono">{formatMs(h.avg)}</span> },
            { header: 'p95', width: '8%', align: 'right', cell: (h) => <span className="font-mono">{formatMs(h.p95)}</span> },
            {
              header: 'Errors',
              width: '7%',
              align: 'right',
              cell: (h) => <span className={cn('font-mono', h.errors && 'text-destructive')}>{h.errors || '—'}</span>,
            },
            {
              header: 'Total self',
              width: '12%',
              cell: (h) => (
                <>
                  <span className="font-mono">{formatMs(h.totalSelf)}</span>
                  <ShareBar pct={(h.totalSelf / maxSelf) * 100} color="var(--warning)" />
                </>
              ),
            },
            {
              header: 'Signature',
              cell: (h) => (
                <code className="break-words font-mono text-[9.5px]">
                  <span className="text-muted-foreground">(</span>
                  {h.params.map((p, i) => (
                    <span key={i}>
                      {i > 0 && <span className="text-muted-foreground">, </span>}
                      <span className="text-orange-600">{p}</span>
                      {h.argTypes?.[i] && <span className="text-muted-foreground">: {h.argTypes[i]}</span>}
                    </span>
                  ))}
                  <span className="text-muted-foreground">) → </span>
                  {h.async ? `Promise<${h.resultType ?? 'void'}>` : (h.resultType ?? 'void')}
                </code>
              ),
            },
          ]}
        />
      </PrintSection>
    </PrintDocument>
  );
}

export default function HotspotsReport() {
  return (
    <Suspense>
      <HotspotsReportInner />
    </Suspense>
  );
}

'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrintDocument, PrintSection, PrintStat } from '@/components/print/print-document';
import { PrintTable } from '@/components/print/print-table';
import { MiniBars } from '@/components/print/print-charts';
import { globalFilters, printApiQuery, printShortDateTime, sliceForPrint } from '@/components/print/print-query';
import { usePrintData } from '@/components/print/use-print-data';
import { KindBadge } from '@/components/data-display/trace-badges';
import { IncidentChip } from '@/features/incidents/components/incident-badges';
import { cn, SEVERITY } from '@/lib/utils';
import type { ErrorGroup } from '@stacklens/shared/api-types';

function ErrorsReportInner() {
  const sp = useSearchParams();
  const search = sp.get('search') ?? '';
  const { data, error, fetchedAt } = usePrintData<{ e: { groups: ErrorGroup[] } }>({ e: `/api/errors?${printApiQuery(sp)}` });
  // same client-side search as the Errors page
  const groups = (data?.e.groups ?? []).filter(
    (g) => !search || `${g.name} ${g.message} ${g.spanName}`.toLowerCase().includes(search.toLowerCase()),
  );
  const { rows, note } = sliceForPrint(sp, groups, 'error groups');
  const events = groups.reduce((a, g) => a + g.count, 0);
  const filters = [...globalFilters(sp), ...(search ? [{ label: 'Search', value: search }] : [])];

  return (
    <PrintDocument
      title="Errors"
      landscape
      subtitle="Exceptions grouped by where they were thrown"
      filters={filters}
      notes={data ? [note] : []}
      generatedAt={fetchedAt}
      ready={!!data}
      error={error}
    >
      <div className="grid grid-cols-4 gap-2.5">
        <PrintStat label="Error groups" value={groups.length.toLocaleString()} />
        <PrintStat label="Occurrences" value={events.toLocaleString()} tone={events ? 'error' : undefined} />
        <PrintStat label="Server errors" value={groups.filter((g) => g.severity === 'error').length.toLocaleString()} />
        <PrintStat label="With an incident" value={groups.filter((g) => g.incident).length.toLocaleString()} />
      </div>
      <PrintSection title="Error groups" right={`${groups.length.toLocaleString()} groups · ${events.toLocaleString()} occurrences`}>
        <PrintTable
          rows={rows}
          rowKey={(g) => g.key}
          empty="No errors in this time range."
          columns={[
            {
              header: 'Error',
              width: '38%',
              cell: (g) => {
                const S = SEVERITY[g.severity];
                return (
                  <>
                    <div className="flex flex-wrap items-baseline gap-1.5">
                      <span className={cn('font-mono font-semibold', S.text)}>{g.name}</span>
                      {g.severity === 'warning' && (
                        <span className="rounded bg-amber-500/10 px-1 text-[9.5px] text-amber-700">
                          client error{g.status ? ` · ${g.status}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 break-words">{g.message}</div>
                    <div className="mt-0.5 break-all font-mono text-[9.5px] text-muted-foreground">
                      {[...g.routes.slice(0, 3), ...g.applications].join(' · ')}
                    </div>
                  </>
                );
              },
            },
            {
              header: 'Thrown in',
              width: '20%',
              cell: (g) => (
                <>
                  <div className="break-all font-mono text-[10px]">{g.spanName}</div>
                  <KindBadge kind={g.kind} className="mt-0.5 text-[9px]" />
                </>
              ),
            },
            {
              header: 'Trend',
              width: '11%',
              cell: (g) => (
                <MiniBars values={g.series} width={64} color={g.severity === 'warning' ? 'var(--warning)' : 'var(--destructive)'} />
              ),
            },
            { header: 'Events', width: '7%', align: 'right', cell: (g) => <span className="font-mono">{g.count.toLocaleString()}</span> },
            { header: 'Users', width: '6%', align: 'right', cell: (g) => <span className="font-mono">{g.users}</span> },
            {
              header: 'Seen',
              width: '11%',
              cell: (g) => (
                <div className="text-[9.5px] leading-tight">
                  <div>last {printShortDateTime(g.lastSeen)}</div>
                  <div className="text-muted-foreground">first {printShortDateTime(g.firstSeen)}</div>
                </div>
              ),
            },
            {
              header: 'Incident',
              className: 'whitespace-nowrap',
              cell: (g) =>
                g.incident ? (
                  <IncidentChip number={g.incident.number} stateCode={g.incident.stateCode} state={g.incident.state} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
            },
          ]}
        />
      </PrintSection>
    </PrintDocument>
  );
}

export default function ErrorsReport() {
  return (
    <Suspense>
      <ErrorsReportInner />
    </Suspense>
  );
}

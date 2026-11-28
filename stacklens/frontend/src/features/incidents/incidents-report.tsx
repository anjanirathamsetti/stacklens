'use client';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { PrintDocument, PrintEmpty, PrintSection, PrintStat } from '@/components/print/print-document';
import { PrintTable } from '@/components/print/print-table';
import { globalFilters, MAX_PRINT_ROWS, printApiQuery, printDateTime, sliceForPrint } from '@/components/print/print-query';
import { usePrintData } from '@/components/print/use-print-data';
import { PriorityBadge, StateBadge } from '@/features/incidents/components/incident-badges';
import { cn, SEVERITY } from '@/lib/utils';
import type { IncidentRow } from '@/features/incidents/incidents-page';
import type { ErrorGroup, IncidentSource } from '@stacklens/shared/api-types';

const TABS = { open: 'Open', resolved: 'Resolved', all: 'All' } as const;

function IncidentsReportInner() {
  const sp = useSearchParams();
  const tab = (sp.get('tab') ?? '') in TABS ? (sp.get('tab') as keyof typeof TABS) : 'open';
  const search = sp.get('search') ?? '';
  const { data, error, fetchedAt } = usePrintData<{ i: { source: IncidentSource; incidents: IncidentRow[]; untracked: ErrorGroup[] } }>({
    i: `/api/incidents?${printApiQuery(sp)}`,
  });
  const all = data?.i.incidents ?? [];
  const untracked = data?.i.untracked ?? [];
  const open = all.filter((r) => r.stateCode < 6);
  // same tab + search as the Incidents page
  const list = (tab === 'open' ? open : tab === 'resolved' ? all.filter((r) => r.stateCode >= 6) : all).filter(
    (r) => !search || `${r.number} ${r.shortDescription} ${r.error?.spanName ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );
  const { rows, note } = sliceForPrint(sp, list, 'incidents', 25);
  const regressions = all.filter((r) => r.stateCode >= 6 && r.resolvedAt && r.lastSeen && r.lastSeen > r.resolvedAt).length;
  const src = data?.i.source;

  const filters = [...globalFilters(sp), { label: 'Showing', value: TABS[tab] }];
  if (search) filters.push({ label: 'Search', value: search });
  if (src)
    filters.push({
      label: 'Source',
      value: src.mode === 'servicenow' ? `ServiceNow · ${src.instance?.replace(/^https?:\/\//, '') ?? ''}` : 'Demo mode (local tickets)',
    });

  return (
    <PrintDocument
      title="Incidents"
      landscape
      subtitle="ServiceNow tickets tied to the errors StackLens detects"
      filters={filters}
      notes={data ? [note] : []}
      generatedAt={fetchedAt}
      ready={!!data}
      error={error}
    >
      <div className="grid grid-cols-4 gap-2.5">
        <PrintStat label="Open incidents" value={open.length} />
        <PrintStat
          label="P1 / P2 open"
          value={open.filter((r) => r.priorityCode <= 2).length}
          tone={open.some((r) => r.priorityCode <= 2) ? 'warning' : undefined}
        />
        <PrintStat label="Errors without a ticket" value={untracked.length} />
        <PrintStat label="Regressed after resolve" value={regressions} tone={regressions ? 'error' : undefined} />
      </div>

      <PrintSection title={`${TABS[tab]} incidents`} right={`${list.length.toLocaleString()} incidents`}>
        <PrintTable
          rows={rows}
          rowKey={(r) => r.sysId}
          empty={tab === 'open' ? 'No open incidents.' : 'No incidents here yet.'}
          columns={[
            {
              header: 'Incident',
              width: '28%',
              cell: (r) => (
                <>
                  <div className="font-mono font-semibold">{r.number}</div>
                  <div className="break-words text-muted-foreground">{r.shortDescription}</div>
                  {(r.assignmentGroup || r.assignedTo) && (
                    <div className="text-[9.5px] text-muted-foreground">
                      {[r.assignmentGroup, r.assignedTo].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </>
              ),
            },
            {
              header: 'Tracked error',
              width: '26%',
              cell: (r) =>
                r.error ? (
                  <>
                    <div className={cn('break-all font-mono', SEVERITY[r.error.severity].text)}>{r.error.name}</div>
                    <div className="break-all font-mono text-[9.5px] text-muted-foreground">{r.error.spanName}</div>
                  </>
                ) : (
                  <span className="text-muted-foreground">{r.errorId ? 'no occurrences in range' : '—'}</span>
                ),
            },
            { header: 'Priority', width: '8%', cell: (r) => <PriorityBadge code={r.priorityCode} /> },
            { header: 'State', width: '12%', cell: (r) => <StateBadge code={r.stateCode} label={r.state} /> },
            {
              header: 'Events since opened',
              width: '11%',
              align: 'right',
              cell: (r) => {
                const regressed = r.stateCode >= 6 && r.resolvedAt && r.lastSeen && r.lastSeen > r.resolvedAt;
                return (
                  <>
                    <span className="font-mono">{r.eventsSinceOpened}</span>
                    {regressed && <div className="text-[9.5px] text-destructive">regressed</div>}
                  </>
                );
              },
            },
            { header: 'Opened', cell: (r) => <span className="text-[10px]">{printDateTime(r.openedAt)}</span> },
          ]}
        />
      </PrintSection>

      <PrintSection title="Errors without a ticket" description="Recurring errors in range that no open incident tracks">
        {untracked.length ? (
          <PrintTable
            rows={untracked.slice(0, MAX_PRINT_ROWS)}
            rowKey={(g) => g.id}
            columns={[
              {
                header: 'Error',
                width: '50%',
                cell: (g) => (
                  <>
                    <span className={cn('font-mono font-semibold', SEVERITY[g.severity].text)}>{g.name}</span>{' '}
                    <span className="text-muted-foreground">in</span> <span className="break-all font-mono">{g.spanName}</span>
                    <div className="break-words text-muted-foreground">{g.message}</div>
                  </>
                ),
              },
              { header: 'Events', align: 'right', cell: (g) => <span className="font-mono">{g.count}</span> },
              { header: 'Users', align: 'right', cell: (g) => <span className="font-mono">{g.users}</span> },
              { header: 'Applications', width: '22%', cell: (g) => <span className="break-words">{g.applications.join(', ')}</span> },
            ]}
          />
        ) : (
          <PrintEmpty>Every error in range is tracked.</PrintEmpty>
        )}
      </PrintSection>
    </PrintDocument>
  );
}

export default function IncidentsReport() {
  return (
    <Suspense>
      <IncidentsReportInner />
    </Suspense>
  );
}

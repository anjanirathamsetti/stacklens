'use client';
import { Suspense, startTransition, useCallback, useEffect, useState } from 'react';
import { useCan } from '@/lib/current-user';
import Link from 'next/link';
import { Bug, ChevronRight, Search, ShieldCheck, Siren, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IncidentChip } from '@/features/incidents/components/incident-badges';
import { CreateIncidentDialog } from '@/features/incidents/components/create-incident-dialog';
import { Pagination, TableShell, filterKeyOf, usePaged } from '@/components/data-display/pagination';
import { PageHeader } from '@/components/layout/page-header';
import { ExportPdfButton } from '@/components/print/export-pdf-button';
import { SummarizeErrorsButton } from '@/features/ai/components/ai-entry-points';
import { FilterBar, PageActions } from '@/components/layout/filter-bar';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { KindBadge } from '@/components/data-display/trace-badges';
import { useLive } from '@/components/layout/providers';
import { useFilters, useLiveRefresh } from '@/lib/url-filters';
import { cn, SEVERITY, timeAgo } from '@/lib/utils';
import type { ErrorGroup, IncidentSource } from '@stacklens/shared/api-types';

function MiniBars({ values, tone = 'bg-rose-400' }: { values: number[]; tone?: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-7 w-28 items-end gap-[2px]">
      {values.map((v, i) => (
        <div
          key={i}
          className={cn('flex-1 rounded-[1px]', tone)}
          style={{ height: `${v ? Math.max(12, (v / max) * 100) : 4}%`, opacity: v ? 1 : 0.15 }}
        />
      ))}
    </div>
  );
}

function ErrorsInner() {
  const { apiQuery, key, globalQs, sp } = useFilters();
  const { live } = useLive();
  const [groups, setGroups] = useState<ErrorGroup[] | null>(null);
  const [search, setSearch] = useState('');
  const [createFor, setCreateFor] = useState<string | null>(null);
  const canWrite = useCan('member');
  const [source, setSource] = useState<IncidentSource>();
  useEffect(() => {
    fetch('/api/incidents?limit=1')
      .then((r) => r.json())
      .then((d) => setSource(d.source))
      .catch(() => {});
  }, []);

  const load = useCallback(() => {
    fetch(`/api/errors?${apiQuery()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => startTransition(() => setGroups(d.groups)));
  }, [apiQuery]);
  useEffect(load, [key, load]);
  useLiveRefresh(load, live);

  const rows = (groups ?? []).filter((g) => !search || `${g.name} ${g.message} ${g.spanName}`.toLowerCase().includes(search.toLowerCase()));
  const total = rows.reduce((a, g) => a + g.count, 0);
  const pg = usePaged(rows, `${filterKeyOf(sp)}|${search}`);

  return (
    <>
      <PageHeader title="Errors" description="Exceptions grouped by where they were thrown">
        <SummarizeErrorsButton />
        <PageActions onRefresh={load} />
        <ExportPdfButton report="errors" params={{ search }} />
      </PageHeader>
      <FilterBar />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        <TableShell
          scrollKey={`${pg.page}-${pg.size}`}
          footer={<Pagination page={pg.page} size={pg.size} total={pg.total} onPage={pg.setPage} onSize={pg.setSize} noun="error groups" />}
          toolbar={
            <div className="flex flex-wrap items-center gap-3 p-3">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search error message or function…"
                  className="pl-8"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <span className="text-xs text-muted-foreground">{groups ? `${rows.length} groups · ${total} occurrences` : 'Loading…'}</span>
              <ExportPdfButton report="errors" variant="table" noun="error groups" params={{ search }} />
            </div>
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="h-9 px-4 font-medium">Error</th>
                <th className="h-9 px-3 font-medium">Thrown in</th>
                <th className="h-9 px-3 font-medium">Trend</th>
                <th className="h-9 px-3 font-medium">Events</th>
                <th className="h-9 px-3 font-medium">Users</th>
                <th className="h-9 px-3 font-medium">Last seen</th>
                <th className="h-9 px-3 font-medium">Incident</th>
                <th className="h-9 w-8" />
              </tr>
            </thead>
            <tbody>
              {pg.rows.map((g) => {
                const S = SEVERITY[g.severity];
                return (
                  <tr key={g.key} className="group border-b last:border-0 hover:bg-accent/40">
                    <td className="max-w-[460px] px-4 py-3">
                      <Link href={`/traces/${g.sampleTraceId}${globalQs}`} className="block">
                        <div className="flex items-center gap-2">
                          <Bug className={cn('size-3.5 shrink-0', S.text)} />
                          <span className={cn('font-mono text-[13px] font-semibold', S.text)}>{g.name}</span>
                          {g.severity === 'warning' && (
                            <span className="rounded bg-amber-500/10 px-1 text-[10px] text-amber-700 dark:text-amber-300">
                              client error{g.status ? ` · ${g.status}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-xs">{g.message}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {g.routes.slice(0, 3).map((r) => (
                            <span key={r} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                              {r}
                            </span>
                          ))}
                          {g.applications.map((a) => (
                            <span key={a} className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              {a}
                            </span>
                          ))}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3">
                      <div className="font-mono text-xs">{g.spanName}</div>
                      <KindBadge kind={g.kind} className="mt-1" />
                    </td>
                    <td className="px-3">
                      <MiniBars values={g.series} tone={S.bar} />
                    </td>
                    <td className="px-3">
                      <Badge tone={g.severity === 'warning' ? 'warning' : 'error'} className="font-mono">
                        {g.count}
                      </Badge>
                    </td>
                    <td className="px-3">
                      <span className="inline-flex items-center gap-1 font-mono text-xs text-muted-foreground">
                        <Users className="size-3" /> {g.users}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 text-xs text-muted-foreground">
                      {timeAgo(g.lastSeen)}
                      <div className="text-[10px]">first {timeAgo(g.firstSeen)}</div>
                    </td>
                    <td className="px-3">
                      {g.incident ? (
                        <Link href={`/incidents?selected=${g.incident.sysId}`}>
                          <IncidentChip number={g.incident.number} stateCode={g.incident.stateCode} state={g.incident.state} />
                        </Link>
                      ) : canWrite ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-muted-foreground opacity-60 group-hover:opacity-100"
                          onClick={() => setCreateFor(g.id)}
                        >
                          <Siren /> Create
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="pr-3">
                      <ChevronRight className="size-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {groups && rows.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
              <ShieldCheck className="size-6 text-success" />
              No errors in this time range.
            </div>
          )}
        </TableShell>
      </div>
      <CreateIncidentDialog
        errorId={createFor}
        open={!!createFor}
        onOpenChange={(v) => !v && setCreateFor(null)}
        source={source}
        onCreated={() => load()}
      />
    </>
  );
}

export default function ErrorsPage() {
  return (
    <Suspense>
      <ErrorsInner />
    </Suspense>
  );
}

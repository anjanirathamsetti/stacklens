'use client';
import { Suspense, startTransition, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Bug, CheckCircle2, ExternalLink, Loader2, Play, Plug, Search, Send, ShieldCheck, Siren, X } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ExportPdfButton } from '@/components/print/export-pdf-button';
import { FilterBar } from '@/components/layout/filter-bar';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { useLive } from '@/components/layout/providers';
import { KindBadge } from '@/components/data-display/trace-badges';
import { PriorityBadge, StateBadge } from '@/features/incidents/components/incident-badges';
import { CreateIncidentDialog } from '@/features/incidents/components/create-incident-dialog';
import { Pagination, TableShell, filterKeyOf, usePaged } from '@/components/data-display/pagination';
import { useFilters, useLiveRefresh } from '@/lib/url-filters';
import { useCan, useCurrentUser } from '@/lib/current-user';
import { cn, SEVERITY, timeAgo } from '@/lib/utils';
import type { ErrorGroup, Incident, IncidentSource, SpanKind } from '@stacklens/shared/api-types';

/** An incident as `/api/incidents` returns it: the ticket plus live stats of the error it tracks. */
export type IncidentRow = Incident & {
  error?: {
    id: string;
    name: string;
    message: string;
    spanName: string;
    kind: SpanKind;
    applications: string[];
    routes: string[];
    severity: 'error' | 'warning';
    series: number[];
  };
  eventsSinceOpened: number;
  lastSeen?: number;
  lastTraceId?: string;
};
type Row = IncidentRow;

function MiniBars({ values, tone }: { values: number[]; tone: string }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-6 w-24 items-end gap-[2px]">
      {values.map((v, i) => (
        <div
          key={i}
          className={cn('flex-1 rounded-[1px]', tone)}
          style={{ height: `${v ? Math.max(14, (v / max) * 100) : 6}%`, opacity: v ? 0.85 : 0.15 }}
        />
      ))}
    </div>
  );
}

function Stat({ label, value, tone, icon: Icon }: { label: string; value: React.ReactNode; tone?: string; icon: any }) {
  return (
    <Card className="px-4 py-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {label}
        <Icon className="size-3.5" />
      </div>
      <div className={cn('mt-1 text-2xl font-semibold tabular-nums', tone)}>{value}</div>
    </Card>
  );
}

function SourceBanner({ source }: { source?: IncidentSource }) {
  if (!source) return null;
  if (source.mode === 'servicenow')
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs',
          source.error ? 'border-rose-400/40 text-rose-600 dark:text-rose-300' : 'text-muted-foreground',
        )}
      >
        <span className={cn('size-1.5 rounded-full', source.error ? 'bg-rose-400' : 'bg-success')} />
        ServiceNow · {source.instance?.replace(/^https?:\/\//, '')}
        {source.error && <span className="truncate">· {source.error}</span>}
      </span>
    );
  return (
    <Tooltip
      content={
        <div className="max-w-xs space-y-1">
          <div className="font-medium">Demo mode</div>
          <div className="text-muted-foreground">
            Tickets are stored locally. To sync with ServiceNow, copy <code className="font-mono">stacklens/frontend/.env.example</code> to{' '}
            <code className="font-mono">.env.local</code> and set SERVICENOW_INSTANCE plus credentials, then restart the dashboard.
          </div>
        </div>
      }
    >
      <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
        <Plug className="size-3.5" /> Demo mode · ServiceNow not connected
      </span>
    </Tooltip>
  );
}

function IncidentPanel({ row, onClose, onChanged }: { row: Row; onClose: () => void; onChanged: () => void }) {
  const author = useCurrentUser().user.name;
  const canWrite = useCan('member');
  const [detail, setDetail] = useState<Incident | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/incidents/${row.sysId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setDetail(d.incident ?? null));
  }, [row.sysId]);
  useEffect(load, [load]);

  const act = async (body: object, label: string) => {
    setBusy(label);
    setErr(null);
    try {
      const r = await fetch(`/api/incidents/${row.sysId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...body, author }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setDetail(d.incident);
      setNote('');
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const inc = detail ?? row;
  const S = row.error ? SEVERITY[row.error.severity] : null;

  return (
    <aside className="flex w-[440px] shrink-0 flex-col border-l bg-card/40" style={{ animation: 'slide-in 160ms ease-out' }}>
      <div className="border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-semibold">{inc.number}</span>
              <StateBadge code={inc.stateCode} label={inc.state} />
              <PriorityBadge code={inc.priorityCode} label={inc.priority} />
            </div>
            <div className="mt-1.5 text-sm">{inc.shortDescription}</div>
          </div>
          <button
            onClick={onClose}
            className="grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {inc.url && (
            <a href={inc.url} target="_blank" rel="noreferrer">
              <Button size="sm" variant="outline">
                <ExternalLink /> Open in ServiceNow
              </Button>
            </a>
          )}
          {canWrite && inc.stateCode === 1 && (
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act({ action: 'start' }, 'start')}>
              {busy === 'start' ? <Loader2 className="animate-spin" /> : <Play />} Start work
            </Button>
          )}
          {canWrite && inc.stateCode < 6 && (
            <Button
              size="sm"
              variant="outline"
              disabled={!!busy}
              onClick={() => act({ action: 'resolve', text: note || 'Fixed – error no longer occurring in StackLens.' }, 'resolve')}
            >
              {busy === 'resolve' ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Resolve
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {row.error && S && (
          <div className={cn('rounded-lg border p-3', S.border, S.soft)}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className={cn('flex items-center gap-1.5 font-medium', S.text)}>
                <Bug className="size-3.5" /> Tracked error
              </span>
              <MiniBars values={row.error.series} tone={S.bar} />
            </div>
            <div className="font-mono text-xs font-semibold">{row.error.name}</div>
            <div className="text-xs">{row.error.message}</div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="font-mono">{row.error.spanName}</span>
              <KindBadge kind={row.error.kind} />
            </div>
            <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-md bg-background/60 px-2 py-1.5">
                <div className="text-[10px] text-muted-foreground">since ticket opened</div>
                <div className={cn('font-mono font-medium', row.eventsSinceOpened > 0 && inc.stateCode >= 6 && S.text)}>
                  {row.eventsSinceOpened} events
                </div>
              </div>
              <div className="rounded-md bg-background/60 px-2 py-1.5">
                <div className="text-[10px] text-muted-foreground">last seen</div>
                <div className="font-mono font-medium">{row.lastSeen ? timeAgo(row.lastSeen) : '—'}</div>
              </div>
            </div>
            {inc.stateCode >= 6 && row.eventsSinceOpened > 0 && row.lastSeen && inc.resolvedAt && row.lastSeen > inc.resolvedAt && (
              <div className={cn('mt-2 flex items-center gap-1.5 text-[11px] font-medium', S.text)}>
                <AlertTriangle className="size-3.5" /> Still occurring after the ticket was resolved
              </div>
            )}
            {row.lastTraceId && (
              <Link href={`/traces/${row.lastTraceId}`} className="mt-2 inline-flex items-center gap-1 text-xs text-brand hover:underline">
                Open latest trace <ExternalLink className="size-3" />
              </Link>
            )}
          </div>
        )}

        <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="text-muted-foreground">Opened</dt>
          <dd>{new Date(inc.openedAt).toLocaleString()}</dd>
          <dt className="text-muted-foreground">Updated</dt>
          <dd>{timeAgo(inc.updatedAt)}</dd>
          <dt className="text-muted-foreground">Assignment group</dt>
          <dd>{inc.assignmentGroup ?? '—'}</dd>
          <dt className="text-muted-foreground">Assigned to</dt>
          <dd>{inc.assignedTo ?? '—'}</dd>
          <dt className="text-muted-foreground">Urgency / impact</dt>
          <dd>
            {inc.urgency} / {inc.impact}
          </dd>
          <dt className="text-muted-foreground">Correlation id</dt>
          <dd className="break-all font-mono">{inc.correlationId ?? '—'}</dd>
        </dl>

        {detail?.description && (
          <details className="rounded-lg border">
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium">Description</summary>
            <pre className="whitespace-pre-wrap border-t px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {detail.description}
            </pre>
          </details>
        )}

        <div>
          <div className="mb-2 text-xs font-medium">Work notes</div>
          <div className="flex gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={canWrite ? 'Add a work note…' : 'Viewers can’t add work notes'}
              disabled={!canWrite}
              onKeyDown={(e) => e.key === 'Enter' && note.trim() && act({ action: 'note', text: note }, 'note')}
            />
            <Button
              size="icon"
              disabled={!note.trim() || !!busy}
              onClick={() => act({ action: 'note', text: note }, 'note')}
              aria-label="Post note"
            >
              {busy === 'note' ? <Loader2 className="animate-spin" /> : <Send />}
            </Button>
          </div>
          {err && <div className="mt-2 text-xs text-rose-600 dark:text-rose-300">{err}</div>}
          <ol className="mt-3 space-y-2.5 border-l pl-3">
            {[...(detail?.workNotes ?? [])]
              .sort((a, b) => b.at - a.at)
              .map((n, i) => (
                <li key={i} className="relative text-xs">
                  <span className="absolute -left-[17px] top-1 size-2 rounded-full border-2 border-background bg-muted-foreground/50" />
                  <div className="text-[10px] text-muted-foreground">
                    {n.author} · {timeAgo(n.at)}
                  </div>
                  <div className="whitespace-pre-wrap">{n.text}</div>
                </li>
              ))}
            {detail && !detail.workNotes?.length && <li className="text-xs text-muted-foreground">No work notes yet.</li>}
          </ol>
        </div>
      </div>
    </aside>
  );
}

function IncidentsInner() {
  const { apiQuery, key, sp, set } = useFilters();
  const { live } = useLive();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [untracked, setUntracked] = useState<ErrorGroup[]>([]);
  const [source, setSource] = useState<IncidentSource>();
  const [tab, setTab] = useState<'open' | 'resolved' | 'all'>('open');
  const [search, setSearch] = useState('');
  const [createFor, setCreateFor] = useState<string | null>(null);
  const canWrite = useCan('member');
  const selectedId = sp.get('selected');

  const load = useCallback(() => {
    fetch(`/api/incidents?${apiQuery()}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) =>
        startTransition(() => {
          setRows(d.incidents);
          setUntracked(d.untracked);
          setSource(d.source);
        }),
      );
  }, [apiQuery]);
  useEffect(load, [key, load]);
  useLiveRefresh(load, live, 15_000);

  const all = rows ?? [];
  const open = all.filter((r) => r.stateCode < 6);
  const list = (tab === 'open' ? open : tab === 'resolved' ? all.filter((r) => r.stateCode >= 6) : all).filter(
    (r) => !search || `${r.number} ${r.shortDescription} ${r.error?.spanName ?? ''}`.toLowerCase().includes(search.toLowerCase()),
  );
  const selected = all.find((r) => r.sysId === selectedId);
  const pg = usePaged(list, `${filterKeyOf(sp)}|${tab}|${search}`, 25);
  const regressions = all.filter((r) => r.stateCode >= 6 && r.resolvedAt && r.lastSeen && r.lastSeen > r.resolvedAt).length;

  return (
    <>
      <PageHeader title="Incidents" description="ServiceNow tickets tied to the errors StackLens detects">
        <SourceBanner source={source} />
        <ExportPdfButton report="incidents" params={{ tab: tab === 'open' ? '' : tab, search }} />
      </PageHeader>
      <FilterBar onRefresh={load} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
          <div className="grid shrink-0 grid-cols-2 gap-3 xl:grid-cols-4">
            <Stat label="Open incidents" value={rows ? open.length : '–'} icon={Siren} />
            <Stat
              label="P1 / P2 open"
              value={rows ? open.filter((r) => r.priorityCode <= 2).length : '–'}
              icon={AlertTriangle}
              tone={open.some((r) => r.priorityCode <= 2) ? 'text-orange-600 dark:text-orange-300' : undefined}
            />
            <Stat label="Errors without a ticket" value={rows ? untracked.length : '–'} icon={Bug} />
            <Stat
              label="Regressed after resolve"
              value={rows ? regressions : '–'}
              icon={ShieldCheck}
              tone={regressions ? 'text-rose-600 dark:text-rose-300' : undefined}
            />
          </div>

          <div className="grid min-h-0 flex-1 gap-4 2xl:grid-cols-[1fr_380px]">
            <TableShell
              minHeight={380}
              scrollKey={`${pg.page}-${pg.size}-${tab}`}
              footer={
                <Pagination page={pg.page} size={pg.size} total={pg.total} onPage={pg.setPage} onSize={pg.setSize} noun="incidents" />
              }
              toolbar={
                <div className="flex flex-wrap items-center gap-2 p-3">
                  <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
                    <TabsList>
                      <TabsTrigger value="open">Open {rows && <span className="font-mono text-[10px]">{open.length}</span>}</TabsTrigger>
                      <TabsTrigger value="resolved">Resolved</TabsTrigger>
                      <TabsTrigger value="all">All</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <div className="relative min-w-48 flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search number, summary or function…"
                      className="pl-8"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <ExportPdfButton
                    report="incidents"
                    variant="table"
                    noun="incidents"
                    params={{ tab: tab === 'open' ? '' : tab, search }}
                  />
                </div>
              }
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                    <th className="h-9 px-4 font-medium">Incident</th>
                    <th className="h-9 px-3 font-medium">Tracked error</th>
                    <th className="h-9 px-3 font-medium">Priority</th>
                    <th className="h-9 px-3 font-medium">State</th>
                    <th className="h-9 px-3 font-medium">Events since opened</th>
                    <th className="h-9 px-3 font-medium">Opened</th>
                  </tr>
                </thead>
                <tbody>
                  {pg.rows.map((r) => {
                    const S = r.error ? SEVERITY[r.error.severity] : null;
                    const regressed = r.stateCode >= 6 && r.resolvedAt && r.lastSeen && r.lastSeen > r.resolvedAt;
                    return (
                      <tr
                        key={r.sysId}
                        onClick={() => set({ selected: r.sysId })}
                        className={cn(
                          'cursor-pointer border-b last:border-0 transition-colors hover:bg-accent/50',
                          selectedId === r.sysId && 'bg-brand/[0.07]',
                        )}
                      >
                        <td className="max-w-[320px] px-4 py-2.5">
                          <div className="font-mono text-xs font-semibold">{r.number}</div>
                          <div className="truncate text-xs text-muted-foreground">{r.shortDescription}</div>
                        </td>
                        <td className="max-w-[260px] px-3">
                          {r.error ? (
                            <>
                              <div className={cn('truncate font-mono text-xs', S?.text)}>{r.error.name}</div>
                              <div className="truncate font-mono text-[11px] text-muted-foreground">{r.error.spanName}</div>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">{r.errorId ? 'no occurrences in range' : '—'}</span>
                          )}
                        </td>
                        <td className="px-3">
                          <PriorityBadge code={r.priorityCode} />
                        </td>
                        <td className="px-3">
                          <StateBadge code={r.stateCode} label={r.state} />
                        </td>
                        <td className="px-3">
                          <span className="font-mono text-xs tabular-nums">{r.eventsSinceOpened}</span>
                          {regressed && (
                            <span className="ml-2 rounded bg-rose-500/10 px-1 text-[10px] text-rose-600 dark:text-rose-300">regressed</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-3 text-xs text-muted-foreground">{timeAgo(r.openedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!rows && (
                <div className="grid h-32 place-items-center">
                  <Loader2 className="size-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {rows && list.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-14 text-center text-sm text-muted-foreground">
                  <Siren className="size-6" />
                  {tab === 'open' ? 'No open incidents.' : 'No incidents here yet.'}
                  <span className="text-xs">Create one from an error on the right or on the Errors page.</span>
                </div>
              )}
            </TableShell>

            <Card className="flex max-h-full min-h-0 flex-col overflow-hidden 2xl:h-full">
              <div className="shrink-0 border-b px-4 py-3">
                <div className="text-sm font-medium">Errors without a ticket</div>
                <div className="text-xs text-muted-foreground">Recurring errors in range that no open incident tracks</div>
              </div>
              <div className="min-h-0 flex-1 divide-y overflow-y-auto">
                {untracked.map((g) => {
                  const S = SEVERITY[g.severity];
                  return (
                    <div key={g.id} className="flex items-start gap-3 px-4 py-3">
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', S.dot)} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs">
                          <span className={cn('font-mono font-semibold', S.text)}>{g.name}</span>{' '}
                          <span className="text-muted-foreground">in</span> <span className="font-mono">{g.spanName}</span>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{g.message}</div>
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {g.count} events · {g.users} users · {g.applications.join(', ')}
                        </div>
                      </div>
                      {canWrite && (
                        <Button size="sm" variant="outline" onClick={() => setCreateFor(g.id)}>
                          <Siren /> Ticket
                        </Button>
                      )}
                    </div>
                  );
                })}
                {rows && untracked.length === 0 && (
                  <div className="px-4 py-8 text-center text-xs text-muted-foreground">Every error in range is tracked.</div>
                )}
              </div>
            </Card>
          </div>
        </div>
        {selected && <IncidentPanel key={selected.sysId} row={selected} onClose={() => set({ selected: '' })} onChanged={load} />}
      </div>
      <CreateIncidentDialog
        errorId={createFor}
        open={!!createFor}
        onOpenChange={(v) => !v && setCreateFor(null)}
        source={source}
        onCreated={(inc) => {
          load();
          set({ selected: inc.sysId });
        }}
      />
    </>
  );
}

export default function IncidentsPage() {
  return (
    <Suspense>
      <IncidentsInner />
    </Suspense>
  );
}

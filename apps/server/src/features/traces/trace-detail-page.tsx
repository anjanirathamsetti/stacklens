'use client';
import { Suspense, use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Boxes,
  Braces,
  CheckCircle2,
  ChevronsDownUp,
  ChevronsUpDown,
  Database,
  Flame,
  FolderKanban,
  ListTree,
  Loader2,
  MousePointerClick,
  Network,
  ScrollText,
  Search,
  Siren,
  Timer,
  User,
  Layers,
  Zap,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip } from '@/components/ui/tooltip';
import { CopyButton, JsonView } from '@/components/data-display/json-view';
import { MethodBadge, StatusCodeBadge } from '@/components/data-display/trace-badges';
import { CallTree } from '@/features/traces/components/call-tree';
import { FlameGraph } from '@/features/traces/components/flame-graph';
import { SpanDetails, type InspectorTab } from '@/features/traces/components/span-inspector';
import { useFilters } from '@/lib/url-filters';
import { ancestorsOf, buildTree, errorOrigins, type SpanNode } from '@/lib/span-tree';
import { cn, formatDateTime, formatMs, KIND_META, SEVERITY, severityOf } from '@/lib/utils';
import { useSettings } from '@/lib/settings-context';
import { OutcomeBadge } from '@/components/data-display/trace-badges';
import type { SpanKind, TraceRecord, TraceSummary } from '@/lib/api-types';

interface LinkedIncident {
  number: string;
  sysId: string;
  state: string;
  url?: string;
}

function KV({ title, value }: { title: string; value: unknown }) {
  const empty = value === undefined || value === null || (typeof value === 'object' && Object.keys(value as object).length === 0);
  return (
    <div className="border-b px-4 py-3 last:border-0">
      <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted-foreground">
        {title}
        {!empty && <CopyButton text={JSON.stringify(value, null, 2)} />}
      </div>
      {empty ? <div className="text-xs text-muted-foreground">—</div> : <JsonView value={value} />}
    </div>
  );
}

function Chip({ icon: Icon, children, title }: { icon: any; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className="inline-flex items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs">
      <Icon className="size-3.5 text-muted-foreground" />
      {children}
    </span>
  );
}

/** Stacked bar: where this request's time went, per layer (self time). */
function LayerBreakdown({ nodes, duration }: { nodes: SpanNode[]; duration: number }) {
  const byKind = new Map<SpanKind, number>();
  for (const n of nodes) byKind.set(n.kind, (byKind.get(n.kind) ?? 0) + n.selfTime);
  const total = [...byKind.values()].reduce((a, b) => a + b, 0) || duration || 1;
  const parts = [...byKind.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (!parts.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-[11px] text-muted-foreground">Where the time went</div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {parts.map(([k, v]) => (
          <Tooltip key={k} content={`${KIND_META[k].label}: ${formatMs(v)} (${((v / total) * 100).toFixed(1)}%)`}>
            <div
              className={cn('h-full border-r border-card last:border-0 transition-[filter] hover:brightness-110', KIND_META[k].bar)}
              style={{ width: `${(v / total) * 100}%` }}
            />
          </Tooltip>
        ))}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px]">
        {parts.map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cn('size-2 rounded-sm', KIND_META[k].dot)} />
            <span className="text-muted-foreground">{KIND_META[k].label}</span>
            <span className="font-mono tabular-nums">{((v / total) * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Initially hide framework internals (repository → EntityManager → QueryBuilder → SQL) and deep helpers, but keep the error path open. */
function smartCollapse(byId: Map<string, SpanNode>, keepOpen: Set<string>) {
  const out = new Set<string>();
  for (const n of byId.values()) {
    if (!n.children.length || keepOpen.has(n.id)) continue;
    if (n.kind === 'repository' || n.kind === 'db' || n.depth >= 4) out.add(n.id);
  }
  return out;
}

function TraceDetail({ id }: { id: string }) {
  const { globalQs, sp } = useFilters();
  const spanParam = sp.get('span');
  const [trace, setTrace] = useState<TraceRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [tab, setTab] = useState<InspectorTab>('input');
  const timeFormat = useSettings().settings.timeFormat;
  const [incidents, setIncidents] = useState<LinkedIncident[]>([]);
  const [expired, setExpired] = useState<{ summary: TraceSummary; newerTraceId?: string } | null>(null);

  useEffect(() => {
    fetch(`/api/traces/${id}`, { cache: 'no-store' })
      .then(async (r) => {
        if (r.ok) return r.json();
        const body = await r.json().catch(() => ({}));
        if (r.status === 410) {
          setExpired(body);
          return Promise.reject(new Error('expired'));
        }
        return Promise.reject(new Error(r.status === 404 ? 'not found' : body.error));
      })
      .then((t: TraceRecord) => {
        setTrace(t);
        const tr = buildTree(t.spans);
        const o = errorOrigins(t.spans);
        const keep = new Set<string>();
        for (const oid of o) ancestorsOf(oid, tr.byId).forEach((a) => keep.add(a));
        // deep link (?span=…) – open the path to that call and select it
        if (spanParam && tr.byId.has(spanParam)) {
          ancestorsOf(spanParam, tr.byId).forEach((a) => keep.add(a));
          setSelectedId(spanParam);
          setTab(tr.byId.get(spanParam)!.status === 'error' ? 'output' : 'input');
        }
        setCollapsed(smartCollapse(tr.byId, keep));
      })
      .catch((e) => setError(e.message));
    fetch(`/api/traces/${id}/incidents`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { incidents: [] }))
      .then((d) => setIncidents(d.incidents ?? []))
      .catch(() => {});
    // spanParam is only read when the trace loads; selecting another call must not refetch it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelectedId(undefined);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tree = useMemo(() => (trace ? buildTree(trace.spans) : null), [trace]);
  const selected = selectedId && tree ? tree.byId.get(selectedId) : undefined;
  const path = useMemo(
    () =>
      selected && tree
        ? ancestorsOf(selected.id, tree.byId)
            .reverse()
            .map((pid) => tree.byId.get(pid)!)
        : [],
    [selected, tree],
  );
  const allLogs = useMemo(
    () =>
      trace && tree
        ? trace.spans.flatMap((s) => (s.logs ?? []).map((l) => ({ ...l, span: tree.byId.get(s.id)! }))).sort((a, b) => a.t - b.t)
        : [],
    [trace, tree],
  );

  const select = (sid: string, t?: InspectorTab) => {
    setSelectedId(sid);
    if (t) setTab(t);
    if (!tree) return;
    const anc = ancestorsOf(sid, tree.byId);
    if (anc.some((a) => collapsed.has(a))) {
      const next = new Set(collapsed);
      anc.forEach((a) => next.delete(a));
      setCollapsed(next);
    }
  };

  if (error === 'expired' && expired) {
    const s = expired.summary;
    return (
      <div className="grid flex-1 place-items-center p-6">
        <Card className="max-w-lg p-6 text-center">
          <div className="mx-auto mb-3 grid size-10 place-items-center rounded-full bg-muted">
            <Timer className="size-5 text-muted-foreground" />
          </div>
          <div className="text-sm font-medium">This call tree has been rotated out of memory</div>
          <p className="mt-1 text-xs text-muted-foreground">
            StackLens keeps the newest call trees (plus extra room for ones with errors). The summary is still here:
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs">
            {s.method && <MethodBadge method={s.method} />}
            <span className="font-mono">{s.route ?? s.name}</span>
            {s.statusCode && <StatusCodeBadge code={s.statusCode} />}
            <span className="font-mono text-muted-foreground">{formatMs(s.duration)}</span>
            <span className="text-muted-foreground">{new Date(s.startTime).toLocaleString()}</span>
          </div>
          {s.errors?.[0] && (
            <div className="mt-2 text-xs text-muted-foreground">
              {s.errors[0].name} in <span className="font-mono">{s.errors[0].spanName}</span>: {s.errors[0].message}
            </div>
          )}
          <div className="mt-5 flex justify-center gap-2">
            <Link href={`/traces${globalQs}`}>
              <Button variant="outline" size="sm">
                <ArrowLeft /> All traces
              </Button>
            </Link>
            {expired.newerTraceId && (
              <Link href={`/traces/${expired.newerTraceId}${globalQs}`}>
                <Button size="sm">Open the latest {s.errorCount ? 'failing ' : ''}trace for this endpoint</Button>
              </Link>
            )}
          </div>
        </Card>
      </div>
    );
  }
  if (error)
    return (
      <div className="grid flex-1 place-items-center text-sm text-muted-foreground">
        <div className="text-center">
          <div className="mb-3">Trace {error}.</div>
          <Link href={`/traces${globalQs}`}>
            <Button variant="outline" size="sm">
              <ArrowLeft /> Back to traces
            </Button>
          </Link>
        </div>
      </div>
    );
  if (!trace || !tree)
    return (
      <div className="grid flex-1 place-items-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );

  const spans = trace.spans;
  const origins = errorOrigins(spans);
  const nodes = [...tree.byId.values()].filter((n) => n.parentId !== null);
  const originNodes = nodes.filter((n) => origins.has(n.id));
  const firstError = originNodes[0];
  const sqlSpans = spans.filter((s) => s.kind === 'db' && s.name.startsWith('SQL'));
  const maxDepth = Math.max(0, ...nodes.map((n) => n.depth));
  const slowest = [...nodes].sort((a, b) => b.selfTime - a.selfTime)[0];
  const http = trace.http;
  const app = trace.application ?? trace.service;
  const code = http?.statusCode ?? 0;
  const outcome: 'ok' | 'warning' | 'error' =
    code >= 500 || (trace.status === 'error' && !http)
      ? 'error'
      : code >= 400
        ? 'warning'
        : firstError
          ? (severityOf(firstError) ?? 'error')
          : 'ok';
  const fullyExpanded = collapsed.size === 0;
  const canSimplify = smartCollapse(tree.byId, new Set()).size > 0;

  const outcomeStyle = {
    ok: { icon: CheckCircle2, ring: 'bg-success/10 text-success' },
    warning: { icon: AlertTriangle, ring: cn(SEVERITY.warning.soft, SEVERITY.warning.text) },
    error: { icon: AlertTriangle, ring: cn(SEVERITY.error.soft, SEVERITY.error.text) },
  }[outcome];
  const OutcomeIcon = outcomeStyle.icon;
  const statusText = http ? `${code} ${outcome === 'ok' ? 'OK' : outcome === 'warning' ? 'client error' : 'server error'}` : trace.status;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4">
        <Link href={`/traces${globalQs}`}>
          <Button variant="ghost" size="icon-sm" aria-label="Back">
            <ArrowLeft />
          </Button>
        </Link>
        <div className="flex min-w-0 items-center gap-2">
          {http ? <MethodBadge method={http.method} /> : <Badge tone="brand">JOB</Badge>}
          <h1 className="truncate font-mono text-sm font-semibold">{http?.route ?? trace.name}</h1>
          {http?.statusCode && <StatusCodeBadge code={http.statusCode} />}
          <OutcomeBadge code={http?.statusCode} failed={trace.status === 'error'} />
          {trace.truncated && <Badge tone="warning">truncated</Badge>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
          <span className="hidden font-mono xl:inline">{formatDateTime(trace.startTime, timeFormat, true)}</span>
          <span className="flex items-center gap-1 rounded-md border bg-card py-0.5 pl-2 pr-0.5 font-mono">
            {trace.id.slice(0, 10)}…
            <CopyButton text={trace.id} />
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <div className="space-y-4 p-5">
            {/* Summary */}
            <Card className="p-4">
              <div className="flex flex-wrap items-start gap-4">
                <div className={cn('grid size-10 shrink-0 place-items-center rounded-full', outcomeStyle.ring)}>
                  <OutcomeIcon className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm">
                    <span className="font-medium">{http ? 'Responded' : 'Finished'}</span> <span className="font-mono">{statusText}</span>{' '}
                    in <span className="font-mono font-medium">{formatMs(trace.duration)}</span>
                    <span className="text-muted-foreground"> · {nodes.length} function calls</span>
                  </div>
                  {firstError ? (
                    <div className="mt-1 text-sm">
                      <span className={cn('font-medium', SEVERITY[severityOf(firstError) ?? 'error'].text)}>{firstError.error?.name}</span>
                      <span className="text-muted-foreground"> thrown in </span>
                      <span className="font-mono">{firstError.name}</span>
                      <div className="mt-0.5 text-muted-foreground">{firstError.error?.message}</div>
                    </div>
                  ) : slowest ? (
                    <div className="mt-1 text-sm text-muted-foreground">
                      Most time spent in <span className="font-mono text-foreground">{slowest.name}</span> ({formatMs(slowest.selfTime)},{' '}
                      {((slowest.selfTime / Math.max(trace.duration, 0.001)) * 100).toFixed(0)}% of the request)
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Chip icon={Boxes}>{app}</Chip>
                    <Chip icon={FolderKanban}>{trace.project ?? 'default'}</Chip>
                    {trace.userId && (
                      <Link href={`/traces?user=${encodeURIComponent(trace.userId)}`} title="All traces from this user">
                        <Chip icon={User}>
                          <span className="font-mono">{trace.userId}</span>
                        </Chip>
                      </Link>
                    )}
                    <Chip icon={Layers}>depth {maxDepth}</Chip>
                    {sqlSpans.length > 0 && (
                      <Chip icon={Database}>
                        {sqlSpans.length} SQL · {formatMs(sqlSpans.reduce((a, s) => a + s.duration, 0))}
                      </Chip>
                    )}
                    {incidents.map((inc) => (
                      <Link key={inc.sysId} href={`/incidents?selected=${inc.sysId}`} title="Linked incident">
                        <span className="inline-flex items-center gap-1.5 rounded-md border border-brand/30 bg-brand/[0.06] px-2 py-1 text-xs text-brand">
                          <Siren className="size-3.5" />
                          <span className="font-mono">{inc.number}</span>
                          <span className="text-muted-foreground">{inc.state}</span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col gap-2">
                  {firstError && (
                    <Button size="sm" onClick={() => select(firstError.id, 'output')}>
                      <Zap /> Inspect error
                    </Button>
                  )}
                  {slowest && (
                    <Button size="sm" variant="outline" onClick={() => select(slowest.id, 'input')}>
                      <Timer /> Slowest call
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-4 border-t pt-3">
                <LayerBreakdown nodes={nodes} duration={trace.duration} />
              </div>
            </Card>

            {/* Explorer */}
            <Card className="overflow-hidden">
              <Tabs defaultValue="tree">
                <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                  <TabsList>
                    <TabsTrigger value="tree">
                      <ListTree /> Call tree
                    </TabsTrigger>
                    <TabsTrigger value="flame">
                      <Flame /> Flame graph
                    </TabsTrigger>
                    <TabsTrigger value="logs">
                      <ScrollText /> Logs{' '}
                      {allLogs.length > 0 && <span className="rounded bg-background/80 px-1 font-mono text-[10px]">{allLogs.length}</span>}
                    </TabsTrigger>
                    {http && (
                      <TabsTrigger value="http">
                        <Network /> Request / Response
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="raw">
                      <Braces /> Raw
                    </TabsTrigger>
                  </TabsList>
                  <div className="relative ml-auto w-48">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Find function…"
                      className="h-7 pl-8 text-xs"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </div>
                  {(canSimplify || !fullyExpanded) && (
                    <Tooltip content={fullyExpanded ? 'Collapse framework internals' : 'Expand every call (repositories, SQL, helpers)'}>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (fullyExpanded) {
                            const keep = new Set<string>();
                            for (const o of origins) ancestorsOf(o, tree.byId).forEach((a) => keep.add(a));
                            setCollapsed(smartCollapse(tree.byId, keep));
                          } else setCollapsed(new Set());
                        }}
                      >
                        {fullyExpanded ? <ChevronsDownUp /> : <ChevronsUpDown />}
                        {fullyExpanded ? 'Simplify' : 'Expand all'}
                      </Button>
                    </Tooltip>
                  )}
                </div>

                <TabsContent value="tree" className="overflow-x-auto">
                  <CallTree
                    roots={tree.roots}
                    byId={tree.byId}
                    duration={trace.duration}
                    selectedId={selectedId}
                    onSelect={(sid) => select(sid)}
                    collapsed={collapsed}
                    setCollapsed={setCollapsed}
                    filter={filter}
                    errorOrigins={origins}
                  />
                  {!selected && (
                    <div className="flex items-center gap-2 px-4 py-3 text-[11px] text-muted-foreground">
                      <MousePointerClick className="size-3.5" /> Click any call to see its input and output. Collapsed rows (+N) hide
                      framework internals; use Expand all to see everything.
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="flame">
                  <FlameGraph byId={tree.byId} duration={trace.duration} selectedId={selectedId} onSelect={(sid) => select(sid)} />
                </TabsContent>

                <TabsContent value="logs">
                  {allLogs.length === 0 ? (
                    <div className="p-10 text-center text-sm text-muted-foreground">No logs were written during this request.</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                          <th className="h-8 px-4 font-medium">Offset</th>
                          <th className="h-8 px-3 font-medium">Level</th>
                          <th className="h-8 px-3 font-medium">Function</th>
                          <th className="h-8 px-3 font-medium">Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {allLogs.map((l, i) => (
                          <tr key={i} className="border-b align-top last:border-0 hover:bg-accent/40">
                            <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground">+{formatMs(l.t)}</td>
                            <td className="px-3 py-2">
                              <Badge tone={l.level === 'error' ? 'error' : l.level === 'warn' ? 'warning' : 'neutral'}>{l.level}</Badge>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                className="cursor-pointer font-mono text-xs hover:underline"
                                onClick={() => select(l.span.id, 'logs')}
                              >
                                {l.span.name}
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              {l.message && <div className="font-mono text-xs">{l.message}</div>}
                              {l.data !== undefined && <JsonView value={l.data} defaultOpen={1} className="mt-1" />}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </TabsContent>

                {http && (
                  <TabsContent value="http" className="p-4">
                    <div className="grid gap-4 2xl:grid-cols-2">
                      <Card className="overflow-hidden">
                        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5 text-xs font-medium">
                          <MethodBadge method={http.method} />
                          <span className="truncate font-mono">{http.url}</span>
                        </div>
                        <KV title="Path params" value={http.request?.params} />
                        <KV title="Query" value={http.request?.query} />
                        <KV title="Body" value={http.request?.body} />
                        <KV title="Headers" value={http.request?.headers} />
                      </Card>
                      <Card className="overflow-hidden">
                        <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-2.5 text-xs font-medium">
                          Response {http.statusCode && <StatusCodeBadge code={http.statusCode} />}
                          <span className="ml-auto font-mono text-muted-foreground">{formatMs(trace.duration)}</span>
                        </div>
                        <KV title="Body" value={http.response?.body} />
                        <KV title="Headers" value={http.response?.headers} />
                      </Card>
                    </div>
                  </TabsContent>
                )}

                <TabsContent value="raw" className="p-4">
                  <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                    Trace payload ({spans.length} spans)
                    <CopyButton text={JSON.stringify(trace, null, 2)} />
                  </div>
                  <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/30 p-4 font-mono text-[11px] leading-relaxed">
                    {JSON.stringify(trace, null, 2)}
                  </pre>
                </TabsContent>
              </Tabs>
            </Card>
          </div>
        </div>

        {/* Inspector: only when a call is selected */}
        {selected && (
          <aside className="hidden w-[460px] shrink-0 border-l bg-card/40 lg:block" style={{ animation: 'slide-in 160ms ease-out' }}>
            <SpanDetails
              span={selected}
              trace={trace}
              traceDuration={trace.duration}
              path={path}
              onSelect={(sid) => select(sid)}
              tab={tab}
              onTab={setTab}
              onClose={() => setSelectedId(undefined)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}

export default function TraceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <TraceDetail id={id} />
    </Suspense>
  );
}

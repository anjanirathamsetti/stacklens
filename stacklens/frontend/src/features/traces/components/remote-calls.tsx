'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, CornerLeftUp, EyeOff, Globe, Loader2, Unplug } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { StatusCodeBadge } from '@/components/data-display/trace-badges';
import { cn, formatMs } from '@/lib/utils';
import type { RemoteMark, SpanNode } from '@stacklens/shared/span-tree';
import type { SpanRecord, TraceLinks, TraceRecord, TraceSummary } from '@stacklens/shared/api-types';

/**
 * Cross-service tracing in the trace view: outgoing calls to other instrumented services can be
 * expanded to show the callee's call tree inline, grafted under the outgoing-call span.
 *
 * Grafted spans get ids `<child trace id>:<span id>` (trace ids are unique, so these never clash)
 * and are shifted onto this trace's timeline at the callee's start, clamped inside the outgoing span.
 */

/** What the call tree shows on a span that called another service. */
export interface RemoteLink {
  traceId: string;
  /** callee application, when its trace is stored here */
  service?: string;
  host?: string;
  statusCode?: number;
  summary?: TraceSummary;
  state: 'closed' | 'loading' | 'open' | 'unavailable' | 'error';
}

type Loaded = { record: TraceRecord; links: TraceLinks } | 'loading' | 'missing' | 'error';
type ViewSpan = SpanRecord & { remote?: RemoteMark };

/** Nesting limit for callee-of-callee grafts (A → B → C → …). */
const MAX_HOPS = 6;

async function getJson<T>(url: string): Promise<{ status: number; body?: T }> {
  const r = await fetch(url, { cache: 'no-store' });
  return { status: r.status, body: r.ok ? ((await r.json()) as T) : undefined };
}

/** Links to callees for one trace's spans: stored child traces first, then ids callees reported back. */
function linksOf(spans: SpanRecord[], links: TraceLinks | null | undefined, prefix: string) {
  const ids = new Set(spans.map((s) => s.id));
  const out = new Map<string, Omit<RemoteLink, 'state'>>();
  for (const c of links?.children ?? []) {
    if (!ids.has(c.spanId) || out.has(prefix + c.spanId)) continue;
    out.set(prefix + c.spanId, { traceId: c.trace.id, service: c.trace.application, summary: c.trace });
  }
  for (const s of spans) {
    const ob = s.outbound;
    if (!ob) continue;
    const prev = out.get(prefix + s.id);
    if (prev) out.set(prefix + s.id, { ...prev, host: ob.host, statusCode: ob.statusCode });
    else if (ob.childTraceId) out.set(prefix + s.id, { traceId: ob.childTraceId, host: ob.host, statusCode: ob.statusCode });
  }
  return out;
}

/**
 * Loads a trace's cross-service links and the callee traces the user expands. Returns the spans to
 * draw (this trace's plus grafted callee spans), the link state per span, and a toggle.
 */
export function useRemoteCalls(trace: TraceRecord | null) {
  const [links, setLinks] = useState<TraceLinks | null>(null);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!trace) return;
    let live = true;
    getJson<TraceLinks>(`/api/traces/${trace.id}/links`)
      .then((r) => live && setLinks(r.body ?? { children: [] }))
      .catch(() => live && setLinks({ children: [] }));
    return () => {
      live = false;
    };
  }, [trace]);

  const load = useCallback((traceId: string) => {
    setLoaded((m) => ({ ...m, [traceId]: 'loading' }));
    Promise.all([
      getJson<TraceRecord>(`/api/traces/${traceId}`),
      getJson<TraceLinks>(`/api/traces/${traceId}/links`).catch(() => ({ status: 0, body: undefined })),
    ])
      .then(([t, l]) => {
        const value: Loaded = t.body
          ? { record: t.body, links: l.body ?? { children: [] } }
          : t.status === 404 || t.status === 410
            ? 'missing'
            : 'error';
        setLoaded((m) => ({ ...m, [traceId]: value }));
      })
      .catch(() => setLoaded((m) => ({ ...m, [traceId]: 'error' })));
  }, []);

  const view = useMemo(() => {
    const remote = new Map<string, RemoteLink>();
    // outgoing calls that got a response but no trace to link: the callee doesn't run StackLens
    const noGraph = new Map<string, string>();
    if (!trace) return { spans: [] as ViewSpan[], remote, noGraph };
    const spans: ViewSpan[] = [...trace.spans];
    const byId = new Map<string, ViewSpan>(spans.map((s) => [s.id, s]));

    const level = (levelSpans: SpanRecord[], levelLinks: TraceLinks | null | undefined, prefix: string, hops: number) => {
      const found = linksOf(levelSpans, levelLinks, prefix);
      for (const s of levelSpans)
        if (s.outbound && s.outbound.statusCode !== undefined && !found.has(prefix + s.id)) noGraph.set(prefix + s.id, s.outbound.host);
      for (const [viewId, l] of found) {
        const got = loaded[l.traceId];
        const isOpen = open.has(viewId);
        // a reported id with no stored trace: the callee reports to another server (or hasn't yet)
        const state: RemoteLink['state'] =
          got === 'missing' || (got === undefined && !l.summary)
            ? 'unavailable'
            : got === 'error'
              ? 'error'
              : !isOpen
                ? 'closed'
                : got && got !== 'loading'
                  ? 'open'
                  : 'loading';
        const service = l.service ?? (typeof got === 'object' ? (got.record.application ?? got.record.service) : undefined);
        remote.set(viewId, { ...l, service, state });
        const caller = byId.get(viewId);
        if (state !== 'open' || typeof got !== 'object' || !caller || hops >= MAX_HOPS) continue;
        // place the callee on this timeline: its own start if the clocks agree, kept inside the outgoing call
        const callee = got.record;
        const want = callee.startTime - trace.startTime;
        const latest = caller.start + Math.max(0, caller.duration - callee.duration);
        const offset = Math.min(Math.max(want, caller.start), latest);
        const childPrefix = `${callee.id}:`;
        for (const s of callee.spans) {
          const g: ViewSpan = {
            ...s,
            id: childPrefix + s.id,
            parentId: s.parentId === null ? viewId : childPrefix + s.parentId,
            start: s.start + offset,
            remote: { traceId: callee.id, service: service ?? l.host ?? 'remote', spanId: s.id, root: s.parentId === null },
          };
          spans.push(g);
          byId.set(g.id, g);
        }
        level(callee.spans, got.links, childPrefix, hops + 1);
      }
    };
    level(trace.spans, links, '', 0);
    return { spans, remote, noGraph };
  }, [trace, links, loaded, open]);

  const toggle = useCallback(
    (spanId: string) => {
      const link = view.remote.get(spanId);
      if (!link) return;
      const retry = link.state === 'unavailable' || link.state === 'error';
      setOpen((prev) => {
        const next = new Set(prev);
        if (next.has(spanId) && !retry) next.delete(spanId);
        else next.add(spanId);
        return next;
      });
      if (retry || (!open.has(spanId) && loaded[link.traceId] === undefined)) load(link.traceId);
    },
    [view.remote, open, loaded, load],
  );

  /** The callee trace a grafted span belongs to (for the inspector's Input/Output panels). */
  const recordOf = useCallback(
    (traceId: string) => {
      const got = loaded[traceId];
      return typeof got === 'object' ? got.record : undefined;
    },
    [loaded],
  );

  return { links, spans: view.spans, remote: view.remote, noGraph: view.noGraph, toggle, recordOf };
}

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 10)}…` : id);

/** Call-tree chip on an outgoing call: callee service, status, and a link to its trace. */
export function RemoteChip({ link, onToggle }: { link: RemoteLink; onToggle: () => void }) {
  const label = link.service ?? link.host ?? 'remote';
  const tip =
    link.state === 'unavailable'
      ? `${link.host ?? 'The callee'} runs StackLens and answered with trace ${link.traceId}, but that trace isn't stored here yet: it may still be arriving, or the callee reports to another StackLens server. Click to check again.`
      : `Called ${label}${link.summary ? ` · ${link.summary.name} · ${formatMs(link.summary.duration)}` : ''}. ${link.state === 'open' ? 'Collapse' : 'Expand'} to ${link.state === 'open' ? 'hide' : 'see'} its call tree here.`;
  return (
    <span className="inline-flex items-center gap-1">
      <Tooltip content={<div className="max-w-xs text-xs">{tip}</div>}>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={cn(
            'inline-flex cursor-pointer items-center gap-1 rounded border px-1 font-mono text-[10px] font-medium',
            link.state === 'unavailable'
              ? 'border-dashed text-muted-foreground hover:bg-accent'
              : 'border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500/15 dark:text-sky-300',
          )}
          aria-label={link.state === 'open' ? `Hide ${label} call tree` : `Show ${label} call tree`}
        >
          {link.state === 'loading' ? (
            <Loader2 className="size-3 animate-spin" />
          ) : link.state === 'unavailable' ? (
            <Unplug className="size-3" />
          ) : (
            <Globe className="size-3" />
          )}
          {label}
          {link.state === 'unavailable' && <span className="font-normal">· trace not received</span>}
          {link.state === 'error' && <span className="font-normal text-destructive">· failed to load</span>}
        </button>
      </Tooltip>
      {link.state !== 'unavailable' && (
        <Tooltip content="Open the callee's trace">
          <Link
            href={`/traces/${link.traceId}`}
            onClick={(e) => e.stopPropagation()}
            className="grid size-4 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={`Open ${label} trace`}
          >
            <ArrowUpRight className="size-3" />
          </Link>
        </Tooltip>
      )}
    </span>
  );
}

/** Call-tree chip on an outgoing call whose callee doesn't report to StackLens. */
export function NoCallGraphChip({ host }: { host: string }) {
  return (
    <Tooltip
      content={
        <div className="max-w-xs text-xs">
          Call graph not available: {host} doesn’t report to StackLens. The request and response this service sent and received are recorded
          on this call – select it to see them.
        </div>
      }
    >
      <span className="inline-flex items-center gap-1 rounded border border-dashed border-amber-500/50 px-1 font-mono text-[10px] text-amber-700 dark:text-amber-300">
        <EyeOff className="size-3" />
        no call graph
      </span>
    </Tooltip>
  );
}

/** Chip on the first row of a grafted callee tree. */
export function RemoteServiceTag({ mark }: { mark: RemoteMark }) {
  return (
    <Tooltip content={`Runs in ${mark.service} (trace ${mark.traceId})`}>
      <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1 font-mono text-[10px] font-medium text-sky-700 dark:text-sky-300">
        <Globe className="size-3" />
        {mark.service}
      </span>
    </Tooltip>
  );
}

/** "Called by orders-api → GET /checkout" banner on a trace that another service caused. */
export function CalledByBanner({ parent, qs }: { parent: NonNullable<TraceLinks['parent']>; qs: string }) {
  const caller = parent.trace?.application ?? parent.service ?? 'another service';
  const sep = qs ? '&' : '?';
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-sky-500/25 bg-sky-500/[0.06] px-3 py-2 text-xs">
      <CornerLeftUp className="size-3.5 text-sky-600 dark:text-sky-400" />
      <span className="text-muted-foreground">Called by</span>
      <span className="font-mono font-medium">{caller}</span>
      {parent.trace ? (
        <>
          <span className="text-muted-foreground">→</span>
          <Link
            href={`/traces/${parent.traceId}${qs}${sep}span=${encodeURIComponent(parent.spanId)}`}
            className="inline-flex items-center gap-1 font-mono text-sky-700 hover:underline dark:text-sky-300"
          >
            {parent.trace.name}
            <ArrowUpRight className="size-3" />
          </Link>
          {parent.trace.statusCode && <StatusCodeBadge code={parent.trace.statusCode} />}
          <span className="font-mono text-muted-foreground">{formatMs(parent.trace.duration)}</span>
        </>
      ) : (
        <span className="text-muted-foreground">
          (trace <span className="font-mono">{shortId(parent.traceId)}</span>, not stored on this server)
        </span>
      )}
    </div>
  );
}

/** Inspector section for an outgoing call or a grafted callee span. */
export function RemoteInspectorNote({
  span,
  link,
  noGraph,
  onToggle,
}: {
  span: SpanNode;
  link?: RemoteLink;
  /** the call got a response but no linked trace */
  noGraph?: boolean;
  onToggle: () => void;
}) {
  if (span.remote) {
    return (
      <div className="flex items-center gap-2 border-b bg-sky-500/[0.05] px-4 py-2 text-xs">
        <Globe className="size-3.5 text-sky-600 dark:text-sky-400" />
        <span>
          Runs in <span className="font-mono font-medium">{span.remote.service}</span>
        </span>
        <Link
          href={`/traces/${span.remote.traceId}?span=${encodeURIComponent(span.remote.spanId)}`}
          className="ml-auto inline-flex items-center gap-1 text-sky-700 hover:underline dark:text-sky-300"
        >
          Open trace <ArrowUpRight className="size-3" />
        </Link>
      </div>
    );
  }
  const ob = span.outbound;
  if (!ob && !link) return null;
  return (
    <div className="space-y-1 border-b bg-sky-500/[0.05] px-4 py-2 text-xs">
      <div className="flex items-center gap-2">
        <Globe className="size-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
        <span className="min-w-0 truncate">
          Outgoing call to <span className="font-mono font-medium">{link?.service ?? ob?.host ?? 'another service'}</span>
        </span>
        {(ob?.statusCode ?? link?.statusCode) && <StatusCodeBadge code={(ob?.statusCode ?? link?.statusCode)!} />}
        {link && link.state !== 'unavailable' && (
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <button onClick={onToggle} className="cursor-pointer text-sky-700 hover:underline dark:text-sky-300">
              {link.state === 'open' ? 'Hide call tree' : 'Show call tree'}
            </button>
            <Link
              href={`/traces/${link.traceId}`}
              className="inline-flex items-center gap-1 text-sky-700 hover:underline dark:text-sky-300"
            >
              Open trace <ArrowUpRight className="size-3" />
            </Link>
          </span>
        )}
      </div>
      {ob && <div className="break-all font-mono text-[11px] text-muted-foreground">{ob.url}</div>}
      {link?.state === 'unavailable' && (
        <div className="rounded border border-dashed border-amber-500/40 bg-amber-500/[0.06] px-2 py-1.5 text-amber-800 dark:text-amber-200">
          <div className="font-medium">Child trace not received yet</div>
          <div className="mt-0.5">
            {ob?.host ?? 'The callee'} runs StackLens and answered with trace <span className="font-mono">{link.traceId}</span>, but it
            isn’t stored on this server. It may still be arriving, or {ob?.host ?? 'the callee'} reports to another StackLens server.{' '}
            <button onClick={onToggle} className="cursor-pointer underline">
              Check again
            </button>
          </div>
        </div>
      )}
      {noGraph && (
        <div className="rounded border border-dashed border-amber-500/40 bg-amber-500/[0.06] px-2 py-1.5 text-amber-800 dark:text-amber-200">
          <div className="flex items-center gap-1.5 font-medium">
            <EyeOff className="size-3.5" /> Call graph not available — {ob?.host} doesn’t report to StackLens
          </div>
          <div className="mt-0.5">
            The request and response below are exactly what this service sent and received (secrets redacted, large values trimmed).
            {ob?.propagated === false && ' No trace context was sent to this host (propagateTo).'}
          </div>
        </div>
      )}
      {ob && !link && !noGraph && ob.propagated === false && (
        <div className="text-muted-foreground">No trace context was sent (propagation is off or restricted for this host).</div>
      )}
    </div>
  );
}

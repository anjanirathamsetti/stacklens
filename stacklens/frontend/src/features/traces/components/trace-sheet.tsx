'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { AlertOctagon, ChevronDown, ChevronUp, ExternalLink, ListTree, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { CopyButton, JsonView } from '@/components/data-display/json-view';
import { TraceShareMenu } from '@/features/traces/components/trace-share-menu';
import { AppBadge, MethodBadge, OutcomeBadge, StatusCodeBadge } from '@/components/data-display/trace-badges';
import { KIND_SHORT } from '@/features/traces/components/call-tree';
import { buildTree, errorOrigins } from '@stacklens/shared/span-tree';
import { cn, formatDateTime, formatMs, KIND_META, SEVERITY, severityOf } from '@/lib/utils';
import type { TraceRecord, TraceSummary } from '@stacklens/shared/api-types';

function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{children}</div>;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 space-y-1.5', className)}>
      <Label>{label}</Label>
      <div className="min-w-0 break-words text-sm">{children}</div>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3.5 border-b border-dashed px-5 py-4 last:border-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">{children}</div>
    </section>
  );
}

/** A titled box like Bifrost's "User" / "Assistant" message blocks. */
function Box({
  title,
  right,
  children,
  tone,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', tone)}>
      <div className="flex min-h-10 items-center justify-between gap-2 border-b px-4 py-2">
        <div className="text-sm font-medium">{title}</div>
        {right}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'object' && Object.keys(v as object).length === 0);

export function TraceSheet({
  traceId,
  onClose,
  onPrev,
  onNext,
  timeFormat,
  globalQs,
}: {
  traceId: string | null;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  timeFormat: '12h' | '24h';
  globalQs: string;
}) {
  const [trace, setTrace] = useState<TraceRecord | null>(null);
  const [expired, setExpired] = useState<TraceSummary | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!traceId) return;
    let cancelled = false;
    setLoading(true);
    setExpired(null);
    fetch(`/api/traces/${traceId}`, { cache: 'no-store' })
      .then(async (r) => {
        const body = await r.json();
        if (cancelled) return;
        if (r.ok) setTrace(body);
        else {
          setTrace(null);
          if (r.status === 410) setExpired(body.summary);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [traceId]);

  // ↑ / ↓ (or k / j) step through the list while the panel is open
  useEffect(() => {
    if (!traceId) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input,textarea')) return;
      if ((e.key === 'ArrowDown' || e.key === 'j') && onNext) {
        e.preventDefault();
        onNext();
      } else if ((e.key === 'ArrowUp' || e.key === 'k') && onPrev) {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [traceId, onNext, onPrev]);

  const derived = useMemo(() => {
    if (!trace) return null;
    const tree = buildTree(trace.spans);
    const nodes = [...tree.byId.values()].filter((n) => n.parentId !== null);
    const origins = errorOrigins(trace.spans);
    const firstError = nodes.find((n) => origins.has(n.id));
    const sql = trace.spans.filter((s) => s.kind === 'db' && s.name.startsWith('SQL'));
    return {
      nodes,
      firstError,
      errors: nodes.filter((n) => origins.has(n.id)).length,
      depth: Math.max(0, ...nodes.map((n) => n.depth)),
      sqlCount: sql.length,
      sqlMs: sql.reduce((a, s) => a + s.duration, 0),
      slowest: [...nodes].sort((a, b) => b.selfTime - a.selfTime).slice(0, 5),
      logs: trace.spans.reduce((a, s) => a + (s.logs?.length ?? 0), 0),
    };
  }, [trace]);

  const http = trace?.http;
  const open = !!traceId;
  const fullHref = traceId ? `/traces/${traceId}${globalQs}` : '#';

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[1px] data-[state=open]:animate-[fade-in_150ms_ease-out]" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[min(760px,100vw)] flex-col border-l bg-background shadow-2xl outline-none data-[state=open]:animate-[sheet-in_200ms_cubic-bezier(0.32,0.72,0,1)]"
        >
          {/* Header */}
          <div className="flex shrink-0 items-start gap-3 border-b px-5 py-4">
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="flex flex-wrap items-center gap-2 text-base font-semibold">
                <span className="text-muted-foreground">Trace ID:</span>
                <span className="truncate font-mono text-sm">{traceId}</span>
                {traceId && <CopyButton text={traceId} />}
                {trace && <OutcomeBadge code={http?.statusCode} failed={trace.status === 'error'} />}
              </DialogPrimitive.Title>
              {trace && (
                <div className="mt-1.5 flex min-w-0 items-center gap-2">
                  {http ? <MethodBadge method={http.method} /> : <MethodBadge method="JOB" />}
                  <span className="truncate font-mono text-sm">{http?.route ?? trace.name}</span>
                  {http?.url && http.url !== http.route && (
                    <span className="truncate font-mono text-xs text-muted-foreground">{http.url}</span>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {traceId && (
                <span className="mr-1">
                  <TraceShareMenu traceId={traceId} title={trace ? `${http?.method ?? ''} ${http?.route ?? trace.name}`.trim() : traceId} />
                </span>
              )}
              <Tooltip content="Previous trace (↑ / k)">
                <button
                  disabled={!onPrev}
                  onClick={onPrev}
                  className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 cursor-pointer"
                  aria-label="Previous trace"
                >
                  <ChevronUp className="size-4" />
                </button>
              </Tooltip>
              <Tooltip content="Next trace (↓ / j)">
                <button
                  disabled={!onNext}
                  onClick={onNext}
                  className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 cursor-pointer"
                  aria-label="Next trace"
                >
                  <ChevronDown className="size-4" />
                </button>
              </Tooltip>
              <DialogPrimitive.Close
                className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                aria-label="Close (Esc)"
              >
                <X className="size-4" />
              </DialogPrimitive.Close>
            </div>
          </div>

          {/* Body */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {loading && !trace && !expired ? (
              <div className="grid h-60 place-items-center">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : expired ? (
              <div className="p-6 text-sm text-muted-foreground">
                This call tree has been rotated out of memory. Summary: {expired.method} {expired.route ?? expired.name} ·{' '}
                {expired.statusCode ?? expired.status} · {formatMs(expired.duration)} · {formatDateTime(expired.startTime, timeFormat)}
              </div>
            ) : trace && derived ? (
              <div className={cn('space-y-6 p-5 transition-opacity', loading && 'opacity-60')}>
                <div className="overflow-hidden rounded-lg border bg-card">
                  <Group title="Timings">
                    <Field label="Start timestamp">
                      <span className="whitespace-nowrap font-mono text-[12.5px]">{formatDateTime(trace.startTime, timeFormat, true)}</span>
                    </Field>
                    <Field label="End timestamp">
                      <span className="whitespace-nowrap font-mono text-[12.5px]">
                        {formatDateTime(trace.startTime + trace.duration, timeFormat, true)}
                      </span>
                    </Field>
                    <Field label="Latency">
                      <span className="font-mono text-[13px]">{trace.duration.toFixed(2)}ms</span>
                    </Field>
                  </Group>
                  <Group title="Request details">
                    {http && (
                      <Field label="Method">
                        <MethodBadge method={http.method} />
                      </Field>
                    )}
                    {http?.statusCode && (
                      <Field label="Status">
                        <StatusCodeBadge code={http.statusCode} />
                      </Field>
                    )}
                    <Field label="Application">
                      <AppBadge name={trace.application ?? trace.service} />
                    </Field>
                    <Field label="Route">
                      <span className="font-mono text-[13px]">{http?.route ?? trace.name}</span>
                    </Field>
                    <Field label="Project">{trace.project ?? 'default'}</Field>
                    <Field label="Environment">{trace.environment ?? '—'}</Field>
                    <Field label="User">
                      {trace.userId ? (
                        <Link
                          href={`/traces?user=${encodeURIComponent(trace.userId)}`}
                          className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs hover:bg-brand/15 hover:text-brand"
                        >
                          {trace.userId}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </Field>
                    <Field label="Client IP">
                      <span className="font-mono text-[13px]">{http?.ip ?? '—'}</span>
                    </Field>
                  </Group>
                  <Group title="Execution">
                    <Field label="Function calls">
                      <span className="font-mono text-[13px]">{derived.nodes.length}</span>
                    </Field>
                    <Field label="Max depth">
                      <span className="font-mono text-[13px]">{derived.depth}</span>
                    </Field>
                    <Field label="Errors thrown">
                      <span
                        className={cn('font-mono text-[13px]', derived.errors && SEVERITY[severityOf(derived.firstError!) ?? 'error'].text)}
                      >
                        {derived.errors}
                      </span>
                    </Field>
                    <Field label="SQL queries">
                      <span className="font-mono text-[13px]">
                        {derived.sqlCount} <span className="text-muted-foreground">· {formatMs(derived.sqlMs)}</span>
                      </span>
                    </Field>
                    <Field label="Logs">
                      <span className="font-mono text-[13px]">{derived.logs}</span>
                    </Field>
                  </Group>
                </div>

                {derived.firstError?.error && (
                  <div className="space-y-2.5">
                    <h3 className="text-sm font-semibold">Error</h3>
                    <Box
                      tone={SEVERITY[severityOf(derived.firstError) ?? 'error'].border}
                      title={
                        <span className={cn('flex items-center gap-1.5', SEVERITY[severityOf(derived.firstError) ?? 'error'].text)}>
                          <AlertOctagon className="size-4" /> {derived.firstError.error.name}
                          <span className="font-normal text-muted-foreground">in</span>
                          <span className="font-mono text-[13px] text-foreground">{derived.firstError.name}</span>
                        </span>
                      }
                      right={
                        <CopyButton
                          text={`${derived.firstError.error.name}: ${derived.firstError.error.message}\n${derived.firstError.error.stack ?? ''}`}
                        />
                      }
                    >
                      <div className="font-mono text-[13px]">{derived.firstError.error.message}</div>
                      {derived.firstError.error.stack && (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">Stack trace</summary>
                          <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted/50 p-2.5 font-mono text-[11px] leading-relaxed text-muted-foreground">
                            {derived.firstError.error.stack.split('\n').slice(1).join('\n').trim()}
                          </pre>
                        </details>
                      )}
                    </Box>
                  </div>
                )}

                <div className="space-y-2.5">
                  <h3 className="text-sm font-semibold">Input</h3>
                  {http ? (
                    (['params', 'query', 'body'] as const).some((k) => !isEmpty(http.request?.[k])) ? (
                      (['params', 'query', 'body'] as const)
                        .filter((k) => !isEmpty(http.request?.[k]))
                        .map((k) => (
                          <Box
                            key={k}
                            title={{ params: 'Path params', query: 'Query', body: 'Body' }[k]}
                            right={<CopyButton text={JSON.stringify(http.request?.[k], null, 2)} />}
                          >
                            <JsonView value={http.request?.[k]} />
                          </Box>
                        ))
                    ) : (
                      <div className="rounded-lg border border-dashed px-4 py-3 font-mono text-[13px] text-muted-foreground">
                        {http.method} {http.url} <span className="font-sans">· no params, query or body</span>
                      </div>
                    )
                  ) : (
                    <div className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
                      Background job – no HTTP input.
                    </div>
                  )}
                  {http && !isEmpty(http.request?.headers) && (
                    <details className="rounded-lg border bg-card">
                      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">Request headers</summary>
                      <div className="border-t px-4 py-3">
                        <JsonView value={http.request?.headers} defaultOpen={1} />
                      </div>
                    </details>
                  )}
                </div>

                {http && (
                  <div className="space-y-2.5">
                    <h3 className="text-sm font-semibold">Response</h3>
                    <Box
                      title={
                        <span className="flex items-center gap-2">
                          Body {http.statusCode && <StatusCodeBadge code={http.statusCode} />}
                        </span>
                      }
                      right={http.response?.body !== undefined && <CopyButton text={JSON.stringify(http.response?.body, null, 2)} />}
                    >
                      {http.response?.body === undefined ? (
                        <div className="text-xs text-muted-foreground">No body captured</div>
                      ) : (
                        <JsonView value={http.response.body} />
                      )}
                    </Box>
                  </div>
                )}

                <div className="space-y-2.5">
                  <h3 className="text-sm font-semibold">Slowest calls</h3>
                  <div className="overflow-hidden rounded-lg border bg-card">
                    {derived.slowest.map((n) => {
                      const meta = KIND_META[n.kind] ?? KIND_META.function;
                      const pct = trace.duration ? (n.selfTime / trace.duration) * 100 : 0;
                      return (
                        <Link
                          key={n.id}
                          href={`/traces/${trace.id}${globalQs}${globalQs ? '&' : '?'}span=${n.id}`}
                          className="group flex items-center gap-3 border-b px-4 py-2.5 last:border-0 hover:bg-accent/50"
                        >
                          <span
                            className={cn(
                              'w-[38px] shrink-0 rounded px-1 py-[1px] text-center font-mono text-[9.5px] font-semibold',
                              meta.soft,
                              meta.text,
                            )}
                          >
                            {KIND_SHORT[n.kind]}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[13px]">
                            {n.className && <span className="text-muted-foreground">{n.className}.</span>}
                            {n.className ? n.method : n.name}
                          </span>
                          <div className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-muted sm:block">
                            <div className={cn('h-full rounded-full', meta.bar)} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                          <span className="w-16 text-right font-mono text-xs tabular-nums">{formatMs(n.selfTime)}</span>
                          <ExternalLink className="size-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-6 text-sm text-muted-foreground">Trace not found.</div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-between gap-2 border-t bg-card/60 px-5 py-3">
            <span className="text-[11px] text-muted-foreground">↑ ↓ to move between traces · Esc to close</span>
            <Link href={fullHref}>
              <Button size="sm">
                <ListTree /> Open call tree
              </Button>
            </Link>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

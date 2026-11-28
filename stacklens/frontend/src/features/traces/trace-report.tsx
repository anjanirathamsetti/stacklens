'use client';
import { Suspense, use, useMemo } from 'react';
import { PrintDocument, PrintEmpty, PrintSection, PrintStat } from '@/components/print/print-document';
import { PrintTable } from '@/components/print/print-table';
import { MAX_VALUE_CHARS, PrintValue } from '@/components/print/print-value';
import { printDateTime, type PrintFilter } from '@/components/print/print-query';
import { usePrintData } from '@/components/print/use-print-data';
import { KindBadge, MethodBadge, OutcomeBadge, StatusCodeBadge } from '@/components/data-display/trace-badges';
import { Badge } from '@/components/ui/badge';
import { buildTree, callCount, errorOrigins, type SpanNode } from '@stacklens/shared/span-tree';
import { formatSql } from '@stacklens/shared/sql-format';
import { cn, formatMs, KIND_META, SEVERITY, severityOf } from '@/lib/utils';
import type { SpanKind, TraceRecord } from '@stacklens/shared/api-types';

/** Calls printed with their values; a trace with more is cut (stated in the PDF). */
export const MAX_PRINT_SPANS = 300;
const MAX_LOGS = 500;
const MAX_STACK_CHARS = 1800;
/** Deeper calls are drawn at this indent, with their depth written out. */
const MAX_INDENT = 10;

const LOG_TONE: Record<string, string> = {
  error: 'bg-destructive/12 text-destructive',
  warn: 'bg-warning/15 text-warning',
  info: 'bg-viz/12 text-viz',
  debug: 'bg-muted text-muted-foreground',
};

/** Depth-first, children in start order: the call tree fully expanded. */
function walk(roots: SpanNode[]): SpanNode[] {
  const out: SpanNode[] = [];
  const visit = (n: SpanNode) => {
    out.push(n);
    n.children.forEach(visit);
  };
  roots.forEach(visit);
  return out;
}

/** Label + value row. `code` labels are identifiers (parameter names) and keep their case. */
function Field({ label, code, children }: { label: string; code?: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <div
        className={cn(
          'break-all pt-1 text-muted-foreground',
          code ? 'font-mono text-[9.5px]' : 'text-[9.5px] font-medium uppercase tracking-wide',
        )}
      >
        {label}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function SpanBlock({ n, isOrigin }: { n: SpanNode; isOrigin: boolean }) {
  const indent = Math.min(n.depth, MAX_INDENT);
  const sev = severityOf(n);
  const S = sev ? SEVERITY[sev] : null;
  const sql = n.kind === 'db' && typeof n.args?.[0] === 'string' ? (n.args[0] as string) : undefined;
  const args = sql ? (n.args ?? []).slice(1) : (n.args ?? []);
  const hasValues = args.length > 0 || n.result !== undefined || n.error || sql;
  return (
    <div className={cn('break-inside-avoid border-b py-1.5 pr-1', isOrigin && S?.soft)} style={{ paddingLeft: `${indent * 12 + 4}px` }}>
      <div className="flex items-baseline gap-1.5">
        <span className={cn('size-1.5 shrink-0 translate-y-[-1px] rounded-full', S ? S.dot : KIND_META[n.kind]?.dot)} />
        <span className={cn('min-w-0 break-all font-mono text-[10.5px] font-semibold', S?.text)}>{n.name}</span>
        {n.depth > MAX_INDENT && <span className="text-[9px] text-muted-foreground">depth {n.depth}</span>}
        <KindBadge kind={n.kind} className="shrink-0 py-0 text-[9px]" />
        {n.async && <span className="text-[9px] text-muted-foreground">async</span>}
        {n.collapsed && (
          <Badge tone="neutral" className="py-0 text-[9px]">
            ×{callCount(n).toLocaleString()} calls · min {formatMs(n.collapsed.minDuration)} · max {formatMs(n.collapsed.maxDuration)}
            {n.collapsed.errors ? ` · ${n.collapsed.errors} failed` : ''}
          </Badge>
        )}
        <span className="ml-auto shrink-0 whitespace-nowrap font-mono text-[9.5px] tabular-nums text-muted-foreground">
          +{formatMs(n.start)} · <span className="text-foreground">{formatMs(n.collapsed ? n.collapsed.totalDuration : n.duration)}</span>
          {n.children.length > 0 && ` · self ${formatMs(n.selfTime)}`}
        </span>
      </div>
      {hasValues && (
        <div className="mt-1 space-y-1 pl-3">
          {sql && (
            <Field label="SQL">
              <PrintValue value={formatSql(sql)} />
            </Field>
          )}
          {args.map((a, i) => (
            <Field key={i} code label={n.params[sql ? i + 1 : i] ?? `arg ${i + 1}`}>
              <PrintValue value={a} />
            </Field>
          ))}
          {n.result !== undefined && (
            <Field label="Returns">
              <PrintValue value={n.result} />
            </Field>
          )}
          {n.error && (
            <Field label="Threw">
              <div className={cn('rounded border px-1.5 py-1 text-[10px]', S?.border, S?.soft)}>
                <span className={cn('font-mono font-semibold', S?.text)}>{n.error.name}</span>
                {n.error.status ? <span className="text-muted-foreground"> ({n.error.status})</span> : null}: {n.error.message}
              </div>
            </Field>
          )}
        </div>
      )}
      {n.valuesDropped && <div className="mt-0.5 pl-3 text-[9px] text-muted-foreground">values not captured (capture budget used up)</div>}
    </div>
  );
}

function TraceReportInner({ id }: { id: string }) {
  const { data, error, fetchedAt } = usePrintData<{ trace: TraceRecord }>({ trace: `/api/traces/${encodeURIComponent(id)}` });
  const trace = data?.trace;
  const tree = useMemo(() => (trace ? buildTree(trace.spans) : null), [trace]);
  const ordered = useMemo(() => (tree ? walk(tree.roots) : []), [tree]);

  const http = trace?.http;
  const title = trace ? `Trace · ${http ? `${http.method} ${http.route ?? http.url}` : trace.name}` : 'Trace';
  const origins = trace ? errorOrigins(trace.spans) : new Set<string>();
  const nodes = ordered.filter((n) => n.parentId !== null);
  const originNodes = nodes.filter((n) => origins.has(n.id));
  const calls = nodes.reduce((a, s) => a + callCount(s), 0);
  const slowest = [...nodes].sort((a, b) => b.selfTime - a.selfTime)[0];
  const printed = ordered.slice(0, MAX_PRINT_SPANS);
  const logs = trace
    ? trace.spans
        .flatMap((s) => (s.logs ?? []).map((l) => ({ ...l, span: s.name, key: `${s.id}:${l.t}:${l.message}` })))
        .sort((a, b) => a.t - b.t)
    : [];

  const byKind = new Map<SpanKind, number>();
  for (const n of nodes) byKind.set(n.kind, (byKind.get(n.kind) ?? 0) + n.selfTime);
  const layerTotal = [...byKind.values()].reduce((a, b) => a + b, 0) || trace?.duration || 1;
  const layers = [...byKind.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  const filters: PrintFilter[] = trace
    ? [
        { label: 'Trace ID', value: trace.id },
        { label: 'Started', value: printDateTime(trace.startTime, true) },
        { label: 'Application', value: trace.application ?? trace.service },
        ...(trace.project ? [{ label: 'Project', value: trace.project }] : []),
        ...(trace.environment ? [{ label: 'Environment', value: trace.environment }] : []),
        ...(trace.userId ? [{ label: 'User', value: trace.userId }] : []),
      ]
    : [{ label: 'Trace ID', value: id }];

  const notes: string[] = [];
  if (trace) {
    if (ordered.length > MAX_PRINT_SPANS)
      notes.push(
        `Call tree: first ${MAX_PRINT_SPANS} of ${ordered.length.toLocaleString()} recorded calls (in call order). Open the trace in StackLens for the rest.`,
      );
    notes.push(
      `Values longer than ${MAX_VALUE_CHARS.toLocaleString()} characters are shortened. Secrets were redacted by the SDK before the trace was sent.`,
    );
    if (trace.truncated)
      notes.push(`${(trace.droppedSpans ?? 0).toLocaleString()} calls weren’t recorded: the trace reached maxSpansPerTrace.`);
    if (trace.valuesTruncated) notes.push('Some later calls kept their timing but not their values: the trace reached maxCaptureBytes.');
    if (logs.length > MAX_LOGS) notes.push(`Logs: first ${MAX_LOGS} of ${logs.length.toLocaleString()} lines.`);
  }

  return (
    <PrintDocument
      title={title}
      subtitle={http && http.url !== http.route ? <span className="font-mono">{http.url}</span> : undefined}
      filters={filters}
      notes={notes}
      generatedAt={fetchedAt}
      ready={!!trace}
      error={error === 'expired' ? 'the call tree of this trace was rotated out of storage; only its summary is kept.' : error}
    >
      {trace && tree && (
        <>
          <div className="grid grid-cols-3 gap-2.5">
            <PrintStat label="Status" value={http?.statusCode ?? trace.status}>
              <div className="mt-1 flex items-center gap-1.5">
                {http ? <MethodBadge method={http.method} className="w-[46px]" /> : <Badge tone="brand">JOB</Badge>}
                {http?.statusCode && <StatusCodeBadge code={http.statusCode} />}
                <OutcomeBadge code={http?.statusCode} failed={trace.status === 'error'} />
              </div>
            </PrintStat>
            <PrintStat
              label="Duration"
              value={formatMs(trace.duration)}
              sub={
                slowest && (
                  <>
                    slowest: <span className="font-mono">{slowest.name}</span> ({formatMs(slowest.selfTime)} self)
                  </>
                )
              }
            />
            <PrintStat
              label="Calls"
              value={calls.toLocaleString()}
              sub={`${nodes.length.toLocaleString()} recorded · depth ${Math.max(0, ...nodes.map((n) => n.depth))} · ${originNodes.length} error${originNodes.length === 1 ? '' : 's'}`}
            />
          </div>

          {layers.length > 0 && (
            <PrintSection title="Where the time went" description="Self time per layer" keepTogether>
              <div className="flex h-2 overflow-hidden rounded-full bg-muted">
                {layers.map(([k, v]) => (
                  <div
                    key={k}
                    className={cn('h-full border-r border-white last:border-0', KIND_META[k].bar)}
                    style={{ width: `${(v / layerTotal) * 100}%` }}
                  />
                ))}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-3 text-[10.5px]">
                {layers.map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1.5">
                    <span className={cn('size-2 rounded-sm', KIND_META[k].dot)} />
                    <span className="text-muted-foreground">{KIND_META[k].label}</span>
                    <span className="font-mono tabular-nums">
                      {formatMs(v)} · {((v / layerTotal) * 100).toFixed(0)}%
                    </span>
                  </span>
                ))}
              </div>
            </PrintSection>
          )}

          <PrintSection title="Errors" description="Where exceptions were thrown (origins only, not the callers they bubbled through)">
            {originNodes.length ? (
              <div className="space-y-2">
                {originNodes.map((n) => {
                  const S = SEVERITY[severityOf(n) ?? 'error'];
                  return (
                    <div key={n.id} className={cn('break-inside-avoid rounded-md border p-2', S.border, S.soft)}>
                      <div className="flex flex-wrap items-baseline gap-1.5 text-[11px]">
                        <span className={cn('font-mono font-semibold', S.text)}>{n.error?.name ?? 'Error'}</span>
                        <span className="text-muted-foreground">in</span>
                        <span className="break-all font-mono">{n.name}</span>
                        <KindBadge kind={n.kind} className="text-[9px]" />
                        {n.error?.status && <Badge tone={S === SEVERITY.warning ? 'warning' : 'error'}>{n.error.status}</Badge>}
                        <span className="ml-auto font-mono text-[9.5px] text-muted-foreground">+{formatMs(n.start)}</span>
                      </div>
                      <div className="mt-0.5 break-words text-[11px]">{n.error?.message}</div>
                      {n.error?.stack && <PrintValue className="mt-1 bg-white/70" value={n.error.stack} max={MAX_STACK_CHARS} />}
                    </div>
                  );
                })}
              </div>
            ) : (
              <PrintEmpty>No errors in this trace.</PrintEmpty>
            )}
          </PrintSection>

          {http && (
            <PrintSection title="Request & response">
              <div className="space-y-1.5 rounded-md border p-2">
                <Field label="URL">
                  <div className="break-all pt-0.5 font-mono text-[10.5px]">
                    {http.method} {http.url}
                    {http.route && http.route !== http.url ? <span className="text-muted-foreground"> (route {http.route})</span> : null}
                    {http.ip ? <span className="text-muted-foreground"> · from {http.ip}</span> : null}
                  </div>
                </Field>
                {(
                  [
                    ['Query', http.request?.query],
                    ['Params', http.request?.params],
                    ['Req. headers', http.request?.headers],
                    ['Req. body', http.request?.body],
                    ['Res. headers', http.response?.headers],
                    ['Res. body', http.response?.body],
                  ] as const
                )
                  .filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'object' && Object.keys(v as object).length === 0))
                  .map(([label, v]) => (
                    <Field key={label} label={label}>
                      <PrintValue value={v} />
                    </Field>
                  ))}
              </div>
            </PrintSection>
          )}

          <PrintSection
            title="Call tree"
            description="Every recorded call in order, with its arguments, return value and errors. Times: start offset · duration · self time."
            right={`${printed.length.toLocaleString()} of ${ordered.length.toLocaleString()} calls`}
          >
            <div className="border-t">
              {printed.map((n) => (
                <SpanBlock key={n.id} n={n} isOrigin={origins.has(n.id)} />
              ))}
            </div>
          </PrintSection>

          <PrintSection title="Logs" description="Console and logger output captured during the request">
            <PrintTable
              rows={logs.slice(0, MAX_LOGS)}
              rowKey={(l, i) => `${l.key}:${i}`}
              empty="No logs captured."
              columns={[
                { header: 'Time', width: '10%', cell: (l) => <span className="font-mono text-[10px]">+{formatMs(l.t)}</span> },
                {
                  header: 'Level',
                  width: '9%',
                  cell: (l) => (
                    <span className={cn('rounded px-1 py-0.5 font-mono text-[9.5px] uppercase', LOG_TONE[l.level] ?? LOG_TONE.debug)}>
                      {l.level}
                    </span>
                  ),
                },
                { header: 'Call', width: '24%', cell: (l) => <span className="break-all font-mono text-[10px]">{l.span}</span> },
                {
                  header: 'Message',
                  cell: (l) => (
                    <>
                      <div className="whitespace-pre-wrap break-words">{l.message}</div>
                      {l.data !== undefined && <PrintValue className="mt-0.5" value={l.data} max={600} />}
                    </>
                  ),
                },
              ]}
            />
          </PrintSection>
        </>
      )}
    </PrintDocument>
  );
}

export default function TraceReport({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <TraceReportInner id={id} />
    </Suspense>
  );
}

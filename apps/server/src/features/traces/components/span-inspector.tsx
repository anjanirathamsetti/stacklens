'use client';
import { AlertOctagon, ArrowDownToLine, ArrowRight, ArrowUpFromLine, Info, ScrollText, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KindBadge, StatusCodeBadge } from '@/components/data-display/trace-badges';
import { GenerateTestButton } from '@/features/ai/components/ai-entry-points';
import { CopyButton, JsonView, toPlain } from '@/components/data-display/json-view';
import { cn, errorStatus, formatMs, KIND_META, SEVERITY, severityOf } from '@/lib/utils';
import type { SpanNode } from '@/lib/span-tree';
import type { TraceRecord } from '@/lib/api-types';

export type InspectorTab = 'input' | 'output' | 'logs' | 'details';

function Block({
  title,
  right,
  children,
  className,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)}>
      <div className="flex min-h-9 items-center justify-between gap-2 border-b bg-muted/30 px-3 py-1.5">
        <div className="min-w-0 text-xs font-medium">{title}</div>
        <div className="flex shrink-0 items-center">{right}</div>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function TypeLine({ type }: { type?: string }) {
  if (!type) return null;
  return (
    <code className="mb-2 block max-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-sky-500/[0.07] px-2 py-1.5 font-mono text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
      {type}
    </code>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{children}</div>;
}

function formatSql(sql: string) {
  return sql
    .replace(/\s+/g, ' ')
    .replace(/\s(FROM|WHERE|LEFT JOIN|INNER JOIN|JOIN|GROUP BY|ORDER BY|LIMIT|OFFSET|VALUES|SET|RETURNING|HAVING)\s/gi, '\n$1 ')
    .replace(/\s(AND|OR)\s/g, '\n  $1 ')
    .trim();
}

export function signatureOf(span: SpanNode) {
  const params = span.params.length ? span.params : (span.args ?? []).map((_, i) => `arg${i}`);
  const args = params.map((p, i) => `${p}: ${span.argTypes?.[i] ?? 'unknown'}`);
  const ret = span.status === 'error' ? 'never' : (span.resultType ?? 'void');
  return `${span.async ? 'async ' : ''}${span.method}(${args.join(', ')}): ${span.async ? `Promise<${ret}>` : ret}`;
}

function copyJson(v: unknown) {
  return JSON.stringify(toPlain(v), null, 2) ?? 'undefined';
}

function ErrorBlock({ span }: { span: SpanNode }) {
  if (!span.error) return null;
  const S = SEVERITY[severityOf(span) ?? 'error'];
  const status = errorStatus(span.error);
  return (
    <Block
      className={S.border}
      title={
        <span className={cn('flex items-center gap-1.5', S.text)}>
          <AlertOctagon className="size-3.5" /> Threw {span.error.name}
          {status && <span className="font-mono text-[10px] font-normal opacity-80">HTTP {status}</span>}
        </span>
      }
      right={<CopyButton text={`${span.error.name}: ${span.error.message}\n${span.error.stack ?? ''}`} />}
    >
      <div className="text-xs leading-relaxed">{span.error.message}</div>
      {span.error.stack && (
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/50 p-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          {span.error.stack.split('\n').slice(1).join('\n').trim()}
        </pre>
      )}
    </Block>
  );
}

function InputPanel({ span, trace }: { span: SpanNode; trace: TraceRecord }) {
  const isRoot = span.parentId === null;
  if (isRoot) {
    const r = trace.http?.request;
    if (!trace.http) return <Empty>This trace was started by a background job – no HTTP input.</Empty>;
    return (
      <div className="space-y-3">
        <Block
          title={
            <span className="font-mono">
              {trace.http.method} {trace.http.url}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-[10px] text-muted-foreground">route</div>
              <div className="font-mono">{trace.http.route ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">user</div>
              <div className="font-mono">{trace.userId ?? '—'}</div>
            </div>
          </div>
        </Block>
        {(['params', 'query', 'body', 'headers'] as const).map((k) => {
          const v = r?.[k];
          const empty = v === undefined || v === null || (typeof v === 'object' && Object.keys(v as object).length === 0);
          return (
            <Block key={k} title={<span className="capitalize">{k}</span>} right={!empty && <CopyButton text={copyJson(v)} />}>
              {empty ? (
                <div className="text-xs text-muted-foreground">empty</div>
              ) : (
                <JsonView value={v} defaultOpen={k === 'headers' ? 1 : 2} />
              )}
            </Block>
          );
        })}
      </div>
    );
  }

  const sql = span.kind === 'db' && typeof span.args?.[0] === 'string' ? (span.args[0] as string) : undefined;
  if (sql) {
    const params = span.args?.[1];
    return (
      <div className="space-y-3">
        <Block title="SQL statement" right={<CopyButton text={sql} />}>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-teal-700 dark:text-teal-300">
            {formatSql(sql)}
          </pre>
        </Block>
        <Block title="Parameters" right={Array.isArray(params) && params.length > 0 && <CopyButton text={copyJson(params)} />}>
          {Array.isArray(params) && params.length > 0 ? (
            <JsonView value={params} defaultOpen={1} />
          ) : (
            <div className="text-xs text-muted-foreground">none</div>
          )}
        </Block>
      </div>
    );
  }

  if (!span.args) return <Empty>Argument capture is disabled (captureArgs: false).</Empty>;
  if (span.args.length === 0) return <Empty>Called with no arguments.</Empty>;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {span.args.length} argument{span.args.length === 1 ? '' : 's'} passed in
        </span>
        <span className="flex items-center gap-1">
          copy all <CopyButton text={copyJson(span.args)} />
        </span>
      </div>
      {span.args.map((a, i) => (
        <Block
          key={i}
          title={
            <span className="flex items-center gap-2">
              <span className="grid size-4 place-items-center rounded bg-muted font-mono text-[9px] text-muted-foreground">{i}</span>
              <span className="font-mono">{span.params[i] ?? `arg${i}`}</span>
            </span>
          }
          right={<CopyButton text={copyJson(a)} />}
        >
          <TypeLine type={span.argTypes?.[i]} />
          <JsonView value={a} />
        </Block>
      ))}
    </div>
  );
}

function OutputPanel({ span, trace }: { span: SpanNode; trace: TraceRecord }) {
  const isRoot = span.parentId === null;
  if (isRoot) {
    if (!trace.http) return span.error ? <ErrorBlock span={span} /> : <Empty>Job finished without an HTTP response.</Empty>;
    const body = trace.http.response?.body;
    return (
      <div className="space-y-3">
        <Block
          title={
            <span className="flex items-center gap-2">
              Response {trace.http.statusCode && <StatusCodeBadge code={trace.http.statusCode} />}
            </span>
          }
          right={body !== undefined && <CopyButton text={copyJson(body)} />}
        >
          {body === undefined ? <div className="text-xs text-muted-foreground">no body captured</div> : <JsonView value={body} />}
        </Block>
        <Block title="Headers">
          <JsonView value={trace.http.response?.headers ?? {}} defaultOpen={1} />
        </Block>
      </div>
    );
  }
  if (span.status === 'error') return <ErrorBlock span={span} />;
  if (span.status === 'pending') return <Empty>This call had not finished when the trace was exported.</Empty>;
  if (span.result === undefined)
    return (
      <div className="space-y-3">
        <TypeLine type={span.async ? 'Promise<void>' : 'void'} />
        <Empty>Returned nothing (undefined).</Empty>
      </div>
    );
  return (
    <Block title="Return value" right={<CopyButton text={copyJson(span.result)} />}>
      <TypeLine type={span.resultType ? (span.async ? `Promise<${span.resultType}>` : span.resultType) : undefined} />
      <JsonView value={span.result} />
    </Block>
  );
}

function LogsPanel({ span }: { span: SpanNode }) {
  if (!span.logs?.length) return <Empty>No console output or stacklens.log() calls inside this function.</Empty>;
  return (
    <div className="space-y-2">
      {span.logs.map((l, i) => (
        <div
          key={i}
          className={cn(
            'rounded-lg border p-2.5',
            l.level === 'error' && 'border-destructive/30 bg-destructive/[0.03]',
            l.level === 'warn' && 'border-warning/30 bg-warning/[0.04]',
          )}
        >
          <div className="flex items-center gap-2 text-[11px]">
            <Badge tone={l.level === 'error' ? 'error' : l.level === 'warn' ? 'warning' : 'neutral'}>{l.level}</Badge>
            <span className="font-mono text-muted-foreground">+{formatMs(l.t)}</span>
          </div>
          {l.message && <div className="mt-1.5 font-mono text-xs">{l.message}</div>}
          {l.data !== undefined && <JsonView value={l.data} className="mt-1.5" defaultOpen={1} />}
        </div>
      ))}
    </div>
  );
}

function DetailsPanel({ span }: { span: SpanNode }) {
  const rows: [string, React.ReactNode][] = [
    [
      'Name',
      <span key="n" className="font-mono">
        {span.name}
      </span>,
    ],
    ['Layer', <KindBadge key="k" kind={span.kind} />],
    ['Class', span.className ?? '—'],
    [
      'Method',
      <span key="m" className="font-mono">
        {span.method}
      </span>,
    ],
    [
      'Parameters',
      <span key="p" className="font-mono">
        {span.params.join(', ') || '—'}
      </span>,
    ],
    ['Async', span.async ? 'yes' : 'no'],
    [
      'Span id',
      <span key="i" className="font-mono">
        {span.id}
      </span>,
    ],
  ];
  return (
    <div className="space-y-3">
      {span.parentId !== null && (
        <Block title="Inferred signature" right={<CopyButton text={signatureOf(span)} />}>
          <code className="block whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">{signatureOf(span)}</code>
        </Block>
      )}
      <Block title="Call metadata">
        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-xs">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="min-w-0 break-all">{v}</dd>
            </div>
          ))}
        </dl>
      </Block>
      {span.attributes && Object.keys(span.attributes).length > 0 && (
        <Block title="Attributes">
          <JsonView value={span.attributes} />
        </Block>
      )}
    </div>
  );
}

export function SpanDetails({
  span,
  trace,
  traceDuration,
  path,
  onSelect,
  tab,
  onTab,
  onClose,
}: {
  span: SpanNode;
  trace: TraceRecord;
  traceDuration: number;
  path: SpanNode[];
  onSelect: (id: string) => void;
  tab: InspectorTab;
  onTab: (t: InspectorTab) => void;
  onClose?: () => void;
}) {
  const meta = KIND_META[span.kind] ?? KIND_META.function;
  const pct = traceDuration ? (span.duration / traceDuration) * 100 : 0;
  const sev = span.status === 'error' ? severityOf(span) : null;
  const isRoot = span.parentId === null;
  const argCount = isRoot ? undefined : span.args?.length;

  return (
    <div className="flex h-full flex-col text-sm">
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <KindBadge kind={span.kind} />
              {sev ? (
                <Badge tone={sev === 'warning' ? 'warning' : 'error'}>{SEVERITY[sev].label.toLowerCase()}</Badge>
              ) : span.status === 'pending' ? (
                <Badge tone="warning">unfinished</Badge>
              ) : (
                <Badge tone="success">ok</Badge>
              )}
              {span.async && <Badge tone="outline">async</Badge>}
            </div>
            <div className="break-all font-mono text-[13px] font-semibold">
              {span.className && <span className="font-normal text-muted-foreground">{span.className}.</span>}
              <span className={sev ? SEVERITY[sev].text : meta.text}>{span.className ? span.method : span.name}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            {!isRoot && <GenerateTestButton functionName={span.name} />}
            <CopyButton text={span.name} />
            {onClose && (
              <button
                onClick={onClose}
                className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
                aria-label="Close inspector"
                title="Close (Esc)"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">{formatMs(span.duration)}</span> total
          </span>
          <span>{formatMs(span.selfTime)} self</span>
          <span>{pct.toFixed(1)}% of request</span>
          {span.descendants > 0 && <span>{span.descendants} child calls</span>}
        </div>
        {path.length > 0 && (
          <details className="group mt-2">
            <summary className="cursor-pointer list-none text-[11px] text-muted-foreground hover:text-foreground">
              <span className="group-open:hidden">
                Show call path ({path.length} caller{path.length === 1 ? '' : 's'}) ›
              </span>
              <span className="hidden group-open:inline">Call path ⌄</span>
            </summary>
            <div className="mt-1.5 flex flex-wrap items-center gap-0.5 text-[11px] text-muted-foreground">
              {path.map((p) => (
                <span key={p.id} className="inline-flex items-center gap-0.5">
                  <button
                    onClick={() => onSelect(p.id)}
                    className="cursor-pointer rounded px-1 font-mono hover:bg-accent hover:text-foreground"
                  >
                    {p.className ? `${p.className}.${p.method}` : p.name}
                  </button>
                  <ArrowRight className="size-3" />
                </span>
              ))}
              <span className="px-1 font-mono text-foreground">{span.className ? `${span.className}.${span.method}` : span.name}</span>
            </div>
          </details>
        )}
      </div>

      <Tabs value={tab} onValueChange={(v) => onTab(v as InspectorTab)} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b px-4 py-2">
          <TabsList className="w-full">
            <TabsTrigger value="input" className="flex-1">
              <ArrowDownToLine /> Input
              {argCount !== undefined && <span className="rounded bg-muted px-1 font-mono text-[10px]">{argCount}</span>}
            </TabsTrigger>
            <TabsTrigger value="output" className="flex-1">
              <ArrowUpFromLine /> Output
              {sev && <span className={cn('size-1.5 rounded-full', SEVERITY[sev].dot)} />}
            </TabsTrigger>
            <TabsTrigger value="logs" className="flex-1">
              <ScrollText /> Logs
              {!!span.logs?.length && <span className="rounded bg-muted px-1 font-mono text-[10px]">{span.logs.length}</span>}
            </TabsTrigger>
            <TabsTrigger value="details" className="flex-1">
              <Info /> Details
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <TabsContent value="input">
            <InputPanel span={span} trace={trace} />
          </TabsContent>
          <TabsContent value="output">
            <OutputPanel span={span} trace={trace} />
          </TabsContent>
          <TabsContent value="logs">
            <LogsPanel span={span} />
          </TabsContent>
          <TabsContent value="details">
            <DetailsPanel span={span} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

'use client';
import { useState } from 'react';
import {
  AlertOctagon,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Info,
  Repeat,
  ScrollText,
  Search,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KindBadge, StatusCodeBadge } from '@/components/data-display/trace-badges';
import { GenerateTestButton } from '@/features/ai/components/ai-entry-points';
import { CopyButton, JsonView, jsonMatches, toPlain } from '@/components/data-display/json-view';
import { SqlView } from '@/components/data-display/sql-view';
import { InlineType, SignatureView, TypeView, signatureText } from '@/components/data-display/code-view';
import type { SignatureParts } from '@stacklens/shared/type-format';
import { sqlSummary } from '@stacklens/shared/sql-format';
import { cn, errorStatus, formatMs, KIND_META, SEVERITY, severityOf } from '@/lib/utils';
import { busyTime, type SpanNode } from '@stacklens/shared/span-tree';
import type { TraceRecord } from '@stacklens/shared/api-types';

export type InspectorTab = 'input' | 'output' | 'logs' | 'details';

function Block({
  title,
  right,
  children,
  className,
  open,
  onToggle,
  preview,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** collapsible only when `onToggle` is given */
  open?: boolean;
  onToggle?: () => void;
  /** shown in the header while collapsed */
  preview?: React.ReactNode;
}) {
  const collapsible = !!onToggle;
  const isOpen = !collapsible || open !== false;
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)}>
      <div
        className={cn(
          'flex min-h-9 items-center justify-between gap-2 bg-muted/30 px-3 py-1.5',
          isOpen && 'border-b',
          collapsible && 'cursor-pointer select-none hover:bg-muted/60',
        )}
        onClick={onToggle}
        role={collapsible ? 'button' : undefined}
        aria-expanded={collapsible ? isOpen : undefined}
        tabIndex={collapsible ? 0 : undefined}
        onKeyDown={collapsible ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle?.()) : undefined}
      >
        <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          {collapsible && (
            <ChevronRight
              className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-150', isOpen && 'rotate-90')}
            />
          )}
          <div className="shrink-0">{title}</div>
          {!isOpen && preview && <div className="min-w-0 truncate text-[11px] font-normal">{preview}</div>}
        </div>
        <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
          {right}
        </div>
      </div>
      {isOpen && <div className="p-3">{children}</div>}
    </div>
  );
}

/* ------------------------------ card stack ------------------------------ */

interface CardSpec {
  key: string;
  title: React.ReactNode;
  right?: React.ReactNode;
  /** one-line summary shown in the header while the card is folded */
  preview?: React.ReactNode;
  className?: string;
  body: React.ReactNode;
  /** false hides the card while searching */
  matches?: boolean;
}

/**
 * A section's cards. With two or more, each folds with a chevron and "Expand all / Collapse all"
 * appears; a single card stays a plain card. While searching, cards without a match are hidden and
 * the rest are shown open.
 */
function CardStack({
  cards,
  label,
  extra,
  filter,
}: {
  cards: CardSpec[];
  label?: React.ReactNode;
  extra?: React.ReactNode;
  filter?: string;
}) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const searching = !!filter?.trim();
  const shown = searching ? cards.filter((c) => c.matches !== false) : cards;
  const many = cards.length > 1;
  const allClosed = many && cards.every((c) => closed.has(c.key));
  const toggle = (key: string) =>
    setClosed((c) => {
      const n = new Set(c);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  return (
    <div className="space-y-3">
      {(label || extra || many) && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">
            {searching ? `${shown.length} of ${cards.length} ${cards.length === 1 ? 'card matches' : 'cards match'}` : label}
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {many && !searching && (
              <button
                type="button"
                onClick={() => setClosed(allClosed ? new Set() : new Set(cards.map((c) => c.key)))}
                className="flex items-center gap-1 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground cursor-pointer"
              >
                {allClosed ? <ChevronsUpDown className="size-3.5" /> : <ChevronsDownUp className="size-3.5" />}
                {allClosed ? 'Expand all' : 'Collapse all'}
              </button>
            )}
            {extra}
          </span>
        </div>
      )}
      {searching && shown.length === 0 && <Empty>Nothing here matches “{filter!.trim()}”.</Empty>}
      {shown.map((c) => (
        <Block
          key={c.key}
          title={c.title}
          right={c.right}
          className={c.className}
          {...(many && {
            open: searching || !closed.has(c.key),
            onToggle: searching ? undefined : () => toggle(c.key),
            preview: c.preview,
          })}
        >
          {c.body}
        </Block>
      ))}
    </div>
  );
}

/** Search box for the Input / Output tabs. */
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative mb-3">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && value && (e.stopPropagation(), onChange(''))}
        placeholder={placeholder}
        spellCheck={false}
        className="h-8 w-full rounded-md border border-input bg-card pl-8 pr-8 font-mono text-xs shadow-xs placeholder:font-sans placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
          aria-label="Clear search"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  );
}

const lc = (q?: string) => q?.trim().toLowerCase() ?? '';
const textHas = (text: string | undefined | null, q: string) => !!text && text.toLowerCase().includes(q);

function TypeLine({ type }: { type?: string }) {
  if (!type) return null;
  return <TypeView type={type} className="mb-2 max-h-40" />;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">{children}</div>;
}

/** The call's inferred signature, as parts for SignatureView. */
export function signatureParts(span: SpanNode): SignatureParts {
  const params = span.params.length ? span.params : (span.args ?? []).map((_, i) => `arg${i}`);
  const ret = span.status === 'error' ? 'never' : (span.resultType ?? 'void');
  return {
    async: span.async,
    name: span.method,
    params: params.map((p, i) => ({ name: p, type: span.argTypes?.[i] ?? 'unknown' })),
    returnType: span.async ? `Promise<${ret}>` : ret,
  };
}

function copyJson(v: unknown) {
  return JSON.stringify(toPlain(v), null, 2) ?? 'undefined';
}

function errorCard(span: SpanNode): CardSpec | undefined {
  if (!span.error) return undefined;
  const S = SEVERITY[severityOf(span) ?? 'error'];
  const status = errorStatus(span.error);
  return {
    key: 'error',
    className: S.border,
    title: (
      <span className={cn('flex items-center gap-1.5', S.text)}>
        <AlertOctagon className="size-3.5" /> Threw {span.error.name}
        {status && <span className="font-mono text-[10px] font-normal opacity-80">HTTP {status}</span>}
      </span>
    ),
    right: <CopyButton text={`${span.error.name}: ${span.error.message}\n${span.error.stack ?? ''}`} />,
    preview: <span className="text-muted-foreground">{span.error.message}</span>,
    body: (
      <>
        <div className="text-xs leading-relaxed">{span.error.message}</div>
        {span.error.stack && (
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/50 p-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
            {span.error.stack.split('\n').slice(1).join('\n').trim()}
          </pre>
        )}
      </>
    ),
  };
}

const isEmptyValue = (v: unknown) => v === undefined || v === null || (typeof v === 'object' && Object.keys(v as object).length === 0);

/* -------------------------------- panels -------------------------------- */

/** Does this call have input worth searching? */
function hasSearchableInput(span: SpanNode, trace: TraceRecord) {
  return span.parentId === null ? !!trace.http : !!span.args?.length;
}

function InputPanel({ span, trace, filter }: { span: SpanNode; trace: TraceRecord; filter: string }) {
  const q = lc(filter);
  if (span.parentId === null) {
    if (!trace.http) return <Empty>This trace was started by a background job – no HTTP input.</Empty>;
    const http = trace.http;
    const r = http.request;
    const cards: CardSpec[] = [
      {
        key: 'request',
        title: (
          <span className="font-mono">
            {http.method} {http.url}
          </span>
        ),
        matches: [http.method, http.url, http.route, trace.userId].some((t) => textHas(t, q)),
        body: (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-[10px] text-muted-foreground">route</div>
              <div className="font-mono">{http.route ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10px] text-muted-foreground">user</div>
              <div className="font-mono">{trace.userId ?? '—'}</div>
            </div>
          </div>
        ),
      },
      ...(['params', 'query', 'body', 'headers'] as const).map((k): CardSpec => {
        const v = r?.[k];
        const empty = isEmptyValue(v);
        return {
          key: k,
          title: <span className="capitalize">{k}</span>,
          right: !empty && <CopyButton text={copyJson(v)} />,
          preview: <span className="text-muted-foreground">{empty ? 'empty' : `${Object.keys(v as object).length} fields`}</span>,
          matches: !empty && (textHas(k, q) || jsonMatches(v, q)),
          body: empty ? (
            <div className="text-xs text-muted-foreground">empty</div>
          ) : (
            <JsonView value={v} defaultOpen={k === 'headers' ? 1 : 2} filter={textHas(k, q) ? undefined : filter} />
          ),
        };
      }),
    ];
    return <CardStack key={span.id} cards={cards} label="Request" filter={filter} />;
  }

  const sql = span.kind === 'db' && typeof span.args?.[0] === 'string' ? (span.args[0] as string) : undefined;
  if (sql) {
    const params = span.args?.[1];
    const hasParams = Array.isArray(params) && params.length > 0;
    const cards: CardSpec[] = [
      {
        key: 'sql',
        title: 'SQL statement',
        preview: <span className="font-mono text-muted-foreground">{sqlSummary(sql)}</span>,
        matches: textHas(sql, q),
        body: <SqlView sql={sql} className="border-0 bg-transparent" />,
      },
      {
        key: 'params',
        title: 'Parameters',
        right: hasParams && <CopyButton text={copyJson(params)} />,
        preview: <span className="text-muted-foreground">{hasParams ? `${(params as unknown[]).length} values` : 'none'}</span>,
        matches: hasParams && jsonMatches(params, q),
        body: hasParams ? (
          <JsonView value={params} defaultOpen={1} filter={filter} />
        ) : (
          <div className="text-xs text-muted-foreground">none</div>
        ),
      },
    ];
    return <CardStack key={span.id} cards={cards} filter={filter} />;
  }

  if (!span.args) return <Empty>Argument capture is disabled (captureArgs: false).</Empty>;
  if (span.args.length === 0) return <Empty>Called with no arguments.</Empty>;
  const args = span.args;
  const cards = args.map((a, i): CardSpec => {
    const name = span.params[i] ?? `arg${i}`;
    const type = span.argTypes?.[i];
    const nameHit = textHas(name, q);
    return {
      key: String(i),
      title: (
        <span className="flex items-center gap-2">
          <span className="grid size-4 place-items-center rounded bg-muted font-mono text-[9px] text-muted-foreground">{i}</span>
          <span className="font-mono">{name}</span>
        </span>
      ),
      right: <CopyButton text={copyJson(a)} />,
      preview: type ? <InlineType type={type} className="text-[11px]" /> : undefined,
      matches: nameHit || textHas(type, q) || jsonMatches(a, q),
      body: (
        <>
          <TypeLine type={type} />
          <JsonView value={a} filter={nameHit ? undefined : filter} />
        </>
      ),
    };
  });
  return (
    <CardStack
      key={span.id}
      cards={cards}
      filter={filter}
      label={`${args.length} argument${args.length === 1 ? '' : 's'} passed in`}
      extra={
        <span className="flex items-center gap-1">
          copy all <CopyButton text={copyJson(args)} />
        </span>
      }
    />
  );
}

/** Does this call have output worth searching? */
function hasSearchableOutput(span: SpanNode, trace: TraceRecord) {
  return span.parentId === null ? !!trace.http : span.status === 'ok' && span.result !== undefined;
}

function OutputPanel({ span, trace, filter }: { span: SpanNode; trace: TraceRecord; filter: string }) {
  const q = lc(filter);
  if (span.parentId === null) {
    const err = errorCard(span);
    if (!trace.http) return err ? <CardStack key={span.id} cards={[err]} /> : <Empty>Job finished without an HTTP response.</Empty>;
    const http = trace.http;
    const body = http.response?.body;
    const headers = http.response?.headers ?? {};
    const cards: CardSpec[] = [
      {
        key: 'response',
        title: <span className="flex items-center gap-2">Response {http.statusCode && <StatusCodeBadge code={http.statusCode} />}</span>,
        right: body !== undefined && <CopyButton text={copyJson(body)} />,
        preview: <span className="text-muted-foreground">{body === undefined ? 'no body' : 'body'}</span>,
        matches: body !== undefined && jsonMatches(body, q),
        body:
          body === undefined ? (
            <div className="text-xs text-muted-foreground">no body captured</div>
          ) : (
            <JsonView value={body} filter={filter} />
          ),
      },
      {
        key: 'headers',
        title: 'Headers',
        preview: <span className="text-muted-foreground">{Object.keys(headers as object).length} headers</span>,
        matches: jsonMatches(headers, q),
        body: <JsonView value={headers} defaultOpen={1} filter={filter} />,
      },
    ];
    return <CardStack key={span.id} cards={cards} filter={filter} />;
  }
  if (span.status === 'error') return <CardStack key={span.id} cards={[errorCard(span)!]} />;
  if (span.status === 'pending') return <Empty>This call had not finished when the trace was exported.</Empty>;
  if (span.result === undefined)
    return (
      <div className="space-y-3">
        <TypeLine type={span.async ? 'Promise<void>' : 'void'} />
        <Empty>Returned nothing (undefined).</Empty>
      </div>
    );
  const type = span.resultType ? (span.async ? `Promise<${span.resultType}>` : span.resultType) : undefined;
  return (
    <CardStack
      key={span.id}
      filter={filter}
      cards={[
        {
          key: 'result',
          title: 'Return value',
          right: <CopyButton text={copyJson(span.result)} />,
          matches: textHas(type, q) || jsonMatches(span.result, q),
          body: (
            <>
              <TypeLine type={type} />
              <JsonView value={span.result} filter={filter} />
            </>
          ),
        },
      ]}
    />
  );
}

function LogsPanel({ span }: { span: SpanNode }) {
  if (!span.logs?.length) return <Empty>No console output or stacklens.log() calls inside this function.</Empty>;
  const cards = span.logs.map((l, i): CardSpec => ({
    key: String(i),
    className: cn(l.level === 'error' && 'border-destructive/30', l.level === 'warn' && 'border-warning/30'),
    title: (
      <span className="flex items-center gap-2 font-normal">
        <Badge tone={l.level === 'error' ? 'error' : l.level === 'warn' ? 'warning' : 'neutral'}>{l.level}</Badge>
        <span className="font-mono text-[11px] text-muted-foreground">+{formatMs(l.t)}</span>
      </span>
    ),
    preview: <span className="font-mono text-muted-foreground">{l.message || (l.data !== undefined ? 'data' : '')}</span>,
    body: (
      <>
        {l.message && <div className="font-mono text-xs">{l.message}</div>}
        {l.data !== undefined && <JsonView value={l.data} className={cn(l.message && 'mt-1.5')} defaultOpen={1} />}
        {!l.message && l.data === undefined && <div className="text-xs text-muted-foreground">(empty)</div>}
      </>
    ),
  }));
  return <CardStack key={span.id} cards={cards} label={`${cards.length} log line${cards.length === 1 ? '' : 's'}`} />;
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
  const sig = signatureParts(span);
  const cards: CardSpec[] = [];
  if (span.parentId !== null)
    cards.push({
      key: 'signature',
      title: 'Inferred signature',
      right: <CopyButton text={signatureText(sig)} />,
      preview: <span className="font-mono text-muted-foreground">{sig.name}(…)</span>,
      body: <SignatureView sig={sig} className="max-h-72" />,
    });
  cards.push({
    key: 'metadata',
    title: 'Call metadata',
    preview: <span className="font-mono text-muted-foreground">{span.name}</span>,
    body: (
      <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="min-w-0 break-all">{v}</dd>
          </div>
        ))}
      </dl>
    ),
  });
  if (span.attributes && Object.keys(span.attributes).length > 0)
    cards.push({
      key: 'attributes',
      title: 'Attributes',
      preview: <span className="text-muted-foreground">{Object.keys(span.attributes).length} attributes</span>,
      body: <JsonView value={span.attributes} />,
    });
  return <CardStack key={span.id} cards={cards} />;
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
  // collapsed spans: time the calls actually ran, not the wall-clock window they spread over
  const ran = busyTime(span);
  const pct = traceDuration ? Math.min(100, (ran / traceDuration) * 100) : 0;
  const sev = span.status === 'error' ? severityOf(span) : null;
  const isRoot = span.parentId === null;
  const argCount = isRoot ? undefined : span.args?.length;
  // search text per tab, tied to the selected call (a new call starts with an empty search)
  const [search, setSearch] = useState<{ id: string; input: string; output: string }>({ id: span.id, input: '', output: '' });
  const q = search.id === span.id ? search : { id: span.id, input: '', output: '' };
  const setQ = (which: 'input' | 'output', v: string) => setSearch({ ...q, [which]: v });

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
            <span className="font-medium text-foreground">{formatMs(ran)}</span> total
            {span.collapsed && ` over ${span.collapsed.count.toLocaleString()} calls`}
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

      {span.collapsed && <CollapsedSummary span={span} />}
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
            {span.collapsed || (span.valuesDropped && span.args === undefined) ? (
              <NotCaptured span={span} />
            ) : (
              <>
                {hasSearchableInput(span, trace) && (
                  <SearchBox value={q.input} onChange={(v) => setQ('input', v)} placeholder="Search input by field name or value…" />
                )}
                <InputPanel span={span} trace={trace} filter={q.input} />
              </>
            )}
          </TabsContent>
          <TabsContent value="output">
            {span.collapsed || (span.valuesDropped && span.result === undefined && !span.error) ? (
              <NotCaptured span={span} />
            ) : (
              <>
                {hasSearchableOutput(span, trace) && (
                  <SearchBox value={q.output} onChange={(v) => setQ('output', v)} placeholder="Search output by field name or value…" />
                )}
                <OutputPanel span={span} trace={trace} filter={q.output} />
              </>
            )}
          </TabsContent>
          <TabsContent value="logs">
            <LogsPanel span={span} />
            {!!span.droppedLogs && (
              <div className="mt-3 text-xs text-muted-foreground">
                +{span.droppedLogs.toLocaleString()} more log lines weren’t kept (limit per call).
              </div>
            )}
          </TabsContent>
          <TabsContent value="details">
            <DetailsPanel span={span} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/** Stats for a span that stands for many repeated calls. */
function CollapsedSummary({ span }: { span: SpanNode }) {
  const c = span.collapsed!;
  const avg = c.totalDuration / Math.max(1, c.count);
  const stats: [string, string][] = [
    ['Calls', c.count.toLocaleString()],
    ['Total', formatMs(c.totalDuration)],
    ['Average', formatMs(avg)],
    ['Min / max', `${formatMs(c.minDuration)} / ${formatMs(c.maxDuration)}`],
  ];
  return (
    <div className="shrink-0 border-b bg-brand/[0.04] px-4 py-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-brand">
        <Repeat className="size-3.5" /> Repeated calls, folded into one row
      </div>
      <div className="grid grid-cols-4 gap-2">
        {stats.map(([l, v]) => (
          <div key={l} className="rounded-md border bg-background px-2 py-1.5">
            <div className="text-[10px] text-muted-foreground">{l}</div>
            <div className="font-mono text-xs font-medium tabular-nums">{v}</div>
          </div>
        ))}
      </div>
      {c.errors > 0 && (
        <div className="mt-2 text-xs text-destructive">
          {c.errors.toLocaleString()} of these calls threw. The first failures are listed as separate rows next to this one, with their
          inputs.
        </div>
      )}
    </div>
  );
}

/** Why a span has no input/output. */
function NotCaptured({ span }: { span: SpanNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2.5 text-xs text-muted-foreground">
      <Info className="mt-px size-3.5 shrink-0" />
      {span.collapsed ? (
        <span>
          Values aren’t captured for repeated calls. The first calls of this function, listed just above this row, have their full inputs
          and outputs.
        </span>
      ) : (
        <span>
          This request captured more data than the per-trace limit, so later calls kept their timing and errors but not their values. Raise{' '}
          <code className="font-mono">maxCaptureBytes</code> in the tracer to keep more.
        </span>
      )}
    </div>
  );
}

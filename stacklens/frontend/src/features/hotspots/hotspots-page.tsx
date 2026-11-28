'use client';
import { Suspense, startTransition, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, ExternalLink, Flame } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ExportPdfButton } from '@/components/print/export-pdf-button';
import { FilterBar } from '@/components/layout/filter-bar';
import { Pagination, TableShell, filterKeyOf, usePaged } from '@/components/data-display/pagination';
import { useLive } from '@/components/layout/providers';
import { useFilters, useLiveRefresh } from '@/lib/url-filters';
import { Input, Select } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import { KindBadge } from '@/components/data-display/trace-badges';
import { InlineType, SignatureView } from '@/components/data-display/code-view';
import { cn, formatMs } from '@/lib/utils';
import type { Hotspot, SpanKind } from '@stacklens/shared/api-types';

type SortKey = 'totalSelf' | 'calls' | 'avg' | 'p95' | 'errors';

/** Column header; sortable when `k` is set. */
function Th({
  k,
  sort,
  onSort,
  children,
  className,
}: {
  k?: SortKey;
  sort: SortKey;
  onSort: (k: SortKey) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th
      onClick={k ? () => onSort(k) : undefined}
      className={cn('h-9 px-3 font-medium', k && 'cursor-pointer hover:text-foreground', sort === k && 'text-foreground', className)}
    >
      {children}
      {sort === k && ' ↓'}
    </th>
  );
}

function InsightsInner() {
  const { apiQuery, key, globalQs, sp } = useFilters();
  const { live } = useLive();
  const [items, setItems] = useState<Hotspot[]>([]);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'' | SpanKind>((sp.get('kind') as SpanKind) ?? '');
  const [sort, setSort] = useState<SortKey>('totalSelf');

  const load = useCallback(() => {
    fetch(`/api/hotspots?${apiQuery({ search })}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => startTransition(() => setItems(d.hotspots)));
  }, [apiQuery, search]);
  useEffect(() => {
    const id = setTimeout(load, 150);
    return () => clearTimeout(id);
  }, [key, load]);
  useLiveRefresh(load, live);

  const rows = items.filter((h) => !kind || h.kind === kind).sort((a, b) => b[sort] - a[sort]);
  const maxSelf = Math.max(1, ...rows.map((r) => r.totalSelf));
  const pg = usePaged(rows, `${filterKeyOf(sp)}|${search}|${kind}|${sort}`);
  const exportParams = { search, kind, sort: sort === 'totalSelf' ? '' : sort };

  return (
    <>
      <PageHeader title="Hotspots" description="Every instrumented function aggregated across the traces in range">
        <ExportPdfButton report="hotspots" params={exportParams} />
      </PageHeader>
      <FilterBar onRefresh={load} />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
        <TableShell
          scrollKey={`${pg.page}-${pg.size}`}
          footer={<Pagination page={pg.page} size={pg.size} total={pg.total} onPage={pg.setPage} onSize={pg.setSize} noun="functions" />}
          toolbar={
            <div className="flex flex-wrap items-center gap-2 p-3">
              <div className="relative min-w-56 flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Filter functions…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <Select value={kind} clearable className="w-40" onChange={(e) => setKind(e.target.value as SpanKind | '')}>
                <option value="">All layers</option>
                <option value="controller">Controllers</option>
                <option value="handler">Handlers</option>
                <option value="service">Services</option>
                <option value="repository">Repositories</option>
                <option value="db">DB / SQL</option>
                <option value="function">Functions</option>
              </Select>
              <ExportPdfButton report="hotspots" variant="table" noun="functions" params={exportParams} />
            </div>
          }
        >
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                  <Th sort={sort} onSort={setSort} className="pl-4">
                    Function
                  </Th>
                  <Th sort={sort} onSort={setSort}>
                    Layer
                  </Th>
                  <Th sort={sort} onSort={setSort} k="calls">
                    Calls
                  </Th>
                  <Th sort={sort} onSort={setSort} k="avg">
                    Avg
                  </Th>
                  <Th sort={sort} onSort={setSort} k="p95">
                    p95
                  </Th>
                  <Th sort={sort} onSort={setSort} k="errors">
                    Errors
                  </Th>
                  <Th sort={sort} onSort={setSort} k="totalSelf">
                    Total self time
                  </Th>
                  <Th sort={sort} onSort={setSort} className="pr-4">
                    Signature
                  </Th>
                </tr>
              </thead>
              <tbody>
                {pg.rows.map((h) => (
                  <tr key={h.name} className="border-b last:border-0 hover:bg-accent/50">
                    <td className="py-2.5 pl-4 pr-3">
                      <Link
                        href={`/traces/${h.lastTraceId}${globalQs}`}
                        className="group inline-flex items-center gap-1.5 font-mono text-[13px] hover:underline"
                      >
                        {h.name}
                        <ExternalLink className="size-3 opacity-0 group-hover:opacity-60" />
                      </Link>
                      <div className="text-[11px] text-muted-foreground">
                        in {h.traces} trace{h.traces === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td className="px-3">
                      <KindBadge kind={h.kind} />
                    </td>
                    <td className="px-3 font-mono text-xs tabular-nums">{h.calls}</td>
                    <td className="px-3 font-mono text-xs tabular-nums">{formatMs(h.avg)}</td>
                    <td className="px-3 font-mono text-xs tabular-nums">{formatMs(h.p95)}</td>
                    <td className="px-3">
                      {h.errors ? <Badge tone="error">{h.errors}</Badge> : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-warning" style={{ width: `${(h.totalSelf / maxSelf) * 100}%` }} />
                        </div>
                        <span className="font-mono text-xs tabular-nums">{formatMs(h.totalSelf)}</span>
                      </div>
                    </td>
                    <td className="max-w-[360px] px-3 pr-4">
                      <Tooltip
                        className="max-w-xl p-0"
                        content={
                          <SignatureView
                            className="max-h-80 bg-transparent px-3 py-2"
                            sig={{
                              async: h.async,
                              name: h.name.split('.').pop() ?? h.name,
                              params: h.params.map((p, i) => ({ name: p, type: h.argTypes?.[i] ?? 'unknown' })),
                              returnType: h.async ? `Promise<${h.resultType ?? 'void'}>` : (h.resultType ?? 'void'),
                            }}
                          />
                        }
                      >
                        <code className="block truncate font-mono text-[11px]">
                          <span className="text-muted-foreground">(</span>
                          {h.params.map((p, i) => (
                            <span key={i}>
                              {i > 0 && <span className="text-muted-foreground">, </span>}
                              <span className="text-orange-600 dark:text-orange-300">{p}</span>
                            </span>
                          ))}
                          <span className="text-muted-foreground">) → </span>
                          <InlineType type={h.async ? `Promise<${h.resultType ?? 'void'}>` : (h.resultType ?? 'void')} />
                        </code>
                      </Tooltip>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-16 text-sm text-muted-foreground">
                <Flame className="size-5" />
                No data yet – send some requests to an instrumented API.
              </div>
            )}
          </div>
        </TableShell>
      </div>
    </>
  );
}

export default function InsightsPage() {
  return (
    <Suspense>
      <InsightsInner />
    </Suspense>
  );
}

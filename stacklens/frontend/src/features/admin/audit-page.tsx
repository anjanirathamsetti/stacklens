'use client';
import { useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ExportPdfButton } from '@/components/print/export-pdf-button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useResource } from '@/lib/use-resource';
import { useSettings } from '@/lib/settings-context';
import { cn, formatDateTime } from '@/lib/utils';
import type { AuditEntry } from '@stacklens/shared/api-types';
import { auditLabel as label, auditTone as tone } from '@/features/admin/audit-labels';

export default function AuditPage() {
  const { data, reload, loading } = useResource<{ entries: AuditEntry[] }>('/api/admin/audit?limit=300');
  const { timeFormat } = useSettings().settings;
  const [query, setQuery] = useState('');
  const [hideSignIns, setHideSignIns] = useState(false);
  const entries = useMemo(
    () =>
      (data?.entries ?? []).filter(
        (e) =>
          (!hideSignIns || !['login', 'logout'].includes(e.action)) &&
          (!query || `${e.actorEmail} ${e.target} ${label(e.action)}`.toLowerCase().includes(query.toLowerCase())),
      ),
    [data, query, hideSignIns],
  );

  return (
    <>
      <PageHeader title="Audit log" description="Sign-ins and changes to users, keys and settings">
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          Refresh
        </Button>
        <ExportPdfButton report="admin/audit" params={{ q: query, hideSignIns }} />
      </PageHeader>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl p-6">
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b p-3">
              <Input
                placeholder="Search by person, action or target…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="max-w-xs"
              />
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={hideSignIns}
                  onChange={(e) => setHideSignIns(e.target.checked)}
                  className="accent-[var(--brand)]"
                />
                Hide sign-ins
              </label>
              <span className="ml-auto text-xs text-muted-foreground">Latest 300 events</span>
              <ExportPdfButton report="admin/audit" variant="table" noun="events" params={{ q: query, hideSignIns }} />
            </div>
            <div className="divide-y">
              {entries.map((e) => (
                <div key={e.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', tone(e.action))} />
                  <div className="min-w-0 flex-1">
                    <div>
                      <span className="font-medium">{e.actorEmail ?? 'System'}</span>{' '}
                      <span className="text-muted-foreground">{label(e.action).toLowerCase()}</span>
                      {e.target && e.target !== e.actorEmail && <span className="font-mono text-xs"> {e.target}</span>}
                    </div>
                    {Object.keys(e.details).length > 0 && (
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {Object.entries(e.details)
                          .map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 text-right text-xs text-muted-foreground">
                    <div className="font-mono">{formatDateTime(e.at, timeFormat)}</div>
                    {e.ip && <div className="font-mono text-[11px]">{e.ip}</div>}
                  </div>
                </div>
              ))}
            </div>
            {data && entries.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground">
                <ScrollText className="size-5" /> No events{query ? ` match “${query}”` : ' yet'}
              </div>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

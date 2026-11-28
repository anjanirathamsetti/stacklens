'use client';
import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Section } from '@/components/layout/settings-ui';
import { cn, formatDateTime, formatMs } from '@/lib/utils';
import type { IncidentSource } from '@stacklens/shared/api-types';

/** Admin → Data & storage and Admin → Integrations. */

export interface ServerInfo {
  storage: {
    database: { kind: 'postgres' | 'embedded'; location: string };
    dataDir: string;
    traces: number;
    errorTraces: number;
    summaries: number;
    oldest?: number;
    retentionDays: number;
    limits: { traces: number; errorTraces: number; summaries: number };
    bytes: number;
  };
  incidents: IncidentSource;
}

const mb = (b: number) => (b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${(b / 1e3).toFixed(0)} KB`);

function Meter({ label, value, max, hint }: { label: string; value: number; max: number; hint?: string }) {
  const p = Math.min(100, (value / Math.max(max, 1)) * 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span>{label}</span>
        <span className="font-mono text-muted-foreground">
          {value.toLocaleString()} / {max.toLocaleString()}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full transition-all', p > 90 ? 'bg-amber-400' : 'bg-viz')} style={{ width: `${p}%` }} />
      </div>
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function DataTab({ info, reload }: { info: ServerInfo | null; reload: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const s = info?.storage;
  return (
    <div className="space-y-4">
      <Section title="Storage" description="Traces, summaries, incidents and settings are stored in PostgreSQL.">
        {s ? (
          <>
            <Meter
              label="Full call trees (healthy)"
              value={s.traces - s.errorTraces}
              max={s.limits.traces}
              hint="Older call trees keep their summary; the full tree is pruned first."
            />
            <Meter
              label="Call trees with errors"
              value={s.errorTraces}
              max={s.limits.errorTraces}
              hint="Kept in a separate pool so failing requests stay inspectable longer."
            />
            <Meter
              label="Request summaries"
              value={s.summaries}
              max={s.limits.summaries}
              hint="Power charts, metrics and error groups for long time ranges."
            />
            <div className="grid gap-3 border-t pt-4 text-xs sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">Database</div>
                <div className="font-mono">{s.database.kind === 'postgres' ? 'PostgreSQL' : 'Embedded PostgreSQL'}</div>
                <div className="break-all font-mono text-muted-foreground">{s.database.location}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Table size</div>
                <div className="font-mono">{mb(s.bytes)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Retention</div>
                <div className="font-mono">{s.retentionDays} days</div>
              </div>
              <div>
                <div className="text-muted-foreground">Oldest data</div>
                <div className="font-mono">{s.oldest ? new Date(s.oldest).toLocaleString() : '—'}</div>
              </div>
            </div>
            <div className="text-[11px] text-muted-foreground">
              Set <code className="font-mono">DATABASE_URL</code> to use an external PostgreSQL server. Limits:{' '}
              <code className="font-mono">STACKLENS_MAX_TRACES</code>, <code className="font-mono">STACKLENS_MAX_ERROR_TRACES</code>,{' '}
              <code className="font-mono">STACKLENS_MAX_SUMMARIES</code>, <code className="font-mono">STACKLENS_RETENTION_DAYS</code>.
            </div>
          </>
        ) : (
          <div className="h-24 animate-pulse rounded-md bg-muted" />
        )}
      </Section>
      <Section title="Danger zone" description="Permanently delete every captured trace and summary. Incidents are not affected.">
        <div className="flex items-center justify-between gap-4">
          <div className="text-xs text-muted-foreground">
            {confirming ? 'This cannot be undone. Delete all trace data?' : 'Useful before a demo or after changing instrumentation.'}
          </div>
          {confirming ? (
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={async () => {
                  await fetch('/api/traces', { method: 'DELETE' });
                  setConfirming(false);
                  reload();
                }}
              >
                <Trash2 /> Delete all data
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="border-rose-400/40 text-rose-600 hover:bg-rose-500/10 dark:text-rose-400"
              onClick={() => setConfirming(true)}
            >
              <Trash2 /> Clear trace data
            </Button>
          )}
        </div>
      </Section>
    </div>
  );
}

export function IntegrationsTab({ info }: { info: ServerInfo | null }) {
  const src = info?.incidents;
  return (
    <div className="space-y-4">
      <Section title="ServiceNow" description="Create and track incidents for error groups.">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 size-2.5 shrink-0 rounded-full',
              src?.mode === 'servicenow' ? (src.error ? 'bg-rose-400' : 'bg-success') : 'bg-muted-foreground/40',
            )}
          />
          <div className="text-sm">
            {src?.mode === 'servicenow' ? (
              <>
                Connected to <span className="font-mono">{src.instance?.replace(/^https?:\/\//, '')}</span>
                {src.error && <div className="text-xs text-rose-600 dark:text-rose-400">{src.error}</div>}
              </>
            ) : (
              <>
                <div className="font-medium">Not connected · demo mode</div>
                <div className="mt-1 text-xs text-muted-foreground">Incidents are stored locally in the data folder.</div>
              </>
            )}
          </div>
        </div>
        <div className="rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          To connect, copy <code className="font-mono">stacklens/frontend/.env.example</code> to{' '}
          <code className="font-mono">.env.local</code>, set <code className="font-mono">SERVICENOW_INSTANCE</code> and either{' '}
          <code className="font-mono">SERVICENOW_USERNAME</code>/<code className="font-mono">SERVICENOW_PASSWORD</code> or{' '}
          <code className="font-mono">SERVICENOW_TOKEN</code>, then restart the server. Credentials stay on the server and are never sent to
          the browser.
        </div>
      </Section>
      <Section title="Collector" description="Where your instrumented apps send traces.">
        <Field label="Ingest endpoint">
          <code className="rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs">
            {typeof window !== 'undefined' ? window.location.origin : ''}/api/ingest
          </code>
        </Field>
        <Field label="Tracer config" hint="Set in your app">
          <code className="font-mono text-xs text-muted-foreground">STACKLENS_ENDPOINT=…/api/ingest</code>
        </Field>
      </Section>
    </div>
  );
}
